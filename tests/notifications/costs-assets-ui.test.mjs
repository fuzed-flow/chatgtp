import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM, VirtualConsole } from 'jsdom';

const local = p => fileURLToPath(new URL(p, import.meta.url));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C=id(1), U=id(2), A=id(3), B=id(4), R=id(5), V=id(6);
const source = `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,useNavigate} from 'react-router-dom';import Inventory from './src/pages/Inventory.jsx';import Vendors from './src/pages/Vendors.jsx';import Equipment from './src/components/employee/EPEquipmentReservations.jsx';
const f=window.fixture;window.qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});window.root=createRoot(document.getElementById('root'));function View(){window.navigate=useNavigate();const Component={inventory:Inventory,vendors:Vendors,equipment:Equipment}[f.kind];return React.createElement(Component,{profile:f.profile});}window.root.render(React.createElement(MemoryRouter,{initialEntries:[f.path]},React.createElement(QueryClientProvider,{client:window.qc},React.createElement(View))));`;
const bundled = build({ stdin:{contents:source,resolveDir:local('../..'),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',alias:{'@':local('../../src')},define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'cost-ui-fixture',setup(b){
 b.onResolve({filter:/^(?:@\/api\/supabaseClient|@\/lib\/AuthContext|sonner)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.includes('supabaseClient')?'export const supabase={from:t=>window.fixture.from(t),rpc:(n,p)=>window.fixture.rpc(n,p)};':a.path.includes('AuthContext')?'export const useAuth=()=>({profile:window.fixture.profile});':'export const toast={success:m=>window.fixture.toasts.push(m),error:m=>window.fixture.toasts.push(m)};'}));
 }}] });

async function view(kind,path) {
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.example/Inventory',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window;
 w.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLElement.prototype.hasPointerCapture=()=>false;w.HTMLElement.prototype.setPointerCapture=()=>{};w.HTMLElement.prototype.releasePointerCapture=()=>{};
 w.fetch=()=>{throw new Error('Live requests are forbidden in UI fixtures');};
 const f={kind,path,profile:{id:U,company_id:C,role:kind==='equipment'?'employee':'owner',full_name:'Synthetic user'},queries:[],rpcs:[],toasts:[]};
 const items=[{id:A,company_id:C,name:'Older drill',item_type:'Equipment',equipment_status:'Available',unit:'ea',quantity_on_hand:2},{id:B,company_id:C,name:'Second tool',item_type:'Equipment',equipment_status:'Available',unit:'ea',quantity_on_hand:2}];
 const reservation={id:R,company_id:C,inventory_id:A,assigned_to:U,quantity:1,start_date:'2026-10-04',return_due_date:'2026-10-06',status:'Reserved',inventory:items[0],projects:{name:'Synthetic project'}};
 f.from=table=>{const record={table,filters:[]};f.queries.push(record);let single=false;const result=()=>{const target=record.filters.find(([key])=>key==='id')?.[1];let rows=[];
  if(table==='inventory') rows=target?items.filter(i=>i.id===target):[]; // main list intentionally omits older targets
  if(table==='vendors') rows=target===V?[{id:V,company_id:C,name:'Older supplier',category:'Other'}]:[];
  if(table==='inventory_reservations') rows=target===R?[reservation]:kind==='equipment'&& !target?[]:[];
  return Promise.resolve({data:single?rows[0]||null:JSON.parse(JSON.stringify(rows)),error:null});};
  const chain={select(p){record.projection=p;return chain;},eq(k,v){record.filters.push([k,v]);return chain;},neq(k,v){record.filters.push([k,v]);return chain;},order(){return chain;},maybeSingle(){single=true;return result();},then:(yes,no)=>result().then(yes,no)};return chain;};
 f.rpc=async(name,params)=>{f.rpcs.push({name,params});if(params.p_action==='request_checkout')reservation.checkout_requested_at='2026-10-04T12:00:00Z';if(params.p_action==='confirm_return')reservation.status='Returned';return {data:{status:reservation.status},error:null};};
 f.reservation=reservation;w.fixture=f;w.eval((await bundled).outputFiles[0].text);
 const wait=async condition=>{for(let n=0;n<200;n++){if(condition())return;await new Promise(r=>setTimeout(r,10));}throw new Error('UI timeout: '+w.document.body.textContent.slice(0,800));};
 const button=text=>[...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 return {w,f,wait,button,close(){w.root.unmount();w.qc.clear();w.close();assert.deepEqual(errors,[]);}};
}

test('inventory resolves older reservation targets separately and reacts to another item in the same mounted page',async()=>{
 const v=await view('inventory',`/Inventory?reservation=${R}`);try{
  await v.wait(()=>v.w.document.querySelector('[role=dialog]')?.textContent.includes('Older drill'));
  await v.wait(()=>v.w.document.querySelector('[role=dialog]')?.textContent.includes('Reserved'));
  assert.ok(v.f.queries.some(q=>q.table==='inventory_reservations'&&q.filters.some(([k,value])=>k==='id'&&value===R)));
  assert.ok(v.f.queries.some(q=>q.table==='inventory'&&q.filters.some(([k,value])=>k==='id'&&value===A)));
  v.w.navigate(`/Inventory?id=${B}`);
  await v.wait(()=>v.w.document.querySelector('[role=dialog]')?.textContent.includes('Second tool'));
  for(const q of v.f.queries)assert.ok(q.filters.some(([k,value])=>k==='company_id'&&value===C),'Every target query is tenant scoped');
 }finally{v.close();}
});

test('vendor notification opens an older supplier form outside the main list',async()=>{
 const v=await view('vendors',`/Vendors?id=${V}`);try{
  await v.wait(()=>v.w.document.querySelector('[role=dialog] input')?.value==='Older supplier');
  const target=v.f.queries.find(q=>q.table==='vendors'&&q.filters.some(([k,value])=>k==='id'&&value===V));
  assert.ok(target);assert.ok(target.filters.some(([k,value])=>k==='company_id'&&value===C));
 }finally{v.close();}
});

test('field equipment target requests checkout without changing status and only offers return after office approval',async()=>{
 const v=await view('equipment',`/EmployeePortal?tab=inventory&reservation=${R}`);try{
  await v.wait(()=>v.button('Request checkout'));
  assert.ok(v.button('Request checkout').classList.contains('min-h-11'));
  assert.equal(v.button('Confirm equipment returned'),undefined);
  v.button('Request checkout').click();await v.wait(()=>v.w.document.body.textContent.includes('waiting for office approval'));
  assert.equal(v.f.reservation.status,'Reserved');
  assert.deepEqual(JSON.parse(JSON.stringify(v.f.rpcs[0])),{name:'inventory_reservation_action',params:{p_reservation:R,p_action:'request_checkout'}});
  v.f.reservation.status='Checked out';await v.w.qc.invalidateQueries({queryKey:['my-equipment-target']});
  await v.wait(()=>v.button('Confirm equipment returned'));v.button('Confirm equipment returned').click();await v.wait(()=>v.w.document.body.textContent.includes('Returned'));
  assert.equal(v.f.rpcs[1].params.p_action,'confirm_return');
  for(const q of v.f.queries){assert.ok(q.filters.some(([k,value])=>k==='assigned_to'&&value===U));assert.ok(q.filters.some(([k,value])=>k==='company_id'&&value===C));}
 }finally{v.close();}
});
