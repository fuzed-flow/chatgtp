import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const script=(await build({entryPoints:[fileURLToPath(new URL('../../supabase/functions/client-portal-message/index.ts',import.meta.url))],bundle:true,write:false,platform:'browser',format:'iife',plugins:[{name:'synthetic-client',setup(b){b.onResolve({filter:/^npm:/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=(...args)=>globalThis.makeClient(...args);'}));}}]})).outputFiles[0].text;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plain=v=>JSON.parse(JSON.stringify(v));
function fixture(options={}){
  let handler;const calls=[],fetches=[],warnings=[];
  const env={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',RESEND_API_KEY:'synthetic-resend',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-twilio',TWILIO_FROM_NUMBER:'+14035550000',...options.env};
  vm.runInNewContext(script,{Deno:{serve:h=>handler=h,env:{get:k=>env[k]}},Response,Request,Headers,URLSearchParams,AbortSignal,btoa,
    makeClient:(url,key)=>{assert.equal(url,env.SUPABASE_URL);assert.equal(key,env.SUPABASE_SERVICE_ROLE_KEY);return{async rpc(name,args){calls.push({name,args:plain(args)});
      if(name==='claim_client_portal_message')return{error:options.claimError||null,data:options.claim||{claimed:true,message_id:id(5),company_id:id(1),company_name:'Saved Company',client_name:'Client <script>alert(1)</script>',client_email:'saved-client@example.invalid',recipient:options.recipient||(args.p_channel==='Email'?'saved-office@example.invalid':'(403) 555-1234'),subject:args.p_subject,message:args.p_message}};
      assert.equal(name,'finish_client_portal_message');return {data:null,error:options.finishError?{message:'failed'}:null};
    }};},console:{warn:v=>warnings.push(v),error:v=>warnings.push(v)},
    fetch:async(url,config)=>{fetches.push({url:String(url),headers:plain(config.headers),body:typeof config.body==='string'?JSON.parse(config.body):Object.fromEntries(config.body)});
      if(options.networkError)throw new Error('Synthetic timeout');
      const sms=String(url).includes('twilio.com');return Response.json(options.providerBody|| (sms?{sid:'SM'+'b'.repeat(32)}:{id:id(99)}),{status:options.providerStatus||200});}
  });
  return{handler,calls,fetches,warnings};
}
const request=(input={})=>new Request('https://db.invalid/functions/v1/client-portal-message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:id(2),token:'a'.repeat(64),token_kind:'quote',request_id:id(3),channel:'Email',subject:'Question <b>hi</b>',message:'<img src=x onerror=alert(1)>\nMy question',...input})});
for(const channel of ['Email','SMS'])test(`portal ${channel} uses only the server-owned business recipient and keeps secrets outside responses`,async()=>{
  const f=fixture(),res=await f.handler(request({channel,company_id:id(9),recipient:'attacker@example.invalid',phone_number:'+19005551234',from:'spoof@example.invalid'}));
  assert.equal(res.status,200);const body=await res.json();assert.equal(body.success,true);assert.equal(f.fetches.length,1);
  assert.deepEqual(Object.keys(body).sort(),['message_id','success']);assert.equal(f.calls[0].name,'claim_client_portal_message');assert.equal(f.calls[0].args.p_client,id(2));
  if(channel==='Email'){
    const send=f.fetches[0];assert.deepEqual(send.body.to,['saved-office@example.invalid']);assert.equal(send.body.from,'Fuzed Flow <alerts@mail.fuzedflow.com>');assert.equal(send.body.reply_to,'saved-client@example.invalid');
    assert.ok(!send.body.html.includes('<img'));assert.ok(!send.body.html.includes('<script>'));assert.ok(send.body.html.includes('&lt;img'));assert.match(send.headers['Idempotency-Key'],/^portal\//);
  }else{assert.equal(f.fetches[0].body.To,'+14035551234');assert.equal(f.fetches[0].body.From,'+14035550000');assert.match(f.fetches[0].body.Body,/FuzedFlow — client portal message from/);}
  assert.equal(f.calls[1].args.p_status,'sent');assert.deepEqual(f.warnings,[]);
});
for(const [name,input] of [['wrong client',{client_id:'bad'}],['missing private token',{token:''}],['wrong channel',{channel:'Phone Call'}],['email no subject',{subject:''}],['too long SMS',{channel:'SMS',message:'x'.repeat(1601)}],['foreign reply shape',{reply_id:'not-a-uuid'}],['empty message',{message:'  '}]])test('invalid input blocks external delivery: '+name,async()=>{
  const f=fixture();assert.equal((await f.handler(request(input))).status,400);assert.equal(f.calls.length,0);assert.equal(f.fetches.length,0);
});
for(const [code,message,status] of [['42501','Messaging is unavailable.',403],['54000','Rate limit',429],['XX000','Private SQL details',403]])test(`capability and rate checks reject before provider ${code}`,async()=>{
  const f=fixture({claimError:{code,message}}),r=await f.handler(request());assert.equal(r.status,status);assert.equal(f.fetches.length,0);assert.equal(f.calls.length,1);
  if(code==='XX000')assert.ok(!(await r.text()).includes(message));
});
for(const status of ['sent','pending','unknown','failed'])test('stable send intent does not resend '+status,async()=>{
  const f=fixture({claim:{claimed:false,status,message_id:id(5)}});assert.equal((await f.handler(request())).status,status==='sent'?200:409);assert.equal(f.fetches.length,0);assert.equal(f.calls.length,1);
});
for(const [options,status] of [[{providerStatus:400},'failed'],[{networkError:true},'unknown'],[{providerBody:{unexpected:'response'}},'unknown'],[{finishError:true},'unknown']])test('provider failure preserves known versus uncertain outcomes '+JSON.stringify(options),async()=>{
  const f=fixture(options),r=await f.handler(request());assert.equal(r.status,502);assert.equal(f.fetches.length,1);assert.equal(f.calls.at(-1).args.p_status,status);assert.deepEqual(f.warnings,[]);
});
test('missing provider configuration does not claim or queue a send',async()=>{
  const f=fixture({env:{RESEND_API_KEY:''}});assert.equal((await f.handler(request())).status,503);assert.equal(f.calls.length,0);assert.equal(f.fetches.length,0);
});
test('invalid saved company recipient is rejected without provider contact',async()=>{
  const f=fixture({recipient:'bad\r\nBcc:other@example.invalid'});assert.equal((await f.handler(request())).status,502);assert.equal(f.fetches.length,0);assert.equal(f.calls.at(-1).args.p_status,'failed');
});
test('endpoint handles preflight, rejects other methods and bounds request size',async()=>{
  const f=fixture();assert.equal((await f.handler(new Request('https://db.invalid',{method:'OPTIONS'}))).status,200);
  assert.equal((await f.handler(new Request('https://db.invalid'))).status,405);
  assert.equal((await f.handler(request({message:'x'.repeat(19000)}))).status,413);assert.equal(f.calls.length,0);assert.equal(f.fetches.length,0);
});
