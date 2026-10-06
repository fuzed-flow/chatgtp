import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parse } from '@babel/parser';

// Execute each production save handler against a synthetic database. This catches
// early returns, unchecked child-write failures, and clearing dirty state too soon.
const builders = [
  { name: 'quote', file: 'QuoteBuilder', table: 'quotes', id: 'quoteId', children: ['quote_line_items', 'quote_phases', 'quote_payment_schedules'] },
  { name: 'change order', file: 'ChangeOrderBuilder', table: 'change_orders', id: 'coId', children: ['change_order_line_items', 'change_order_phases'] },
  { name: 'invoice', file: 'InvoiceBuilder', table: 'invoices', id: 'invoiceId', children: ['invoice_line_items', 'invoice_phases', 'invoice_payment_schedules'] },
];

async function fixture(builder, options = {}) {
  const source = await fs.readFile(new URL(`../../src/pages/${builder.file}.jsx`, import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const page = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const declaration = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
    .find(node => node.id.name === 'handleSave');
  assert.ok(declaration, 'Production save handler exists.');
  const calls = [];
  const errors = [];
  let savedRevision = null;
  let revision = 3;
  let dirty = true;
  let saving = false;
  let parentInserts = 0;
  const state = {
    [builder.id]: options.newDocument ? null : 'document-one',
    companyId: 'company-one', company: { next_quote_number: 1001, next_change_order_number: 101, next_invoice_number: 1001 },
    existingQuote: null, existingInvoice: options.newDocument ? null : { invoice_number: 'INV-1001', status: 'Draft' },
    isTemplate: false, isDocumentLoading: false, documentLoading: false, isQuoteImportPending: false, invoiceLoadError: false, quoteImportError: false,
    localTitle: 'Focused title', localOverallScope: 'Focused scope', localClientMessage: 'Focused message', localTerms: 'Focused terms', localNotes: 'Focused notes',
    form: { title: 'Old blurred title', project_id: 'project-one', client_id: 'client-0000000001', lead_id: 'none', quote_id: 'none', status: 'Draft',
      quote_number: options.newDocument ? '' : 'QT-1001', change_order_number: options.newDocument ? '' : 'CO-101',
      has_payment_schedule: true, due_terms: 'net_30', show_notes: true },
    phases: options.phases || [{ phase_name: 'Phase', sort_order: 0, items: [{ name: 'Item', quantity: 2, unit_price: 25, unit_cost: 10, supplier: 'Focused supplier', is_material: true, taxable: true }] }],
    paymentScheduleItems: [{ payment_name: 'Payment', due_event: 'Completion', amount: 50, amount_type: 'fixed' }],
    manualItems: [{ name: 'Manual charge', amount: 5 }],
    pdfSettings: {}, currentMarginAmount: 0, effectiveSubtotal: 50, grandTax: 0, grandTotal: 50,
    currentSubtotal: 55, currentTax: 0, currentTotal: 55, currentBalance: 55,
    saveInFlight: { current: false }, savingRef: { current: false }, saveInProgress: { current: false }, pendingCounterUpdate: { current: null },
    hydratedQuoteId: { current: null }, hasLoadedDocument: { current: null }, hydratedInvoiceId: { current: null }, hydratedInvoiceStatus: { current: 'Draft' }, allocatedInvoiceNumber: { current: null },
    hasLoadedPhases: { current: true }, hasLoadedSchedule: { current: true }, hasLoadedManualItems: { current: true },
    safeNum: value => Number(value) || 0, isPhaseActive: () => true, isItemActive: () => true,
    getRevision: () => revision,
    markSaved: value => { savedRevision = value; if (value !== revision) return false; dirty = false; return true; },
    setSaving: value => { saving = value; },
    hydrateForm: value => { state.form = typeof value === 'function' ? value(state.form) : value; },
    setQuoteId: value => { state.quoteId = value; }, setCoId: value => { state.coId = value; }, setInvoiceId: value => { state.invoiceId = value; },
    createPageUrl: value => `/${value}`, navigate: path => { calls.push({ navigation: path }); },
    window: { history: { state: { idx: 1, key: 'original' }, replaceState: (...args) => { calls.push({ history: args }); } } },
    toast: { loading() {}, dismiss() {}, success() {}, info() {}, error: message => errors.push(message) },
    console: { error() {} },
    queryClient: { invalidateQueries: async () => undefined },
  };
  state.supabase = { from(table) {
    const query = { table, action: 'select', payload: null, filters: [] };
    let result;
    const chain = {
      insert(payload) { query.action = 'insert'; query.payload = payload; return chain; },
      update(payload) { query.action = 'update'; query.payload = payload; return chain; },
      delete() { query.action = 'delete'; return chain; },
      select() { return chain; }, single() { return chain; },
      eq(key, value) { query.filters.push([key, value]); return chain; },
      then(resolve, reject) {
        if (!result) result = (async () => {
          calls.push(query);
          if (query.table === builder.table && query.action === 'insert') parentInserts += 1;
          if (options.onQuery) await options.onQuery(query, () => { revision += 1; });
          if (options.fail?.table === query.table && options.fail.action === query.action) return { data: null, error: { message: 'Synthetic persistence failure' } };
          return { data: { id: query.table === builder.table ? 'saved-document' : `${query.table}-one`, ...(query.table === 'invoices' ? { status: options.persistedStatus || query.payload?.status || query.payload?.[0]?.status || 'Draft' } : {}) }, error: null };
        })();
        return result.then(resolve, reject);
      },
    };
    return chain;
  } };
  const context = vm.createContext(state);
  const save = vm.runInContext(`(${source.slice(declaration.init.start, declaration.init.end)})`, context);
  return { save, state, calls, errors, get dirty() { return dirty; }, get saving() { return saving; }, get savedRevision() { return savedRevision; }, get parentInserts() { return parentInserts; } };
}

for (const builder of builders) {
  test(`${builder.name} parent-write failure keeps the document open and unsaved`, async () => {
    const view = await fixture(builder, { fail: { table: builder.table, action: 'update' } });
    assert.equal(await view.save(), null);
    assert.equal(view.dirty, true);
    assert.equal(view.saving, false);
    assert.equal(view.savedRevision, null);
    assert.ok(!view.calls.some(call => builder.children.includes(call.table)));
  });

  test(`${builder.name} saves the parent and all child data before clearing unsaved changes`, async () => {
    const view = await fixture(builder);
    assert.equal(await view.save(), 'document-one');
    assert.equal(view.dirty, false);
    assert.equal(view.saving, false);
    assert.equal(view.savedRevision, 3);
    assert.deepEqual(view.errors, []);
    for (const table of builder.children) assert.ok(view.calls.some(call => call.table === table && call.action === 'insert'), `${table} was persisted`);
    const parent = view.calls.find(call => call.table === builder.table && call.action === 'update');
    if (builder.name !== 'invoice') {
      assert.equal(parent.payload.title, 'Focused title', 'Current focused text is saved without requiring blur.');
      assert.equal(parent.payload.notes, 'Focused notes');
    }
  });

  test(`${builder.name} persists the current phase order instead of stale sort values`, async () => {
    const view = await fixture(builder, { phases: [
      { phase_name: 'Third moved first', sort_order: 2, items: [] },
      { phase_name: 'First moved second', sort_order: 0, items: [] },
      { phase_name: 'Second moved third', sort_order: 1, items: [] },
    ] });

    assert.equal(await view.save(), 'document-one');
    const phaseWrites = view.calls.filter(call => call.table === builder.children[1] && call.action === 'insert');
    assert.deepEqual(phaseWrites.map(call => call.payload[0].phase_name), [
      'Third moved first',
      'First moved second',
      'Second moved third',
    ]);
    assert.deepEqual(phaseWrites.map(call => call.payload[0].sort_order), [0, 1, 2]);
  });

  for (const table of builder.children) for (const action of ['delete', 'insert']) {
    test(`${builder.name} ${table} ${action} failure keeps edits unsaved and does not navigate`, async () => {
      const view = await fixture(builder, { fail: { table, action } });
      assert.equal(await view.save('Sent'), null);
      assert.equal(view.dirty, true);
      assert.equal(view.savedRevision, null);
      assert.equal(view.saving, false);
      assert.equal(view.state.form.status, 'Draft', 'A failed save does not mark the document Sent.');
      assert.ok(view.errors.some(message => message.includes('Synthetic persistence failure')));
      assert.ok(!view.calls.some(call => call.navigation));
    });
  }

  test(`${builder.name} edits arriving during persistence remain unsaved`, async () => {
    let changed = false;
    const view = await fixture(builder, { onQuery(query, edit) {
      if (!changed && query.table === builder.table) { changed = true; edit(); }
    } });
    assert.equal(await view.save(), 'document-one');
    assert.equal(view.dirty, true);
    assert.equal(view.savedRevision, 3);
  });

  test(`${builder.name} retries a partially saved new document without inserting a duplicate parent`, async () => {
    const failure = { table: builder.children[0], action: 'insert' };
    const view = await fixture(builder, { newDocument: true, fail: failure });
    assert.equal(await view.save(), null);
    assert.equal(view.state[builder.id], 'saved-document');
    failure.table = null;
    assert.equal(await view.save(), 'saved-document');
    assert.equal(view.parentInserts, 1);
    assert.equal(view.dirty, false);
    assert.equal(view.saving, false);
  });

  test(`${builder.name} retries a failed document-number update without duplicating or renumbering the document`, async () => {
    const failure = { table: 'companies', action: 'update' };
    const view = await fixture(builder, { newDocument: true, fail: failure });
    assert.equal(await view.save(), null);
    assert.equal(view.dirty, true);
    assert.equal(view.state[builder.id], 'saved-document');
    assert.notEqual(view.state.pendingCounterUpdate.current, null);
    failure.table = null;
    assert.equal(await view.save(), 'saved-document');
    assert.equal(view.parentInserts, 1);
    assert.equal(view.state.pendingCounterUpdate.current, null);
    const parentWrites = view.calls.filter(call => call.table === builder.table);
    const numberKey = builder.name === 'quote' ? 'quote_number' : builder.name === 'invoice' ? 'invoice_number' : 'change_order_number';
    assert.equal(parentWrites[0].payload[0][numberKey], parentWrites[1].payload[numberKey]);
    assert.equal(view.dirty, false);
  });
}

test('invoice saves ordinary edits without overwriting a newer accounting status', async () => {
  const invoice = builders.find(builder => builder.name === 'invoice');
  const view = await fixture(invoice, { persistedStatus: 'Paid' });

  assert.equal(await view.save(), 'document-one');
  const parent = view.calls.find(call => call.table === 'invoices' && call.action === 'update');
  assert.equal(Object.hasOwn(parent.payload, 'status'), false, 'An unchanged local status is omitted from the update.');
  assert.equal(view.state.form.status, 'Paid', 'The authoritative saved status is reconciled into the form.');
  assert.equal(view.state.hydratedInvoiceStatus.current, 'Paid');
});

test('invoice delivery reconciles the authoritative status after email or text succeeds', async () => {
  const source = await fs.readFile(new URL('../../src/pages/InvoiceBuilder.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const page = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const declaration = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
    .find(node => node.id.name === 'reconcileDeliveryStatus');
  assert.ok(declaration, 'Invoice Builder has an authoritative delivery-status reconciler.');

  const events = [];
  const form = { status: 'Draft', notes: 'Keep this edit' };
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { status: 'Partial' }, error: null }),
  };
  const context = vm.createContext({
    sendInvoiceId: 'sent-invoice', invoiceId: 'stale-invoice', companyId: 'company-one',
    queryClient: { invalidateQueries: ({ queryKey }) => events.push(queryKey.join(':')) },
    supabase: { from: () => chain },
    hydratedInvoiceStatus: { current: 'Draft' },
    hydrateForm: updater => Object.assign(form, updater(form)),
    toast: { warning: message => events.push(message) },
  });
  const reconcile = vm.runInContext(`(${source.slice(declaration.init.start, declaration.init.end)})`, context);
  await reconcile();

  assert.equal(form.status, 'Partial');
  assert.equal(form.notes, 'Keep this edit');
  assert.equal(context.hydratedInvoiceStatus.current, 'Partial');
  assert.ok(events.includes('invoice:sent-invoice'));
});

test('invoice delivery saves unsaved edits before opening the email dialog', async () => {
  const source = await fs.readFile(new URL('../../src/pages/InvoiceBuilder.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const page = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const declaration = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
    .find(node => node.id.name === 'openSendDialog');
  assert.ok(declaration, 'Invoice Builder has a guarded delivery opener.');

  const events = [];
  let dirtyCheck = 0;
  const context = vm.createContext({
    invoiceId: 'saved-invoice',
    hasUnsavedChanges: () => dirtyCheck++ === 0,
    handleSave: async () => { events.push('save'); return 'saved-invoice'; },
    setSendInvoiceId: id => events.push(`id:${id}`),
    setSendMethod: method => events.push(`method:${method}`),
    setEmailDialog: open => events.push(`open:${open}`),
    toast: {info: message => events.push(`info:${message}`)},
  });
  const openSendDialog = vm.runInContext(`(${source.slice(declaration.init.start, declaration.init.end)})`, context);
  await openSendDialog('email');
  assert.deepEqual(events, ['save', 'id:saved-invoice', 'method:email', 'open:true']);
});

test('invoice delivery stays closed when saving unsaved edits fails', async () => {
  const source = await fs.readFile(new URL('../../src/pages/InvoiceBuilder.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const page = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const declaration = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
    .find(node => node.id.name === 'openSendDialog');
  const events = [];
  const context = vm.createContext({
    invoiceId: 'saved-invoice',
    hasUnsavedChanges: () => true,
    handleSave: async () => { events.push('save-failed'); return null; },
    setSendInvoiceId: id => events.push(`id:${id}`),
    setSendMethod: method => events.push(`method:${method}`),
    setEmailDialog: open => events.push(`open:${open}`),
    toast: {info: message => events.push(`info:${message}`)},
  });
  const openSendDialog = vm.runInContext(`(${source.slice(declaration.init.start, declaration.init.end)})`, context);
  await openSendDialog('email');
  assert.deepEqual(events, ['save-failed']);
});

test('invoice delivery stays closed when another edit arrives during its save', async () => {
  const source = await fs.readFile(new URL('../../src/pages/InvoiceBuilder.jsx', import.meta.url), 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const page = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  const declaration = page.body.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
    .find(node => node.id.name === 'openSendDialog');
  const events = [];
  const context = vm.createContext({
    invoiceId: 'saved-invoice',
    hasUnsavedChanges: () => true,
    handleSave: async () => { events.push('save'); return 'saved-invoice'; },
    setSendInvoiceId: id => events.push(`id:${id}`),
    setSendMethod: method => events.push(`method:${method}`),
    setEmailDialog: open => events.push(`open:${open}`),
    toast: {info: message => events.push(`info:${message}`)},
  });
  const openSendDialog = vm.runInContext(`(${source.slice(declaration.init.start, declaration.init.end)})`, context);
  await openSendDialog('email');
  assert.equal(events[0], 'save');
  assert.equal(events.length, 2);
  assert.match(events[1], /^info:The invoice changed while it was saving/);
  assert.ok(!events.some(event => event.startsWith('open:')));
});
