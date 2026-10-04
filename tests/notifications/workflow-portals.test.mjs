import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const token='a'.repeat(64);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const bundle = build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import DocumentResponse from './src/pages/DocumentResponse.jsx';import WarrantyResponse from './src/pages/WarrantyResponse.jsx';window.fixtureRoot=createRoot(document.getElementById('root'));window.fixtureRoot.render(React.createElement(window.fixture.kind==='document'?DocumentResponse:WarrantyResponse));`, resolveDir: fileURLToPath(new URL('../..',import.meta.url)), loader:'jsx', sourcefile:'workflow-portal-fixture.jsx' },
  bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"test"'},alias:{'@':fileURLToPath(new URL('../../src',import.meta.url))},
  plugins:[{name:'synthetic-workflow-database',setup(builder){ builder.onResolve({filter:/^@\/api\/supabaseClient$/},()=>({path:'database',namespace:'workflow-fixture'})); builder.onLoad({filter:/.*/,namespace:'workflow-fixture'},()=>({loader:'js',contents:'export const supabase={rpc:(...args)=>window.fixture.rpc(...args)};'})); }}],
});

async function view(kind, options={}) {
  const errors=[];
  const virtualConsole=new VirtualConsole(); virtualConsole.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM('<div id="root"></div>',{url:`https://app.fuzedflow.com/${kind==='document'?'DocumentResponse':'WarrantyResponse'}?token=${options.token??token}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole});
  const {window}=dom; const {document}=window;
  window.fetch=()=>{throw new Error('Synthetic tests cannot use the network.');};
  const details=kind==='document'?{id:'doc-request',company_name:'Synthetic Company',title:'Agreement.pdf',request_type:options.type||'signature',recipient_name:'Tim Test',instructions:'Review the exact uploaded version.',status:'Pending',document_name:'Agreement.pdf',document_url:options.url||'https://files.example.invalid/agreement.pdf',expires_at:'2026-11-01T12:00:00Z'}:{company_name:'Synthetic Company',project_name:'Synthetic Project',customer_name:'Tim Test',can_create:true,expires_at:'2026-11-01T12:00:00Z',claims:[{id:'claim-1',title:'Door adjustment',description:'Door sticking',status:'Awaiting Customer',resolution:'Door adjusted',repair_visit_at:'2026-10-06T12:00:00Z',updates:[]}]};
  const fixture={kind,calls:[],responses:[],rpc(name,args){ fixture.calls.push({name,args:JSON.parse(JSON.stringify(args))}); if(name.endsWith('_details'))return Promise.resolve({data:details,error:null}); return new Promise(resolve=>fixture.responses.push(resolve)); }};
  window.fixture=fixture;
  window.eval((await bundle).outputFiles[0].text);
  async function wait(predicate){for(let i=0;i<200;i++){if(predicate())return;await pause(10);}throw new Error(`Expected portal state. ${document.body.textContent}. ${errors.join('; ')}`);}
  await wait(()=>document.body.textContent.includes('Agreement.pdf')||document.body.textContent.includes('Synthetic Project')||document.querySelector('[role="alert"]'));
  function input(selector,value){const element=document.querySelector(selector);assert.ok(element);Object.getOwnPropertyDescriptor(element.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new window.Event('input',{bubbles:true}));}
  const button=text=>[...document.querySelectorAll('button')].find(element=>element.textContent.trim()===text);
  const submit=form=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const close=()=>{window.fixtureRoot.unmount();window.close();};
  return {window,document,fixture,details,errors,wait,input,button,submit,close};
}

test('document portal records consent once, locks double submissions, and displays the recorded response',async()=>{
  const ui=await view('document');
  try{
    const submitButton=ui.button('Sign document'); assert.ok(submitButton.disabled);
    assert.equal(ui.document.querySelector('a').rel,'noopener noreferrer');
    const consent=ui.document.querySelector('#document-consent'); assert.equal(consent.checked,false);
    consent.click(); await ui.wait(()=>!ui.button('Sign document').disabled);
    ui.input('#document-message','Synthetic consent comment');
    await ui.wait(()=>ui.document.querySelector('#document-message').value==='Synthetic consent comment');
    const form=ui.document.querySelector('form'); ui.submit(form);ui.submit(form);
    await ui.wait(()=>ui.fixture.responses.length===1);
    const calls=ui.fixture.calls.filter(call=>call.name==='respond_document_request');assert.equal(calls.length,1);
    assert.deepEqual(calls[0].args,{p_token:token,p_action:'complete',p_name:'Tim Test',p_message:'Synthetic consent comment',p_consent:true});
    assert.ok(ui.document.querySelector('#document-signer').disabled);
    ui.fixture.responses[0]({data:{...ui.details,status:'Signed',signer_name:'Tim Test',responded_at:'2026-10-04T12:00:00Z',response_message:'Synthetic consent comment'},error:null});
    await ui.wait(()=>ui.document.body.textContent.includes('Response recorded: Signed'));
    assert.equal(ui.document.querySelector('form'),null);assert.deepEqual(ui.errors,[]);
  }finally{ui.close();}
});

test('review portal supports decline without consent and blocks unsafe file links',async()=>{
  const ui=await view('document',{type:'review',url:'javascript:alert(1)'});
  try{
    assert.equal(ui.document.querySelector('a'),null);
    ui.button('Decline request').click();await ui.wait(()=>ui.fixture.responses.length===1);
    const call=ui.fixture.calls.find(call=>call.name==='respond_document_request');assert.equal(call.args.p_action,'decline');assert.equal(call.args.p_consent,false);
    ui.fixture.responses[0]({data:null,error:{message:'Synthetic save failed'}});
    await ui.wait(()=>ui.document.querySelector('[role="alert"]')?.textContent.includes('Synthetic save failed'));
    assert.equal(ui.button('Decline request').disabled,false);assert.deepEqual(ui.errors,[]);
  }finally{ui.close();}
});

test('invalid public capability never queries private or public records',async()=>{
  const ui=await view('document',{token:'invalid'});
  try{assert.equal(ui.fixture.calls.length,0);assert.match(ui.document.querySelector('[role="alert"]').textContent,/invalid or expired/);assert.deepEqual(ui.errors,[]);}finally{ui.close();}
});

test('warranty portal submits a real claim and prevents duplicate customer submissions',async()=>{
  const ui=await view('warranty');
  try{
    ui.input('#warranty-title','Tile grout concern');ui.input('#warranty-description','Synthetic details of the issue');
    await ui.wait(()=>!ui.button('Submit warranty claim').disabled);
    const form=ui.document.querySelector('form');ui.submit(form);ui.submit(form);
    await ui.wait(()=>ui.fixture.responses.length===1);
    const call=ui.fixture.calls.find(call=>call.name==='respond_warranty_claim');assert.deepEqual(call.args,{p_token:token,p_action:'create',p_claim:null,p_title:'Tile grout concern',p_message:'Synthetic details of the issue'});
    ui.fixture.responses[0]({data:ui.details,error:null});await ui.wait(()=>ui.document.body.textContent.includes('Your warranty claim has been submitted.'));
    assert.equal(ui.document.querySelector('#warranty-title').value,'');assert.equal(ui.document.querySelector('#warranty-description').value,'');assert.deepEqual(ui.errors,[]);
  }finally{ui.close();}
});

test('warranty repair confirmation and reopening use distinct customer actions',async()=>{
  const ui=await view('warranty');
  try{
    ui.button('Confirm repair complete').click();await ui.wait(()=>ui.fixture.responses.length===1);
    let call=ui.fixture.calls.find(call=>call.name==='respond_warranty_claim');assert.equal(call.args.p_action,'confirm');assert.equal(call.args.p_claim,'claim-1');
    const resolved={...ui.details,claims:[{...ui.details.claims[0],status:'Resolved'}]};ui.fixture.responses[0]({data:resolved,error:null});await ui.wait(()=>ui.button('Reopen claim'));
    assert.equal(ui.button('Reopen claim').disabled,true);ui.input('#warranty-update-claim-1','The issue returned.');await ui.wait(()=>!ui.button('Reopen claim').disabled);
    ui.button('Reopen claim').click();await ui.wait(()=>ui.fixture.responses.length===2);
    call=ui.fixture.calls.filter(call=>call.name==='respond_warranty_claim')[1];assert.equal(call.args.p_action,'reopen');assert.equal(call.args.p_message,'The issue returned.');assert.deepEqual(ui.errors,[]);
  }finally{ui.close();}
});
