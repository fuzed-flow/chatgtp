import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup({beforeDomain,afterDomain}={}) {
 const db=new PGlite();
 for(const file of ['./schema.sql','./people-schema.sql','../../supabase/migrations/20261003220500_role_based_notifications.sql','../../supabase/migrations/20261004174541_people_pm_task_workflows.sql']) {
  const domain=file.endsWith('20261004174541_people_pm_task_workflows.sql');
  if(domain&&beforeDomain)await beforeDomain(db);
  await db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  if(domain&&afterDomain)await afterDomain(db);
 }
 const C=id(1),OTHER=id(2),PROJECT=id(3),FOREIGN=id(4);
 const people=Object.fromEntries(['owner','admin','manager','office','employee','subcontractor'].map((r,i)=>[r,id(10+i)]));
 const rows=async(sql,p=[]) => (await db.query(sql,p)).rows;
 const actor=async user=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);
 await db.query("insert into companies(id,name,timezone) values($1,'Synthetic A','UTC'),($2,'Synthetic B','UTC')",[C,OTHER]);
 for(const [role,user] of Object.entries(people)) await db.query('insert into profiles(id,company_id,role,full_name,is_active) values($1,$2,$3,$3,true)',[user,C,role]);
 await db.query("insert into profiles(id,company_id,role,full_name,is_active) values($1,$2,'admin','Other company',true)",[id(20),OTHER]);
 await db.query("insert into projects(id,company_id,name,status,start_date) values($1,$2,'Synthetic project','Active','2026-10-07'),($3,$4,'Foreign project','Active','2026-10-07')",[PROJECT,C,FOREIGN,OTHER]);
 for(const role of ['manager','employee','subcontractor']) await db.query('insert into project_staff(company_id,project_id,user_id,is_active) values($1,$2,$3,true)',[C,PROJECT,people[role]]);
 await actor(people.admin); await db.exec('delete from notifications');
 const count=async(event,user)=>Number((await rows('select count(*)::int n from notifications where event_key=$1 and ($2::uuid is null or user_id=$2)',[event,user||null]))[0].n);
 return {db,C,OTHER,PROJECT,FOREIGN,people,rows,actor,count};
}

test('task changes, comments and prerequisite readiness use saved context and strict tenant/assignment access',async()=>{
 const {db,C,OTHER,PROJECT,FOREIGN,people,rows,actor,count}=await setup();
 try {
  const FIRST=id(30),SECOND=id(31),THIRD=id(32),ALIEN=id(33);
  for(const [task,title] of [[FIRST,'Prepare'],[SECOND,'Install'],[THIRD,'Finish']]) await db.query("insert into project_tasks(id,company_id,project_id,title,status,priority,assigned_to) values($1,$2,$3,$4,'To Do','Medium',$5)",[task,C,PROJECT,title,[people.employee]]);
  await db.query("insert into project_tasks(id,company_id,project_id,title,status) values($1,$2,$3,'Private foreign task','To Do')",[ALIEN,OTHER,FOREIGN]);
  await db.query("update project_tasks set priority='Urgent',due_date_target='2026-10-06' where id=$1",[SECOND]);
  assert.equal(await count('task_priority_changed',people.employee),1);
  assert.equal(await count('task_due_date_changed',people.employee),1);
  assert.equal(await count('task_priority_changed',id(20)),0);
  await db.query('insert into task_dependencies(company_id,project_id,task_id,depends_on_task_id) values($1,$2,$3,$4),($1,$2,$3,$5)',[C,PROJECT,THIRD,FIRST,SECOND]);
  await assert.rejects(db.query('insert into task_dependencies(company_id,project_id,task_id,depends_on_task_id) values($1,$2,$3,$4)',[C,PROJECT,FIRST,THIRD]),/cycle/);
  await assert.rejects(db.query('insert into task_dependencies(company_id,project_id,task_id,depends_on_task_id) values($1,$2,$3,$4)',[C,PROJECT,THIRD,ALIEN]),/same project/);
  await db.query("update project_tasks set status='Done' where id=$1",[FIRST]);
  assert.equal(await count('task_dependency_ready',people.employee),0,'one of two dependencies remains incomplete');
  await db.query("update project_tasks set status='Done' where id=$1",[SECOND]);
  assert.equal(await count('task_dependency_ready',people.employee),1);
  await db.query("update project_tasks set description='ordinary edit' where id=$1",[SECOND]);
  assert.equal(await count('task_dependency_ready',people.employee),1,'ordinary edits do not repeat readiness');
  await actor(people.employee); await db.exec('set role authenticated');
  await db.query("insert into task_comments(company_id,source_table,task_id,user_id,body) values($1,'project_tasks',$2,$3,'  Ready for inspection  ')",[C,THIRD,people.employee]);
  const workflow=(await rows("select public.get_task_workflow('project_tasks',$1) data",[THIRD]))[0].data;
  assert.equal(workflow.comments[0].body,'Ready for inspection');
  assert.equal(workflow.dependencies.length,2);
  assert.equal(workflow.options.length,0,'field users cannot enumerate project task options');
  assert.equal(workflow.can_edit_dependencies,false);
  await assert.rejects(db.query("insert into task_comments(company_id,source_table,task_id,user_id,body) values($1,'project_tasks',$2,$3,'forged')",[OTHER,ALIEN,people.employee]),/identity mismatch|row-level security/);
  await assert.rejects(db.query("select public.get_task_workflow('project_tasks',$1)",[ALIEN]),/access denied/);
  await assert.rejects(db.query('delete from task_dependencies where task_id=$1',[THIRD]).then(r=>{assert.equal(r.affectedRows,0);throw new Error('RLS filtered');}),/RLS filtered/);
  await db.exec('reset role');
  assert.ok(await count('task_comment',people.owner)>0);
  assert.equal(await count('task_comment',people.employee),0,'actor does not receive its own Important comment');
  await actor(people.admin);
  const CRM=id(34);
  await db.query("insert into tasks(id,company_id,title,status,priority,assigned_to) values($1,$2,'CRM followup','To Do','Low',$3)",[CRM,C,people.office]);
  await db.query("update tasks set priority='High',due_date='2026-10-06T09:00:00Z' where id=$1",[CRM]);
  assert.ok(await count('task_priority_changed',people.office)>0);
 } finally {await db.close();}
});

test('migration preserves existing leave and dependency rows, derives only valid legacy context and quarantines invalid pairs',async()=>{
 const C=id(200),ADMIN=id(201),WORKER=id(202),PROJECT=id(203),SECOND_PROJECT=id(204),FIRST=id(205),NEXT=id(206),OTHER_PROJECT_TASK=id(207),VALID=id(208),INVALID=id(209),LEAVE=id(210);
 let dependencySnapshot,leaveSnapshot,notificationCount;
 const state=await setup({beforeDomain:async db=>{
  await db.query("insert into companies(id,name,timezone) values($1,'Historical synthetic company','UTC')",[C]);
  await db.query("insert into profiles(id,company_id,role,full_name,is_active) values($1,$3,'admin','Historical admin',true),($2,$3,'employee','Historical person',true)",[ADMIN,WORKER,C]);
  await db.query("insert into projects(id,company_id,name,status) values($1,$3,'Historical project','Active'),($2,$3,'Other historical project','Active')",[PROJECT,SECOND_PROJECT,C]);
  for(const [task,project,title]of [[FIRST,PROJECT,'Prepare'],[NEXT,PROJECT,'Install'],[OTHER_PROJECT_TASK,SECOND_PROJECT,'Private other project']])await db.query("insert into project_tasks(id,company_id,project_id,title,status,assigned_to) values($1,$2,$3,$4,'To Do',$5)",[task,C,project,title,[WORKER]]);
  await db.query('insert into task_dependencies(id,task_id,depends_on_task_id) values($1,$2,$3)',[VALID,NEXT,FIRST]);
  await db.query('insert into task_dependencies(id,company_id,project_id,task_id,depends_on_task_id) values($1,$2,$3,$4,$5)',[INVALID,C,PROJECT,NEXT,OTHER_PROJECT_TASK]);
  await db.query("insert into time_off_requests(id,company_id,employee_name,type,start_date,end_date,status,reason) values($1,$2,'Historical person','Vacation','2026-10-10','2026-10-11','Pending','Retain this original record')",[LEAVE,C]);
  dependencySnapshot=(await db.query('select to_jsonb(d) doc from task_dependencies d order by id')).rows;
  leaveSnapshot=(await db.query('select to_jsonb(r) doc from time_off_requests r')).rows[0].doc;
  notificationCount=(await db.query('select count(*)::int n from notifications')).rows[0].n;
 },afterDomain:async db=>{
  assert.deepEqual((await db.query('select to_jsonb(d) doc from task_dependencies d order by id')).rows,dependencySnapshot,'dependency metadata, ids, links and timestamps are unchanged');
  const migrated=(await db.query('select to_jsonb(r) doc from time_off_requests r')).rows[0].doc;
  assert.equal(migrated.user_id,null,'even a unique matching name is not reassigned during migration');
  delete migrated.user_id;delete migrated.approved_by;assert.deepEqual(migrated,leaveSnapshot);
  assert.equal((await db.query('select count(*)::int n from notifications')).rows[0].n,notificationCount,'migration itself emits no customer-data notifications');
 }});
 const {db,actor,rows,count}=state;
 try{
  await actor(null);
  const review=await rows('select id,review_state from notification_private.people_legacy_workflow_review order by id');
  assert.deepEqual(review,[{id:VALID,review_state:'context_derived'},{id:INVALID,review_state:'quarantined_dependency'},{id:LEAVE,review_state:'identity_unlinked'}]);
  await actor(WORKER);await db.exec('set role authenticated');
  assert.equal((await rows('select count(*)::int n from time_off_requests'))[0].n,0,'unlinked history remains private until HR confirms its identity');
  const workflow=(await rows("select get_task_workflow('project_tasks',$1) data",[NEXT]))[0].data;
  assert.equal(workflow.dependencies.length,1);assert.equal(workflow.dependencies[0].id,VALID);
  assert.equal((await rows('select count(*)::int n from task_dependencies'))[0].n,1,'malformed cross-project pair is not exposed by a permissive legacy policy');
  await assert.rejects(db.query('select * from notification_private.people_legacy_workflow_review'),/permission denied/);
  await db.exec('reset role');await actor(ADMIN);
  await assert.rejects(db.query('insert into task_dependencies(company_id,project_id,task_id,depends_on_task_id) values($1,$2,$3,$4)',[C,PROJECT,NEXT,FIRST]),/already saved/);
  await assert.rejects(db.query('insert into task_dependencies(company_id,project_id,task_id,depends_on_task_id) values($1,$2,$3,$4)',[C,PROJECT,FIRST,NEXT]),/cycle/);
  await db.query("update project_tasks set status='Done' where id=$1",[FIRST]);
  assert.equal(await count('task_dependency_ready',WORKER),1,'valid legacy dependency participates in readiness; quarantined pair does not block it');
  await db.query('update time_off_requests set user_id=$1 where id=$2',[WORKER,LEAVE]);
  await db.query("update time_off_requests set status='Approved' where id=$1",[LEAVE]);
  assert.equal(await count('leave_approved',WORKER),1,'explicit HR linking restores the personal decision workflow');
  assert.equal((await rows('select count(*)::int n from task_dependencies'))[0].n,2,'quarantine preserves the stored invalid row');
 }finally{await db.close();}
});

test('field daily logs persist tenant identity; structured work, weather and review updates deliver safely',async()=>{
 const {db,C,OTHER,PROJECT,FOREIGN,people,rows,actor,count}=await setup();
 try {
  const LOG=id(40);
  await actor(people.employee);
  await db.query("insert into project_daily_logs(id,company_id,project_id,user_id,date,category,summary,safety_concerns,blockers,weather_delay,photos) values($1,$2,$3,$4,'2026-10-05','Work Completed','Doors installed','Open trench','Delivery late',true,'[\"photo-one\"]')",[LOG,C,PROJECT,people.employee]);
  assert.ok(await count('daily_log_submitted',people.manager)>0);
  assert.ok(await count('work_completed_today',people.owner)>0);
  assert.equal(await count('weather_delay',people.owner),1,'structured and legacy sources share event identity');
  await assert.rejects(db.query("insert into project_daily_logs(company_id,project_id,user_id,date,summary) values($1,$2,$3,'2026-10-05','forged')",[OTHER,FOREIGN,people.employee]),/access denied|identity mismatch/);
  await actor(people.admin);
  await db.query("update project_daily_logs set safety_status='Acknowledged',blocker_status='Resolved',photos='[\"replacement-photo\"]' where id=$1",[LOG]);
  assert.equal(await count('safety_review_changed',people.owner),1);
  assert.equal(await count('blocker_review_changed',people.owner),1);
  assert.equal(await count('daily_log_photos_changed',people.owner),1);
  await db.query("update project_daily_logs set materials_used='Nails' where id=$1",[LOG]);
  assert.equal(await count('safety_review_changed',people.owner),1);
  await actor(null);
  await db.exec('alter table project_daily_logs disable trigger people_log_identity');
  const LEGACY=id(41);
  await db.query("insert into project_daily_logs(id,project_id,user_id,date,summary) values($1,$2,$3,'2026-10-04','Historical field log')",[LEGACY,PROJECT,people.employee]);
  await db.exec('alter table project_daily_logs enable trigger people_log_identity');
  await actor(people.admin);
  await db.query("update project_daily_logs set summary='Reviewed historical field log' where id=$1",[LEGACY]);
  assert.equal((await rows('select company_id from project_daily_logs where id=$1',[LEGACY]))[0].company_id,C,'an authorized edit repairs a legacy missing company without changing authorship');
  await assert.rejects(db.query('update project_daily_logs set user_id=$1 where id=$2',[people.admin,LEGACY]),/identity cannot be changed/);
 } finally {await db.close();}
});

test('leave requests and decisions are private, date-valid and preserved on cancellation',async()=>{
 const {db,C,OTHER,people,rows,actor,count}=await setup();
 try {
  await actor(people.employee); await db.exec('set role authenticated');
  const LEAVE=id(50);
  await db.query("insert into time_off_requests(id,company_id,user_id,employee_name,type,start_date,end_date,status) values($1,$2,$3,'employee','Vacation','2026-10-05','2026-10-06','Pending')",[LEAVE,C,people.employee]);
  await assert.rejects(db.query("update time_off_requests set status='Approved' where id=$1",[LEAVE]),/own pending/);
  await assert.rejects(db.query("insert into time_off_requests(company_id,user_id,start_date,end_date,status) values($1,$2,'2026-10-07','2026-10-05','Pending')",[C,people.employee]),/End date/);
  await assert.rejects(db.query("insert into time_off_requests(company_id,user_id,start_date,end_date,status) values($1,$2,'2026-10-05','2026-10-06','Pending')",[OTHER,people.employee]),/your company/);
  await db.exec('reset role');
  assert.equal(await count('leave_requested',people.owner),1);
  await actor(people.admin);
  await db.query("update time_off_requests set status='Approved',approved_by='admin' where id=$1",[LEAVE]);
  assert.equal(await count('leave_approved',people.employee),1);
  await actor(people.subcontractor); await db.exec('set role authenticated');
  assert.equal((await rows('select count(*)::int n from time_off_requests'))[0].n,0,'a colleague cannot read another person’s leave');
  await db.exec('reset role'); await actor(people.employee);
  const CANCEL=id(51);
  await db.query("insert into time_off_requests(id,company_id,user_id,employee_name,start_date,end_date,status) values($1,$2,$3,'employee','2026-10-09','2026-10-09','Pending')",[CANCEL,C,people.employee]);
  await db.query("update time_off_requests set status='Cancelled' where id=$1",[CANCEL]);
  assert.equal((await rows('select status from time_off_requests where id=$1',[CANCEL]))[0].status,'Cancelled');
  assert.ok(await count('leave_cancelled',people.owner)>0);
  await actor(null);
  const LEGACY=id(52);
  await db.query("insert into time_off_requests(id,company_id,employee_name,start_date,end_date,status) values($1,$2,'Legacy ambiguous name','2026-10-10','2026-10-10','Pending')",[LEGACY,C]);
  await actor(people.admin);
  await db.query('update time_off_requests set user_id=$1 where id=$2',[people.employee,LEGACY]);
  await db.query("update time_off_requests set status='Approved' where id=$1",[LEGACY]);
  assert.equal(await count('leave_approved',people.employee),2,'HR can resolve a legacy identity before deciding it');
  await assert.rejects(db.query('update time_off_requests set user_id=$1 where id=$2',[people.subcontractor,LEGACY]),/identity cannot be changed/);
 } finally {await db.close();}
});

test('phase prerequisites, assignment removal and repeated reminders retain meaningful scope',async()=>{
 const {db,C,PROJECT,people,rows,actor,count}=await setup();
 try {
  const PHASE=id(60),NEXT=id(61);
  await db.query("insert into project_phases(id,company_id,project_id,name,status) values($1,$2,$3,'Rough in','In Progress')",[PHASE,C,PROJECT]);
  await db.query("insert into project_phases(id,company_id,project_id,name,status,depends_on_phase_id) values($1,$2,$3,'Close walls','Not Started',$4)",[NEXT,C,PROJECT,PHASE]);
  await assert.rejects(db.query("update project_phases set status='Ready' where id=$1",[NEXT]),/Complete the prerequisite/);
  await assert.rejects(db.query('update project_phases set depends_on_phase_id=$1 where id=$2',[NEXT,PHASE]),/cycle/);
  await db.query("update project_phases set status='Completed' where id=$1",[PHASE]);
  assert.ok(await count('phase_ready',people.manager)>0);
  await db.query("update project_phases set status='Ready',start_date_target='2026-10-06' where id=$1",[NEXT]);
  assert.ok(await count('phase_changed',people.owner)>0);
  await db.query('delete from project_staff where company_id=$1 and project_id=$2 and user_id=$3',[C,PROJECT,people.subcontractor]);
  assert.equal(await count('project_assignment_removed',people.subcontractor),1);
  await actor(people.subcontractor); await db.exec('set role authenticated');
  assert.equal((await rows("select count(*)::int n from notifications where event_key='project_assignment_removed'"))[0].n,1,'personal removal alert remains readable after membership removal');
  await db.exec('reset role'); await actor(people.admin);
  await db.query("insert into project_milestones(company_id,project_id,title,due_date_target,status) values($1,$2,'Inspection','2026-10-04','Pending')",[C,PROJECT]);
  await actor(null);
  await db.exec("select notification_private.people_reminders('2026-10-05T09:00:00Z')");
  assert.ok(await count('project_starting_soon',people.employee)>0);
  assert.ok(await count('milestone_overdue',people.owner)>0);
  const before=await count('milestone_overdue');
  await db.exec("select notification_private.people_reminders('2026-10-05T10:00:00Z')");
  assert.equal(await count('milestone_overdue'),before);
 } finally {await db.close();}
});

test('submission reminders unify both allocation sources, honor approved leave, and hour alerts require recorded allowances',async()=>{
 const {db,C,PROJECT,people,rows,actor,count}=await setup();
 try {
  await db.query("insert into schedule_jobs(company_id,project_id,title,start_date_time,end_date_time,status) values($1,$2,'Scheduled work','2026-10-04T08:00Z','2026-10-06T17:00Z','Scheduled')",[C,PROJECT]);
  await db.query("insert into project_allocations(company_id,project_id,user_id,allocated_hours,utilization_percentage,allocation_start_date,allocation_end_date) values($1,$2,$3,8,100,'2026-10-04','2026-10-06')",[C,PROJECT,people.employee]);
  await db.query("insert into resource_allocations(company_id,project_id,user_id,allocated_hours,allocation_percentage,start_date,end_date) values($1,$2,$3,8,100,'2026-10-04','2026-10-06')",[C,PROJECT,people.subcontractor]);
  await db.query("insert into time_off_requests(company_id,user_id,employee_name,start_date,end_date,status) values($1,$2,'employee','2026-10-04','2026-10-04','Approved')",[C,people.employee]);
  await actor(null);
  await db.exec("select notification_private.submission_reminders('2026-10-05T09:00:00Z')");
  assert.equal(await count('timesheet_missing',people.employee),0,'approved leave excludes missing submissions');
  assert.equal(await count('daily_log_missing',people.employee),0);
  assert.equal(await count('timesheet_missing',people.subcontractor),1,'legacy allocation source participates');
  await db.exec("select notification_private.submission_reminders('2026-10-06T09:00:00Z')");
  assert.equal(await count('timesheet_missing',people.employee),1,'ordinary allocation UI source participates');
  await db.query("insert into time_entries(company_id,project_id,user_id,employee_name,date,total_hours,status) values($1,$2,$3,'employee','2026-10-05',9,'Pending')",[C,PROJECT,people.employee]);
  await db.query("insert into time_entries(company_id,user_id,employee_name,date,clock_in,status) values($1,$2,'employee','2026-10-04','2026-10-04T17:00Z','Clocked In')",[C,people.employee]);
  await db.query('update project_staff set pm_hours_cap=10 where company_id=$1 and project_id=$2 and user_id=$3',[C,PROJECT,people.manager]);
  await db.query("insert into time_entries(company_id,project_id,user_id,employee_name,date,total_hours,status,is_project_management) values($1,$2,$3,'manager','2026-10-05',9,'Pending',true)",[C,PROJECT,people.manager]);
  await assert.rejects(db.query("insert into time_entries(company_id,project_id,user_id,employee_name,date,total_hours,status,is_project_management) values($1,$2,$3,'employee','2026-10-05',2,'Pending',true)",[C,PROJECT,people.employee]),/assigned project manager/);
  await db.exec("select notification_private.people_reminders('2026-10-05T09:00:00Z')");
  assert.equal(await count('missing_clock_out',people.employee),1);
  assert.equal(await count('scheduled_hours_exceeded',people.employee),1);
  assert.equal(await count('pm_hours_approaching',people.manager),1);
  await db.query("insert into time_entries(company_id,project_id,user_id,employee_name,date,total_hours,status,is_project_management) values($1,$2,$3,'manager','2026-10-05',2,'Approved',true)",[C,PROJECT,people.manager]);
  await db.exec("select notification_private.people_reminders('2026-10-05T10:00:00Z')");
  assert.equal(await count('pm_hours_exceeded',people.manager),1);
  assert.equal(await count('missing_clock_out',people.employee),1);
  await actor(people.employee);
  await assert.rejects(db.query('update project_allocations set allocated_hours=999 where company_id=$1',[C]),/management access denied/);
 } finally {await db.close();}
});
