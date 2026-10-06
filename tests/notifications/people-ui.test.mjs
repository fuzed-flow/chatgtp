import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM, VirtualConsole} from 'jsdom';

const local = path => fileURLToPath(new URL(path, import.meta.url));
const plain = value => JSON.parse(JSON.stringify(value));
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
const COMPANY = '10000000-0000-4000-8000-000000000001';
const USER = '10000000-0000-4000-8000-000000000010';
const PROJECT = '10000000-0000-4000-8000-000000000020';
const TASK = '10000000-0000-4000-8000-000000000030';
const PREREQUISITE = '10000000-0000-4000-8000-000000000031';

const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,useNavigate} from 'react-router-dom';
import DailyLogs from './src/components/employee/EPDailyLogs.jsx';
import Leave from './src/components/employee/EPVacationTracker.jsx';
import Tasks from './src/components/tasks/TaskWorkflowPanel.jsx';
import Hours from './src/components/pm/PMManagementHoursPanel.jsx';
import Identity from './src/components/employee/LeaveIdentityPicker.jsx';
import OfficeTasks from './src/pages/Tasks.jsx';
import FieldTasks from './src/components/employee/EPTasks.jsx';
import AssignedWork from './src/components/employee/EPAssignedWork.jsx';
import Portal from './src/pages/EmployeePortal.jsx';
import Clock from './src/components/employee/EPTimeClock.jsx';
import Sheets from './src/components/employee/EPTimesheets.jsx';
import * as allocations from './src/lib/projectAllocations.js';
window.allocations=allocations;
const f=window.peopleFixture;
const components={logs:DailyLogs,leave:Leave,task:Tasks,hours:Hours,identity:Identity,office_tasks:OfficeTasks,field_tasks:FieldTasks,assigned_work:AssignedWork,portal:Portal,clock:Clock,sheets:Sheets};
window.peopleQueryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
const invalidate=window.peopleQueryClient.invalidateQueries.bind(window.peopleQueryClient);
window.peopleQueryClient.invalidateQueries=options=>{f.invalidations.push(options.queryKey);return invalidate(options);};
window.peopleRoot=createRoot(document.getElementById('root'));
const child=React.createElement(components[f.component],f.props);
function NavigationFixture({children}){const navigate=useNavigate();window.navigatePeople=navigate;return children;}
window.peopleRoot.render(React.createElement(MemoryRouter,{initialEntries:[f.path||'/EmployeePortal']},React.createElement(NavigationFixture,null,React.createElement(QueryClientProvider,{client:window.peopleQueryClient},f.component==='task'?React.createElement('form',{onSubmit:event=>{event.preventDefault();f.parentSubmits++;}},child):child))));
`;
// Native Select primitives keep option selection deterministic; component state,
// actual form controls, Radix dialogs and React Query are otherwise real.
const selectFixture = `import React from 'react';
export const SelectItem=()=>null,SelectContent=()=>null,SelectTrigger=()=>null,SelectValue=()=>null;
export function Select({value,onValueChange,disabled,children}){
 const options=[];let trigger={};
 const visit=nodes=>React.Children.forEach(nodes,node=>{if(!React.isValidElement(node))return;if(node.type===SelectItem)options.push(node.props);else if(node.type===SelectTrigger)trigger=node.props;else visit(node.props.children);});visit(children);
 return React.createElement('select',{value:value||'',onChange:e=>onValueChange(e.target.value),disabled,id:trigger.id,'aria-label':trigger['aria-label']},[React.createElement('option',{key:'empty',value:''},'Select'),...options.map(o=>React.createElement('option',{key:o.value,value:o.value,disabled:o.disabled},o.children))]);
}`;
const bundle = build({
 stdin:{contents:source,resolveDir:local('../..'),loader:'jsx'},bundle:true,write:false,platform:'browser',format:'iife',
 define:{'process.env.NODE_ENV':'"test"'},alias:{'@':local('../../src')},
 plugins:[{name:'synthetic-people-services',setup(builder){
  builder.onResolve({filter:/^(?:@\/api\/supabaseClient|@\/lib\/AuthContext|@\/components\/ui\/select|@\/components\/employee\/ProjectPlanList|sonner)$/},args=>({path:args.path,namespace:'people-fixture'}));
  builder.onLoad({filter:/.*/,namespace:'people-fixture'},args=>({loader:'js',resolveDir:local('../..'),contents:
   args.path.includes('supabaseClient')?'export const supabase={from:t=>window.peopleFixture.from(t),rpc:(n,p)=>window.peopleFixture.rpc(n,p)};':
   args.path.includes('AuthContext')?'export const useAuth=()=>window.peopleFixture.auth;':
   args.path.includes('ui/select')?selectFixture:
   args.path.includes('ProjectPlanList')?'import React from "react";export default function Plans({projectId}){return React.createElement("div",{"data-assigned-plans":projectId},"Assigned project plans");}':
   'export const toast={success:m=>window.peopleFixture.toasts.push({level:"success",message:m}),error:m=>window.peopleFixture.toasts.push({level:"error",message:m})};'
  }));
 }}],
});

async function view(component, options={}) {
 const errors=[];const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.example/EmployeePortal',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole});
 const {window}=dom;window.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 window.HTMLElement.prototype.scrollIntoView=()=>{};window.HTMLElement.prototype.hasPointerCapture=()=>false;window.HTMLElement.prototype.setPointerCapture=()=>{};window.HTMLElement.prototype.releasePointerCapture=()=>{};
 window.fetch=()=>{throw new Error('No live requests permitted in people workflow tests');};window.confirm=()=>true;
 const profile={id:USER,company_id:COMPANY,full_name:'Synthetic Manager',role:component==='hours'?'manager':component==='office_tasks'?'office':'employee'};
 const task={id:TASK,project_id:PROJECT,title:'Synthetic task'};
 const staff=[{id:'staff-one',company_id:COMPANY,project_id:PROJECT,user_id:USER,is_active:true,pm_hours_cap:10}];
 const props=['logs','leave','field_tasks','assigned_work','clock','sheets'].includes(component)?{currentUser:profile,companyId:COMPANY}:component==='task'?{task}:component==='hours'?{project:{id:PROJECT},staff,users:[profile]}:{request:{id:'legacy-leave',employee_name:'Legacy person'}};
 const f={component,props,auth:{profile,company:{plan_id:'professional'},settings:{}},queries:[],writes:[],rpcs:[],toasts:[],invalidations:[],parentSubmits:0,writeErrors:[],pendingWrite:null,...options};
 const rows={users:profile,profiles:['identity','office_tasks'].includes(component)?[profile]:profile,companies:{name:'Synthetic company'},projects:[{id:PROJECT,name:'Assigned project'}],clients:[],leads:[],vendors:[],tasks:[],project_tasks:[],project_phases:[],project_milestones:[],project_staff:[{project_id:PROJECT,projects:{id:PROJECT,name:'Assigned project'}}],project_daily_logs:[],time_off_requests:options.requests||[],time_entries:[],project_allocations:[],resource_allocations:[],...options.rows};
 f.from=table=>{
  const record={table,mode:'select',filters:[]};f.queries.push(record);let response;
  const resolve=()=>response ||= Promise.resolve().then(async()=>{
   if(record.mode!=='select'){
    f.writes.push(plain(record));if(f.pendingWrite)await f.pendingWrite;
    const message=f.writeErrors.shift();return {data:message?null:f.writeData??[{id:record.filters.find(([key])=>key==='id')?.[1]||'saved-record'}],error:message?{message}:null};
   }
   if(!Object.hasOwn(rows,table))throw new Error('Unexpected synthetic table '+table);
   let data=rows[table];if(f.readOverride)data=await f.readOverride(record,data);
   if(record.single&&Array.isArray(data))data=data[0]??null;
   return {data:plain(data),error:null};
  });
  const chain={select(projection){record.projection=projection;return chain;},eq(key,value){record.filters.push([key,value]);return chain;},in(key,value){record.filters.push([key,value]);return chain;},contains(key,value){record.filters.push([key,value]);record.contains=[key,value];return chain;},gte(key,value){record.filters.push([key,value]);record.gte=[key,value];return chain;},lte(key,value){record.filters.push([key,value]);record.lte=[key,value];return chain;},is(key,value){record.filters.push([key,value]);return chain;},or(value){record.or=value;return chain;},order(field,options){record.order={field,options};return chain;},limit(count){record.limit=count;return chain;},insert(payload){record.mode='insert';record.payload=payload;return chain;},update(payload){record.mode='update';record.payload=payload;return chain;},delete(){record.mode='delete';return chain;},single(){record.single=true;return resolve();},maybeSingle(){record.single=true;return resolve();},then:(yes,no)=>resolve().then(yes,no)};
  return chain;
 };
 f.rpc=async(name,params)=>{f.rpcs.push({name,params:plain(params)});return {data:{comments:[],dependencies:[],options:[{id:PREREQUISITE,title:'Prepare site'}],can_edit_dependencies:true,...f.workflow},error:null};};
 window.peopleFixture=f;window.eval((await bundle).outputFiles[0].text);
 const wait=async condition=>{for(let i=0;i<200;i++){if(condition())return;await pause();}throw new Error('Timed out waiting for synthetic UI: '+window.document.body.textContent.slice(0,400));};
 const button=text=>[...window.document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
 const click=text=>{const node=button(text);assert.ok(node,'Missing button '+text);node.click();};
 const input=(node,value)=>{assert.ok(node,'Missing input');const prototype=node.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:node.tagName==='SELECT'?window.HTMLSelectElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);node.dispatchEvent(new window.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));};
 const close=()=>{window.peopleRoot.unmount();window.peopleQueryClient.clear();dom.window.close();assert.deepEqual(errors,[]);};
 return {window,document:window.document,f,wait,button,click,input,close};
}

test('field daily log saves tenant identity and structured work/weather after an assigned-project selection',async()=>{
 const v=await view('logs');try{
  await v.wait(()=>v.button('Submit New Log'));v.click('Submit New Log');
  await v.wait(()=>v.document.querySelectorAll('select').length===3);
  const selects=v.document.querySelectorAll('select');v.input(selects[1],PROJECT);
  v.input(v.document.querySelector('textarea[placeholder="Describe the work done..."]'),'Installed site doors');
  await v.wait(()=>!v.button('Submit Log').disabled);v.document.querySelector('input[type=checkbox]').click();await pause();v.click('Submit Log');
  await v.wait(()=>v.f.writes.length===1);
  const write=v.f.writes[0];assert.equal(write.table,'project_daily_logs');
  assert.deepEqual(write.payload[0],{company_id:COMPANY,user_id:USER,project_id:PROJECT,date:write.payload[0].date,weather:'Sunny',category:'Work Completed',weather_delay:true,summary:'Installed site doors',blockers:null,safety_concerns:null,materials_used:null,photos:[]});
  const assigned=v.f.queries.find(q=>q.table==='project_staff');assert.ok(assigned.filters.some(([k,x])=>k==='company_id'&&x===COMPANY));assert.ok(assigned.filters.some(([k,x])=>k==='user_id'&&x===USER));
 }finally{v.close();}
});

test('time off rejects reversed dates, links the requesting user and preserves a cancelled request',async()=>{
 const request={id:'leave-one',type:'Vacation',status:'Pending',start_date:'2026-10-10',end_date:'2026-10-11'};
 const v=await view('leave',{requests:[request]});try{
  await v.wait(()=>v.button('Cancel Request'));v.click('Request Time Off');await v.wait(()=>v.document.querySelectorAll('input[type=date]').length===2);
  const dates=v.document.querySelectorAll('input[type=date]');v.input(dates[0],'2026-10-12');v.input(dates[1],'2026-10-10');await pause();v.click('Submit to HR');await pause();
  assert.equal(v.f.writes.length,0);assert.ok(v.f.toasts.some(t=>t.message.includes('End date')));
  v.input(dates[1],'2026-10-13');await pause();v.click('Submit to HR');await v.wait(()=>v.f.writes.length===1);
  assert.equal(v.f.writes[0].payload.user_id,USER);assert.equal(v.f.writes[0].payload.company_id,COMPANY);assert.equal(v.f.writes[0].payload.total_days,2);
  await v.wait(()=>!v.button('Submit to HR'));v.click('Cancel Request');await v.wait(()=>v.f.writes.length===2);
  assert.equal(v.f.writes[1].mode,'update');assert.deepEqual(v.f.writes[1].payload,{status:'Cancelled'});assert.deepEqual(v.f.writes[1].filters,[['company_id',COMPANY],['user_id',USER],['status','Pending'],['id','leave-one']]);
 }finally{v.close();}
});

test('task discussion posts a scoped trimmed comment once and does not submit its parent edit form',async()=>{
 let release;const pendingWrite=new Promise(resolve=>release=resolve);const v=await view('task',{pendingWrite});try{
  await v.wait(()=>v.button('Post comment'));v.input(v.document.querySelector('textarea'),'  Ready for review  ');await pause();
  v.click('Post comment');v.click('Post comment');await v.wait(()=>v.f.writes.length===1);assert.equal(v.f.parentSubmits,0);
  assert.deepEqual(v.f.rpcs[0],{name:'get_task_workflow',params:{p_table:'project_tasks',p_task:TASK}});
  assert.deepEqual(v.f.writes[0].payload,{company_id:COMPANY,user_id:USER,source_table:'project_tasks',task_id:TASK,body:'Ready for review'});
  release();await v.wait(()=>v.f.toasts.some(t=>t.level==='success'));assert.equal(v.document.querySelector('textarea').value,'');
 }finally{release();v.close();}
});

test('task discussion retains a rejected comment; a selected prerequisite is saved with canonical project context',async()=>{
 const v=await view('task',{writeErrors:['Access changed']});try{
  await v.wait(()=>v.button('Post comment'));v.input(v.document.querySelector('textarea'),'Keep this update');await pause();v.click('Post comment');
  await v.wait(()=>v.f.toasts.some(t=>t.level==='error'));assert.equal(v.document.querySelector('textarea').value,'Keep this update');
  v.input(v.document.querySelector('select'),PREREQUISITE);await pause();v.click('Add prerequisite');await v.wait(()=>v.f.writes.length===2);
  assert.deepEqual(v.f.writes[1].payload,{company_id:COMPANY,project_id:PROJECT,task_id:TASK,depends_on_task_id:PREREQUISITE,dependency_type:'Finish-to-Start'});assert.equal(v.f.parentSubmits,0);
 }finally{v.close();}
});

test('explicit prerequisite removal accepts preserved legacy null context while binding the exact parent task',async()=>{
 const v=await view('task',{workflow:{dependencies:[{id:'legacy-dependency',task_id:PREREQUISITE,title:'Legacy prerequisite',status:'To Do'}]}});try{
  await v.wait(()=>v.button('Remove'));v.click('Remove');await v.wait(()=>v.f.writes.length===1);
  const write=v.f.writes[0];assert.equal(write.table,'task_dependencies');assert.equal(write.mode,'delete');
  assert.equal(write.or,`company_id.eq.${COMPANY},company_id.is.null`);
  assert.deepEqual(write.filters,[['task_id',TASK],['id','legacy-dependency']]);assert.equal(write.projection,'id');
  assert.equal(v.f.parentSubmits,0);
 }finally{v.close();}
});

test('management time captures the real worker/project classification; saving a cap is company scoped',async()=>{
 const v=await view('hours');try{
  await v.wait(()=>v.document.querySelector('#management-hours'));await pause();v.input(v.document.querySelector('#management-hours'),'2.5');v.input(v.document.querySelector('#management-notes'),'Site coordination');await pause();v.click('Submit management hours');await v.wait(()=>v.f.writes.length===1);
  const payload=v.f.writes[0].payload;assert.equal(payload.company_id,COMPANY);assert.equal(payload.project_id,PROJECT);assert.equal(payload.user_id,USER);assert.equal(payload.is_project_management,true);assert.equal(payload.total_hours,2.5);assert.equal(payload.status,'Pending');assert.equal(payload.notes,'Site coordination');
  await v.wait(()=>!v.button('Submit management hours').disabled);v.input(v.document.querySelector('#pm-cap-staff-one'),'12');await pause();v.click('Save cap');await v.wait(()=>v.f.writes.length===2);
  assert.deepEqual(v.f.writes[1].payload,{pm_hours_cap:12});assert.deepEqual(v.f.writes[1].filters,[['company_id',COMPANY],['project_id',PROJECT],['id','staff-one']]);
 }finally{v.close();}
});

test('legacy leave linking uses an active company user and refuses silently overwriting a linked request',async()=>{
 const v=await view('identity');try{
  await v.wait(()=>v.document.querySelector('select:not(:disabled)'));v.input(v.document.querySelector('select'),USER);await v.wait(()=>v.f.writes.length===1);
  assert.deepEqual(v.f.writes[0].payload,{user_id:USER});assert.deepEqual(v.f.writes[0].filters,[['company_id',COMPANY],['id','legacy-leave'],['user_id',null]]);
  const people=v.f.queries.find(q=>q.table==='profiles');assert.equal(people.projection,'id,full_name,email');assert.equal(people.or,'is_active.is.null,is_active.eq.true');
 }finally{v.close();}
});

test('allocation readers merge both saved sources without losing zero allocation and preserve source-specific writes',async()=>{
 const v=await view('identity',{rows:{project_allocations:[{id:'modern',allocated_hours:8,utilization_percentage:0,allocation_start_date:'2026-10-01',allocation_end_date:'2026-10-07'}],resource_allocations:[{id:'legacy',allocated_hours:6,allocation_percentage:50,start_date:'2026-10-02',end_date:'2026-10-08'}]}});try{
  const rows=plain(await v.window.allocations.getProjectAllocations(COMPANY,PROJECT));assert.equal(rows.length,2);assert.equal(rows[0].utilization_percentage,0);assert.equal(rows[1].allocation_start_date,'2026-10-02');assert.equal(rows[1].source_table,'resource_allocations');
  for(const query of v.f.queries.filter(q=>q.table.endsWith('_allocations')))assert.deepEqual(query.filters,[['company_id',COMPANY],['project_id',PROJECT]]);
  const payload={task_id:'none',user_id:USER,allocated_hours:'4',utilization_percentage:'0',allocation_start_date:'2026-10-02',allocation_end_date:'2026-10-08'};
  assert.deepEqual(plain(v.window.allocations.allocationPayload(payload,'resource_allocations')),{task_id:null,user_id:USER,allocated_hours:4,allocation_percentage:0,start_date:'2026-10-02',end_date:'2026-10-08'});
 }finally{v.close();}
});

for(const component of ['office_tasks','field_tasks'])test(`${component} follows a second notification URL without refetching tasks or retaining the prior record`,async()=>{
 const rows=[{id:TASK,title:'First notified task',project_id:PROJECT,status:'To Do',priority:'Medium',assigned_to:[USER],created_at:'2026-10-01T12:00:00Z'},{id:PREREQUISITE,title:'Second notified task',project_id:PROJECT,status:'To Do',priority:'Medium',assigned_to:[USER],created_at:'2026-10-01T13:00:00Z'}];
 const path=component==='office_tasks'?'/Tasks':'/EmployeePortal?tab=tasks';
 const separator=path.includes('?')?'&':'?';
 const v=await view(component,{path:path+separator+'notificationTask='+TASK,rows:{project_tasks:rows}});try{
  await v.wait(()=>v.document.querySelector('[role=dialog]')?.textContent.includes('First notified task'));
  const reads=v.f.queries.filter(q=>['project_tasks','tasks'].includes(q.table)).length;
  v.window.navigatePeople(path+separator+'notificationTask='+PREREQUISITE);
  await v.wait(()=>v.document.querySelector('[role=dialog]')?.textContent.includes('Second notified task'));
  assert.ok(!v.document.querySelector('[role=dialog]').textContent.includes('First notified task'));
  assert.equal(v.f.queries.filter(q=>['project_tasks','tasks'].includes(q.table)).length,reads,'URL changes use existing scoped task data');
  v.window.navigatePeople(path+separator+'notificationTask=unavailable');
  await v.wait(()=>!v.document.querySelector('[role=dialog]'));
 }finally{v.close();}
});

test('field task reads are server-filtered to the signed-in assignee with explicit projections',async()=>{
 const v=await view('field_tasks');try{
  await v.wait(()=>v.f.queries.some(q=>q.table==='project_tasks')&&v.f.queries.some(q=>q.table==='tasks'));
  const project=v.f.queries.find(q=>q.table==='project_tasks');
  const legacy=v.f.queries.find(q=>q.table==='tasks');
  assert.equal(project.projection,'id,company_id,project_id,phase_id,title,description,status,due_date_target,assigned_to,created_at,priority');
  assert.deepEqual(plain(project.filters),[['company_id',COMPANY],['assigned_to',[USER]]]);
  assert.deepEqual(plain(project.contains),['assigned_to',[USER]]);
  assert.equal(legacy.projection,'id,company_id,project_id,title,description,status,due_date,assigned_to,created_at,priority');
  assert.deepEqual(plain(legacy.filters),[['company_id',COMPANY],['assigned_to',[USER]]]);
 }finally{v.close();}
});

test('field phase notifications show the exact assigned phase and prerequisite with minimal company/project scoped reads',async()=>{
 const first={id:TASK,project_id:PROJECT,name:'Prepare site',status:'Completed',start_date_target:'2026-10-01',end_date_target:'2026-10-02'};
 const second={id:PREREQUISITE,project_id:PROJECT,name:'Install doors',status:'Ready',start_date_target:'2026-10-03',end_date_target:'2026-10-04',depends_on_phase_id:TASK};
 const path='/EmployeePortal?tab=projects&notificationProject='+PROJECT+'&notificationPhase='+PREREQUISITE;
 const v=await view('assigned_work',{path,rows:{project_phases:[first,second]}});try{
  await v.wait(()=>v.document.querySelector('[aria-label="Phase Install doors"]'));
  assert.ok(v.document.querySelector('[aria-label="Phase Install doors"]').textContent.includes('Prerequisite: Prepare site · Complete'));
  assert.equal(v.document.querySelector('[aria-label="Phase Prepare site"]'),null);
  assert.equal(v.document.querySelector('[data-assigned-plans]').getAttribute('data-assigned-plans'),PROJECT);
  const read=v.f.queries.find(q=>q.table==='project_phases');
  assert.equal(read.projection,'id,project_id,name,status,start_date_target,end_date_target,depends_on_phase_id');
  assert.deepEqual(plain(read.filters),[['company_id',COMPANY],['project_id',[PROJECT]]]);
  v.window.navigatePeople('/EmployeePortal?tab=projects&notificationProject=not-assigned&notificationPhase='+PREREQUISITE);
  await v.wait(()=>v.document.body.textContent.includes('This item is no longer available in your assigned work.'));
  assert.equal(v.document.querySelector('[data-assigned-plans]'),null);
 }finally{v.close();}
});

const ownProfile={id:USER,company_id:COMPANY,full_name:'Synthetic Manager',role:'employee'};
test('Starter field project and task notifications stay accessible while HR tabs retain their plan gate',async()=>{
 const v=await view('portal',{path:'/EmployeePortal?tab=projects&notificationProject='+PROJECT,auth:{profile:ownProfile,company:{plan_id:'starter'},settings:{}}});try{
  await v.wait(()=>v.document.querySelector('[data-assigned-plans]'));
  assert.ok(!v.document.body.textContent.includes('Upgrade to Professional'));
  assert.equal(v.f.queries.filter(q=>q.table==='time_entries').length,0);
  v.window.navigatePeople('/EmployeePortal?tab=tasks');await v.wait(()=>v.document.body.textContent.includes('My Tasks'));
  assert.ok(!v.document.body.textContent.includes('Upgrade to Professional'));
  v.window.navigatePeople('/EmployeePortal?tab=timesheets');await v.wait(()=>v.document.body.textContent.includes('Unlock Time Tracking & Personal HR'));
  assert.equal(v.f.queries.filter(q=>q.table==='time_entries').length,0,'locked HR content never mounts its query');
  v.window.navigatePeople('/EmployeePortal?tab=projects');await v.wait(()=>v.document.querySelector('[data-assigned-plans]'));
 }finally{v.close();}
});

test('Starter defaults to assigned projects and disabled portal sections remain disabled on direct links',async()=>{
 const v=await view('portal',{auth:{profile:ownProfile,company:{plan_id:'starter'},settings:{features:{tasks:false,daily_logs:false}}}});try{
  await v.wait(()=>v.document.querySelector('[data-assigned-plans]'));
  assert.ok(!v.document.body.textContent.includes('Unlock'));
  v.window.navigatePeople('/EmployeePortal?tab=tasks');await v.wait(()=>v.document.body.textContent.includes("This section is disabled in your company's settings"));
  assert.equal(v.f.queries.filter(q=>['project_tasks','tasks'].includes(q.table)).length,0);
  v.window.navigatePeople('/EmployeePortal?tab=daily_logs');await pause();
  assert.equal(v.f.queries.filter(q=>q.table==='project_daily_logs').length,0);
 }finally{v.close();}
});

test('clock and manual timesheets have distinct company/user cache keys and never query by employee name',async()=>{
 for(const component of ['clock','sheets']){
  const v=await view(component);try{
   await v.wait(()=>v.f.queries.some(q=>q.table==='time_entries'));
   const query=v.f.queries.find(q=>q.table==='time_entries');assert.deepEqual(query.filters,[['company_id',COMPANY],['user_id',USER]]);
   assert.ok(!query.filters.some(([key])=>key==='employee_name'));
   assert.equal(query.limit,component==='sheets'?30:undefined);
   const keys=plain(v.window.peopleQueryClient.getQueryCache().getAll().map(q=>q.queryKey));
   assert.ok(keys.some(key=>JSON.stringify(key)===JSON.stringify([component==='clock'?'employee_clock_entries':'employee_timesheets',COMPANY,USER])));
  }finally{v.close();}
 }
});

test('clock-out rereads the own open shift, uses its current clock-in and conditionally saves it only once',async()=>{
 const oldStart=new Date(Date.now()-2*3600000).toISOString();const latestStart=new Date(Date.now()-3600000).toISOString();
 const shift={id:'own-active-shift',company_id:COMPANY,user_id:USER,employee_name:ownProfile.full_name,status:'Clocked In',clock_in:oldStart,clock_out:null,date:oldStart.slice(0,10)};
 let release;const pendingWrite=new Promise(resolve=>release=resolve);
 const v=await view('clock',{rows:{time_entries:[{...shift,id:'same-name-other-user',user_id:PREREQUISITE},shift]},pendingWrite,readOverride:(record,data)=>record.single?{...shift,clock_in:latestStart}:data});try{
  await v.wait(()=>v.button('CLOCK OUT'));v.click('CLOCK OUT');v.click('CLOCK OUT');await v.wait(()=>v.f.writes.length===1);
  const read=v.f.queries.find(q=>q.table==='time_entries'&&q.single);assert.equal(read.projection,'id,company_id,user_id,clock_in,clock_out,status');
  assert.deepEqual(read.filters,[['company_id',COMPANY],['user_id',USER],['id',shift.id],['status','Clocked In'],['clock_out',null]]);
  const write=v.f.writes[0];assert.deepEqual(write.filters,[...read.filters,['clock_in',latestStart]]);assert.equal(write.projection,'id');assert.equal(write.payload.total_hours,1);assert.equal(write.payload.status,'Pending');
  release();await v.wait(()=>v.f.toasts.some(t=>t.level==='success'));assert.ok(v.f.invalidations.some(key=>key[0]==='employee_timesheets'&&key[1]===COMPANY&&key[2]===USER));
 }finally{release();v.close();}
});

test('clock-out handles a changed shift or a raced conditional update without claiming success',async()=>{
 const start=new Date(Date.now()-3600000).toISOString();const shift={id:'own-shift',company_id:COMPANY,user_id:USER,status:'Clocked In',clock_in:start,clock_out:null,date:start.slice(0,10)};
 for(const scenario of ['changed','raced']){
  const v=await view('clock',{rows:{time_entries:[shift]},readOverride:(record,data)=>record.single?(scenario==='changed'?null:shift):data,...(scenario==='raced'?{writeData:[]}: {})});try{
   await v.wait(()=>v.button('CLOCK OUT'));v.click('CLOCK OUT');await v.wait(()=>v.f.toasts.some(t=>t.level==='error'));
   assert.equal(v.f.writes.length,scenario==='changed'?0:1);assert.equal(v.f.toasts.some(t=>t.level==='success'),false);
  }finally{v.close();}
 }
});

test('stale or foreign identity props do not fetch personal time records or enable a clock write',async()=>{
 for(const component of ['clock','sheets']){
  const v=await view(component,{props:{currentUser:{...ownProfile,id:PREREQUISITE},companyId:COMPANY}});try{
   await pause();await pause();assert.equal(v.f.queries.filter(q=>q.table==='time_entries').length,0);
   if(component==='clock')assert.equal(v.button('CLOCK IN').disabled,true);
   else{v.click('Submit Missing Hours');await v.wait(()=>v.button('Submit to HR'));assert.equal(v.button('Submit to HR').disabled,true);}
  }finally{v.close();}
 }
});
