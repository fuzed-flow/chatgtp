-- People and production workflows. These extend, rather than replace, the
-- original role-routed source trigger and recipient authorization.
alter table public.project_phases add column if not exists depends_on_phase_id uuid references public.project_phases(id) on delete set null;
alter table public.project_staff add column if not exists pm_hours_cap numeric check (pm_hours_cap is null or pm_hours_cap > 0);
alter table public.resource_allocations add column if not exists allocated_hours numeric check(allocated_hours is null or allocated_hours>=0);
alter table public.time_entries add column if not exists is_project_management boolean not null default false;
alter table public.time_off_requests add column if not exists user_id uuid references public.profiles(id) on delete set null;
alter table public.time_off_requests add column if not exists approved_by text;
alter table public.project_daily_logs add column if not exists weather_delay boolean not null default false;
alter table public.project_daily_logs add column if not exists safety_status text not null default 'Open' check (safety_status in ('Open','Acknowledged','Resolved'));
alter table public.project_daily_logs add column if not exists blocker_status text not null default 'Open' check (blocker_status in ('Open','Acknowledged','Resolved'));

-- Existing leave/dependency records are not rewritten. HR explicitly links
-- unlinked leave. Valid legacy dependency context is derived from its task UUIDs
-- for reads; invalid pairs remain stored and are excluded from the workflow.

create table public.task_comments (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 source_table text not null check(source_table in ('tasks','project_tasks')),
 task_id uuid not null,
 user_id uuid not null references public.profiles(id),
 body text not null check(length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now()
);
create index task_comments_thread on public.task_comments(company_id,source_table,task_id,created_at);
create index task_dependencies_successor on public.task_dependencies(company_id,depends_on_task_id,task_id);
create index task_dependencies_task on public.task_dependencies(company_id,task_id);
create index people_leave_dates on public.time_off_requests(company_id,user_id,start_date,end_date) where lower(status)='approved';
create index people_project_allocations_dates on public.project_allocations(company_id,user_id,project_id,allocation_start_date,allocation_end_date);
create index people_open_clockouts on public.time_entries(company_id,clock_in) where clock_in is not null and clock_out is null;
create index people_management_hours on public.time_entries(company_id,project_id,user_id,date) where is_project_management;

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
 ('task_priority_changed','Task priority changed','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'assigned','projects'),
 ('task_due_date_changed','Task due date changed','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'assigned','projects'),
 ('task_comment','New task comment','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'assigned','projects'),
 ('task_dependency_ready','Task prerequisites complete','Action Required','Projects',array['owner','admin','manager','office','employee','subcontractor'],'assigned','projects'),
 ('project_starting_soon','Project starting soon','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'project','projects'),
 ('phase_changed','Project phase changed','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'project','projects'),
 ('phase_ready','Project phase ready','Action Required','Projects',array['owner','admin','manager','office','employee','subcontractor'],'project','projects'),
 ('milestone_overdue','Project milestone overdue','Action Required','Projects',array['owner','admin','manager','office'],'leadership','projects'),
 ('project_staff_removed','Project team member removed','Important','Projects',array['owner','admin','manager','office'],'leadership','projects'),
 ('project_assignment_removed','Your project assignment was removed','Important','Projects',array['owner','admin','manager','office','employee','subcontractor'],'personal','projects'),
 ('leave_requested','Time off awaiting approval','Action Required','Timesheets',array['owner','admin','office'],'leadership','human_resources'),
 ('leave_approved','Time off approved','FYI','Timesheets',array['owner','admin','manager','office','employee','subcontractor'],'personal','human_resources'),
 ('leave_rejected','Time off declined','Action Required','Timesheets',array['owner','admin','manager','office','employee','subcontractor'],'personal','human_resources'),
 ('leave_cancelled','Time off request cancelled','Important','Timesheets',array['owner','admin','office'],'leadership','human_resources'),
 ('missing_clock_out','Clock-out is missing','Action Required','Timesheets',array['owner','admin','manager','office','employee','subcontractor'],'assigned','human_resources'),
 ('pm_hours_approaching','Project management hours approaching cap','Important','Projects',array['owner','admin','manager','office'],'assigned','projects'),
 ('pm_hours_exceeded','Project management hours exceeded cap','Action Required','Projects',array['owner','admin','manager','office'],'assigned','projects'),
 ('safety_review_changed','Site safety review updated','Important','Daily Logs',array['owner','admin','manager','office'],'leadership','DailyLogs'),
 ('blocker_review_changed','Site issue review updated','Important','Daily Logs',array['owner','admin','manager','office'],'leadership','DailyLogs'),
 ('daily_log_photos_changed','Site photos changed','FYI','Daily Logs',array['owner','admin','manager','office'],'leadership','DailyLogs')
on conflict(event_key) do nothing;
update notification_private.event_rules set roles=array['owner','admin','manager','office','employee','subcontractor'],audience='assigned' where event_key='scheduled_hours_exceeded';

create or replace function notification_private.people_task_access(p_table text,p_task uuid,p_write boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare d jsonb; actor public.profiles; proj uuid;
begin
 if p_table not in ('tasks','project_tasks') or auth.uid() is null then return false; end if;
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false;
 if not found then return false; end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2',p_table) into d using p_task,actor.company_id;
 if d is null then return false; end if;
 proj:=nullif(d->>'project_id','')::uuid;
 if actor.role in ('owner','admin') then return true; end if;
 if actor.role in ('office','manager') then
   return (coalesce(jsonb_array_length(actor.permissions),0)=0 or actor.permissions ? 'projects')
    and (actor.role='office' or proj is null or exists(select 1 from public.project_staff s where s.company_id=actor.company_id and s.project_id=proj and s.user_id=actor.id and s.is_active is distinct from false));
 end if;
 return not p_write and actor.id=any(notification_private.targets(actor.company_id,d->'assigned_to'));
end $$;
revoke all on function notification_private.people_task_access(text,uuid,boolean) from public,anon,authenticated;
grant execute on function notification_private.people_task_access(text,uuid,boolean) to authenticated;

create or replace function notification_private.people_dependency_valid(p_task uuid,p_prerequisite uuid,p_company uuid,p_project uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.project_tasks t join public.project_tasks predecessor
  on predecessor.id=p_prerequisite and predecessor.company_id=t.company_id and predecessor.project_id=t.project_id
  where t.id=p_task and t.company_id is not null and t.project_id is not null and t.id!=predecessor.id
   and (p_company is null or p_company=t.company_id) and (p_project is null or p_project=t.project_id)
   and ((auth.uid() is not null and exists(select 1 from public.profiles actor where actor.id=auth.uid() and actor.company_id=t.company_id and actor.is_active is distinct from false))
    or (auth.uid() is null and coalesce(auth.role(),current_setting('role',true)) not in ('anon','authenticated'))));
$$;
revoke all on function notification_private.people_dependency_valid(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function notification_private.people_dependency_valid(uuid,uuid,uuid,uuid) to authenticated;

-- Review-only metadata: no legacy row is deleted, updated, or reassigned.
create view notification_private.people_legacy_workflow_review as
 select 'time_off_requests'::text source_table,r.id,r.company_id,null::uuid project_id,
  'identity_unlinked'::text review_state,'Link the employee explicitly in Human Resources before deciding this request.'::text reason
 from public.time_off_requests r where r.user_id is null
 union all
 select 'task_dependencies',d.id,d.company_id,d.project_id,
  case when t.id is null or predecessor.id is null or t.company_id is null or t.project_id is null or t.id=predecessor.id
   or t.company_id is distinct from predecessor.company_id or t.project_id is distinct from predecessor.project_id
   or (d.company_id is not null and d.company_id is distinct from t.company_id)
   or (d.project_id is not null and d.project_id is distinct from t.project_id) then 'quarantined_dependency' else 'context_derived' end,
  case when t.id is null or predecessor.id is null or t.company_id is null or t.project_id is null or t.id=predecessor.id
   or t.company_id is distinct from predecessor.company_id or t.project_id is distinct from predecessor.project_id
   or (d.company_id is not null and d.company_id is distinct from t.company_id)
   or (d.project_id is not null and d.project_id is distinct from t.project_id) then 'Stored pair is excluded from task reads, cycles and readiness; privileged review is required.'
   else 'Valid context is derived from existing task UUIDs without rewriting this record.' end
 from public.task_dependencies d left join public.project_tasks t on t.id=d.task_id
 left join public.project_tasks predecessor on predecessor.id=d.depends_on_task_id
 where d.company_id is null or d.project_id is null or t.id is null or predecessor.id is null or t.company_id is null or t.project_id is null or t.id=predecessor.id
  or t.company_id is distinct from predecessor.company_id or t.project_id is distinct from predecessor.project_id
  or d.company_id is distinct from t.company_id or d.project_id is distinct from t.project_id;
revoke all on notification_private.people_legacy_workflow_review from public,anon,authenticated;
grant select on notification_private.people_legacy_workflow_review to service_role;

create or replace function notification_private.people_task_recipients(d jsonb)
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct p.id),'{}') from public.profiles p
 where p.company_id=(d->>'company_id')::uuid and p.is_active is distinct from false and (
  p.id=any(notification_private.targets(p.company_id,d->'assigned_to')) or p.role in ('owner','admin','office')
  or (p.role='manager' and exists(select 1 from public.project_staff s where s.company_id=p.company_id and s.project_id=nullif(d->>'project_id','')::uuid and s.user_id=p.id and s.is_active is distinct from false)));
$$;
revoke all on function notification_private.people_task_recipients(jsonb) from public,anon,authenticated;

alter table public.task_comments enable row level security;
revoke all on public.task_comments from public,anon,authenticated;
grant select,insert,delete on public.task_comments to authenticated;
create policy people_task_comments_read on public.task_comments for select to authenticated
 using(company_id=(select public.get_auth_company_id()) and notification_private.people_task_access(source_table,task_id,false));
create policy people_task_comments_create on public.task_comments for insert to authenticated
 with check(company_id=(select public.get_auth_company_id()) and user_id=(select auth.uid()) and notification_private.people_task_access(source_table,task_id,false));
create policy people_task_comments_delete on public.task_comments for delete to authenticated
 using(company_id=(select public.get_auth_company_id()) and (user_id=(select auth.uid()) or notification_private.people_task_access(source_table,task_id,true)));

create or replace function notification_private.people_comment_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare found_company uuid;
begin
 if new.source_table not in ('tasks','project_tasks') then raise exception 'Unsupported task source' using errcode='23514'; end if;
 execute format('select company_id from public.%I where id=$1',new.source_table) into found_company using new.task_id;
 if found_company is null or found_company is distinct from new.company_id or not exists(select 1 from public.profiles p where p.id=new.user_id and p.company_id=new.company_id and p.is_active is distinct from false) then raise exception 'Task comment identity mismatch' using errcode='23514'; end if;
 new.body:=btrim(new.body);
 return new;
end $$;
revoke all on function notification_private.people_comment_guard() from public,anon,authenticated;
create trigger people_comment_guard before insert on public.task_comments for each row execute function notification_private.people_comment_guard();

alter table public.task_dependencies enable row level security;
grant select,insert,update,delete on public.task_dependencies to authenticated;
create policy people_dependency_scope_read on public.task_dependencies as restrictive for select to public
 using(notification_private.people_task_access('project_tasks',task_id,false) and notification_private.people_dependency_valid(task_id,depends_on_task_id,company_id,project_id));
create policy people_dependency_scope_create on public.task_dependencies as restrictive for insert to public
 with check(company_id=(select public.get_auth_company_id()) and notification_private.people_task_access('project_tasks',task_id,true));
create policy people_dependency_scope_update on public.task_dependencies as restrictive for update to public
 using(notification_private.people_task_access('project_tasks',task_id,true) and notification_private.people_dependency_valid(task_id,depends_on_task_id,company_id,project_id))
 with check(company_id=(select public.get_auth_company_id()) and notification_private.people_task_access('project_tasks',task_id,true));
create policy people_dependency_scope_delete on public.task_dependencies as restrictive for delete to public
 using(notification_private.people_task_access('project_tasks',task_id,true) and notification_private.people_dependency_valid(task_id,depends_on_task_id,company_id,project_id));
create policy people_dependency_read on public.task_dependencies for select to authenticated using(notification_private.people_task_access('project_tasks',task_id,false));
create policy people_dependency_write on public.task_dependencies for all to authenticated using(notification_private.people_task_access('project_tasks',task_id,true)) with check(notification_private.people_task_access('project_tasks',task_id,true));

create or replace function notification_private.people_dependency_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.project_tasks; predecessor public.project_tasks;
begin
 select * into t from public.project_tasks where id=new.task_id;
 select * into predecessor from public.project_tasks where id=new.depends_on_task_id;
 if t.id is null or predecessor.id is null or t.company_id is null or t.project_id is null
  or t.company_id is distinct from predecessor.company_id or t.project_id is distinct from predecessor.project_id
  or new.task_id=new.depends_on_task_id then raise exception 'Choose a different prerequisite in the same project' using errcode='23514'; end if;
 new.company_id:=t.company_id; new.project_id:=t.project_id;
 perform pg_advisory_xact_lock(hashtextextended('people-dependencies:'||t.company_id::text,0));
 if auth.uid() is not null and not notification_private.people_task_access('project_tasks',new.task_id,true) then raise exception 'Task dependency access denied' using errcode='42501'; end if;
 if exists(select 1 from public.task_dependencies d where d.task_id=new.task_id and d.depends_on_task_id=new.depends_on_task_id and d.id is distinct from new.id and notification_private.people_dependency_valid(d.task_id,d.depends_on_task_id,d.company_id,d.project_id)) then raise exception 'This prerequisite is already saved' using errcode='23514'; end if;
 if exists(with recursive chain(id,path) as (
  select new.depends_on_task_id,array[new.depends_on_task_id]
  union all select d.depends_on_task_id,c.path||d.depends_on_task_id from chain c join public.task_dependencies d on d.task_id=c.id
   where notification_private.people_dependency_valid(d.task_id,d.depends_on_task_id,d.company_id,d.project_id) and d.id is distinct from new.id and not d.depends_on_task_id=any(c.path)
 ) select 1 from chain where id=new.task_id) then raise exception 'Task prerequisites cannot form a cycle' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function notification_private.people_dependency_guard() from public,anon,authenticated;
create trigger people_dependency_guard before insert or update on public.task_dependencies for each row execute function notification_private.people_dependency_guard();

create or replace function public.get_task_workflow(p_table text,p_task uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb; result jsonb; deps jsonb:='[]'; options jsonb:='[]'; can_edit boolean;
begin
 if not notification_private.people_task_access(p_table,p_task,false) then raise exception 'Task access denied' using errcode='42501'; end if;
 execute format('select to_jsonb(t) from public.%I t where id=$1',p_table) into d using p_task;
 can_edit:=notification_private.people_task_access(p_table,p_task,true);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'body',c.body,'user_id',c.user_id,'name',p.full_name,'created_at',c.created_at) order by c.created_at),'[]') into result
 from public.task_comments c join public.profiles p on p.id=c.user_id and p.company_id=c.company_id
 where c.company_id=(d->>'company_id')::uuid and c.source_table=p_table and c.task_id=p_task;
 if p_table='project_tasks' then
  select coalesce(jsonb_agg(jsonb_build_object('id',dep.id,'task_id',t.id,'title',t.title,'status',t.status)),'[]') into deps
  from public.task_dependencies dep join public.project_tasks t on t.id=dep.depends_on_task_id and t.company_id=(d->>'company_id')::uuid
  where dep.task_id=p_task and notification_private.people_dependency_valid(dep.task_id,dep.depends_on_task_id,dep.company_id,dep.project_id);
  if can_edit then
   select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status) order by t.title),'[]') into options
   from public.project_tasks t where t.company_id=(d->>'company_id')::uuid and t.project_id=(d->>'project_id')::uuid and t.id!=p_task;
  end if;
 end if;
 return jsonb_build_object('comments',result,'dependencies',deps,'options',options,'can_edit_dependencies',can_edit);
end $$;
revoke all on function public.get_task_workflow(text,uuid) from public,anon,authenticated;
grant execute on function public.get_task_workflow(text,uuid) to authenticated;

create or replace function notification_private.people_leave_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; is_hr boolean; d public.time_off_requests;
begin
 if auth.uid() is null then
  if coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
  return case when tg_op='DELETE' then old else new end;
 end if;
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false;
 if actor.id is null then raise exception 'Active company profile required' using errcode='42501'; end if;
 is_hr:=actor.role in ('owner','admin') or (actor.role='office' and (coalesce(jsonb_array_length(actor.permissions),0)=0 or actor.permissions ? 'human_resources'));
 d:=case when tg_op='DELETE' then old else new end;
 if d.company_id is distinct from actor.company_id then raise exception 'Time off must belong to your company' using errcode='42501'; end if;
 if tg_op!='DELETE' then
  if new.user_id is null and tg_op='INSERT' then new.user_id:=actor.id; end if;
  if not exists(select 1 from public.profiles where id=new.user_id and company_id=actor.company_id) then raise exception 'Select a valid company user' using errcode='23514'; end if;
  if new.start_date is null or new.end_date is null or new.end_date<new.start_date then raise exception 'End date must be on or after start date' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or (old.user_id is not null and new.user_id is distinct from old.user_id) or (old.user_id is null and not is_hr)) then raise exception 'Time off identity cannot be changed' using errcode='42501'; end if;
 end if;
 if not is_hr then
  if (tg_op='INSERT' and (new.user_id!=actor.id or lower(coalesce(new.status,''))!='pending'))
    or (tg_op!='INSERT' and (old.user_id is distinct from actor.id or lower(coalesce(old.status,''))!='pending'))
    or (tg_op='UPDATE' and (lower(coalesce(new.status,'')) not in ('pending','cancelled','canceled') or new.admin_notes is distinct from old.admin_notes or new.approved_by is distinct from old.approved_by))
  then raise exception 'You can submit or cancel your own pending time off only' using errcode='42501'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function notification_private.people_leave_guard() from public,anon,authenticated;
create trigger people_leave_guard before insert or update or delete on public.time_off_requests for each row execute function notification_private.people_leave_guard();
alter table public.time_off_requests enable row level security;
grant select,insert,update,delete on public.time_off_requests to authenticated;
create or replace function notification_private.people_leave_access(p_user uuid,p_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active is distinct from false and (p.id=p_user or p.role in ('owner','admin') or (p.role='office' and (coalesce(jsonb_array_length(p.permissions),0)=0 or p.permissions ? 'human_resources'))));
$$;
revoke all on function notification_private.people_leave_access(uuid,uuid) from public,anon,authenticated;
grant execute on function notification_private.people_leave_access(uuid,uuid) to authenticated;
create policy people_leave_scope on public.time_off_requests as restrictive for all to public
 using(company_id=(select public.get_auth_company_id()) and notification_private.people_leave_access(user_id,company_id))
 with check(company_id=(select public.get_auth_company_id()) and notification_private.people_leave_access(user_id,company_id));
create policy people_leave_access on public.time_off_requests for all to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=time_off_requests.company_id and p.is_active is distinct from false and (p.id=time_off_requests.user_id or p.role in ('owner','admin') or (p.role='office' and (coalesce(jsonb_array_length(p.permissions),0)=0 or p.permissions ? 'human_resources')))))
 with check(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=time_off_requests.company_id and p.is_active is distinct from false and (p.id=time_off_requests.user_id or p.role in ('owner','admin') or (p.role='office' and (coalesce(jsonb_array_length(p.permissions),0)=0 or p.permissions ? 'human_resources')))));

create or replace function notification_private.people_log_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; project_company uuid; can_manage boolean;
begin
 select company_id into project_company from public.projects where id=new.project_id;
 if project_company is null then raise exception 'Select a valid project for this log' using errcode='23514'; end if;
 if auth.uid() is null then
  if coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
  if new.company_id is distinct from project_company then raise exception 'Daily log project/company mismatch' using errcode='23514'; end if;
  return new;
 end if;
 select * into actor from public.profiles where id=auth.uid() and is_active is distinct from false;
 if actor.id is null or actor.company_id is distinct from project_company then raise exception 'Daily log project access denied' using errcode='42501'; end if;
 if new.company_id is null then new.company_id:=actor.company_id; end if;
 if new.user_id is null and tg_op='INSERT' then new.user_id:=actor.id; end if;
 if new.company_id is distinct from actor.company_id or not exists(select 1 from public.profiles where id=new.user_id and company_id=actor.company_id) then raise exception 'Daily log identity mismatch' using errcode='42501'; end if;
 can_manage:=actor.role in ('owner','admin') or (actor.role in ('office','manager') and (coalesce(jsonb_array_length(actor.permissions),0)=0 or actor.permissions ? 'DailyLogs') and (actor.role='office' or exists(select 1 from public.project_staff s where s.company_id=actor.company_id and s.project_id=new.project_id and s.user_id=actor.id and s.is_active is distinct from false)));
 if not can_manage and (new.user_id!=actor.id or not exists(select 1 from public.project_staff s where s.company_id=actor.company_id and s.project_id=new.project_id and s.user_id=actor.id and s.is_active is distinct from false)) then raise exception 'Submit logs only for your assigned projects' using errcode='42501'; end if;
 if tg_op='UPDATE' and (new.project_id is distinct from old.project_id or new.user_id is distinct from old.user_id or (old.company_id is not null and new.company_id is distinct from old.company_id)) then raise exception 'Daily log identity cannot be changed' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function notification_private.people_log_identity() from public,anon,authenticated;
create trigger people_log_identity before insert or update on public.project_daily_logs for each row execute function notification_private.people_log_identity();

create or replace function notification_private.people_management_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare worker public.profiles;
begin
 if not new.is_project_management then return new; end if;
 select * into worker from public.profiles where id=new.user_id and company_id=new.company_id and is_active is distinct from false;
 if worker.id is null or worker.role not in ('owner','admin','manager','office') or new.project_id is null
   or not exists(select 1 from public.projects p where p.id=new.project_id and p.company_id=new.company_id)
   or (worker.role not in ('owner','admin') and not exists(select 1 from public.project_staff s where s.company_id=new.company_id and s.project_id=new.project_id and s.user_id=worker.id and s.is_active is distinct from false))
 then raise exception 'Management hours require an assigned project manager or company administrator' using errcode='23514'; end if;
 if new.total_hours is null or new.total_hours<=0 or new.total_hours>24 then raise exception 'Record management hours between 0 and 24 for a day' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function notification_private.people_management_identity() from public,anon,authenticated;
create trigger people_management_identity before insert or update on public.time_entries for each row execute function notification_private.people_management_identity();

create or replace function notification_private.people_allocation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; actor public.profiles; start_date date; end_date date; pct numeric;
begin
 if not exists(select 1 from public.projects p join public.profiles worker on worker.company_id=p.company_id where p.id=(d->>'project_id')::uuid and p.company_id=(d->>'company_id')::uuid and worker.id=(d->>'user_id')::uuid and worker.is_active is distinct from false) then raise exception 'Allocation must link a project and active user in the same company' using errcode='23514'; end if;
 if auth.uid() is not null then
  select * into actor from public.profiles where id=auth.uid() and company_id=(d->>'company_id')::uuid and is_active is distinct from false;
  if actor.id is null or actor.role not in ('owner','admin','manager','office') or (actor.role in ('manager','office') and jsonb_array_length(coalesce(actor.permissions,'[]'))>0 and not actor.permissions ? 'projects')
   or (actor.role='manager' and not exists(select 1 from public.project_staff s where s.company_id=actor.company_id and s.project_id=(d->>'project_id')::uuid and s.user_id=actor.id and s.is_active is distinct from false)) then raise exception 'Allocation management access denied' using errcode='42501'; end if;
 elsif coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
 if tg_op!='DELETE' then
  start_date:=coalesce(d->>'allocation_start_date',d->>'start_date')::date; end_date:=coalesce(d->>'allocation_end_date',d->>'end_date')::date;
  pct:=coalesce(d->>'utilization_percentage',d->>'allocation_percentage')::numeric;
  if (start_date is not null and end_date is not null and end_date<start_date) or coalesce((d->>'allocated_hours')::numeric,0)<0 or pct<0 or pct>100 then raise exception 'Check allocation dates, hours and percentage' using errcode='23514'; end if;
  if nullif(d->>'task_id','') is not null and not exists(select 1 from public.project_tasks t where t.id=(d->>'task_id')::uuid and t.project_id=(d->>'project_id')::uuid and t.company_id=(d->>'company_id')::uuid) then raise exception 'Allocation task must belong to its project' using errcode='23514'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function notification_private.people_allocation_guard() from public,anon,authenticated;
create trigger people_allocation_guard before insert or update or delete on public.project_allocations for each row execute function notification_private.people_allocation_guard();
create trigger people_allocation_guard before insert or update or delete on public.resource_allocations for each row execute function notification_private.people_allocation_guard();
alter table public.project_allocations enable row level security;
alter table public.resource_allocations enable row level security;
create policy people_allocation_tenant on public.project_allocations as restrictive for all to public using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()));
create policy people_allocation_tenant on public.resource_allocations as restrictive for all to public using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()));

create or replace function notification_private.people_phase_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.depends_on_phase_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('people-phases:'||coalesce(new.company_id::text,''),0));
  if new.depends_on_phase_id=new.id or not exists(select 1 from public.project_phases p where p.id=new.depends_on_phase_id and p.company_id=new.company_id and p.project_id=new.project_id) then raise exception 'Choose another prerequisite phase in this project' using errcode='23514'; end if;
  if lower(coalesce(new.status,''))='ready' and not exists(select 1 from public.project_phases p where p.id=new.depends_on_phase_id and lower(coalesce(p.status,'')) in ('completed','complete','done')) then raise exception 'Complete the prerequisite before marking this phase ready' using errcode='23514'; end if;
  if exists(with recursive chain(id,path) as (
   select new.depends_on_phase_id,array[new.depends_on_phase_id]
   union all select p.depends_on_phase_id,c.path||p.depends_on_phase_id from chain c join public.project_phases p on p.id=c.id where p.company_id=new.company_id and p.depends_on_phase_id is not null and not p.depends_on_phase_id=any(c.path)
  ) select 1 from chain where id=new.id) then raise exception 'Phase prerequisites cannot form a cycle' using errcode='23514'; end if;
 end if;
 return new;
end $$;
revoke all on function notification_private.people_phase_guard() from public,anon,authenticated;
create trigger people_phase_guard before insert or update on public.project_phases for each row execute function notification_private.people_phase_guard();

create or replace function notification_private.people_source_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 o jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 c uuid:=nullif(d->>'company_id','')::uuid; proj uuid:=nullif(d->>'project_id','')::uuid;
 k text:=tg_table_name||':'||(d->>'id')||':'||txid_current()::text;
 ref jsonb; r record; event text; label text; recipients uuid[]:='{}';
begin
 if c is null then return case when tg_op='DELETE' then old else new end; end if;
 if auth.uid() is not null and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=c and p.is_active is distinct from false) then return case when tg_op='DELETE' then old else new end; end if;
 case tg_table_name
 when 'tasks','project_tasks' then
  if tg_op='UPDATE' then
   recipients:=notification_private.people_task_recipients(d);
   if d->>'priority' is distinct from o->>'priority' then perform notification_private.row_event(d,tg_table_name,'task_priority_changed',proj,recipients,coalesce(d->>'title','Task')||': priority is now '||coalesce(d->>'priority','not set'),k||':priority'); end if;
   if coalesce(d->>'due_date_target',d->>'due_date') is distinct from coalesce(o->>'due_date_target',o->>'due_date') then perform notification_private.row_event(d,tg_table_name,'task_due_date_changed',proj,recipients,coalesce(d->>'title','Task')||': target date '||case when coalesce(d->>'due_date_target',d->>'due_date') is null then 'removed' else to_char(coalesce(d->>'due_date_target',d->>'due_date')::date,'Mon DD, YYYY') end,k||':due'); end if;
   if tg_table_name='project_tasks' and lower(coalesce(d->>'status','')) in ('done','completed','complete') and d->>'status' is distinct from o->>'status' then
    for r in select to_jsonb(t) doc from public.task_dependencies dep join public.project_tasks t on t.id=dep.task_id and t.company_id=c where dep.depends_on_task_id=(d->>'id')::uuid and notification_private.people_dependency_valid(dep.task_id,dep.depends_on_task_id,dep.company_id,dep.project_id) and lower(coalesce(t.status,'')) not in ('done','completed','complete','cancelled','canceled') loop
     if not exists(select 1 from public.task_dependencies dep join public.project_tasks predecessor on predecessor.id=dep.depends_on_task_id and predecessor.company_id=c where dep.task_id=(r.doc->>'id')::uuid and notification_private.people_dependency_valid(dep.task_id,dep.depends_on_task_id,dep.company_id,dep.project_id) and lower(coalesce(predecessor.status,'')) not in ('done','completed','complete')) then
      perform notification_private.row_event(r.doc,'project_tasks','task_dependency_ready',nullif(r.doc->>'project_id','')::uuid,notification_private.people_task_recipients(r.doc),coalesce(r.doc->>'title','Task')||': all saved prerequisites are complete.',k||':ready:'||(r.doc->>'id'));
     end if;
    end loop;
   end if;
  end if;
 when 'task_comments' then
  if tg_op='INSERT' then
   execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2',d->>'source_table') into ref using (d->>'task_id')::uuid,c;
   if ref is not null then perform notification_private.row_event(ref,d->>'source_table','task_comment',nullif(ref->>'project_id','')::uuid,notification_private.people_task_recipients(ref),coalesce(ref->>'title','Task')||': '||left(d->>'body',500),k); end if;
  end if;
 when 'project_phases' then
  label:=coalesce(d->>'name','Phase'); recipients:=notification_private.targets(c,d->'assigned_to');
  if tg_op='UPDATE' and (d->>'status',d->>'start_date_target',d->>'end_date_target',d->>'assigned_to',d->>'depends_on_phase_id') is distinct from (o->>'status',o->>'start_date_target',o->>'end_date_target',o->>'assigned_to',o->>'depends_on_phase_id') then perform notification_private.row_event(d,tg_table_name,'phase_changed',proj,recipients,label||': '||coalesce(d->>'status','Not Started')||'. Review the phase dates and assignment.',k||':changed'); end if;
  if lower(coalesce(d->>'status',''))='ready' and d->>'status' is distinct from o->>'status' then perform notification_private.row_event(d,tg_table_name,'phase_ready',proj,recipients,label||' is marked ready to start.',k||':ready'); end if;
  if tg_op='UPDATE' and lower(coalesce(d->>'status','')) in ('done','completed','complete') and d->>'status' is distinct from o->>'status' then
   for r in select to_jsonb(p) doc from public.project_phases p where p.company_id=c and p.project_id=proj and p.depends_on_phase_id=(d->>'id')::uuid and lower(coalesce(p.status,'')) not in ('done','completed','complete','cancelled','canceled') loop
    perform notification_private.row_event(r.doc,'project_phases','phase_ready',proj,notification_private.targets(c,r.doc->'assigned_to'),coalesce(r.doc->>'name','Phase')||': its prerequisite phase is complete. Review and start the phase.',k||':ready:'||(r.doc->>'id'));
   end loop;
  end if;
 when 'project_staff' then
  if tg_op='DELETE' or (d->>'is_active'='false' and o->>'is_active' is distinct from 'false') then
   select to_jsonb(p) into ref from public.projects p where p.id=proj and p.company_id=c;
   if ref is not null then
    perform notification_private.row_event(ref,'projects','project_staff_removed',proj,'{}',coalesce(ref->>'name','Project')||': a team assignment was removed.',k);
    perform notification_private.emit(c,'project_assignment_removed','User',(d->>'user_id')::uuid,null,array[(d->>'user_id')::uuid],'Your assignment to '||coalesce(ref->>'name','the project')||' was removed. Contact your manager if this was unexpected.',k||':personal');
   end if;
  end if;
 when 'time_off_requests' then
  recipients:=array_remove(array[nullif(d->>'user_id','')::uuid],null);
  label:=coalesce(d->>'employee_name','Team member')||': '||to_char((d->>'start_date')::date,'Mon DD, YYYY')||' to '||to_char((d->>'end_date')::date,'Mon DD, YYYY');
  event:=case when tg_op='DELETE' or (lower(coalesce(d->>'status','')) in ('cancelled','canceled') and d->>'status' is distinct from o->>'status') then 'leave_cancelled'
   when lower(coalesce(d->>'status',''))='pending' and (tg_op='INSERT' or (d->>'start_date',d->>'end_date',d->>'type',d->>'reason') is distinct from (o->>'start_date',o->>'end_date',o->>'type',o->>'reason')) then 'leave_requested'
   when lower(coalesce(d->>'status',''))='approved' and d->>'status' is distinct from o->>'status' then 'leave_approved'
   when lower(coalesce(d->>'status',''))='rejected' and d->>'status' is distinct from o->>'status' then 'leave_rejected' else null end;
  if event is not null then perform notification_private.emit(c,event,'LeaveRequest',(d->>'id')::uuid,null,recipients,label||'. Status: '||case when tg_op='DELETE' then 'Cancelled' else coalesce(d->>'status','Pending') end,k); end if;
 when 'project_daily_logs' then
  if d->>'weather_delay'='true' and o->>'weather_delay' is distinct from 'true' then perform notification_private.row_event(d,tg_table_name,'weather_delay',proj,'{}','Weather delay recorded: '||coalesce(d->>'blockers',d->>'summary','Review the site log.'),k||':weather_delay'); end if;
  if tg_op='UPDATE' and d->>'safety_status' is distinct from o->>'safety_status' and nullif(d->>'safety_concerns','') is not null then perform notification_private.row_event(d,tg_table_name,'safety_review_changed',proj,'{}','Safety concern is now '||coalesce(d->>'safety_status','Open')||': '||left(d->>'safety_concerns',500),k||':safety'); end if;
  if tg_op='UPDATE' and d->>'blocker_status' is distinct from o->>'blocker_status' and nullif(d->>'blockers','') is not null then perform notification_private.row_event(d,tg_table_name,'blocker_review_changed',proj,'{}','Site issue is now '||coalesce(d->>'blocker_status','Open')||': '||left(d->>'blockers',500),k||':blocker'); end if;
  if tg_op='UPDATE' and d->'photos' is distinct from o->'photos' and jsonb_array_length(case when jsonb_typeof(d->'photos')='array' then d->'photos' else '[]'::jsonb end)<=jsonb_array_length(case when jsonb_typeof(o->'photos')='array' then o->'photos' else '[]'::jsonb end) then perform notification_private.row_event(d,tg_table_name,'daily_log_photos_changed',proj,'{}','Saved site photos were updated.',k||':photos'); end if;
 else null;
 end case;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function notification_private.people_source_event() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['tasks','project_tasks','task_comments','project_phases','project_staff','time_off_requests','project_daily_logs'] loop
  execute format('create trigger people_notification_events after insert or update or delete on public.%I for each row execute function notification_private.people_source_event()',t);
 end loop;
end $$;

-- Called by the central reminder routine after removing its legacy missing
-- submission block. Both allocation entry points count; approved leave does not.
create or replace function notification_private.submission_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare co record; r record; tz text; today date; yesterday date; n integer:=0;
begin
 for co in select id,timezone from public.companies loop
  select name into tz from pg_timezone_names where name=co.timezone limit 1; tz:=coalesce(tz,'America/Edmonton');
  today:=(p_now at time zone tz)::date; yesterday:=today-1;
  if extract(hour from p_now at time zone tz)<8 then continue; end if;
  for r in with allocations as (
   select company_id,user_id,project_id,start_date,end_date,allocation_percentage pct from public.resource_allocations
   union all select company_id,user_id,project_id,allocation_start_date,allocation_end_date,utilization_percentage from public.project_allocations
  ) select distinct a.user_id,a.project_id from allocations a join public.profiles p on p.id=a.user_id and p.company_id=a.company_id
   join public.projects pr on pr.id=a.project_id and pr.company_id=a.company_id
   where a.company_id=co.id and a.start_date<=yesterday and a.end_date>=yesterday and a.pct>0 and p.is_active is distinct from false and p.role in ('employee','subcontractor')
    and exists(select 1 from public.schedule_jobs j where j.company_id=co.id and j.project_id=a.project_id and (j.start_date_time at time zone tz)::date<=yesterday and (j.end_date_time at time zone tz)::date>=yesterday and lower(coalesce(j.status,'')) not in ('cancelled','canceled'))
    and not exists(select 1 from public.time_off_requests l where l.company_id=co.id and lower(coalesce(l.status,''))='approved' and l.start_date<=yesterday and l.end_date>=yesterday and (l.user_id=a.user_id or (l.user_id is null and l.employee_name=p.full_name and (select count(*) from public.profiles p2 where p2.company_id=co.id and p2.full_name=l.employee_name)=1)))
  loop
   if not exists(select 1 from public.time_entries t where t.company_id=co.id and t.user_id=r.user_id and t.date=yesterday and lower(coalesce(t.status,'')) not in ('cancelled','canceled','rejected')) then
    n:=n+notification_private.emit(co.id,'timesheet_missing','TimeEntry',r.user_id,r.project_id,array[r.user_id],'Submit your timesheet for '||to_char(yesterday,'Mon DD, YYYY'),'timesheet_missing:'||r.user_id||':'||yesterday);
   end if;
   if not exists(select 1 from public.project_daily_logs l where l.company_id=co.id and l.project_id=r.project_id and l.user_id=r.user_id and l.date=yesterday) then
    n:=n+notification_private.emit(co.id,'daily_log_missing','ProjectRecord',r.project_id,r.project_id,array[r.user_id],'Submit your daily log for '||to_char(yesterday,'Mon DD, YYYY'),'daily_log_missing:'||r.user_id||':'||r.project_id||':'||yesterday);
   end if;
  end loop;
 end loop;
 return n;
end $$;
revoke all on function notification_private.submission_reminders(timestamptz) from public,anon,authenticated;

create or replace function notification_private.people_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare co record; r record; tz text; today date; n integer:=0; total numeric; e text; targets uuid[];
begin
 for co in select id,timezone from public.companies loop
  select name into tz from pg_timezone_names where name=co.timezone limit 1; tz:=coalesce(tz,'America/Edmonton'); today:=(p_now at time zone tz)::date;
  if extract(hour from p_now at time zone tz)<8 then continue; end if;
  for r in select to_jsonb(p) doc from public.projects p where p.company_id=co.id and p.start_date between today and today+3 and lower(coalesce(p.status,'')) not in ('completed','done','closed','cancelled','canceled','archived') loop
   n:=n+notification_private.row_event(r.doc,'projects','project_starting_soon',(r.doc->>'id')::uuid,'{}',coalesce(r.doc->>'name','Project')||' starts '||to_char((r.doc->>'start_date')::date,'Mon DD, YYYY'),'project-start:'||(r.doc->>'id')||':'||(r.doc->>'start_date'));
  end loop;
  for r in select to_jsonb(m) doc from public.project_milestones m join public.projects p on p.id=m.project_id and p.company_id=m.company_id where m.company_id=co.id and m.due_date_target<today and lower(coalesce(m.status,'')) not in ('completed','complete','done','closed','cancelled','canceled') and lower(coalesce(p.status,'')) not in ('completed','done','closed','cancelled','canceled','archived') loop
   n:=n+notification_private.row_event(r.doc,'project_milestones','milestone_overdue',(r.doc->>'project_id')::uuid,'{}',coalesce(r.doc->>'title','Milestone')||' was due '||to_char((r.doc->>'due_date_target')::date,'Mon DD, YYYY'),'milestone-overdue:'||(r.doc->>'id')||':'||(r.doc->>'due_date_target'));
  end loop;
  for r in select to_jsonb(t) doc from public.time_entries t join public.profiles p on p.id=t.user_id and p.company_id=t.company_id where t.company_id=co.id and p.is_active is distinct from false and t.clock_in is not null and t.clock_out is null and lower(coalesce(t.status,''))='clocked in' and t.clock_in<=p_now-interval '12 hours' loop
   select coalesce(array_agg(p.id),'{}') into targets from public.profiles p where p.company_id=co.id and p.is_active is distinct from false and (p.id=(r.doc->>'user_id')::uuid or p.role in ('owner','admin','office'));
   n:=n+notification_private.row_event(r.doc,'time_entries','missing_clock_out',null,targets,coalesce(r.doc->>'employee_name','Team member')||': this shift has remained open for at least 12 hours. Check and record its clock-out.','clockout:'||(r.doc->>'id')||':'||(r.doc->>'clock_in'));
  end loop;
  for r in with allocated as (select company_id,user_id,project_id,allocation_start_date,allocation_end_date,allocated_hours from public.project_allocations union all select company_id,user_id,project_id,start_date,end_date,allocated_hours from public.resource_allocations)
    select a.user_id,a.project_id,a.allocation_start_date start_date,a.allocation_end_date end_date,sum(a.allocated_hours) allowance,p.full_name
    from allocated a join public.profiles p on p.id=a.user_id and p.company_id=a.company_id join public.projects pr on pr.id=a.project_id and pr.company_id=a.company_id
    where a.company_id=co.id and a.allocated_hours>0 and a.allocation_start_date<=today and a.allocation_end_date>=a.allocation_start_date and p.is_active is distinct from false
    group by a.user_id,a.project_id,a.allocation_start_date,a.allocation_end_date,p.full_name loop
   select coalesce(sum(t.total_hours),0) into total from public.time_entries t where t.company_id=co.id and t.user_id=r.user_id and t.project_id=r.project_id and t.date between r.start_date and least(today,r.end_date) and lower(coalesce(t.status,'')) in ('approved','pending','submitted','under review');
   if total>r.allowance then
    select coalesce(array_agg(p.id),'{}') into targets from public.profiles p where p.company_id=co.id and p.is_active is distinct from false and (p.id=r.user_id or p.role in ('owner','admin','office'));
    n:=n+notification_private.emit(co.id,'scheduled_hours_exceeded','TimeEntry',r.user_id,r.project_id,targets,r.full_name||': recorded '||round(total,2)||' hours against '||round(r.allowance,2)||' allocated hours ('||to_char(r.start_date,'Mon DD')||' to '||to_char(r.end_date,'Mon DD, YYYY')||').','scheduled-hours:'||r.user_id||':'||r.project_id||':'||r.start_date||':'||r.end_date||':'||r.allowance);
   end if;
  end loop;
  for r in select s.*,p.full_name from public.project_staff s join public.profiles p on p.id=s.user_id and p.company_id=s.company_id join public.projects pr on pr.id=s.project_id and pr.company_id=s.company_id where s.company_id=co.id and s.is_active is distinct from false and p.is_active is distinct from false and s.pm_hours_cap>0 and lower(coalesce(pr.status,'')) not in ('completed','done','closed','cancelled','canceled','archived') loop
   select coalesce(sum(t.total_hours),0) into total from public.time_entries t where t.company_id=co.id and t.project_id=r.project_id and t.user_id=r.user_id and t.is_project_management and lower(coalesce(t.status,'')) in ('approved','pending','submitted','under review');
   if total>=r.pm_hours_cap*0.9 then
    e:=case when total>r.pm_hours_cap then 'pm_hours_exceeded' else 'pm_hours_approaching' end;
    select coalesce(array_agg(p.id),'{}') into targets from public.profiles p where p.company_id=co.id and p.is_active is distinct from false and (p.id=r.user_id or p.role in ('owner','admin','office') or (p.role='manager' and exists(select 1 from public.project_staff s where s.user_id=p.id and s.company_id=co.id and s.project_id=r.project_id and s.is_active is distinct from false)));
    n:=n+notification_private.emit(co.id,e,'Project',r.project_id,r.project_id,targets,r.full_name||': recorded '||round(total,2)||' project management hours against a '||round(r.pm_hours_cap,2)||'-hour cap.',e||':'||r.id||':'||r.pm_hours_cap);
   end if;
  end loop;
 end loop;
 return n;
end $$;
revoke all on function notification_private.people_reminders(timestamptz) from public,anon,authenticated;
