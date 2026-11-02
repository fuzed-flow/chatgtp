import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM,VirtualConsole} from 'jsdom';import {fileURLToPath} from 'node:url';
import {portalCommunicationAccess,portalMessagingEnabled,mergePortalMessages,addPortalCommunicationAccess,isSavedPortalRecipient} from '../../src/lib/portalCommunications.js';
const path=p=>fileURLToPath(new URL(p,import.meta.url)),pause=n=>new Promise(r=>setTimeout(r,n)),plain=v=>JSON.parse(JSON.stringify(v));
const bundle=await build({stdin:{resolveDir:path('../../'),loader:'jsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import Panel from './src/components/portal/PortalCommunicationPanel';import Settings from './src/components/settings/ClientPortalSettings';
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});window.queryClient=client;window.root=createRoot(document.getElementById('root'));
 window.renderPortal=(props={clientId:'client-one',access:{kind:'quote',token:'private-token'},companyName:'Sample Company'})=>window.root.render(<QueryClientProvider client={client}>{window.portalFixture.mode==='settings'?<Settings/>:<Panel key={props.clientId+props.access.token} {...props}/>}</QueryClientProvider>);window.renderPortal();`},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"test"'},alias:{'@/api/supabaseClient':path('./browser/mockDb.js'),'@/lib/AuthContext':path('./browser/mockAuth.js'),'@':path('../../src')}});
async function view(options={}){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/ClientPortal',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window,d=w.document;
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.fetch=()=>{throw new Error('Live requests forbidden');};
 const f=w.portalFixture={enabled:true,messages:[{id:'email-one',type:'Email',direction:'Outbound',subject:'Earlier email',message:'<p>Hello &amp; welcome</p><img src=x onerror="alert(1)">',status:'Delivered',created_at:'2026-11-02T15:00:00Z'},{id:'sms-one',type:'SMS',direction:'Inbound',subject:'Question',message:'A literal <b>SMS</b>',status:'Received',created_at:'2026-11-02T14:00:00Z'}],rpcs:[],sends:[],writes:[],older:[],...options};
 w.eval(bundle.outputFiles[0].text);
 const wait=async predicate=>{for(let n=0;n<150;n++){if(predicate())return;await pause(10);}throw new Error('Missing UI state: '+d.body.textContent+' '+errors.join(';'));};
 const input=async(selector,value)=>{const el=d.querySelector(selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?w.HTMLTextAreaElement.prototype:w.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(15);};
 const button=text=>[...d.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 await wait(()=>f.mode==='settings'?d.querySelector('#portal-communications'):!d.body.textContent.includes('Loading communications'));
 return{w,d,f,errors,wait,input,button,close(){w.root.unmount();w.queryClient.clear();dom.window.close();}};
}
test('access uses opaque capabilities and is opt-in with per-client override',()=>{
 assert.equal(isSavedPortalRecipient({email:'Client@example.invalid'},'client@example.invalid','email'),true);
 assert.equal(isSavedPortalRecipient({email:'client@example.invalid'},'other@example.invalid','email'),false);
 assert.equal(isSavedPortalRecipient({phone:'(403) 555-2345'},'+14035552345','sms'),true);
 assert.equal(isSavedPortalRecipient({phone:'(403) 555-2345'},'+14035559999','sms'),false);
 assert.equal(portalCommunicationAccess(new URLSearchParams('id=client')),null);
 assert.deepEqual(portalCommunicationAccess(new URLSearchParams('quote_token=abc')),{token:'abc',kind:'quote'});
 assert.deepEqual(portalCommunicationAccess(new URLSearchParams('portal_token=secure&co_token=co')),{token:'secure',kind:'portal'});
 assert.equal(portalMessagingEnabled({},{}),false);assert.equal(portalMessagingEnabled({client_portal:{show_communications:true}},{direct_messaging:false}),false);
 assert.equal(portalMessagingEnabled({client_portal:{show_communications:true}},'{}'),true);
});
test('project update and closeout URLs keep their original location and add only a private token',async()=>{
 const calls=[],db={async rpc(name,args){calls.push({name,args});return {data:'private-token'};}};
 const url=new URL(await addPortalCommunicationAccess(db,'https://app.invalid/ClientPortal?id=client&tab=updates&update=update-one','client'));
 assert.equal(url.searchParams.get('update'),'update-one');assert.equal(url.searchParams.get('portal_token'),'private-token');assert.equal(calls[0].name,'issue_client_portal_communication_token');
 assert.equal(await addPortalCommunicationAccess({rpc:async()=>({data:null})},url.toString(),'client'),url.toString());
 await assert.rejects(addPortalCommunicationAccess({rpc:async()=>({error:{message:'No'}})},url.toString(),'client'),/could not be created/);
});
test('history text is inert, uses client perspective, and exposes no staff-only actions',async()=>{
 const v=await view();try{await v.wait(()=>v.d.body.textContent.includes('Earlier email'));
 assert.equal(v.d.querySelector('img'),null);assert.equal(v.d.querySelector('script'),null);assert.ok(v.d.body.textContent.includes('Hello & welcome'));assert.ok(v.d.body.textContent.includes('A literal <b>SMS</b>'));
 assert.ok(v.d.body.textContent.includes('You'));assert.equal(v.button('Add Reminder'),undefined);assert.equal(v.button('Mark handled'),undefined);assert.ok(v.button('Reply by Email'));
 assert.deepEqual(v.errors,[]);assert.equal(v.f.rpcs[0].args.p_client,'client-one');assert.equal(v.f.rpcs[0].args.p_token,'private-token');
 }finally{v.close();}
});
for(const channel of ['Email','SMS'])test(`client can compose ${channel} with fixed identity, bounded text and one send intent`,async()=>{
 const v=await view();try{
 await v.wait(()=>v.d.querySelector('#portal-message-body'));if(channel==='SMS'){v.d.querySelector('input[value=SMS]').click();await pause(20);}else await v.input('#portal-message-subject','A client question');
 assert.equal(v.d.querySelector('textarea').maxLength,channel==='SMS'?1600:5000);await v.input('textarea','  My question <3  ');
 const send=v.button('Send '+channel);send.click();send.click();await v.wait(()=>v.f.sends.length===1);await v.wait(()=>v.d.querySelector('textarea').value==='');
 const call=plain(v.f.sends[0]);assert.equal(call.name,'client-portal-message');assert.equal(call.body.client_id,'client-one');assert.equal(call.body.channel,channel);assert.equal(call.body.message,'My question <3');assert.equal(call.body.recipient,undefined);assert.equal(call.body.company_id,undefined);assert.match(call.body.request_id,/^[a-f0-9-]{36}$/);assert.ok(v.d.body.textContent.includes('accepted for sending'));
 }finally{v.close();}
});
test('reply links the selected outgoing message and failed sends retain the draft and stable request ID',async()=>{
 const v=await view();try{await v.wait(()=>v.button('Reply by Email'));v.button('Reply by Email').click();await pause(20);
 assert.equal(v.d.querySelector('#portal-message-subject').value,'Re: Earlier email');assert.equal(v.d.activeElement.id,'portal-message-body');
 await v.input('textarea','Reply text');v.f.nextSend=async()=>({error:{context:{clone:()=>({json:async()=>({error:'Delivery pending'})})}},data:null});
 v.button('Send Email').click();await v.wait(()=>v.d.body.textContent.includes('Delivery pending'));assert.equal(v.d.querySelector('textarea').value,'Reply text');
 v.button('Send Email').click();await v.wait(()=>v.f.sends.length===2);assert.equal(v.f.sends[0].body.request_id,v.f.sends[1].body.request_id);assert.equal(v.f.sends[0].body.reply_id,'email-one');
 }finally{v.close();}
});
test('server off switch clears loaded history and removes sending controls',async()=>{
 const v=await view();try{await v.wait(()=>v.d.body.textContent.includes('Earlier email'));v.f.enabled=false;await v.w.queryClient.invalidateQueries();
 await v.wait(()=>v.d.body.textContent.includes('currently unavailable'));assert.ok(!v.d.body.textContent.includes('Earlier email'));assert.equal(v.d.querySelector('textarea'),null);
 }finally{v.close();}
});
test('failed capability refresh hides cached messages and contact methods can be disabled',async()=>{
 const v=await view({smsAvailable:false});try{await v.wait(()=>v.d.querySelector('input[value=SMS]'));assert.equal(v.d.querySelector('input[value=SMS]').disabled,true);
 v.f.rpcError=true;await v.w.queryClient.invalidateQueries();await v.wait(()=>v.d.body.textContent.includes('private portal link'));assert.ok(!v.d.body.textContent.includes('Earlier email'));
 }finally{v.close();}
});
test('earlier messages use cursor pagination, merge without duplicates and retain latest status',async()=>{
 const v=await view({hasMore:true,older:[{id:'older',type:'SMS',direction:'Outbound',message:'Older message',created_at:'2026-10-01T12:00Z',status:'Sent'}]});try{
 await v.wait(()=>v.button('Load earlier messages'));v.button('Load earlier messages').click();await v.wait(()=>v.d.body.textContent.includes('Older message'));
 assert.equal(v.f.rpcs.at(-1).args.p_before_id,'sms-one');assert.equal(v.button('Load earlier messages'),undefined);
 assert.equal(mergePortalMessages([{id:'a',created_at:'2026-10-01',status:'Sent'}],[{id:'a',created_at:'2026-10-01',status:'Delivered'}])[0].status,'Delivered');
 }finally{v.close();}
});
test('switching private client links remounts and clears unsent text',async()=>{
 const v=await view();try{await v.wait(()=>v.d.querySelector('textarea'));await v.input('textarea','Private draft');
 v.w.renderPortal({clientId:'client-two',access:{kind:'portal',token:'different-private-token'},companyName:'Other contractor'});await v.wait(()=>v.d.querySelector('textarea')?.value==='');
 assert.equal(v.d.querySelector('#portal-message-subject').value,'');assert.equal(v.f.rpcs.at(-1).args.p_client,'client-two');
 }finally{v.close();}
});
test('subscriber setting starts off and saves the new toggle while preserving other portal settings',async()=>{
 const v=await view({mode:'settings',settings:{email:'company@example.invalid',client_portal:{show_project_closeouts:false,another_setting:'retain'}}});try{
 const toggle=v.d.querySelector('#portal-communications');assert.equal(toggle.getAttribute('aria-checked'),'false');assert.equal(toggle.getAttribute('aria-describedby'),'portal-communications-description');toggle.click();await pause(20);
 const save=[...v.d.querySelectorAll('button')].find(b=>b.textContent.includes('Save'));save.click();await v.wait(()=>v.f.writes.length===1);
 const write=plain(v.f.writes[0]);assert.equal(write.id,'company-one');assert.equal(write.value.settings.client_portal.show_communications,true);assert.equal(write.value.settings.client_portal.show_project_closeouts,false);assert.equal(write.value.settings.client_portal.another_setting,'retain');assert.equal(write.value.settings.email,'company@example.invalid');
 }finally{v.close();}
});
