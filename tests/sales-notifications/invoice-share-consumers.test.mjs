import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=new URL('../../',import.meta.url);
const bundle=await build({
  entryPoints:[fileURLToPath(new URL('supabase/functions/invoice-reminder-cron/index.ts',root))],
  bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
  plugins:[{name:'synthetic-reminder-dependencies',setup(builder){
    builder.onResolve({filter:/^https:\/\//},args=>({path:args.path,namespace:'synthetic'}));
    builder.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'js',contents:
      args.path.includes('supabase-js') ? 'export const createClient=(...args)=>globalThis.testClient(...args);' :
      args.path.includes('/http/server.ts') ? 'export const serve=handler=>globalThis.captureHandler(handler);' :
      (()=>{throw new Error('Unexpected remote import: '+args.path);})()}));
  }}],
});

const COMPANY='00000000-0000-4000-8000-000000000001';
const CLIENT='00000000-0000-4000-8000-000000000002';
const INVOICE='00000000-0000-4000-8000-000000000003';
const TOKEN='a'.repeat(64);
const SERVICE='synthetic-service';
const NOW=Date.UTC(2026,9,6,12);
const plain=value=>JSON.parse(JSON.stringify(value));
class FixedDate extends Date {constructor(...args){super(...(args.length ? args : [NOW]));}static now(){return NOW;}}

function fixture(options={}) {
  let handler;
  const fetches=[],updates=[],rpcs=[],errors=[];
  const invoices=options.invoices || [{
    id:INVOICE,invoice_number:'INV-SYNTHETIC',status:'Sent',due_date:'2026-10-06',automation_stage:0,
    client_id:CLIENT,company_id:COMPANY,
    companies:{id:COMPANY,name:'Synthetic & Co',settings:{automations:{invoice_enabled:true,invoice_predue:3,invoice_overdue_1:3,invoice_overdue_2:14}}},
    clients:{name:'Client <One>',email:'client@example.invalid',phone:'+17805551234'},
  }];
  const db={from(table){assert.equal(table,'invoices');const query={operation:'select',filters:[]};
    const chain={select(){return chain;},in(key,values){query.filters.push([key,values]);return chain;},update(payload){query.operation='update';query.payload=plain(payload);return chain;},eq(key,value){query.filters.push([key,value]);return chain;},then(resolve,reject){
      if(query.operation==='update'){updates.push(plain(query));return Promise.resolve({data:null,error:null}).then(resolve,reject);}
      return Promise.resolve({data:plain(invoices),error:null}).then(resolve,reject);
    }};return chain;
  },async rpc(name,args){rpcs.push({name,args:plain(args)});assert.equal(name,'issue_invoice_reminder_share_token');
    return options.issueError ? {data:null,error:{message:'synthetic issue failure'}} : {data:options.token ?? TOKEN,error:null};
  }};
  const env={SUPABASE_URL:'https://synthetic.supabase.invalid',SUPABASE_SERVICE_ROLE_KEY:SERVICE,APP_URL:'https://app.fuzedflow.com'};
  vm.runInNewContext(bundle.outputFiles[0].text,{
    Request,Response,Headers,URL,TextEncoder,Uint8Array,crypto:webcrypto,Date:FixedDate,
    Deno:{env:{get:key=>env[key]}},captureHandler:value=>{handler=value;},testClient:()=>db,
    fetch:async(url,config)=>{fetches.push({url:String(url),body:JSON.parse(config.body)});return Response.json({success:options.deliveryFailure!==true},{status:options.deliveryFailure===true?503:200});},
    console:{log(){},warn(){},error:message=>errors.push(message)},
  },{timeout:1000});
  const request=()=>new Request('https://synthetic.supabase.invalid/functions/v1/invoice-reminder-cron',{method:'POST',headers:{Authorization:`Bearer ${SERVICE}`}});
  return {handler,request,fetches,updates,rpcs,errors};
}

test('Invoice reminder issues a private link before delivery and keeps it in both channels',async()=>{
  const view=fixture();const response=await view.handler(view.request());assert.equal(response.status,200);
  assert.deepEqual(view.rpcs,[{name:'issue_invoice_reminder_share_token',args:{p_invoice:INVOICE,p_stage:1}}]);assert.equal(view.fetches.length,2);
  const email=view.fetches.find(call=>call.url.endsWith('/send-email')).body;
  const sms=view.fetches.find(call=>call.url.endsWith('/send-sms')).body;
  assert.match(email.html_body,new RegExp(`id=${INVOICE}&amp;token=${TOKEN}`));
  assert.match(sms.message_body,new RegExp(`id=${INVOICE}&token=${TOKEN}`));
  assert.doesNotMatch(email.html_body,/Client <One>|Synthetic & Co/);
  assert.deepEqual(view.updates[0].payload,{automation_stage:1});
});

for(const options of [{issueError:true},{token:'invalid'}]) test('Invoice reminder never sends or advances when its private link cannot be issued '+JSON.stringify(options),async()=>{
  const view=fixture(options);assert.equal((await view.handler(view.request())).status,200);
  assert.equal(view.fetches.length,0);assert.equal(view.updates.length,0);assert.equal(view.rpcs.length,1);assert.equal(view.errors.length,1);
});

test('Invoice reminder does not issue a link when no automation stage is due',async()=>{
  const view=fixture({invoices:[{
    id:INVOICE,invoice_number:'INV-SYNTHETIC',status:'Sent',due_date:'2026-10-20',automation_stage:0,client_id:CLIENT,company_id:COMPANY,
    companies:{id:COMPANY,name:'Synthetic',settings:{automations:{invoice_enabled:true,invoice_predue:3,invoice_overdue_1:3,invoice_overdue_2:14}}},
    clients:{name:'Client',email:'client@example.invalid',phone:null},
  }]});
  assert.equal((await view.handler(view.request())).status,200);assert.equal(view.rpcs.length,0);assert.equal(view.fetches.length,0);assert.equal(view.updates.length,0);
});

test('Invoice reminder retry uses the same stage-scoped link and does not advance after delivery failure',async()=>{
  const view=fixture({deliveryFailure:true});
  assert.equal((await view.handler(view.request())).status,200);assert.equal((await view.handler(view.request())).status,200);
  assert.equal(view.updates.length,0);assert.equal(view.rpcs.length,2);
  assert.deepEqual(view.rpcs.map(call=>call.args),[
    {p_invoice:INVOICE,p_stage:1},
    {p_invoice:INVOICE,p_stage:1},
  ]);
  const emailLinks=view.fetches.filter(call=>call.url.endsWith('/send-email')).map(call=>call.body.html_body.match(/href="([^"]+)/)[1]);
  const smsLinks=view.fetches.filter(call=>call.url.endsWith('/send-sms')).map(call=>call.body.message_body.match(/https:\/\/[^\s]+/)[0]);
  assert.equal(emailLinks[0],emailLinks[1]);assert.equal(smsLinks[0],smsLinks[1]);
});

test('Invoice text dialog appends only a tokenized link after successful token issuance',async()=>{
  const source=await fs.readFile(new URL('../../src/components/invoices/SendInvoiceTextDialog.jsx',import.meta.url),'utf8');
  const issue=source.indexOf('issue_invoice_share_token');
  const delivery=source.indexOf("supabase.functions.invoke('send-sms'");
  assert.ok(issue>0 && delivery>issue,'token issuance must precede SMS delivery');
  assert.match(source,/searchParams\.set\("id", invoiceId\)/);assert.match(source,/searchParams\.set\("token", token\)/);
  assert.doesNotMatch(source,/PublicInvoiceView\?id=\$\{invoice\.id\}/);
  assert.match(source,/shareError \|\| typeof shareToken !== "string" \|\| !\/\^\[a-f0-9\]\{64\}\$\/i\.test\(shareToken\)/);
  assert.match(source,/payload: \{[\s\S]*phone_number: phone\.trim\(\)[\s\S]*message_body: finalSmsPayload/);
  assert.match(source,/body: \{ \.\.\.intent\.payload, request_id: intent\.requestId \}/);
  assert.match(source,/retryMode === "status" \? "Retry status"/);
  assert.match(source,/Close &amp; check history/);
});

test('Invoice text retry after an accepted SMS updates status without sending a duplicate',async()=>{
  const source=await fs.readFile(new URL('../../src/components/invoices/SendInvoiceTextDialog.jsx',import.meta.url),'utf8');
  const ast=(await import('@babel/parser')).parse(source,{sourceType:'module',plugins:['jsx']});
  const component=ast.program.body.find(node=>node.type==='ExportDefaultDeclaration').declaration;
  const declaration=component.body.body.flatMap(node=>node.type==='VariableDeclaration'?node.declarations:[])
    .find(node=>node.id.name==='handleSend');
  assert.ok(declaration);

  let invokeCount=0,statusWrites=0,statusShouldFail=true,closed=false,succeeded=false;
  const context={
    phone:'+17805551234',message:'Invoice ready',portalLink:'',retryMode:null,errorMessage:'',
    invoice:{id:INVOICE},profile:{company_id:COMPANY},sendIntent:{current:null},
    crypto:webcrypto,buildSecureInvoiceUrl:(invoiceId,token)=>`https://app.fuzedflow.com/PublicInvoiceView?id=${invoiceId}&token=${token}`,
    setSaving(){},setErrorMessage(value){context.errorMessage=value;},setPortalLink(value){context.portalLink=value;},
    setRetryMode(value){context.retryMode=value;},
    toast:{loading(){return 'toast';},success(){},error(){}},console:{error(){}},
    onSuccess(){succeeded=true;},onOpenChange(value){if(value===false)closed=true;},
    supabase:{
      async rpc(){return {data:TOKEN,error:null};},
      functions:{async invoke(){invokeCount+=1;return {data:{success:true},error:null};}},
      from(){const chain={update(){return chain;},eq(){return chain;},then(resolve,reject){statusWrites+=1;return Promise.resolve(statusShouldFail?{error:{message:'status failed'}}:{error:null}).then(resolve,reject);}};return chain;},
    },
  };
  const handleSend=vm.runInNewContext(`(${source.slice(declaration.init.start,declaration.init.end)})`,context);
  const event={preventDefault(){}};
  await handleSend(event);
  assert.equal(invokeCount,1);assert.equal(statusWrites,1);assert.equal(context.retryMode,'status');assert.equal(context.sendIntent.current.accepted,true);
  statusShouldFail=false;
  await handleSend(event);
  assert.equal(invokeCount,1,'accepted SMS is not invoked again');assert.equal(statusWrites,2);assert.equal(succeeded,true);assert.equal(closed,true);
});

test('Public invoice delegates the payable milestone calculation to the secured server',async()=>{
  const source=await fs.readFile(new URL('../../src/pages/PublicInvoiceView.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/let amountToCharge|amountToCharge <= 0/);
  assert.doesNotMatch(source,/scheduleItems\.find\(item => item\.status !== "Paid"\)/);
  assert.match(source,/invoice_id: invoice\.id,[\s\S]*token,/);
});
