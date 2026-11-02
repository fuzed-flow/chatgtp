import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/invoice-reminder-cron/index.ts',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',plugins:[{name:'synthetic-io',setup(b){
  b.onResolve({filter:/^https:\/\//},args=>({path:args.path,namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'js',contents:args.path.includes('supabase-js')?'export const createClient=()=>globalThis.testClient();':'export const serve=handler=>globalThis.captureHandler(handler);'}));
}}]});
const NOW=Date.UTC(2026,10,2,18);
class FixedDate extends Date { constructor(...args){super(...(args.length?args:[NOW]));} static now(){return NOW;} }
const plain=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const invoice={id:id(1),company_id:id(2),client_id:id(3),invoice_number:'INV-SYNTHETIC',status:'Partially Paid',automation_stage:3,due_date:'2026-10-14'};
const target={schedule_item_id:id(4),due_date:'2026-11-05',payment_name:'Payment 2',balance_due:5473.4};
const secret='synthetic-cron-secret-longer-than-thirty-two-characters';
function fixture(options={}){
  let handler,contextCalls=0;
  const sent=[],updates=[],rpcs=[],accepted=new Set();
  const company={id:invoice.company_id,name:'Synthetic Renovations',timezone:options.timezone||'America/Edmonton',settings:{currency:'CAD',automations:{invoice_enabled:true,invoice_predue:3,invoice_overdue_1:3,invoice_overdue_2:14}}};
  const client={name:'Synthetic Client',email:'client@example.invalid',phone:'+14035550100'};
  const db={rpc:async(name,args)=>{
    rpcs.push({name,args:plain(args)});
    if(name==='notification_delivery_server_config')return {data:{notification_cron_secret:secret}};
    if(name==='invoice_reminder_context'){
      contextCalls++;
      if(options.contextError)return {data:null,error:{message:'Synthetic database failure'}};
      return {data:options.paidDuringRun&&contextCalls>1?null:options.target===undefined?plain(target):plain(options.target)};
    }
    if(name==='invoice_installment_reminder_policy'||name==='document_reminder_policy')return {data:{email:true,sms:options.sms===true,email_sent:accepted.has('email'),sms_sent:accepted.has('sms'),cycle:'1234'}};
    if(name==='issue_invoice_reminder_share_token')return {data:'a'.repeat(64)};
    if(name==='record_invoice_installment_reminder'||name==='record_document_reminder_delivery'){accepted.add(args.p_channel);return {data:null};}
    throw new Error('Unexpected RPC '+name);
  },from(table){
    let updating=false;
    const chain={select(){return chain;},in(){return chain;},eq(){return chain;},is(){return chain;},update(payload){updating=true;updates.push(plain(payload));return chain;},async maybeSingle(){return {data:updating?{id:invoice.id}:table==='companies'?company:client};},then(resolve,reject){return Promise.resolve({data:[{...invoice,...options.invoice}]}).then(resolve,reject);}};
    return chain;
  }};
  vm.runInNewContext(bundle.outputFiles[0].text,{Request,Response,Headers,URL,TextEncoder,Uint8Array,crypto:webcrypto,Date:FixedDate,Intl,Deno:{env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',APP_URL:'https://app.fuzedflow.com'})[key]}},testClient:()=>db,captureHandler:value=>{handler=value;},console:{log(){},error(){}},fetch:async(url,config)=>{
    const body=JSON.parse(config.body);sent.push({url:String(url),body});
    const failing=options.fail===true||(options.failSms===true&&String(url).endsWith('/send-sms'));
    return Response.json({success:!failing,...(body.dry_run?{dry_run:true}:{})},{status:failing?503:200});
  }});
  return {sent,updates,rpcs,accepted,options,run:(body={},auth=secret)=>handler(new Request('https://synthetic.invalid/invoice-reminder-cron',{method:'POST',headers:{'X-Notification-Cron-Secret':auth},body:JSON.stringify(body)}))};
}
test('a paid deposit with undated milestones produces no delivery or token',async()=>{
  const f=fixture({target:null});assert.equal((await f.run()).status,200);assert.equal(f.sent.length,0);assert.equal(f.updates.length,0);assert.equal(f.rpcs.some(x=>x.name==='issue_invoice_reminder_share_token'),false);
});
test('a new installment uses its date and amount despite invoice stage 3',async()=>{
  const f=fixture();assert.equal((await f.run()).status,200);assert.equal(f.sent.length,1);
  const email=f.sent[0].body;assert.match(email.subject,/Upcoming Reminder: Payment 2/);assert.match(email.html_body,/Nov 5, 2026/);assert.match(email.html_body,/5,473\.40/);assert.doesNotMatch(email.html_body,/Oct 14|12,771/);assert.equal(f.updates[0].automation_stage,undefined);assert.equal(f.updates[0].status,undefined);
});
test('repeated cron ticks do not repeat accepted installment reminders',async()=>{
  const f=fixture();await f.run();await f.run();assert.equal(f.sent.length,1);assert.equal(f.updates.length,1);
});
test('past-due installments use the correct overdue stage and refer to the installment',async()=>{
  const f=fixture({target:{...target,due_date:'2026-10-28'}});await f.run();assert.match(f.sent[0].body.subject,/Overdue Notice: Payment 2/);assert.equal(f.rpcs.find(x=>x.name==='record_invoice_installment_reminder').args.p_stage,2);
});
test('payment received during link issuance suppresses delivery',async()=>{
  const f=fixture({paidDuringRun:true});await f.run();assert.equal(f.sent.length,0);assert.equal(f.updates.length,0);
});
test('failed delivery preserves the stage and retry request ID',async()=>{
  const f=fixture({fail:true});assert.equal((await f.run()).status,207);assert.equal((await f.run()).status,207);assert.equal(f.updates.length,0);assert.equal(f.accepted.size,0);assert.equal(f.sent[0].body.request_id,f.sent[1].body.request_id);
});
test('partial channel failure retries only the failed channel',async()=>{
  const f=fixture({sms:true,failSms:true});await f.run();assert.equal(f.accepted.has('email'),true);assert.equal(f.accepted.has('sms'),false);assert.equal(f.updates.length,0);
  f.options.failSms=false;await f.run();assert.equal(f.sent.filter(x=>x.url.endsWith('/send-email')).length,1);assert.equal(f.sent.filter(x=>x.url.endsWith('/send-sms')).length,2);assert.match(f.sent.at(-1).body.message_body,/Amount due: \$5,473\.40/);assert.equal(f.updates.length,1);
});
test('dry run never issues tokens, sends messages or writes reminder history',async()=>{
  const f=fixture();const r=await (await f.run({dry_run:true})).json();assert.equal(r.previews[0].schedule_item_id,target.schedule_item_id);assert.equal(f.updates.length,0);assert.equal(f.accepted.size,0);assert.equal(f.rpcs.some(x=>x.name==='issue_invoice_reminder_share_token'),false);assert.equal(f.sent.every(x=>x.body.dry_run===true),true);
});
test('normal invoices still use invoice-level stages and delivery history',async()=>{
  const f=fixture({target:{...target,schedule_item_id:null,payment_name:null},invoice:{automation_stage:0}});await f.run();assert.equal(f.updates[0].automation_stage,1);assert.equal(f.rpcs.some(x=>x.name==='record_document_reminder_delivery'),true);assert.match(f.sent[0].body.subject,/Upcoming Reminder: Invoice/);
});
test('authentication, invalid timezone and unavailable balances all fail closed',async()=>{
  for(const options of [{contextError:true},{timezone:'Unknown/Invalid'},{target:{...target,balance_due:0}}]){
    const f=fixture(options);await f.run();assert.equal(f.sent.length,0);assert.equal(f.updates.length,0);
  }
  const f=fixture();assert.equal((await f.run({},'invalid')).status,401);assert.equal(f.sent.length,0);
});
