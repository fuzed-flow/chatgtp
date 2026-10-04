import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(ROOT + '/package.json');
const {parse} = require('@babel/parser');
const plain = value => JSON.parse(JSON.stringify(value));
const readPage = async file => {
  const source = await fs.readFile(ROOT + '/src/pages/' + file + '.jsx', 'utf8');
  const page = parse(source, {sourceType: 'module', plugins: ['jsx']}).program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const declarations = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : []);
  return {source, page, declarations};
};
const oldTestSource = await fs.readFile(ROOT + '/tests/unsaved-changes/builder-saves.test.mjs', 'utf8');
const oldTestAST = parse(oldTestSource, {sourceType: 'module'});
const fixtureNode = oldTestAST.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'fixture');
const fixtureCode = oldTestSource.slice(fixtureNode.start, fixtureNode.end).replace('new URL(`../../src/pages/${builder.file}.jsx`, import.meta.url)', '`' + ROOT + '/src/pages/${builder.file}.jsx`');
const saveFixture = vm.runInNewContext('(' + fixtureCode + ')', {fs, vm, parse, assert});
const builders = [
  {name: 'quote', file: 'QuoteBuilder', table: 'quotes', id: 'quoteId', children: ['quote_line_items', 'quote_phases', 'quote_payment_schedules']},
  {name: 'change order', file: 'ChangeOrderBuilder', table: 'change_orders', id: 'coId', children: ['change_order_line_items', 'change_order_phases']},
];

async function requestReviewFixture(builder, options) {
  const view = await saveFixture(builder, options);
  const {source, declarations} = await readPage(builder.file);
  const method = declarations.find(node => node.id.name === 'handleRequestInternalReview').init;
  view.state.handleSave = view.save;
  view.requestReview = vm.runInNewContext('(' + source.slice(method.start, method.end) + ')', view.state);
  return view;
}

for (const builder of builders) {
  test(builder.name + ' hydrates saved follow-up/review fields', async () => {
    const {source, page} = await readPage(builder.file);
    const variable = builder.name === 'quote' ? 'existingQuote' : 'existingCO';
    const effect = page.body.body.filter(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'useEffect')
      .map(node => node.expression.arguments[0]).find(node => source.slice(node.start,node.end).includes('hydrateLocalTitle(' + variable));
    assert.ok(effect);
    const view = await saveFixture(builder);
    Object.assign(view.state, {
      [variable]: {id:'document-one', issue_date:'2026-10-04', next_follow_up_date:'2026-10-09', approval_due_date:'2026-10-10', internal_review_status:'Approved', internal_reviewed_by:'reviewer', internal_reviewed_at:'2026-10-04T15:00:00Z'},
      setManualDeposit() {}, hydrateLocalTitle() {}, hydrateLocalOverallScope() {}, hydrateLocalClientMessage() {}, hydrateLocalTerms() {}, hydrateLocalNotes() {},
    });
    vm.runInNewContext('(' + source.slice(effect.start,effect.end) + ')()', view.state);
    assert.equal(view.state.form.next_follow_up_date, '2026-10-09');
    if (builder.table === 'change_orders') assert.equal(view.state.form.approval_due_date, '2026-10-10');
    assert.equal(view.state.form.internal_review_status, 'Approved');
    assert.equal(view.state.form.internal_reviewed_by, 'reviewer');
  });

  test(builder.name + ' saves calendar dates and clearing persists null', async () => {
    const view = await saveFixture(builder);
    view.state.form.next_follow_up_date = '2026-10-09';
    view.state.form.approval_due_date = '2026-10-10';
    assert.equal(await view.save(), 'document-one');
    const first = view.calls.find(call => call.table === builder.table && call.action === 'update');
    assert.equal(first.payload.next_follow_up_date, '2026-10-09');
    if (builder.table === 'change_orders') assert.equal(first.payload.approval_due_date, '2026-10-10');
    view.state.form.next_follow_up_date = '';
    view.state.form.approval_due_date = '';
    assert.equal(await view.save(), 'document-one');
    const last = view.calls.filter(call => call.table === builder.table && call.action === 'update').at(-1);
    assert.equal(last.payload.next_follow_up_date, null);
    if (builder.table === 'change_orders') assert.equal(last.payload.approval_due_date, null);
  });

  test(builder.name + ' request review sets canonical state and ordinary save preserves independent decisions', async () => {
    const view = await requestReviewFixture(builder);
    view.state.form.internal_review_status = 'Approved';
    view.state.form.internal_reviewed_by = 'old-reviewer';
    assert.equal(await view.requestReview(), 'document-one');
    const review = view.calls.find(call => call.table === builder.table && call.action === 'update' && call.payload.status === 'Pending Review');
    assert.equal(review.payload.status, 'Pending Review');
    assert.equal(review.payload.internal_review_status, 'Pending');
    assert.equal(review.payload.internal_reviewed_by, null);
    assert.equal(review.payload.internal_reviewed_at, null);
    assert.deepEqual(plain(review.filters), [['id','document-one'], ['company_id','company-one'], ['status','Draft']]);
    const preliminarySave = view.calls.find(call => call.table === builder.table && call.action === 'update');
    assert.deepEqual(plain(preliminarySave.filters), [['id','document-one'], ['company_id','company-one'], ['status','Draft']], 'The preliminary save cannot overwrite a concurrent customer decision.');
    assert.ok(view.calls.indexOf(review) > view.calls.findLastIndex(call => builder.children.includes(call.table)), 'Review starts only after every child write succeeds.');
    assert.equal(view.state.form.internal_review_status, 'Pending');
    await view.save();
    const ordinary = view.calls.filter(call => call.table === builder.table && call.action === 'update').at(-1);
    assert.equal(Object.hasOwn(ordinary.payload, 'internal_review_status'), false, 'A routine save must not overwrite a reviewer decision.');
  });

  test(builder.name + ' failed child save never submits a review or clears unsaved edits', async () => {
    const view = await requestReviewFixture(builder, {fail:{table:builder.children[0],action:'insert'}});
    assert.equal(await view.requestReview(), null);
    assert.equal(view.calls.some(call => call.payload?.status === 'Pending Review'), false);
    assert.equal(view.state.form.status, 'Draft');
    assert.equal(view.dirty, true);
  });

  test(builder.name + ' edits arriving during save postpone the review request', async () => {
    let edited = false;
    const view = await requestReviewFixture(builder, {onQuery(query, edit) {
      if (!edited && query.table === builder.table) { edited=true; edit(); }
    }});
    assert.equal(await view.requestReview(), null);
    assert.equal(view.calls.some(call => call.payload?.status === 'Pending Review'), false);
    assert.equal(view.dirty, true);
  });

  test(builder.name + ' client-decided documents cannot be submitted for internal review', async () => {
    for (const status of ['Approved','Accepted','Invoiced','Paid','Declined','Rejected','Cancelled']) {
      const view = await requestReviewFixture(builder);
      view.state.form.status=status;
      assert.equal(await view.requestReview(), null);
      assert.equal(view.calls.length, 0, status + ' must remain unchanged.');
    }
  });

  test(builder.name + ' a conflicting final review update leaves the saved draft out of review', async () => {
    const fail = {};
    const view = await requestReviewFixture(builder, {fail, onQuery(query) {
      if (query.payload?.status === 'Pending Review') Object.assign(fail, {table:builder.table,action:'update'});
    }});
    assert.equal(await view.requestReview(), null);
    assert.equal(view.state.form.status, 'Draft');
    assert.equal(view.dirty, false, 'The draft was saved even though review could not be requested.');
    assert.ok(view.errors.some(message => message.includes('review could not be requested')));
  });
}

function database(result = {data:{id:'document'}, error:null}, pending) {
  const writes=[];
  return {writes, from(table) {
    const record={table, filters:[]};
    const chain={update(payload) {record.payload=plain(payload);return chain;}, eq(field,value) {record.filters.push([field,value]);return chain;}, select() {return chain;}, single() {writes.push(record);return pending || Promise.resolve(result);}};
    return chain;
  }};
}

const approvals = await readPage('Approvals');
const mutation = approvals.declarations.find(node => node.id.name === 'internalReviewMutation').init.arguments[0].properties.find(node => node.key.name === 'mutationFn').value;
for (const documentType of ['quote','change_order']) for (const outcome of ['Approved','Changes Required']) {
  test(documentType + ' internal ' + outcome + ' remains a Draft and records reviewer identity', async () => {
    const db=database();
    const run=vm.runInNewContext('(' + approvals.source.slice(mutation.start,mutation.end) + ')', {supabase:db,companyId:'company',profile:{id:'reviewer'}});
    await run({id:'document',documentType,outcome});
    assert.equal(db.writes[0].table, documentType==='quote'?'quotes':'change_orders');
    assert.equal(db.writes[0].payload.status,'Draft');
    assert.equal(db.writes[0].payload.internal_review_status,outcome);
    assert.equal(db.writes[0].payload.internal_reviewed_by,'reviewer');
    assert.ok(Number.isFinite(Date.parse(db.writes[0].payload.internal_reviewed_at)));
    assert.deepEqual(db.writes[0].filters,[['id','document'],['company_id','company'],['status','Pending Review']]);
  });
}
test('a stale internal review cannot report successful approval', async () => {
  const db=database({data:null,error:null});
  const run=vm.runInNewContext('(' + approvals.source.slice(mutation.start,mutation.end) + ')', {supabase:db,companyId:'company',profile:{id:'reviewer'}});
  await assert.rejects(run({id:'document',documentType:'quote',outcome:'Approved'}));
});

for (const [file, handler, variable, key] of [['PublicQuoteView','handleDeclineQuote','quote','public-quote'],['PublicChangeOrderView','handleDeclineChangeOrder','changeOrder','public-co']]) {
  const page=await readPage(file);
  const method=page.declarations.find(node=>node.id.name===handler).init;
  const fixture=(result,pending)=> {
    const db=database(result,pending);
    const state={dialogOpen:true,reason:'  Budget changed  ',busy:false,success:[],errors:[],invalidations:[]};
    const context={supabase:db,[variable]:{id:'document',company_id:'company',status:'Sent'},quoteId:'document',changeOrderId:'document',declineReason:state.reason,
      decisionInFlight:{current:false},setIsDeclining:value=>{state.busy=value;},setDeclineDialogOpen:value=>{state.dialogOpen=value;},setDeclineReason:value=>{state.reason=value;},
      queryClient:{invalidateQueries:async options=>state.invalidations.push(plain(options.queryKey))},toast:{success:message=>state.success.push(message),error:message=>state.errors.push(message)}};
    const run=vm.runInNewContext('(' + page.source.slice(method.start,method.end) + ')',context);
    return {db,state,context,run};
  };
  test(file + ' decline records reason with company and optimistic status guards',async()=>{
    const view=fixture();await view.run();
    assert.equal(view.db.writes[0].payload.status,'Declined');
    assert.equal(view.db.writes[0].payload.decline_reason,'Budget changed');
    assert.deepEqual(view.db.writes[0].filters,[['id','document'],['company_id','company'],['status','Sent']]);
    assert.equal(view.state.dialogOpen,false);assert.equal(view.state.reason,'');assert.equal(view.state.success.length,1);
    assert.deepEqual(view.state.invalidations,[[key,'document']]);assert.equal(view.state.busy,false);
  });
  for (const error of [{message:'Synthetic denial'},null]) test(file + ' rejected/missing row keeps confirmation and reason',async()=>{
    const view=fixture({data:null,error});await view.run();
    assert.equal(view.state.dialogOpen,true);assert.equal(view.state.reason,'  Budget changed  ');assert.equal(view.state.success.length,0);assert.equal(view.state.errors.length,1);assert.equal(view.state.busy,false);
  });
  test(file + ' duplicate confirm cannot write twice while the first decision is pending',async()=>{
    let resolve;const pending=new Promise(done=>{resolve=done;});const view=fixture(undefined,pending);
    const first=view.run();await view.run();assert.equal(view.db.writes.length,1);
    resolve({data:{id:'document'},error:null});await first;assert.equal(view.state.success.length,1);
  });
  test(file + ' terminal states and pending internal review prevent public accept and decline',async()=>{
    const accept=page.declarations.find(node=>node.id.name===(variable==='quote'?'handleAcceptQuote':'handleAcceptChangeOrder')).init;
    for(const status of ['Approved','Accepted','Paid','Invoiced','Declined','Rejected','Pending Review']) {
      const view=fixture(); view.context[variable].status=status;
      await view.run();
      await vm.runInNewContext('(' + page.source.slice(accept.start,accept.end) + ')',view.context)();
      assert.equal(view.db.writes.length,0,status); assert.equal(view.state.success.length,0); assert.equal(view.state.errors.length,2);
    }
  });

  test(file + ' actual public action gate hides decision buttons during internal review',()=>{
    const nodes=[];
    const walk=node=> {
      if (!node || typeof node!=='object') return;
      if (node.type==='LogicalExpression' && node.operator==='&&') nodes.push(node);
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value==='object') walk(value);
    };
    walk(page.page);
    const acceptHandler=variable==='quote'?'handleAcceptQuote':'handleAcceptChangeOrder';
    const gate=nodes.find(node=>page.source.slice(node.right.start,node.right.end).includes('onClick={' + acceptHandler + '}'));
    assert.ok(gate, 'The actual JSX gates the public response controls.');
    const evaluate=status=>vm.runInNewContext(page.source.slice(gate.left.start,gate.left.end),{[variable]:{status}});
    for(const status of ['Approved','Accepted','Paid','Invoiced','Declined','Rejected','Pending Review']) assert.equal(evaluate(status),false,status);
    assert.equal(evaluate('Sent'),true);
    assert.equal(evaluate('Draft'),true,'Existing draft behavior is preserved.');
  });
}

test('Approved quote keeps its separate deposit payment action',async()=>{
  const page=await readPage('PublicQuoteView');
  const nodes=[];
  const walk=node=> {
    if (!node || typeof node!=='object') return;
    if (node.type==='LogicalExpression' && node.operator==='&&') nodes.push(node);
    for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(walk); else if(value && typeof value==='object') walk(value);
  };
  walk(page.page);
  const gate=nodes.find(node=>page.source.slice(node.right.start,node.right.end).includes('onClick={handlePayDeposit}'));
  assert.ok(gate);
  const evaluate=(status,deposit_amount)=>vm.runInNewContext(page.source.slice(gate.left.start,gate.left.end),{quote:{status,deposit_amount}});
  assert.equal(evaluate('Approved',100),true);assert.equal(evaluate('Approved',0),false);assert.equal(evaluate('Paid',100),false);
});
