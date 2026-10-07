import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const C='00000000-0000-4000-8000-000000000001', USER='00000000-0000-4000-8000-000000000002', REQUEST='00000000-0000-4000-8000-000000000003', SEND='00000000-0000-4000-8000-000000000004', PROVIDER='00000000-0000-4000-8000-000000000005', COPY_PROVIDER='00000000-0000-4000-8000-000000000006';
const storage='https://synthetic.supabase.co/storage/v1/object/public/vendor/'+C+'/scope.pdf';
let generation=0;

async function harness(options={}) {
  const calls=[], queries=[], rpcs=[];
  const originalFetch=globalThis.fetch, originalDeno=globalThis.Deno;
  globalThis.Deno={env:{get:key=>({RESEND_API_KEY:'synthetic-provider-key',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'}[key])}};
  globalThis.__vendorTestCreateClient=(_url,key)=>({
    auth:{getUser:async()=>({data:{user:options.unauthenticated?null:{id:USER}},error:options.unauthenticated?{message:'Invalid token'}:null})},
    from:table=>{
      const filters=[]; const chain={select:()=>chain,eq:(name,value)=>{filters.push([name,value]);return chain;},single:async()=>{
        queries.push({table,filters});
        return {data:table==='profiles'?{company_id:C,role:options.role||'admin',is_active:options.active!==false,permissions:options.permissions||[]}:table==='companies'?{name:'Synthetic company',settings:{email:options.companyEmail===undefined?'office@example.invalid':options.companyEmail}}:options.unowned?null:{id:REQUEST,company_id:C,project_id:null,attachments:[storage],status:options.status||'Draft',title:'Synthetic scope request'},error:options.unowned&&table==='vendor_requests'?{message:'Not found'}:null};
      }};return chain;
    },
    rpc:async(name,args)=>{rpcs.push({name,args,service:key==='synthetic-service'});return{data:1,error:options.trackingFailure?{message:'Unavailable'}:null};},
  });
  globalThis.fetch=async(url,init)=>{
    calls.push({url,init});
    if(String(url).includes('/storage/')) return new Response(new Uint8Array([1,2,3]),{status:options.attachmentFailure?404:200,headers:{'content-length':'3'}});
    const isCopy=init?.headers?.['Idempotency-Key']?.endsWith('/vendor-request-copy');
    const failed=options.providerFailure||options.copyFailure&&isCopy;
    return new Response(JSON.stringify(failed?{message:'Synthetic provider failure'}:{id:isCopy?COPY_PROVIDER:PROVIDER}),{status:failed?422:200,headers:{'content-type':'application/json'}});
  };
  const source=await readFile(new URL('../../supabase/functions/send-vendor-request/index.ts',import.meta.url),'utf8');
  const output=await build({stdin:{contents:source,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'synthetic-edge-imports',setup(b){
    b.onResolve({filter:/^https:/},args=>({path:args.path,namespace:'edge-mock'}));
    b.onLoad({filter:/.*/,namespace:'edge-mock'},args=>({contents:args.path.includes('supabase-js')?'export const createClient=(...args)=>globalThis.__vendorTestCreateClient(...args);':args.path.includes('jszip')?'export default class JSZip { file(){} async generateAsync(){return new Uint8Array([1]);} }':args.path.includes('base64')?'export const encodeBase64=value=>Buffer.from(value).toString("base64");':'export const serve=handler=>{globalThis.__vendorTestHandler=handler;};',loader:'js'}));
  }}]});
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text+`\n// fixture ${generation++}`).toString('base64')}`);
  const invoke=async(body={},authorization='Bearer synthetic-user')=>{
    const response=await globalThis.__vendorTestHandler(new Request('https://synthetic.example/send-vendor-request',{method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify({to:'trade@example.invalid',cc:'office@example.invalid',bcc:'archive@example.invalid',subject:'Synthetic quote request',scope_of_work:'Synthetic scope',company_name:'Synthetic company',request_id:SEND,vendor_request_id:REQUEST,...body})}));
    return{status:response.status,body:await response.json()};
  };
  const close=()=>{globalThis.fetch=originalFetch;if(originalDeno===undefined)delete globalThis.Deno;else globalThis.Deno=originalDeno;delete globalThis.__vendorTestCreateClient;delete globalThis.__vendorTestHandler;};
  return{invoke,calls,queries,rpcs,close};
}

test('vendor requests retain CC/BCC formatting and use scoped idempotency plus validated delivery tracking',async()=>{
  const h=await harness();try{
    const result=await h.invoke();assert.equal(result.status,200);assert.equal(result.body.id,PROVIDER);
    assert.ok(h.queries.some(q=>q.table==='vendor_requests'&&q.filters.some(([k,v])=>k==='company_id'&&v===C)));
    const email=h.calls.find(c=>c.url==='https://api.resend.com/emails');const payload=JSON.parse(email.init.body);
    assert.deepEqual(payload.to,['trade@example.invalid']);assert.deepEqual(payload.cc,['office@example.invalid']);assert.deepEqual(payload.bcc,['archive@example.invalid']);assert.match(payload.html,/Synthetic scope/);assert.match(payload.html,/Synthetic company/);
    assert.equal(email.init.headers['Idempotency-Key'],`fuzedflow/${C}/${SEND}/vendor-request`);
    assert.ok(h.rpcs.some(r=>r.name==='register_outbound_delivery'&&r.service&&r.args.p_related==='Trade'&&r.args.p_id===REQUEST&&r.args.p_actor===USER));
  }finally{h.close();}
});

test('requested vendor copy uses the saved company address and exact original HTML and attachments',async()=>{
  const h=await harness();try{
    const result=await h.invoke({send_copy_to_company:true,attachments:[{filename:'scope.pdf',path:storage}]});
    assert.equal(result.status,200);assert.equal(result.body.copy_status,'sent');
    const emails=h.calls.filter(c=>c.url==='https://api.resend.com/emails').map(c=>({payload:JSON.parse(c.init.body),key:c.init.headers['Idempotency-Key']}));
    assert.equal(emails.length,2);assert.deepEqual(emails[1].payload.to,['office@example.invalid']);
    assert.equal(emails[1].payload.cc,undefined);assert.equal(emails[1].payload.bcc,undefined);
    assert.equal(emails[1].payload.html,emails[0].payload.html);
    assert.deepEqual(emails[1].payload.attachments,emails[0].payload.attachments);
    assert.equal(emails[1].payload.subject,'[COPY] Quote Request from Synthetic company - Synthetic scope request');
    assert.equal(emails[1].key,`fuzedflow/${C}/${SEND}/vendor-request-copy`);
    assert.ok(h.rpcs.some(r=>r.name==='register_outbound_delivery'&&r.args.p_copy===true&&r.args.p_recipient==='office@example.invalid'));
  }finally{h.close();}
});

test('a failed vendor copy reports accepted trade delivery and copy-only retry never resends the original',async()=>{
  let h=await harness({copyFailure:true});try{
    const result=await h.invoke({send_copy_to_company:true});assert.equal(result.status,200);assert.equal(result.body.copy_status,'failed');
    assert.equal(h.calls.filter(c=>c.url==='https://api.resend.com/emails').length,2);
  }finally{h.close();}
  h=await harness({status:'Sent'});try{
    const result=await h.invoke({send_copy_to_company:true,copy_only:true});assert.equal(result.status,200);assert.equal(result.body.copy_status,'sent');
    const email=h.calls.filter(c=>c.url==='https://api.resend.com/emails');assert.equal(email.length,1);
    assert.deepEqual(JSON.parse(email[0].init.body).to,['office@example.invalid']);
    assert.equal((await h.invoke({send_copy_to_company:true,copy_only:true,request_id:undefined})).status,400);
  }finally{h.close();}
});

test('invalid or unowned company copy cannot send an original email',async()=>{
  for(const options of [{companyEmail:'invalid'},{unowned:true}]){
    const h=await harness(options);try{assert.equal((await h.invoke({send_copy_to_company:true})).status,400);assert.equal(h.calls.length,0);}finally{h.close();}
  }
});

test('vendor attachments are limited to persisted request files in project storage',async()=>{
  const h=await harness();try{
    assert.equal((await h.invoke({attachments:[{filename:'scope.pdf',path:storage}]})).status,200);
    assert.equal(h.calls.filter(c=>String(c.url).includes('/storage/')).length,1);
    const before=h.calls.length;assert.equal((await h.invoke({attachments:[{filename:'secret.pdf',path:'http://127.0.0.1/private'}]})).status,400);assert.equal(h.calls.length,before);
    assert.equal((await h.invoke({attachments:[{filename:'other.pdf',path:storage.replace('scope.pdf','other.pdf')}]})).status,400);
  }finally{h.close();}
});

for(const [name,options]of[['invalid authentication',{unauthenticated:true}],['inactive account',{active:false}],['field account',{role:'employee'}],['foreign request',{unowned:true}],['missing vendor permission',{role:'manager',permissions:['projects']}]])test(`vendor email rejects ${name} before sending`,async()=>{
  const h=await harness(options);try{assert.equal((await h.invoke()).status,400);assert.equal(h.calls.length,0);}finally{h.close();}
});

test('vendor delivery failures create a persistent company alert without recording success',async()=>{
  const h=await harness({providerFailure:true});try{
    assert.equal((await h.invoke()).status,400);
    assert.ok(h.rpcs.some(r=>r.name==='record_sales_event'&&r.service&&r.args.p_id===REQUEST&&r.args.p_reference===SEND&&r.args.p_event==='vendor_request_delivery_failed'));
    assert.ok(!h.rpcs.some(r=>r.name==='register_outbound_delivery'));
  }finally{h.close();}
});

test('unavailable attachments stop the send and delivery tracking failure does not reject accepted email',async()=>{
  let h=await harness({attachmentFailure:true});try{assert.equal((await h.invoke({attachments:[{filename:'scope.pdf',path:storage}]})).status,400);assert.ok(!h.calls.some(c=>c.url==='https://api.resend.com/emails'));}finally{h.close();}
  h=await harness({trackingFailure:true});try{assert.equal((await h.invoke()).status,200);assert.ok(!h.rpcs.some(r=>r.name==='record_sales_event'));}finally{h.close();}
});
