import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/send-sms/index.ts',import.meta.url))],bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
  plugins:[{name:'synthetic-sms-dependencies',setup(builder){
    builder.onResolve({filter:/^https:\/\//},args=>({path:args.path,namespace:'synthetic'}));
    builder.onLoad({filter:/.*/,namespace:'synthetic'},args=>({loader:'js',contents:
      args.path.includes('supabase-js') ? 'export const createClient=(...args)=>globalThis.testClient(...args);' :
      args.path.includes('/http/server.ts') ? 'export const serve=handler=>globalThis.captureHandler(handler);' :
      (()=>{throw new Error('Unexpected remote import: '+args.path);})()}));
  }}],
});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const COMPANY=id(1),OTHER=id(2),USER=id(3),CLIENT=id(4),FOREIGN_CLIENT=id(5),QUOTE=id(6),CO=id(7),INVOICE=id(8),LEAD=id(9),PROJECT=id(10),REQUEST=id(11),REPLY=id(12);
const ACCOUNT='AC'+'a'.repeat(32),SID='SM'+'b'.repeat(32),URL_BASE='https://synthetic.supabase.invalid';
const SERVICE='synthetic-service-key',FROM='+17805559876';
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(options={}) {
  const clients=[],authCalls=[],queries=[],rpcs=[],fetches=[],warnings=[],ledger=new Map();
  let handler;
  const rows={profiles:[{id:USER,company_id:COMPANY,is_active:true}],quotes:[{id:QUOTE,company_id:COMPANY,client_id:CLIENT,quote_number:'Q-SYNTHETIC'}],
    change_orders:[{id:CO,company_id:COMPANY,project_id:PROJECT,change_order_number:'CO-SYNTHETIC'}],invoices:[{id:INVOICE,company_id:COMPANY,client_id:CLIENT,invoice_number:'INV-SYNTHETIC'}],
    projects:[{id:PROJECT,company_id:COMPANY,client_id:CLIENT}],clients:[{id:CLIENT,company_id:COMPANY,name:'Saved Client'},{id:FOREIGN_CLIENT,company_id:OTHER,name:'Foreign Client'}],
    leads:[{id:LEAD,company_id:COMPANY,contact_name:'Saved lead'}],client_communications:[{id:REPLY,company_id:COMPANY,client_id:CLIENT,direction:'Inbound'}],...plain(options.rows || {})};
  const db={from(table){assert.ok(Object.hasOwn(rows,table),'Unexpected table '+table);const query={table,filters:[]};
    const chain={select(fields){query.fields=fields;return chain;},eq(key,value){query.filters.push([key,value]);return chain;},async single(){queries.push(plain(query));
      if(options.queryError?.(query))return {data:null,error:{message:'synthetic query failure'}};
      const found=rows[table].find(row=>query.filters.every(([key,value])=>row[key]===value));return {data:found ? plain(found) : null,error:null};},
      async upsert(payload,config){query.operation='upsert';query.payload=plain(payload);query.config=plain(config);queries.push(query);
        if(options.logThrow)throw new Error('synthetic log transport failure');return {data:null,error:options.logError ? {message:'synthetic log failure'} : null};},
    };return chain;
  },async rpc(name,args){rpcs.push({name,args:plain(args)});
    if(options.rpcThrows?.includes(name))throw new Error('synthetic RPC transport failure');
    if(options.rpcErrors?.includes(name))return {data:null,error:{message:'synthetic RPC failure'}};
    const key=args.p_company+':'+args.p_request;
    if(name==='claim_sms_intent'){
      assert.match(args.p_fingerprint,/^[a-f0-9]{64}$/);
      let saved=ledger.get(key);
      if(!saved){saved={fingerprint:args.p_fingerprint,status:options.initialStatus || 'pending',provider_id:options.initialStatus==='sent' ? SID : null};ledger.set(key,saved);
        return {data:{claimed:!options.initialStatus,status:saved.status,provider_id:saved.provider_id},error:null};}
      if(saved.fingerprint!==args.p_fingerprint)return {data:null,error:{message:'Send intent payload changed'}};
      if(saved.status==='failed'){saved.status='pending';return {data:{claimed:true,status:'pending'},error:null};}
      return {data:{claimed:false,status:saved.status,provider_id:saved.provider_id},error:null};
    }
    if(name==='finish_sms_intent'){const saved=ledger.get(key);assert.ok(saved);saved.status=args.p_status;saved.provider_id=args.p_provider_id || null;return {data:null,error:null};}
    assert.ok(['register_outbound_delivery','record_sales_event'].includes(name),'Unexpected RPC '+name);return {data:null,error:null};
  }};
  const scoped={...db,auth:{async getUser(token){authCalls.push(token);return options.authResult || (token==='synthetic-user-token' ? {data:{user:{id:USER}},error:null} : {data:{user:null},error:{message:'invalid token'}});}}};
  const env={SUPABASE_URL:URL_BASE,SUPABASE_SERVICE_ROLE_KEY:SERVICE,SUPABASE_ANON_KEY:'synthetic-anon-key',TWILIO_ACCOUNT_SID:ACCOUNT,TWILIO_AUTH_TOKEN:'synthetic-twilio-secret',TWILIO_FROM_NUMBER:FROM,...options.env};
  vm.runInNewContext(bundle.outputFiles[0].text,{Request,Response,Headers,URL,URLSearchParams,TextEncoder,Uint8Array,crypto:webcrypto,btoa,Deno:{env:{get:key=>env[key]}},
    testClient:(url,key,config)=>{clients.push({url,key,config:config ? plain(config) : undefined});assert.equal(url,URL_BASE);assert.ok([SERVICE,'synthetic-anon-key'].includes(key));return key===SERVICE ? db : scoped;},
    captureHandler:value=>{handler=value;},console:{warn:message=>warnings.push(message)},
    fetch:async(url,config)=>{fetches.push({url:String(url),method:config.method,headers:plain(config.headers),form:Object.fromEntries(config.body)});
      assert.equal(String(url),`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Messages.json`);assert.equal(config.method,'POST');
      if(options.networkFailure)throw new Error('synthetic uncertain transport failure');return Response.json(options.providerResult || {sid:SID},{status:options.providerStatus || 201});},
  },{timeout:1000});
  return {handler,clients,authCalls,queries,rpcs,fetches,warnings,ledger};
}
function request(overrides={},token='synthetic-user-token') {return new Request(URL_BASE+'/functions/v1/send-sms',{method:'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token} : {})},body:JSON.stringify({document_type:'quote',document_id:QUOTE,phone_number:'(780) 555-1234',message_body:' A synthetic SMS ',request_id:REQUEST,...overrides})});}
const calls=(view,name)=>view.rpcs.filter(call=>call.name===name);
const history=view=>view.queries.filter(query=>query.operation==='upsert');

for(const token of [null,'invalid-user-token',SERVICE+'-not-exact']) test('SMS rejects unverified auth before Twilio '+JSON.stringify(token),async()=>{
  const view=fixture();assert.equal((await view.handler(request({},token))).status,401);assert.equal(view.fetches.length,0);assert.equal(view.rpcs.length,0);assert.equal(view.queries.length,0);
});
test('SMS validates the explicit bearer token and derives company and actor from the saved active profile',async()=>{
  const view=fixture();assert.equal((await view.handler(request({company_id:OTHER,client_id:FOREIGN_CLIENT,sent_by:id(99)}))).status,200);
  assert.deepEqual(view.authCalls,['synthetic-user-token']);assert.equal(view.clients[1].config.global.headers.Authorization,'Bearer synthetic-user-token');
  assert.deepEqual(view.queries.find(query=>query.table==='profiles').filters,[['id',USER]]);
  assert.equal(calls(view,'claim_sms_intent')[0].args.p_company,COMPANY);assert.equal(calls(view,'register_outbound_delivery')[0].args.p_actor,USER);
  assert.deepEqual(view.queries.find(query=>query.table==='quotes').filters,[['id',QUOTE],['company_id',COMPANY]]);
  assert.deepEqual(view.queries.find(query=>query.table==='clients').filters,[['id',CLIENT],['company_id',COMPANY]]);
});
for(const profile of [null,{id:USER,company_id:COMPANY,is_active:false}]) test('SMS requires an active saved profile '+JSON.stringify(profile),async()=>{
  const view=fixture({rows:{profiles:profile ? [profile] : []}});assert.equal((await view.handler(request())).status,403);assert.equal(view.fetches.length,0);assert.equal(view.rpcs.length,0);
});
test('Exact service key can send only through a saved company context and has no impersonated actor',async()=>{
  const view=fixture();assert.equal((await view.handler(request({company_id:COMPANY},SERVICE))).status,200);assert.equal(view.authCalls.length,0);
  assert.equal(calls(view,'register_outbound_delivery')[0].args.p_actor,null);assert.equal(history(view)[0].payload.sent_by,null);
});
for(const [label,input,options,token] of [
  ['service missing company',{}, {},SERVICE],['service foreign saved document',{company_id:OTHER},{},SERVICE],
  ['missing saved context',{document_type:undefined,document_id:undefined},{},'synthetic-user-token'],
  ['foreign saved quote',{}, {rows:{quotes:[{id:QUOTE,company_id:OTHER,client_id:FOREIGN_CLIENT}]}},'synthetic-user-token'],
  ['foreign saved client',{document_type:undefined,document_id:undefined,client_id:FOREIGN_CLIENT},{},'synthetic-user-token'],
  ['malformed saved document',{document_id:'invalid'},{},'synthetic-user-token'],
  ['foreign change order project',{document_type:'change_order',document_id:CO},{rows:{projects:[{id:PROJECT,company_id:OTHER,client_id:FOREIGN_CLIENT}]}},'synthetic-user-token'],
]) test('SMS preflight rejects '+label+' before claiming or contacting Twilio',async()=>{
  const view=fixture(options);assert.equal((await view.handler(request(input,token))).status,400);assert.equal(view.fetches.length,0);assert.equal(view.rpcs.length,0);
});
for(const phone of ['(780) 555-1234','17805551234','+1 (780) 555-1234']) test('SMS normalizes saved intent phone to E164 '+phone,async()=>{
  const view=fixture();assert.equal((await view.handler(request({phone_number:phone}))).status,200);
  assert.deepEqual(view.fetches[0].form,{To:'+17805551234',From:FROM,Body:'A synthetic SMS',StatusCallback:URL_BASE+'/functions/v1/sms-events'});
  assert.equal(view.fetches[0].headers.Authorization,'Basic '+Buffer.from(ACCOUNT+':synthetic-twilio-secret').toString('base64'));
  const expected=createHash('sha256').update(JSON.stringify(['+17805551234','A synthetic SMS','Quote',QUOTE,'document',null])).digest('hex');
  assert.equal(calls(view,'claim_sms_intent')[0].args.p_fingerprint,expected);
});
for(const input of [{phone_number:'bad phone'},{message_body:''},{message_body:'x'.repeat(5001)},{request_id:'not-a-uuid'}]) test('SMS invalid recipient/message/request never claims or sends '+JSON.stringify(Object.keys(input)),async()=>{
  const view=fixture();assert.equal((await view.handler(request(input))).status,400);assert.equal(view.rpcs.length,0);assert.equal(view.fetches.length,0);
});
test('Accepted SMS records server document party, trusted Twilio SID, history and delivery context',async()=>{
  const view=fixture();const response=await view.handler(request({client_id:FOREIGN_CLIENT,provider:'resend',provider_message_id:id(98)}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,message_sid:SID});
  assert.deepEqual(calls(view,'finish_sms_intent'),[{name:'finish_sms_intent',args:{p_company:COMPANY,p_request:REQUEST,p_status:'sent',p_provider_id:SID}}]);
  assert.deepEqual(calls(view,'register_outbound_delivery')[0].args,{p_provider:'twilio',p_provider_id:SID,p_company:COMPANY,p_related:'Quote',p_id:QUOTE,p_client:CLIENT,p_lead:null,p_actor:USER,p_kind:'document',p_copy:false,p_recipient:'+17805551234',p_sender:FROM,p_reply:null});
  assert.deepEqual(history(view)[0].payload,{company_id:COMPANY,client_id:CLIENT,lead_id:null,type:'SMS',direction:'Outbound',subject:'Text message sent',message:'A synthetic SMS',status:'Sent',sent_by:USER,provider:'twilio',provider_message_id:SID});
  assert.deepEqual(history(view)[0].config,{onConflict:'provider,provider_message_id',ignoreDuplicates:true});
});
test('Saved change order project determines SMS client and explicit inbound reply determines completion context',async()=>{
  const view=fixture();assert.equal((await view.handler(request({document_type:'change_order',document_id:CO,notification_kind:'communication',reply_to_communication_id:REPLY}))).status,200);
  assert.equal(calls(view,'register_outbound_delivery')[0].args.p_client,CLIENT);assert.equal(calls(view,'register_outbound_delivery')[0].args.p_reply,REPLY);
  assert.deepEqual(view.queries.find(query=>query.table==='projects').filters,[['id',PROJECT],['company_id',COMPANY]]);
});
test('Sent SMS replay returns the saved SID without another provider POST or history insert',async()=>{
  const view=fixture();assert.equal((await view.handler(request())).status,200);const response=await view.handler(request());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,message_sid:SID,replayed:true});assert.equal(view.fetches.length,1);assert.equal(history(view).length,1);assert.equal(calls(view,'finish_sms_intent').length,1);
});
for(const status of ['pending','unknown']) test('SMS '+status+' intent returns409 without a provider POST',async()=>{
  const view=fixture({initialStatus:status});const response=await view.handler(request());assert.equal(response.status,409);assert.equal((await response.json()).success,false);assert.equal(view.fetches.length,0);assert.equal(history(view).length,0);
});
test('Reusing the same SMS request ID with a changed fingerprint rejects before another POST',async()=>{
  const view=fixture();await view.handler(request());const response=await view.handler(request({message_body:'Different synthetic message'}));assert.equal(response.status,400);assert.equal(view.fetches.length,1);assert.equal(history(view).length,1);
  assert.notEqual(calls(view,'claim_sms_intent')[0].args.p_fingerprint,calls(view,'claim_sms_intent')[1].args.p_fingerprint);
});
for(const [type,document,event] of [['quote',QUOTE,'quote_send_failed'],['change_order',CO,'co_send_failed'],['invoice',INVOICE,'invoice_send_failed']]) test('Twilio rejection finishes failed and emits typed '+event,async()=>{
  const view=fixture({providerStatus:400,providerResult:{code:21211,message:'synthetic provider detail'}});const response=await view.handler(request({document_type:type,document_id:document}));
  assert.equal(response.status,502);assert.deepEqual(calls(view,'finish_sms_intent')[0].args,{p_company:COMPANY,p_request:REQUEST,p_status:'failed'});
  assert.equal(calls(view,'record_sales_event')[0].args.p_event,event);assert.equal(calls(view,'record_sales_event')[0].args.p_reference,REQUEST);assert.equal(history(view).length,0);
  assert.doesNotMatch(JSON.stringify(await response.json()),/21211|synthetic provider detail/);
});
for(const options of [{networkFailure:true},{providerResult:{sid:'invalid-provider-sid'}}]) test('Uncertain SMS acceptance stays unknown and never auto-sends a duplicate '+JSON.stringify(options),async()=>{
  const view=fixture(options);const response=await view.handler(request());assert.equal(response.status,502);assert.match((await response.json()).error,/could not be confirmed/);
  assert.deepEqual(calls(view,'finish_sms_intent')[0].args,{p_company:COMPANY,p_request:REQUEST,p_status:'unknown'});assert.equal(history(view).length,0);
  assert.equal((await view.handler(request())).status,409);assert.equal(view.fetches.length,1);
});
for(const options of [{rpcErrors:['register_outbound_delivery']},{rpcThrows:['register_outbound_delivery']},{logError:true},{logThrow:true},{rpcErrors:['finish_sms_intent']},{rpcThrows:['finish_sms_intent']}]) test('Provider accepted SMS stays successful despite tracking failure '+JSON.stringify(options),async()=>{
  const view=fixture(options);const response=await view.handler(request());assert.equal(response.status,200);assert.deepEqual(await response.json(),{success:true,message_sid:SID});assert.equal(view.fetches.length,1);assert.ok(view.warnings.length>0);
  assert.equal(calls(view,'record_sales_event').length,0,'A tracking failure does not imply provider rejection.');
  assert.equal(calls(view,'finish_sms_intent').some(call=>call.args.p_status==='unknown'),false);
});
test('Uncertain SMS still returns safe502 when its failure tracking transport also fails',async()=>{
  const view=fixture({networkFailure:true,rpcThrows:['finish_sms_intent']});const response=await view.handler(request());assert.equal(response.status,502);assert.match((await response.json()).error,/could not be confirmed/);
  assert.equal((await view.handler(request())).status,409);assert.equal(view.fetches.length,1);
});
test('SMS claim database failure never contacts Twilio',async()=>{
  const view=fixture({rpcErrors:['claim_sms_intent']});assert.equal((await view.handler(request())).status,400);assert.equal(view.fetches.length,0);assert.equal(history(view).length,0);
});
test('SMS CORS preflight does not authenticate, claim or send',async()=>{
  const view=fixture();const response=await view.handler(new Request(URL_BASE+'/functions/v1/send-sms',{method:'OPTIONS'}));assert.equal(response.status,200);assert.equal(view.clients.length,0);assert.equal(view.fetches.length,0);
});
