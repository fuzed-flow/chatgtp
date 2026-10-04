import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createHmac, webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Execute the complete production handlers and their real shared helpers. Only
// the remote Supabase client and network transport are synthetic.
const root = new URL('../../', import.meta.url);
const bundled = Object.fromEntries(await Promise.all(['email-events','sms-events'].map(async name => {
  const result = await build({
    entryPoints:[fileURLToPath(new URL(`supabase/functions/${name}/index.ts`,root))],
    bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent',
    plugins:[{name:'synthetic-supabase',setup(builder) {
      builder.onResolve({filter:/^https:\/\/esm\.sh\/@supabase\/supabase-js/},args=>({path:args.path,namespace:'test-client'}));
      builder.onLoad({filter:/.*/,namespace:'test-client'},()=>({contents:'export const createClient = (...args) => globalThis.testClient(...args);',loader:'js'}));
    }}],
  });
  return [name,result.outputFiles[0].text];
})));

const NOW = Date.UTC(2026,9,4,18,30);
const URL_BASE = 'https://synthetic.supabase.invalid';
const EMAIL_ID = '00000000-0000-4000-8000-000000000101';
const ROUTE_ID = '00000000-0000-4000-8000-000000000102';
const SMS_ID = 'SM' + 'a'.repeat(32);
const ACCOUNT_ID = 'AC' + 'b'.repeat(32);
const SIGNING_BYTES = Buffer.from('synthetic-resend-webhook-signing-secret');
const RESEND_SECRET = 'whsec_' + SIGNING_BYTES.toString('base64');
const TWILIO_SECRET = 'synthetic-twilio-signing-secret';
const plain = value => JSON.parse(JSON.stringify(value));
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

function fixture(name, options={}) {
  const calls=[], fetches=[];
  let handler;
  const env={SUPABASE_URL:URL_BASE,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RESEND_API_KEY:'synthetic-resend-key',
    RESEND_WEBHOOK_SECRET:RESEND_SECRET,RESEND_REPLY_DOMAIN:'reply.fuzedflow.com',STRIPE_CONNECT_WEBHOOK_SECRET:'synthetic-stripe-key',
    TWILIO_ACCOUNT_SID:ACCOUNT_ID,TWILIO_AUTH_TOKEN:TWILIO_SECRET,...options.env};
  const db={async rpc(name,args) {
    calls.push({name,args:args ? plain(args) : undefined});
    if (name==='notification_provider_server_config') return {data:options.vault || {},error:null};
    if (options.rpcResults && Object.hasOwn(options.rpcResults,name)) return options.rpcResults[name];
    if (name==='record_personal_notification_delivery_callback') return {data:false,error:null};
    if (name==='retry_unregistered_delivery') return {data:true,error:null};
    return options.rpcResult || {data:true,error:null};
  }};
  const context={Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,atob,btoa,Date:FixedDate,
    Deno:{serve:callback=>{handler=callback;},env:{get:key=>env[key]}},testClient:()=>db,
    fetch:async (url,init) => {
      fetches.push({url:String(url),init});
      assert.equal(String(url),`https://api.resend.com/emails/receiving/${EMAIL_ID}?html_format=cid`,'No unexpected or live fetch is permitted.');
      return Response.json(options.received || receivingEmail(),{status:options.fetchStatus || 200});
    },
  };
  vm.runInNewContext(bundled[name],context,{timeout:1000});
  assert.equal(typeof handler,'function');
  return {handler,calls,fetches,env,get writes() { return calls.filter(call=>call.name!=='notification_provider_server_config'); }};
}

function emailRequest(type='email.delivered',options={}) {
  const raw=options.raw || JSON.stringify({type,...(options.createdAt ? {created_at:options.createdAt} : {}),data:{email_id:EMAIL_ID,...options.data}},null,2);
  const timestamp=String(options.timestamp ?? NOW/1000);
  const eventId=options.eventId || 'synthetic-svix-event';
  const signature=createHmac('sha256',options.key || SIGNING_BYTES).update(`${eventId}.${timestamp}.${raw}`).digest('base64');
  const headers={'Content-Type':'application/json','svix-id':eventId,'svix-timestamp':timestamp,'svix-signature':`v1,${signature}`,...options.headers};
  return new Request(`${URL_BASE}/functions/v1/email-events`,{method:'POST',headers,body:options.sentBody || raw});
}

// Shape follows https://resend.com/docs/api-reference/emails/retrieve-received-email.
function receivingEmail(overrides={}) {
  return {id:EMAIL_ID,from:'Saved Client <client@example.invalid>',to:[`reply+${ROUTE_ID}@reply.fuzedflow.com`],
    subject:'Re: Saved quote',text:'Please clarify the installation date.',authentication:{spf:'pass',dkim:'pass',dmarc:'pass'},...overrides};
}

function smsRequest(overrides={},options={}) {
  const form=new URLSearchParams({MessageSid:SMS_ID,AccountSid:ACCOUNT_ID,MessageStatus:'delivered',From:'+17805551234',To:'+17805559876',...overrides});
  for (const [key,value] of options.extra || []) form.append(key,value);
  const search=options.search || '';
  let signedURL=options.signURL || `${URL_BASE}/functions/v1/sms-events${search}`;
  for (const name of [...new Set(form.keys())].sort()) for (const value of [...new Set(form.getAll(name))].sort()) signedURL+=name+value;
  const signature=createHmac('sha1',options.key || TWILIO_SECRET).update(signedURL).digest('base64');
  return new Request(`${options.requestOrigin || URL_BASE}/functions/v1/sms-events${search}`,{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature},body:options.sentBody || form.toString(),
  });
}

for (const options of [
  {key:Buffer.from('wrong-secret')},
  {timestamp:NOW/1000-301},
  {timestamp:NOW/1000+301},
  {headers:{'svix-signature':''}},
  {sentBody:JSON.stringify({type:'email.bounced',data:{email_id:EMAIL_ID}})},
]) test('Resend invalid, stale or modified signature makes no writes '+JSON.stringify(Object.keys(options)),async()=>{
  const view=fixture('email-events');
  assert.equal((await view.handler(emailRequest('email.delivered',options))).status,401);
  assert.equal(view.writes.length,0);assert.equal(view.fetches.length,0);
});

for (const [type,status] of [['email.delivered','delivered'],['email.bounced','bounced'],['email.failed','failed'],['email.complained','complained']]) {
  test(`Resend ${type} maps signed provider ID to the saved-delivery RPC`,async()=>{
    const view=fixture('email-events');
    assert.equal((await view.handler(emailRequest(type))).status,200);
    assert.deepEqual(view.writes,[{name:'record_delivery_callback',args:{p_provider:'resend',p_provider_id:EMAIL_ID,p_event_id:'synthetic-svix-event',p_status:status}}]);
    assert.equal(view.fetches.length,0);
  });
}

for (const [name,result,status] of [['not registered yet',{data:false,error:null},503],['database failure',{data:null,error:{message:'synthetic'}},503],['duplicate acknowledged',{data:true,error:null},200]]) {
  test('Resend callback '+name+' has a safe provider retry response',async()=>{
    const view=fixture('email-events',{rpcResult:result});
    assert.equal((await view.handler(emailRequest())).status,status);
  });
}

test('Resend delivery rejects malformed document provider UUID after signature validation',async()=>{
  const view=fixture('email-events');
  assert.equal((await view.handler(emailRequest('email.delivered',{data:{email_id:'invalid'}}))).status,400);
  assert.equal(view.writes.length,0);
});

for (const authentication of [{dmarc:'pass'},{spf:'pass',dkim:'pass',dmarc:'gray'},{spf:{result:'pass'},dkim:{result:'pass'}}]) {
  test('Authenticated receiving email uses fetched text and route '+JSON.stringify(authentication),async()=>{
    const view=fixture('email-events',{received:receivingEmail({authentication})});
    assert.equal((await view.handler(emailRequest('email.received',{data:{from:'spoofed@example.invalid',text:'Do not trust webhook content'}}))).status,200);
    assert.equal(view.fetches.length,1);
    assert.equal(view.fetches[0].init.headers.Authorization,'Bearer synthetic-resend-key');
    assert.deepEqual(view.writes,[{name:'record_inbound_reply',args:{p_provider:'resend',p_event_id:EMAIL_ID,p_route:ROUTE_ID,p_sender:'client@example.invalid',p_subject:'Re: Saved quote',p_message:'Please clarify the installation date.'}}]);
  });
}

for (const received of [
  receivingEmail({authentication:null}),
  receivingEmail({authentication:{spf:'pass',dkim:'fail',dmarc:'fail'}}),
  receivingEmail({authentication:{spf:'fail',dkim:'pass',dmarc:'gray'}}),
  receivingEmail({to:['reply+malformed@reply.fuzedflow.com']}),
  receivingEmail({to:[`reply+${ROUTE_ID}@foreign.example.invalid`]}),
  receivingEmail({to:[`reply+${ROUTE_ID}@reply.fuzedflow.com`,`reply+${EMAIL_ID}@reply.fuzedflow.com`]}),
  receivingEmail({from:'invalid-sender'}),
]) test('Unauthenticated or ambiguous receiving mail is acknowledged without a reply write '+JSON.stringify([received.authentication,received.to,received.from]),async()=>{
  const view=fixture('email-events',{received});
  const response=await view.handler(emailRequest('email.received'));
  assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);assert.equal(view.writes.length,0);
});

test('Receiving lookup failures return a retry response and never record an empty reply',async()=>{
  const view=fixture('email-events',{fetchStatus:503});
  assert.equal((await view.handler(emailRequest('email.received'))).status,503);assert.equal(view.writes.length,0);
});

test('Service-only Vault fallback can supply Resend verification configuration',async()=>{
  const view=fixture('email-events',{env:{RESEND_WEBHOOK_SECRET:undefined,RESEND_REPLY_DOMAIN:undefined},vault:{resend_webhook_secret:RESEND_SECRET,resend_reply_domain:'reply.fuzedflow.com'}});
  assert.equal((await view.handler(emailRequest())).status,200);
  assert.equal(view.calls[0].name,'notification_provider_server_config');assert.equal(view.writes[0].name,'record_delivery_callback');
});

for (const [overrides,options] of [[{}, {key:'wrong-secret'}],[{AccountSid:'AC'+'c'.repeat(32)},{}],[{}, {signURL:'https://foreign.example.invalid/functions/v1/sms-events'}],[{}, {sentBody:'Body=tampered'}]]) {
  test('Twilio signature/account/url/tampering rejection makes no writes '+JSON.stringify([overrides,Object.keys(options)]),async()=>{
    const view=fixture('sms-events');assert.equal((await view.handler(smsRequest(overrides,options))).status,401);assert.equal(view.writes.length,0);
  });
}

for (const status of ['delivered','failed','undelivered']) test('Twilio '+status+' maps signed SID and status to saved delivery',async()=>{
  const view=fixture('sms-events');assert.equal((await view.handler(smsRequest({MessageStatus:status}))).status,200);
  assert.deepEqual(view.writes,[{name:'record_delivery_callback',args:{p_provider:'twilio',p_provider_id:SMS_ID,p_event_id:`${SMS_ID}:${status}`,p_status:status}}]);
});

test('Twilio canonical URL includes query and every form parameter, independent of incoming proxy host',async()=>{
  const view=fixture('sms-events');
  const response=await view.handler(smsRequest({}, {requestOrigin:'http://internal-proxy.invalid',search:'?source=provider',extra:[['Extra','z'],['Extra','a'],['Extra','a']]}));
  assert.equal(response.status,200);assert.equal(view.writes.length,1);
});

test('Twilio inbound signed form records incoming transport addresses and decoded text',async()=>{
  const view=fixture('sms-events');
  const response=await view.handler(smsRequest({MessageStatus:'received',Body:'Reply with + and & characters'}));
  assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/text\/xml/);
  assert.deepEqual(view.writes,[{name:'record_inbound_sms',args:{p_event_id:SMS_ID,p_sender:'+17805551234',p_recipient:'+17805559876',p_message:'Reply with + and & characters'}}]);
});

test('Twilio malformed message SID never reaches the saved-record RPC',async()=>{
  const view=fixture('sms-events');assert.equal((await view.handler(smsRequest({MessageSid:'invalid'}))).status,400);assert.equal(view.writes.length,0);
});

test('Twilio delivery arriving before registration asks the provider to retry',async()=>{
  const view=fixture('sms-events',{rpcResult:{data:false,error:null}});assert.equal((await view.handler(smsRequest())).status,503);
});

test('Twilio duplicate callback acknowledged by the database returns success',async()=>{
  const view=fixture('sms-events');
  assert.equal((await view.handler(smsRequest())).status,200);
  assert.equal((await view.handler(smsRequest())).status,200);
  assert.equal(view.writes[0].args.p_event_id,view.writes[1].args.p_event_id,'The database can dedupe retries by the same event key.');
});

for (const name of ['email-events','sms-events']) {
  const request = options => name==='email-events' ? emailRequest('email.delivered',options) : smsRequest(options);
  test(`${name} unknown document delivery falls back to a saved personal delivery with identical arguments`,async()=>{
    const view=fixture(name,{rpcResults:{record_delivery_callback:{data:false,error:null},record_personal_notification_delivery_callback:{data:true,error:null}}});
    assert.equal((await view.handler(request())).status,200);
    assert.deepEqual(view.writes.map(call=>call.name),['record_delivery_callback','record_personal_notification_delivery_callback']);
    assert.deepEqual(view.writes[0].args,view.writes[1].args);
  });
  test(`${name} document callback database failure never falls back or acknowledges`,async()=>{
    const view=fixture(name,{rpcResults:{record_delivery_callback:{data:null,error:{message:'synthetic failure'}}}});
    assert.equal((await view.handler(request())).status,503);
    assert.deepEqual(view.writes.map(call=>call.name),['record_delivery_callback']);
  });
  test(`${name} personal callback failure never invokes the unknown-delivery timer`,async()=>{
    const view=fixture(name,{rpcResults:{record_delivery_callback:{data:false,error:null},record_personal_notification_delivery_callback:{data:null,error:{message:'synthetic failure'}}}});
    assert.equal((await view.handler(request())).status,503);
    assert.deepEqual(view.writes.map(call=>call.name),['record_delivery_callback','record_personal_notification_delivery_callback']);
  });
  for (const [minutes,status] of [[9,503],[10,503],[11,200]]) test(`${name} signed unknown callback aged ${minutes} minutes uses bounded retries`,async()=>{
    const view=fixture(name,{rpcResults:{record_delivery_callback:{data:false,error:null}}});
    const date=new Date(NOW-minutes*60000).toISOString();
    assert.equal((await view.handler(request(name==='email-events' ? {createdAt:date} : {DateUpdated:date}))).status,status);
    assert.equal(view.writes.some(call=>call.name==='retry_unregistered_delivery'),minutes<=10);
  });
  test(`${name} timestamp-less unknown callback acknowledges once database retry window expires`,async()=>{
    const view=fixture(name,{rpcResults:{record_delivery_callback:{data:false,error:null},retry_unregistered_delivery:{data:false,error:null}}});
    assert.equal((await view.handler(request())).status,200);
    const timer=view.writes.find(call=>call.name==='retry_unregistered_delivery');
    assert.deepEqual(timer.args,{p_provider:name==='email-events' ? 'resend' : 'twilio',p_provider_id:name==='email-events' ? EMAIL_ID : SMS_ID});
  });
  test(`${name} unknown callback timer database failure stays retryable`,async()=>{
    const view=fixture(name,{rpcResults:{record_delivery_callback:{data:false,error:null},retry_unregistered_delivery:{data:null,error:{message:'synthetic failure'}}}});
    assert.equal((await view.handler(request())).status,503);
  });
}

test('Twilio signed DateSent bounds retries when DateUpdated is absent',async()=>{
  const view=fixture('sms-events',{rpcResults:{record_delivery_callback:{data:false,error:null}}});
  assert.equal((await view.handler(smsRequest({DateSent:new Date(NOW-11*60000).toISOString()}))).status,200);
  assert.equal(view.writes.some(call=>call.name==='retry_unregistered_delivery'),false);
});

test('Authenticated HTML-only reply records readable text without tags, styles or scripts',async()=>{
  const view=fixture('email-events',{received:receivingEmail({text:null,html:'<style>secret style</style><p>Please &amp; thank you.</p><script>alert(1)</script><div>Line &#x32; &lt;literal&gt;<br>Final</div>'})});
  assert.equal((await view.handler(emailRequest('email.received'))).status,200);
  assert.equal(view.writes[0].args.p_message,'Please & thank you.\nLine 2 <literal>\nFinal');
});
