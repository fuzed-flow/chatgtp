import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = fileURLToPath(new URL('../..', import.meta.url));
const TOKEN = 'a'.repeat(64), CLIENT = '00000000-0000-4000-8000-000000000003';
const built = await build({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Portal from './src/pages/ClientPortal.jsx';
    window.root=createRoot(document.getElementById('root')); window.root.render(<Portal/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife',
  define: { 'process.env.NODE_ENV': '"test"' }, alias: { '@': `${root}/src` },
  plugins: [{ name: 'portal-fixtures', setup(builder) {
    builder.onResolve({ filter: /^@\/api\/supabaseClient$|PDFGenerator/ }, args => ({ path: args.path.includes('PDFGenerator') ? 'pdf' : 'db', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader:'js', contents: args.path==='pdf'
      ? 'export const generateClientUpdatePDF=async()=>{}; export const generateProjectCloseoutPDF=async()=>{};'
      : 'export const supabase={rpc:(...args)=>window.portalRpc(...args),from:()=>{throw new Error("Unexpected direct table access");}};' }));
  } }],
});

async function fixture(parameter='quote_token',settings={}) {
  const errors=[],calls=[],opened=[];
  const console=new VirtualConsole(); console.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM('<title>FuzedFlow</title><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icon.png"><meta name="apple-mobile-web-app-title" content="FuzedFlow"><div id="root"></div>',{
    url:`https://app.example/ClientPortal?id=${CLIENT}&${parameter}=${TOKEN}`,runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:console,
  });
  const {window}=dom;
  window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  window.fetch=()=>{throw new Error('No live requests allowed');};
  window.open=()=>({opener:{},close(){opened.push('closed');},location:{replace(url){opened.push(url);}}});
  window.portalRpc=async(name,args)=>{
    calls.push({name,args:JSON.parse(JSON.stringify(args))});
    if(name==='get_client_portal_document_link')return{data:'b'.repeat(64),error:null};
    assert.equal(name,'get_client_portal_bundle');
    return{error:null,data:{
      client:{id:CLIENT,name:'Test Client'},company:{name:'Test Contractor',logo_url:'https://assets.example/contractor.png',settings:{client_portal:settings}},
      quotes:[{id:'quote-1',quote_number:'QT-1',title:'Quote',status:'Sent',created_at:'2026-11-20',total:100}],
      invoices:settings.show_invoices===false?[]:[{id:'invoice-1',invoice_number:'INV-1',status:'Sent',due_date:'2026-12-20',balance_due:50}],
      change_orders:settings.show_change_orders===false?[]:[{id:'co-1',co_number:'CO-1',title:'Change',status:'Sent',created_at:'2026-11-20',total:25}],updates:[],closeouts:[],
    }};
  };
  window.eval(built.outputFiles[0].text);
  const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error(`Did not render: ${window.document.body.textContent}; ${errors}`);};
  await wait(()=>window.document.body.textContent.includes('Test Client'));
  return{window,calls,errors,opened,wait,close(){window.root.unmount();dom.window.close();}};
}

for(const parameter of ['quote_token','invoice_token','co_token','portal_token']){
  test(`all enabled desktop and mobile tabs render from ${parameter}`,async()=>{
    const view=await fixture(parameter);
    try{
      for(const title of ['Quotes','Change Orders','Invoices']){
        assert.ok([...view.window.document.querySelectorAll('[role="tab"]')].some(el=>el.textContent.trim().startsWith(title)));
        assert.ok([...view.window.document.querySelectorAll('select option')].some(el=>el.textContent.trim().startsWith(title)));
      }
      assert.ok(view.window.document.body.textContent.includes('Add Client Portal'));
      const logo=view.window.document.querySelector('img[alt="Test Contractor logo"]');
      assert.equal(logo.src,'https://assets.example/contractor.png');
      assert.equal(view.window.document.querySelector('img[alt="FuzedFlow Logo"]'),null);
      assert.equal(view.window.document.title,'Test Contractor Client Portal');
      assert.ok(view.window.document.querySelector('link[rel="manifest"]').href.includes('/api/client-portal-assets?'));
      assert.equal(new URL(view.window.location.href).searchParams.get('portal_token'),TOKEN);
      assert.deepEqual(view.errors,[]);
    }finally{view.close();}
  });
}
test('disabled tabs stay hidden on desktop and mobile',async()=>{
  const view=await fixture('quote_token',{show_invoices:false,show_change_orders:false});
  try{
    for(const title of ['Invoices','Change Orders']){
      assert.ok(![...view.window.document.querySelectorAll('[role="tab"],select option')].some(el=>el.textContent.trim().startsWith(title)));
    }
  }finally{view.close();}
});
test('opening an invoice requests a document-scoped credential before navigating',async()=>{
  const view=await fixture();
  try{
    const tab=[...view.window.document.querySelectorAll('[role="tab"]')].find(el=>el.textContent.trim().startsWith('Invoices'));
    tab.dispatchEvent(new view.window.MouseEvent('mousedown',{bubbles:true,button:0}));
    await view.wait(()=>view.window.document.body.textContent.includes('View Invoice'));
    [...view.window.document.querySelectorAll('button')].find(el=>el.textContent.includes('View Invoice')).click();
    await view.wait(()=>view.opened.length>0);
    assert.ok(view.opened[0].includes('/PublicInvoiceView?id=invoice-1&token='));
    assert.ok(view.calls.some(c=>c.name==='get_client_portal_document_link'&&c.args.p_kind==='invoice'));
  }finally{view.close();}
});
test('the install button opens portal-specific fallback instructions',async()=>{
  const view=await fixture();
  try{
    [...view.window.document.querySelectorAll('button')].find(el=>el.textContent==='Add Client Portal').click();
    await view.wait(()=>view.window.document.body.textContent.includes('Add Test Contractor Client Portal'));
    assert.ok(view.window.document.body.textContent.includes('bookmark this page'));
  }finally{view.close();}
});
