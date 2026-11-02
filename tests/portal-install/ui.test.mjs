import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM,VirtualConsole} from 'jsdom';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),pause=ms=>new Promise(r=>setTimeout(r,ms));
const bundle=await build({stdin:{resolveDir:root,loader:'jsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import PortalInstallCard from './src/components/portal/PortalInstallCard';import {getInstallState,requestAppInstall} from './src/lib/installApp';window.staffInstallState=getInstallState;window.staffInstall=requestAppInstall;
 window.root=createRoot(document.getElementById('root'));window.renderInstall=()=>window.root.render(<PortalInstallCard clientId={window.installFixture.clientId} company={window.installFixture.company}/>);window.renderInstall();`},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"test"'},alias:{'@':root+'/src'}});
const client='00000000-0000-4000-8000-000000000001';
const logo='https://ochqexofahdssmarnict.supabase.co/storage/v1/object/public/logos/company.png';
async function view({platform='windows',queuedRoot=false}={}){
 const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<html><head><title>Fuzed Flow</title><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/staff-icon.png"><meta name="apple-mobile-web-app-title" content="FuzedFlow"></head><body><div id="root"></div></body></html>',{url:`https://app.fuzedflow.com/ClientPortal?id=${client}&portal_token=private-capability&tab=communications`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window,d=w.document;
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};
 const agents={windows:['Win32','Mozilla/5.0 (Windows NT 10.0) Chrome/156.0'],ios:['iPhone','Mozilla/5.0 (iPhone) Safari/604.1'],android:['Linux arm','Mozilla/5.0 (Linux; Android 16) Chrome/156.0'],mac:['MacIntel','Mozilla/5.0 (Macintosh) Safari/605.1']};
 Object.defineProperty(w.navigator,'platform',{value:agents[platform][0],configurable:true});Object.defineProperty(w.navigator,'userAgent',{value:agents[platform][1],configurable:true});
 w.fetch=()=>{throw new Error('Live requests forbidden');};
 const f=w.installFixture={clientId:client,company:{id:'company-one',name:'Sample Company',logo_url:logo},downloads:[],blobs:[],prompts:0,rootPrompts:0};
 w.URL.createObjectURL=blob=>{f.blobs.push(blob);return 'blob:synthetic-download';};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){f.downloads.push({href:this.href,name:this.download});};
 const prompt=(rootPrompt=false,outcome='accepted')=>{const event=new w.Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{if(rootPrompt)f.rootPrompts++;else f.prompts++;};event.userChoice=Promise.resolve({outcome});w.dispatchEvent(event);};
 w.eval(bundle.outputFiles[0].text);if(queuedRoot)prompt(true);
 const wait=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await pause(10);}throw new Error('Missing install UI state: '+d.body.textContent+' '+errors.join(';'));};
 const button=text=>[...d.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 await wait(()=>button('Download Client Portal'));await wait(()=>d.querySelector('link[rel=manifest]').getAttribute('href').startsWith('/api/client-portal-manifest'));
 const blobText=blob=>new Promise((resolve,reject)=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});
 return{w,d,f,errors,wait,button,prompt,blobText,close(){w.root.unmount();w.close();}};
}

test('prominent company-branded button and metadata use Client Portal and preserve private access',async()=>{
 const v=await view();try{
 const button=v.button('Download Client Portal');assert.ok(button.className.includes('min-h-12'));assert.ok(button.className.includes('w-full'));assert.ok(v.d.body.textContent.includes('Sample Company'));
 assert.equal(v.d.querySelector('img').alt,'Sample Company logo');assert.ok(v.d.querySelector('img').src.includes(encodeURIComponent(logo)));
 assert.equal(v.d.title,'Client Portal');assert.ok(v.d.querySelector('link[rel=apple-touch-icon]').href.includes('/api/client-portal-icon?'));assert.equal(v.d.querySelector('meta[name=apple-mobile-web-app-title]').content,'Client Portal');
 const params=new URL(v.d.querySelector('link[rel=manifest]').href).searchParams;assert.ok(params.get('start').includes('portal_token=private-capability'));
 button.click();await v.wait(()=>v.d.querySelector('[role=dialog]'));assert.ok(v.button('Download desktop link'));assert.deepEqual(v.errors,[]);
 v.w.root.unmount();assert.equal(v.d.title,'Fuzed Flow');assert.equal(v.d.querySelector('link[rel=manifest]').getAttribute('href'),'/manifest.json');
 }finally{v.close();}
});

test('desktop download has the expected name, private portal URL and company icon',async()=>{
 const v=await view();try{v.button('Download Client Portal').click();await v.wait(()=>v.button('Download desktop link'));v.button('Download desktop link').click();await v.wait(()=>v.f.downloads.length===1);
 assert.equal(v.f.downloads[0].name,'Client Portal.url');const content=await v.blobText(v.f.blobs[0]);assert.ok(content.includes(`URL=https://app.fuzedflow.com/ClientPortal?id=${client}`));assert.ok(content.includes('portal_token=private-capability'));assert.ok(content.includes('IconFile=https://app.fuzedflow.com/api/client-portal-icon?'));
 assert.ok(v.d.body.textContent.includes('Desktop link downloaded'));
 }finally{v.close();}
});

for(const platform of ['ios','android','mac'])test(`${platform} has device-specific instructions and the correct download option`,async()=>{
 const v=await view({platform});try{v.button('Download Client Portal').click();await v.wait(()=>v.d.querySelector('[role=dialog]'));
 if(platform==='ios'){assert.ok(v.d.body.textContent.includes('Add to Home Screen'));assert.ok(v.d.body.textContent.includes('Safari'));assert.equal(v.button('Download desktop link'),undefined);}
 if(platform==='android'){assert.ok(v.d.body.textContent.includes('Chrome'));assert.ok(v.d.body.textContent.includes('three-dot menu'));assert.equal(v.button('Download desktop link'),undefined);}
 if(platform==='mac'){assert.ok(v.d.body.textContent.includes('Add to Dock'));v.button('Download desktop link').click();await v.wait(()=>v.f.downloads.length);assert.equal(v.f.downloads[0].name,'Client Portal.webloc');}
 }finally{v.close();}
});

test('a queued staff-app install prompt can never install FuzedFlow from the Client Portal button',async()=>{
 const v=await view({queuedRoot:true});try{v.button('Download Client Portal').click();await v.wait(()=>v.d.querySelector('[role=dialog]'));assert.equal(v.f.rootPrompts,0);assert.equal(v.f.prompts,0);assert.equal(v.button('Install Client Portal'),undefined);
 v.prompt();await v.wait(()=>v.button('Install Client Portal'));v.button('Install Client Portal').click();await v.wait(()=>v.f.prompts===1);await v.wait(()=>v.d.body.textContent.includes('Your browser is adding Client Portal'));
 assert.equal(v.f.rootPrompts,0);
 }finally{v.close();}
});

test('dismissed native installation keeps the manual options available',async()=>{
 const v=await view();try{v.prompt(false,'dismissed');await pause(20);v.button('Download Client Portal').click();await v.wait(()=>v.f.prompts===1);await v.wait(()=>v.button('Download desktop link'));assert.ok(!v.d.body.textContent.includes('Your browser is adding'));
 }finally{v.close();}
});

test('broken company images fall back to company initials without removing installation controls',async()=>{
 const v=await view();try{v.d.querySelector('img').dispatchEvent(new v.w.Event('error'));await v.wait(()=>v.d.querySelector('[aria-label="Sample Company company icon"]'));assert.equal(v.d.querySelector('[aria-label="Sample Company company icon"]').textContent,'SC');assert.ok(v.button('Download Client Portal'));
 }finally{v.close();}
});

test('returning to the staff workspace never reuses a captured client portal prompt',async()=>{
 const v=await view();try{v.prompt();await pause(20);v.w.root.unmount();assert.equal(v.d.querySelector('link[rel=manifest]').getAttribute('href'),'/manifest.json');assert.equal(v.w.staffInstallState(),'manual');assert.equal((await v.w.staffInstall()).outcome,'unavailable');assert.equal(v.f.prompts,0);
 v.prompt(true);assert.equal(v.w.staffInstallState(),'ready');assert.equal((await v.w.staffInstall()).outcome,'accepted');assert.equal(v.f.rootPrompts,1);
 }finally{v.close();}
});

test('changing portal addresses while client data loads does not expose the wrong shortcut or break the page',async()=>{
 const v=await view();try{v.w.history.replaceState({},'', '/ClientPortal?id=00000000-0000-4000-8000-000000000002&portal_token=other-private-token');v.w.renderInstall();await v.wait(()=>!v.button('Download Client Portal'));assert.equal(v.d.querySelector('link[rel=manifest]').getAttribute('href'),'/manifest.json');assert.deepEqual(v.errors,[]);
 v.f.clientId='00000000-0000-4000-8000-000000000002';v.w.renderInstall();await v.wait(()=>v.button('Download Client Portal'));await v.wait(()=>v.d.querySelector('link[rel=manifest]').href.includes('other-private-token'));
 }finally{v.close();}
});
