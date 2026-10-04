-- Role-based notification delivery. Public clients cannot create arbitrary alerts.
create schema if not exists notification_private;
revoke all on schema notification_private from public, anon, authenticated;
grant usage on schema notification_private to authenticated, service_role;

-- Extend the legacy three-role constraint to the roles used by notification routing.
do $$ declare r record; begin
  for r in select c.conname from pg_constraint c
    where c.conrelid='public.profiles'::regclass and c.contype='c'
      and (select attnum from pg_attribute where attrelid=c.conrelid and attname='role')=any(c.conkey)
  loop execute format('alter table public.profiles drop constraint %I',r.conname); end loop;
end $$;
alter table public.profiles add constraint profiles_notification_role_check
  check (role in ('owner','admin','manager','office','employee','subcontractor'));

create table notification_private.event_rules (
  event_key text primary key,
  title text not null,
  severity text not null check (severity in ('Action Required','Important','FYI')),
  category text not null,
  roles text[] not null,
  audience text not null check (audience in ('leadership','project','assigned','personal')),
  module text
);
revoke all on notification_private.event_rules from public, anon, authenticated;

alter table public.notifications add column if not exists event_key text;
alter table public.notifications add column if not exists dedupe_key text;
create unique index notifications_delivery_once on public.notifications(user_id,event_key,dedupe_key);
create index notifications_recipient_recent on public.notifications(company_id,user_id,created_at desc,id desc);
create index notifications_recipient_unread on public.notifications(company_id,user_id,created_at desc) where is_read=false;
create index if not exists notification_project_staff_lookup on public.project_staff(company_id,project_id,user_id) where is_active is distinct from false;

-- Keep both historical read-state fields consistent.
update public.notifications set is_read = coalesce(is_read,false) or coalesce(status='read',false);
alter table public.notifications alter column is_read set default false;
alter table public.notifications alter column is_read set not null;

create or replace function notification_private.eligible(p_user uuid,p_company uuid,p_event text,p_project uuid,p_targeted boolean)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.profiles p join notification_private.event_rules r on r.event_key=p_event
    where p.id=p_user and p.company_id=p_company and p.is_active is distinct from false
      and p.role=any(r.roles)
      and (r.audience not in ('assigned','personal') or p_targeted)
      and (p.role in ('owner','admin','employee','subcontractor') or r.module is null
        or r.audience='personal' or coalesce(jsonb_array_length(p.permissions),0)=0 or p.permissions ? r.module)
      and (
        p.role in ('admin','owner','office') or (p_targeted and (r.event_key!='project_assigned') and (r.event_key!='mentioned' or p_project is null))
        or (r.audience='leadership' and p_project is null and p.role='manager')
        or (p_project is not null and exists (
          select 1 from public.project_staff s join public.projects pr on pr.id=s.project_id and pr.company_id=s.company_id
          where s.company_id=p_company and s.project_id=p_project and s.user_id=p.id and s.is_active is distinct from false
        ))
      )
  );
$$;
revoke all on function notification_private.eligible(uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function notification_private.eligible(uuid,uuid,text,uuid,boolean) to service_role;

create or replace function notification_private.visible(p_company uuid,p_event text,p_metadata jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select case when p_event is null then exists (
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=p_company
    and p.is_active is distinct from false and p.role in ('owner','admin')
  ) else notification_private.eligible((select auth.uid()),p_company,p_event,
    nullif(p_metadata->>'project_id','')::uuid,coalesce((p_metadata->>'targeted')::boolean,false)) end;
$$;
revoke all on function notification_private.visible(uuid,text,jsonb) from public,anon;
grant execute on function notification_private.visible(uuid,text,jsonb) to authenticated;

alter table public.notifications enable row level security;
do $$ declare r record; begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='notifications'
  loop execute format('drop policy %I on public.notifications',r.policyname); end loop;
end $$;

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
('project_created','Project created','FYI','Projects',array['admin','owner','manager','office'],'leadership','projects'),
('project_assigned','New project assigned to you','Action Required','Projects',array['admin','owner','manager','office','employee','subcontractor'],'assigned','projects'),
('project_status_changed','Project status changed','Important','Projects',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('project_dates_changed','Project dates changed','Important','Projects',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('project_milestone_completed','Project milestone completed','Important','Projects',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('task_created','New task created','FYI','Projects',array['admin','owner','manager','office'],'leadership','projects'),
('task_assigned','New task assigned to you','Action Required','Projects',array['admin','owner','manager','office','employee','subcontractor'],'assigned','projects'),
('task_reassigned','Task reassigned','Important','Projects',array['admin','owner','manager','office','employee','subcontractor'],'assigned','projects'),
('task_completed','Task completed','FYI','Projects',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('task_due_today','Task due today','Action Required','Projects',array['admin','owner','manager','office','employee','subcontractor'],'assigned','projects'),
('task_overdue','Task overdue','Action Required','Projects',array['admin','owner','manager','office','employee','subcontractor'],'assigned','projects'),
('quote_created','New quote created','FYI','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_review','Quote awaiting review','Action Required','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_sent','Quote sent to client','FYI','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_viewed','Client viewed quote','FYI','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_approved','Quote approved','Important','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_declined','Quote declined','Important','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_expired','Quote expired','Action Required','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_revised','Quote revised','Important','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_converted','Quote converted to project','Important','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_change_requested','Client requested quote changes','Action Required','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('quote_selection_changed','Client quote selections changed','Important','Financial',array['admin','owner','manager','office'],'leadership','quotes'),
('co_created','New change order created','FYI','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('co_review','Change order awaiting approval','Action Required','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('co_viewed','Client viewed change order','FYI','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('co_approved','Change order approved','Important','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('co_declined','Change order declined','Important','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('co_revised','Change order updated','Important','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('co_added_to_total','Approved change order added to project total','Important','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('change_order_requested','Client requested change order changes','Action Required','Financial',array['admin','owner','manager','office'],'leadership','change_orders'),
('invoice_created','Invoice created','FYI','Financial',array['admin','owner','office'],'leadership','invoices'),
('invoice_sent','Invoice sent','FYI','Financial',array['admin','owner','office'],'leadership','invoices'),
('invoice_viewed','Client viewed invoice','FYI','Financial',array['admin','owner','office'],'leadership','invoices'),
('payment_received','Payment received','Important','Financial',array['admin','owner','office'],'leadership','invoices'),
('partial_payment_received','Partial payment received','Important','Financial',array['admin','owner','office'],'leadership','invoices'),
('invoice_due_soon','Invoice due soon','Important','Financial',array['admin','owner','office'],'leadership','invoices'),
('invoice_overdue','Invoice overdue','Action Required','Financial',array['admin','owner','office'],'leadership','invoices'),
('payment_failed','Payment failed','Action Required','Financial',array['admin','owner','office'],'leadership','invoices'),
('invoice_revised','Invoice revised','Important','Financial',array['admin','owner','office'],'leadership','invoices'),
('final_invoice_issued','Final invoice issued','Important','Financial',array['admin','owner','office'],'leadership','invoices'),
('schedule_added','New event scheduled','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('schedule_changed','Schedule changed','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('schedule_cancelled','Appointment cancelled','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('trade_scheduled','Trade scheduled','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('trade_rescheduled','Trade rescheduled','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('schedule_tomorrow','Scheduled work tomorrow','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('inspection_scheduled','Inspection scheduled','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('inspection_passed','Inspection passed','Important','Scheduling',array['admin','owner','manager','office'],'leadership','projects'),
('inspection_failed','Inspection failed','Action Required','Scheduling',array['admin','owner','manager','office'],'leadership','projects'),
('site_meeting_scheduled','Site meeting scheduled','Important','Scheduling',array['admin','owner','manager','office','employee','subcontractor'],'project','projects'),
('daily_log_submitted','Daily log submitted','FYI','Daily Logs',array['admin','owner','manager','office'],'leadership','DailyLogs'),
('daily_log_photos','Photos added to daily log','FYI','Daily Logs',array['admin','owner','manager','office'],'leadership','DailyLogs'),
('site_issue_reported','Issue reported from site','Action Required','Daily Logs',array['admin','owner','manager','office'],'leadership','DailyLogs'),
('safety_concern','Safety concern reported','Action Required','Daily Logs',array['admin','owner','manager','office'],'leadership','DailyLogs'),
('weather_delay','Weather delay reported','Important','Daily Logs',array['admin','owner','manager','office'],'leadership','DailyLogs'),
('work_completed_today','Work completed today','FYI','Daily Logs',array['admin','owner','manager','office'],'leadership','DailyLogs'),
('daily_log_missing','Daily log missing','Action Required','Daily Logs',array['admin','owner','manager','office','employee','subcontractor'],'assigned','DailyLogs'),
('timesheet_submitted','Timesheet awaiting approval','Action Required','Timesheets',array['admin','owner','office'],'leadership','human_resources'),
('timesheet_approved','Timesheet approved','FYI','Timesheets',array['admin','owner','manager','office','employee','subcontractor'],'personal','human_resources'),
('timesheet_rejected','Timesheet rejected','Action Required','Timesheets',array['admin','owner','manager','office','employee','subcontractor'],'personal','human_resources'),
('timesheet_missing','Missing timesheet','Action Required','Timesheets',array['admin','owner','manager','office','employee','subcontractor'],'assigned','human_resources'),
('scheduled_hours_exceeded','Employee exceeded scheduled hours','Important','Timesheets',array['admin','owner','office'],'leadership','human_resources'),
('weekly_payroll_ready','Weekly hours ready for payroll','Action Required','Timesheets',array['admin','owner','office'],'leadership','human_resources'),
('document_uploaded','New document uploaded','FYI','Documents',array['admin','owner','manager','office'],'leadership','projects'),
('document_updated','Document updated','Important','Documents',array['admin','owner','manager','office'],'leadership','projects'),
('permit_uploaded','Permit uploaded','Important','Documents',array['admin','owner','manager','office'],'leadership','projects'),
('inspection_report_uploaded','Inspection report uploaded','Important','Documents',array['admin','owner','manager','office'],'leadership','projects'),
('client_message','Message from client','Action Required','Mentions',array['admin','owner','manager','office'],'leadership','clients'),
('project_comment','New project comment','FYI','Mentions',array['admin','owner','manager','office','employee','subcontractor'],'project','clients'),
('mentioned','You were mentioned','Action Required','Mentions',array['admin','owner','manager','office','employee','subcontractor'],'personal','clients'),
('subcontractor_added','Subcontractor added','FYI','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('subcontractor_accepted','Subcontractor accepted project','Important','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('subcontractor_declined','Subcontractor declined work','Action Required','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('subcontractor_complete','Subcontractor marked work complete','Important','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('subcontractor_quote','Quote received from subcontractor','Action Required','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('subcontractor_invited','Subcontractor invited','FYI','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('subcontractor_insurance_expiring','Subcontractor insurance expiring','Action Required','Subcontractors',array['admin','owner','manager','office'],'leadership','vendors'),
('po_created','Purchase order created','FYI','Financial',array['admin','owner','manager','office'],'leadership','purchase_orders'),
('po_approved','Purchase order approved','Important','Financial',array['admin','owner','manager','office'],'leadership','purchase_orders'),
('po_changed','Purchase order changed','Important','Financial',array['admin','owner','manager','office'],'leadership','purchase_orders'),
('material_ready','Material order ready or received','Important','Financial',array['admin','owner','manager','office','employee','subcontractor'],'project','purchase_orders'),
('material_backordered','Material unavailable or backordered','Action Required','Financial',array['admin','owner','manager','office'],'leadership','purchase_orders'),
('expense_submitted','Expense requires approval','Action Required','Financial',array['admin','owner','office'],'leadership','human_resources'),
('expense_approved','Expense approved','FYI','Financial',array['admin','owner','manager','office','employee','subcontractor'],'personal','human_resources'),
('expense_rejected','Expense rejected','Action Required','Financial',array['admin','owner','manager','office','employee','subcontractor'],'personal','human_resources'),
('inventory_low','Low inventory','Action Required','Inventory',array['admin','owner','manager','office'],'leadership','inventory'),
('inventory_out','Item out of stock','Action Required','Inventory',array['admin','owner','manager','office'],'leadership','inventory'),
('inventory_assigned','Inventory assigned to project','FYI','Inventory',array['admin','owner','manager','office'],'leadership','inventory'),
('inventory_returned','Inventory returned','FYI','Inventory',array['admin','owner','manager','office'],'leadership','inventory'),
('inventory_received','New inventory received','FYI','Inventory',array['admin','owner','manager','office'],'leadership','inventory'),
('inventory_adjusted','Inventory adjustment made','FYI','Inventory',array['admin','owner','manager','office'],'leadership','inventory'),
('budget_updated','Project budget updated','Important','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('budget_approaching','Project approaching budget','Important','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('budget_exceeded','Project budget exceeded','Action Required','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('labour_allowance_approaching','Labour hours approaching allowance','Important','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('labour_allowance_exceeded','Labour hours exceeded allowance','Action Required','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('profit_changed','New expense affects estimated profit','Important','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('margin_changed','Project margin changed significantly','Important','Financial',array['admin','owner','manager','office'],'leadership','projects'),
('deficiency_reported','New deficiency reported','Action Required','Warranty',array['admin','owner','manager','office'],'leadership','projects'),
('deficiency_assigned','Deficiency assigned','Action Required','Warranty',array['admin','owner','manager','office','employee','subcontractor'],'assigned','projects'),
('deficiency_completed','Deficiency completed','Important','Warranty',array['admin','owner','manager','office'],'leadership','projects'),
('user_added','New user added','FYI','Admin',array['admin','owner'],'leadership','settings'),
('user_invited','User invited','FYI','Admin',array['admin','owner'],'leadership','settings'),
('invitation_accepted','User accepted invitation','FYI','Admin',array['admin','owner'],'leadership','settings'),
('role_changed','Role or permissions changed','Important','Admin',array['admin','owner','manager','office','employee','subcontractor'],'personal','settings'),
('user_removed','User removed or deactivated','Important','Admin',array['admin','owner'],'leadership','settings'),
('company_settings_changed','Company settings changed','Important','Admin',array['admin','owner'],'leadership','settings'),
('billing_plan_changed','Billing plan changed','Important','Admin',array['admin','owner'],'leadership','settings'),
('subscription_payment_failed','Subscription payment failed','Action Required','Admin',array['admin','owner'],'leadership','settings'),
('new_device_login','New login from an unfamiliar device','Important','Security',array['admin','owner','manager','office','employee','subcontractor'],'personal',null),
('password_changed','Password changed','Important','Security',array['admin','owner','manager','office','employee','subcontractor'],'personal',null),
('email_changed','Email changed','Important','Security',array['admin','owner','manager','office','employee','subcontractor'],'personal',null),
('two_factor_changed','Two-factor authentication changed','Important','Security',array['admin','owner','manager','office','employee','subcontractor'],'personal',null),
('administrator_granted','Administrator permissions granted','Important','Security',array['admin','owner','manager','office','employee','subcontractor'],'personal',null);
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;
grant update(is_read,status) on public.notifications to authenticated;
grant all on public.notifications to service_role;
create policy notification_recipient_select on public.notifications for select to authenticated
using (user_id=(select auth.uid()) and notification_private.visible(company_id,event_key,metadata));
create policy notification_recipient_update on public.notifications for update to authenticated
using (user_id=(select auth.uid()) and notification_private.visible(company_id,event_key,metadata))
with check (user_id=(select auth.uid()) and notification_private.visible(company_id,event_key,metadata));

create or replace function notification_private.sync_read_state() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.is_read is distinct from old.is_read then new.status := case when new.is_read then 'read' else 'unread' end;
  elsif new.status is distinct from old.status then new.is_read := new.status='read'; end if;
  return new;
end $$;
create trigger notification_sync_read before update on public.notifications for each row execute function notification_private.sync_read_state();

-- Role routing must not depend on a role that an employee can grant themselves.
create or replace function notification_private.guard_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor public.profiles;
begin
  if auth.uid() is null then
    if coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
    return case when tg_op='DELETE' then old else new end;
  end if;
  select * into actor from public.profiles where id=auth.uid();
  if actor.role in ('owner','admin') and actor.is_active is distinct from false and actor.company_id=coalesce(new.company_id,old.company_id) then
    if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'Company cannot be changed' using errcode='42501'; end if;
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op!='UPDATE' or old.id is distinct from auth.uid()
    or (to_jsonb(new)-array['full_name','phone','dashboard_layout','onboarding_completed','notify_action_required_only'])
      is distinct from (to_jsonb(old)-array['full_name','phone','dashboard_layout','onboarding_completed','notify_action_required_only'])
  then raise exception 'Only a company administrator can change access or another user' using errcode='42501'; end if;
  return new;
end $$;
create trigger notification_guard_profile before insert or update or delete on public.profiles for each row execute function notification_private.guard_profile();

-- Project membership is an authorization input. Only company administrators/PMs can change it.
create or replace function notification_private.guard_staff() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end; c uuid := (d->>'company_id')::uuid;
begin
  if not exists(select 1 from public.projects where id=(d->>'project_id')::uuid and company_id=c)
    or not exists(select 1 from public.profiles where id=(d->>'user_id')::uuid and company_id=c)
  then raise exception 'Project and recipient must belong to the same company' using errcode='23514'; end if;
  if auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and role in ('owner','admin','manager') and is_active is distinct from false)
  then raise exception 'Only company administrators or project managers can assign staff' using errcode='42501'; end if;
  if auth.uid() is null and coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger notification_guard_staff before insert or update or delete on public.project_staff for each row execute function notification_private.guard_staff();

create or replace function notification_private.emit(
 p_company uuid,p_event text,p_related text,p_id uuid,p_project uuid,p_targets uuid[],
 p_body text,p_dedupe text,p_actor uuid default auth.uid())
returns integer language plpgsql security definer set search_path='' as $$
declare r notification_private.event_rules; u record; n integer:=0; affected integer; link text; field_link text; targeted boolean;
begin
  select * into r from notification_private.event_rules where event_key=p_event;
  if not found or p_company is null or p_id is null then return 0; end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and company_id=p_company) then return 0; end if;
  link := case p_related
    when 'Quote' then '/QuoteBuilder?id='||p_id
    when 'ChangeOrder' then '/ChangeOrderBuilder?id='||p_id
    when 'Invoice' then '/InvoiceBuilder?id='||p_id
    when 'PurchaseOrder' then '/PurchaseOrderDetail?id='||p_id
    when 'Project' then '/PMProjectWorkspace?id='||p_id
    when 'Task' then '/Tasks?notificationTask='||p_id
    when 'ProjectTask' then '/Tasks?notificationTask='||p_id
    when 'TimeEntry' then '/HumanResources?tab=timesheets'
    when 'Expense' then '/HumanResources?tab=expenses'
    when 'Inventory' then '/Inventory?id='||p_id
    when 'Subcontractor' then '/Vendors'
    when 'User' then case when r.audience='personal' then '/EmployeePortal?tab=profile' else '/AdminSettings' end
    when 'Company' then '/AdminSettings'
    when 'Message' then '/ClientDetail?id='||p_id
    else case when p_project is not null then '/PMProjectWorkspace?id='||p_project||'&tab='||case when r.category in ('Daily Logs','Mentions') then 'daily-logs' when r.category='Documents' then 'quotes-docs' when r.category='Scheduling' then 'schedule' when r.category='Subcontractors' then 'subs' else 'overview' end else '/DailyLogs' end end;
  field_link := '/EmployeePortal?tab='||case
    when p_related in ('Task','ProjectTask') then 'tasks&notificationTask='||p_id
    when p_related='Project' then 'projects&notificationProject='||p_id
    when r.category='Scheduling' then 'schedule'||case when p_project is not null then '&notificationProject='||p_project else '' end||case when p_related='ProjectRecord' and p_event in ('schedule_added','schedule_changed','schedule_cancelled','schedule_tomorrow') then '&notificationEvent='||p_id else '' end
    when p_related='TimeEntry' then 'timesheets'
    when p_related='Expense' then 'expenses'
    when p_related='Inventory' then 'inventory'
    when r.category='Security' then 'profile'
    when r.category='Financial' and p_project is not null then 'projects&notificationProject='||p_project
    else 'daily_logs&notificationLog='||p_id end;
  for u in select id,role from public.profiles where company_id=p_company and is_active is distinct from false
  loop
    targeted := u.id=any(coalesce(p_targets,'{}'::uuid[]));
    if notification_private.eligible(u.id,p_company,p_event,p_project,targeted)
      and (u.id is distinct from p_actor or r.severity='Action Required' or r.audience='personal')
    then
      insert into public.notifications(company_id,user_id,type,event_key,dedupe_key,title,body,action_url,related_type,related_id,severity,category,metadata,is_read,status)
      values(p_company,u.id,p_event,p_event,p_dedupe,r.title,left(coalesce(p_body,''),2000),
        case when u.role in ('employee','subcontractor') then field_link else link end,
        p_related,p_id,r.severity,r.category,jsonb_build_object('project_id',p_project,'targeted',targeted,'employee_url',field_link),false,'unread')
      on conflict(user_id,event_key,dedupe_key) do nothing;
      get diagnostics affected=row_count; n:=n+affected;
    end if;
  end loop;
  return n;
end $$;
revoke all on function notification_private.emit(uuid,text,text,uuid,uuid,uuid[],text,text,uuid) from public,anon,authenticated;

-- Supabase Realtime still applies the recipient SELECT policy.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications')
  then alter publication supabase_realtime add table public.notifications; end if;
end $$;

create or replace function notification_private.targets(p_company uuid,p_value jsonb)
returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct p.id),'{}'::uuid[]) from public.profiles p
 where p.company_id=p_company and p.is_active is distinct from false and (
   case when jsonb_typeof(p_value)='array' then p_value else jsonb_build_array(p_value) end
 ) ? p.id::text or (p.company_id=p_company and p.is_active is distinct from false and (
   case when jsonb_typeof(p_value)='array' then p_value else jsonb_build_array(p_value) end
 ) ? p.email);
$$;
revoke all on function notification_private.targets(uuid,jsonb) from public,anon,authenticated;

create or replace function notification_private.row_event(d jsonb,t text,e text,proj uuid,recipients uuid[],label text,k text)
returns integer language plpgsql security definer set search_path='' as $$
declare related text;
begin
 related := case t when 'quotes' then 'Quote' when 'change_orders' then 'ChangeOrder'
  when 'invoices' then 'Invoice' when 'projects' then 'Project' when 'project_tasks' then 'ProjectTask'
  when 'tasks' then 'Task' when 'time_entries' then 'TimeEntry' when 'expenses' then 'Expense'
  when 'purchase_orders' then 'PurchaseOrder' when 'inventory' then 'Inventory'
  when 'subcontractors' then 'Subcontractor' when 'profiles' then 'User'
  when 'companies' then 'Company' else 'ProjectRecord' end;
 return notification_private.emit((d->>'company_id')::uuid,e,related,(d->>'id')::uuid,proj,recipients,label,k);
end $$;
revoke all on function notification_private.row_event(jsonb,text,text,uuid,uuid[],text,text) from public,anon,authenticated;

-- Identity is stored explicitly for new timesheets. Legacy names are matched only when unique within a company.
alter table public.change_orders add column if not exists budget_synced_at timestamptz;
alter table public.time_entries add column if not exists user_id uuid references public.profiles(id) on delete set null;
create index notification_timesheet_user on public.time_entries(company_id,user_id,date);
update public.time_entries t set user_id=p.id
from public.profiles p where p.company_id=t.company_id and p.full_name=t.employee_name
  and (select count(*) from public.profiles x where x.company_id=t.company_id and x.full_name=t.employee_name)=1;
alter table public.notes add column if not exists mention_user_ids uuid[] default '{}'::uuid[];
alter table public.project_daily_logs add column if not exists mention_user_ids uuid[] default '{}'::uuid[];
create or replace function notification_private.source_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare chosen uuid; c uuid := new.company_id;
begin
 if new.user_id is null then
   if auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and company_id=c and full_name=new.employee_name)
     then new.user_id:=auth.uid();
   elsif (select count(*) from public.profiles where company_id=c and full_name=new.employee_name)=1
     then select id into new.user_id from public.profiles where company_id=c and full_name=new.employee_name;
   end if;
 end if;
 if new.user_id is not null and not exists(select 1 from public.profiles where id=new.user_id and company_id=c)
   then raise exception 'Timesheet user must belong to the company' using errcode='23514'; end if;
 if auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role in ('employee','subcontractor'))
    and new.user_id is distinct from auth.uid() then raise exception 'You can only submit your own timesheet' using errcode='42501'; end if;
 return new;
end $$;
create trigger notification_timesheet_identity before insert or update on public.time_entries for each row execute function notification_private.source_identity();

create or replace function notification_private.source_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare
 d jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 o jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 c uuid := (d->>'company_id')::uuid; proj uuid := nullif(d->>'project_id','')::uuid;
 recipients uuid[] := '{}'::uuid[]; prior_recipients uuid[]; events text[] := '{}'; e text;
 label text := coalesce(d->>'title',d->>'name',d->>'file_name',d->>'employee_name',d->>'company_name','Activity update');
 prefix text; st text := lower(coalesce(d->>'status','')); previous text:=lower(coalesce(o->>'status',''));
 k text := tg_table_name||':'||(d->>'id')||':'||txid_current()::text;
 ref jsonb; amount numeric; target uuid;
begin
 if tg_table_name='companies' then c:=(d->>'id')::uuid; d:=d||jsonb_build_object('company_id',c); end if;
 if c is null then return case when tg_op='DELETE' then old else new end; end if;
 -- Do not create alerts in another tenant through a permissive legacy source-table policy.
 if auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and is_active is distinct from false)
   then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='DELETE' and tg_table_name!='profiles' then return old; end if;
 case tg_table_name
 when 'projects' then
   proj:=(d->>'id')::uuid;
   if tg_op='INSERT' then
     events:=array_append(events,'project_created');
     if d->>'quote_id' is not null then
       select to_jsonb(q) into ref from public.quotes q where id=(d->>'quote_id')::uuid and company_id=c;
       if found then perform notification_private.row_event(ref,'quotes','quote_converted',proj,'{}',label,k||':quote'); end if;
     end if;
   else
     if st is distinct from previous then events:=array_append(events,'project_status_changed'); end if;
     if (d->>'start_date',d->>'target_end_date') is distinct from (o->>'start_date',o->>'target_end_date') then events:=array_append(events,'project_dates_changed'); end if;
     if (d->>'budget',d->>'budget_revenue',d->>'budget_cost') is distinct from (o->>'budget',o->>'budget_revenue',o->>'budget_cost') then events:=array_append(events,'budget_updated'); end if;
     if coalesce((d->>'budget_revenue')::numeric,0)>0 and coalesce((o->>'budget_revenue')::numeric,0)>0
       and abs((1-coalesce((d->>'budget_cost')::numeric,0)/(d->>'budget_revenue')::numeric)-(1-coalesce((o->>'budget_cost')::numeric,0)/(o->>'budget_revenue')::numeric))>=0.05
       then events:=array_append(events,'margin_changed'); end if;
   end if;
 when 'project_staff' then
   if tg_op='INSERT' or (d->>'user_id',d->>'is_active',d->>'project_id') is distinct from (o->>'user_id',o->>'is_active',o->>'project_id') then
     if d->>'is_active' is distinct from 'false' then
       recipients:=array[(d->>'user_id')::uuid];
       select to_jsonb(p) into ref from public.projects p where id=proj and company_id=c;
       if found then perform notification_private.row_event(ref,'projects','project_assigned',proj,recipients,ref->>'name',k); end if;
     end if;
   end if;
 when 'tasks','project_tasks' then
   recipients:=notification_private.targets(c,d->'assigned_to');
   prior_recipients:=notification_private.targets(c,o->'assigned_to');
   if tg_op='INSERT' then
     events:=array_append(events,'task_created');
     if cardinality(recipients)>0 then perform notification_private.row_event(d,tg_table_name,'task_assigned',proj,recipients,label,k||':assigned'); end if;
   else
     if recipients is distinct from prior_recipients then
       perform notification_private.row_event(d,tg_table_name,'task_reassigned',proj,recipients||prior_recipients,label,k||':reassigned');
       if cardinality(recipients)>0 then perform notification_private.row_event(d,tg_table_name,'task_assigned',proj,recipients,label,k||':assigned'); end if;
     end if;
     if st in ('done','completed','complete') and st is distinct from previous then events:=array_append(events,'task_completed'); end if;
   end if;
 when 'quotes','change_orders','invoices','purchase_orders' then
   if d->>'is_template'='true' then return new; end if;
   prefix:=case tg_table_name when 'quotes' then 'quote' when 'change_orders' then 'co' when 'invoices' then 'invoice' else 'po' end;
   label:=coalesce(d->>'quote_number',d->>'change_order_number',d->>'invoice_number',d->>'po_number','')||' '||label;
   if tg_op='INSERT' then events:=array_append(events,prefix||'_created'); end if;
   if st is distinct from previous then
     if st in ('approved','accepted') and prefix in ('quote','co','po') then events:=array_append(events,prefix||'_approved');
     elsif st in ('declined','rejected') and prefix in ('quote','co') then events:=array_append(events,prefix||'_declined');
     elsif st in ('sent','issued') and prefix in ('quote','invoice') then events:=array_append(events,prefix||'_sent');
     elsif st in ('pending approval','awaiting approval','pending review','under review') and prefix in ('quote','co') then events:=array_append(events,prefix||'_review');
     elsif st='expired' and prefix='quote' then events:=array_append(events,'quote_expired');
     elsif st in ('failed','payment failed') and prefix='invoice' then events:=array_append(events,'payment_failed');
     end if;
   end if;
   if tg_op='UPDATE' then
     if (d->>'title',d->>'total',d->>'description',d->>'overall_scope') is distinct from (o->>'title',o->>'total',o->>'description',o->>'overall_scope')
       and st=previous then events:=array_append(events,case when prefix='po' then 'po_changed' else prefix||'_revised' end); end if;
     if prefix='co' and d->>'budget_synced_at' is not null and d->>'budget_synced_at' is distinct from o->>'budget_synced_at' then events:=array_append(events,'co_added_to_total'); end if;
     if prefix='quote' and d->>'client_selected_items_json' is distinct from o->>'client_selected_items_json' and st=previous then events:=array_append(events,'quote_selection_changed'); end if;
     if prefix='po' and d->>'actual_delivery_date' is not null and o->>'actual_delivery_date' is null then events:=array_append(events,'material_ready'); end if;
     if prefix='invoice' and coalesce((d->>'amount_paid')::numeric,0)>coalesce((o->>'amount_paid')::numeric,0) then
       events:=array_append(events,case when (d->>'amount_paid')::numeric>=coalesce((d->>'total')::numeric,0) then 'payment_received' else 'partial_payment_received' end);
     end if;
   end if;
 when 'payments' then
   select to_jsonb(i) into ref from public.invoices i where id=(d->>'invoice_id')::uuid and company_id=c;
   if found and tg_op='INSERT' and coalesce((d->>'amount')::numeric,0)>0 then
     -- Payment insert and invoice balance update share the same paid-total bucket.
     select coalesce(sum(p.amount),0) into amount from public.payments p where p.invoice_id=(ref->>'id')::uuid and p.company_id=c;
     e:=case when greatest(amount,coalesce((ref->>'amount_paid')::numeric,0))>=coalesce((ref->>'total')::numeric,0) then 'payment_received' else 'partial_payment_received' end;
     perform notification_private.row_event(ref,'invoices',e,nullif(ref->>'project_id','')::uuid,'{}',coalesce(ref->>'invoice_number','Invoice')||': payment recorded', 'invoice-payment:'||(ref->>'id')||':'||round(greatest(amount,coalesce((ref->>'amount_paid')::numeric,0)),2)::text);
   end if;
 when 'schedule_jobs' then
   if tg_op='INSERT' then events:=array_append(events,'schedule_added');
   elsif st in ('cancelled','canceled') and st is distinct from previous then events:=array_append(events,'schedule_cancelled');
   elsif (d->>'start_date_time',d->>'end_date_time',d->>'title',st) is distinct from (o->>'start_date_time',o->>'end_date_time',o->>'title',previous) then events:=array_append(events,'schedule_changed'); end if;
 when 'project_subcontractors' then
   if tg_op='INSERT' and d->>'scheduled_start' is not null then events:=array_append(events,'trade_scheduled');
   elsif (d->>'scheduled_start',d->>'scheduled_end') is distinct from (o->>'scheduled_start',o->>'scheduled_end') then events:=array_append(events,'trade_rescheduled'); end if;
   if st is distinct from previous then
     if st in ('accepted','confirmed') then events:=array_append(events,'subcontractor_accepted');
     elsif st in ('declined','rejected') then events:=array_append(events,'subcontractor_declined');
     elsif st in ('complete','completed','done') then events:=array_append(events,'subcontractor_complete'); end if;
   end if;
 when 'project_milestones' then
   if st in ('complete','completed','done') and st is distinct from previous then events:=array_append(events,'project_milestone_completed'); end if;
 when 'project_daily_logs' then
   if tg_op='INSERT' and proj is not null and lower(coalesce(d->>'category','')) in ('general','email','call','meeting') then events:=array_append(events,'project_comment'); end if;
   if tg_op='INSERT' and jsonb_array_length(coalesce(d->'mention_user_ids','[]'::jsonb))>0 then
     recipients:=notification_private.targets(c,d->'mention_user_ids');
     select coalesce(array_agg(p.id),'{}') into recipients from public.profiles p where p.id=any(recipients) and (
       p.role in ('owner','admin','office') or (proj is not null and exists(select 1 from public.project_staff s where s.user_id=p.id and s.company_id=c and s.project_id=proj and s.is_active is distinct from false)));
     perform notification_private.row_event(d,tg_table_name,'mentioned',proj,recipients,left(coalesce(d->>'summary',''),2000),k||':mention');
   end if;
   if lower(coalesce(d->>'category','')) in ('work completed','work complete','completed') and tg_op='INSERT' then events:=array_append(events,'work_completed_today'); end if;
   label:=coalesce(d->>'summary','Daily log')||' ('||coalesce(d->>'date','')||')';
   if tg_op='INSERT' then events:=array_append(events,'daily_log_submitted'); end if;
   if nullif(d->>'safety_concerns','') is not null and d->>'safety_concerns' is distinct from o->>'safety_concerns' then events:=array_append(events,'safety_concern'); end if;
   if nullif(d->>'blockers','') is not null and d->>'blockers' is distinct from o->>'blockers' then events:=array_append(events,'site_issue_reported'); end if;
   if coalesce(jsonb_array_length(case when jsonb_typeof(d->'photos')='array' then d->'photos' else '[]'::jsonb end),0)>coalesce(jsonb_array_length(case when jsonb_typeof(o->'photos')='array' then o->'photos' else '[]'::jsonb end),0) then events:=array_append(events,'daily_log_photos'); end if;
   if lower(coalesce(d->>'weather','')||' '||coalesce(d->>'blockers','')) ~ '(weather|rain|snow|wind).*(delay|stop)' then events:=array_append(events,'weather_delay'); end if;
 when 'project_issues' then
   label:=coalesce(d->>'title','Project issue');
   if tg_op='INSERT' then events:=array_append(events,'site_issue_reported');
   elsif st in ('resolved','closed','completed','done') and st is distinct from previous then events:=array_append(events,'deficiency_completed'); end if;
 when 'time_entries' then
   recipients:=array_remove(array[nullif(d->>'user_id','')::uuid],null);
   label:=coalesce(d->>'employee_name','Team member')||': '||coalesce(d->>'date','')||' ('||coalesce(d->>'total_hours','0')||' hours)';
   if st in ('pending','submitted','under review') and (tg_op='INSERT' or st is distinct from previous or (d->>'clock_out' is not null and o->>'clock_out' is null)) then events:=array_append(events,'timesheet_submitted');
   elsif st='approved' and st is distinct from previous then events:=array_append(events,'timesheet_approved');
   elsif st='rejected' and st is distinct from previous then events:=array_append(events,'timesheet_rejected'); end if;
 when 'expenses' then
   recipients:=array_remove(array[nullif(d->>'user_id','')::uuid],null);
   if st in ('submitted','pending','under review') and (tg_op='INSERT' or st is distinct from previous) then events:=array_append(events,'expense_submitted');
   elsif st='approved' and st is distinct from previous then events:=array_append(events,'expense_approved');
   elsif st='rejected' and st is distinct from previous then events:=array_append(events,'expense_rejected'); end if;
   if proj is not null and (tg_op='INSERT' or d->>'amount' is distinct from o->>'amount') then events:=array_append(events,'profit_changed'); end if;
 when 'project_documents','company_resources','contractor_portal_files','project_permits','attachments' then
   if tg_table_name='attachments' then
     if lower(coalesce(d->>'related_type',''))='project' then proj:=(d->>'related_id')::uuid; else return new; end if;
   end if;
   if tg_op='INSERT' then
     events:=array_append(events,case when tg_table_name='project_permits' then 'permit_uploaded' when lower(coalesce(d->>'doc_type','')) like '%inspection%' then 'inspection_report_uploaded' else 'document_uploaded' end);
   elsif (d->>'file_name',d->>'file_url') is distinct from (o->>'file_name',o->>'file_url') then events:=array_append(events,'document_updated'); end if;
 when 'project_timeline_events' then
   if tg_op='INSERT' and lower(coalesce(d->>'category','')) like '%inspection%' then events:=array_append(events,'inspection_scheduled');
   elsif tg_op='INSERT' and lower(label) like '%site meeting%' then events:=array_append(events,'site_meeting_scheduled'); end if;
 when 'project_materials' then
   if st is distinct from previous then
     if st in ('received','picked up','ready','delivered') then events:=array_append(events,'material_ready');
     elsif st in ('backordered','backorder','unavailable','out of stock') then events:=array_append(events,'material_backordered'); end if;
   end if;
 when 'subcontractors' then if tg_op='INSERT' then events:=array_append(events,'subcontractor_added'); end if;
 when 'vendor_requests' then
   if tg_op='INSERT' then events:=array_append(events,'subcontractor_invited');
   elsif st is distinct from previous and st in ('received','quoted','responded') then events:=array_append(events,'subcontractor_quote'); end if;
 when 'inventory' then
   amount:=coalesce((d->>'quantity_on_hand')::numeric,0);
   if amount<=0 and (tg_op='INSERT' or coalesce((o->>'quantity_on_hand')::numeric,0)>0) then events:=array_append(events,'inventory_out');
   elsif amount>0 and amount<=coalesce((d->>'reorder_point')::numeric,0) and (tg_op='INSERT' or coalesce((o->>'quantity_on_hand')::numeric,0)>coalesce((d->>'reorder_point')::numeric,0)) then events:=array_append(events,'inventory_low'); end if;
 when 'inventory_transactions' then
   select to_jsonb(i) into ref from public.inventory i where id=(d->>'inventory_id')::uuid and company_id=c;
   if found and tg_op='INSERT' then
     e:=case lower(coalesce(d->>'transaction_type','')) when 'received' then 'inventory_received' when 'receive' then 'inventory_received' when 'consume' then 'inventory_assigned' when 'return' then 'inventory_returned' when 'returned' then 'inventory_returned' when 'assigned' then 'inventory_assigned' when 'checkout' then 'inventory_assigned' else 'inventory_adjusted' end;
     perform notification_private.row_event(ref,'inventory',e,null,'{}',ref->>'name',k);
   end if;
 when 'notes' then
   if lower(coalesce(d->>'related_type',''))='project' then proj:=(d->>'related_id')::uuid; events:=array_append(events,'project_comment'); end if;
   if tg_op='INSERT' and jsonb_array_length(coalesce(d->'mention_user_ids','[]'::jsonb))>0 then
     recipients:=notification_private.targets(c,d->'mention_user_ids');
     select coalesce(array_agg(p.id),'{}') into recipients from public.profiles p where p.id=any(recipients) and (
       p.role in ('owner','admin','office') or (proj is not null and exists(select 1 from public.project_staff s where s.user_id=p.id and s.company_id=c and s.project_id=proj and s.is_active is distinct from false)));
     perform notification_private.row_event(d,tg_table_name,'mentioned',proj,recipients,left(coalesce(d->>'content',''),2000),k||':mention');
   end if;
   label:=left(coalesce(d->>'content','Project comment'),2000);
 when 'messages' then
   if tg_op='INSERT' and lower(coalesce(d->>'sender_type','')) in ('client','customer') then
     if exists(select 1 from public.clients where id=(d->>'client_id')::uuid and company_id=c) then
       perform notification_private.emit(c,'client_message','Message',(d->>'client_id')::uuid,null,'{}',coalesce(d->>'subject','Message from client'),k);
     end if;
   end if;
 when 'team_invites' then if tg_op='INSERT' then events:=array_append(events,'user_invited'); end if;
 when 'profiles' then
   recipients:=array[(d->>'id')::uuid];
   if tg_op='INSERT' then events:=array_append(events,'user_added');
     if exists(select 1 from public.team_invites i where i.company_id=c and lower(i.email)=lower(d->>'email')) then events:=array_append(events,'invitation_accepted'); end if;
   elsif tg_op='DELETE' or (d->>'is_active'='false' and o->>'is_active' is distinct from 'false') then events:=array_append(events,'user_removed');
   elsif (d->>'role',d->'permissions') is distinct from (o->>'role',o->'permissions') then
     events:=array_append(events,'role_changed');
     if d->>'role' in ('admin','owner') and o->>'role' not in ('admin','owner') then events:=array_append(events,'administrator_granted'); end if;
   end if;
 when 'companies' then
   if tg_op='UPDATE' then
     if d->'settings' is distinct from o->'settings' then events:=array_append(events,'company_settings_changed'); end if;
     if (d->>'plan_id',d->>'subscription_status') is distinct from (o->>'plan_id',o->>'subscription_status') then events:=array_append(events,'billing_plan_changed'); end if;
     if d->>'subscription_status' in ('past_due','unpaid') and d->>'subscription_status' is distinct from o->>'subscription_status' then events:=array_append(events,'subscription_payment_failed'); end if;
   end if;
 else null;
 end case;
 foreach e in array events loop
   perform notification_private.row_event(d,tg_table_name,e,proj,recipients,label,
     case when tg_table_name='invoices' and e in ('payment_received','partial_payment_received') then 'invoice-payment:'||(d->>'id')||':'||round((d->>'amount_paid')::numeric,2)::text
       else k||':'||e end);
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function notification_private.source_event() from public,anon,authenticated;

-- Replace incomplete legacy creation alerts; leave configured outbound integrations intact.
do $$ declare r record; t text; begin
 for r in select tgname,relname from pg_trigger join pg_class on pg_class.oid=tgrelid
   join pg_proc on pg_proc.oid=tgfoid where proname='process_in_app_notifications' and not tgisinternal
 loop execute format('drop trigger %I on public.%I',r.tgname,r.relname); end loop;
 foreach t in array array['projects','project_staff','tasks','project_tasks','quotes','change_orders','invoices',
 'payments','purchase_orders','schedule_jobs','project_subcontractors','project_milestones','project_daily_logs',
 'project_issues','time_entries','expenses','project_documents','company_resources','contractor_portal_files',
 'project_permits','attachments','project_timeline_events','project_materials','subcontractors','vendor_requests',
 'inventory','inventory_transactions','notes','messages','team_invites','profiles','companies'] loop
   execute format('create trigger notification_events after insert or update on public.%I for each row execute function notification_private.source_event()',t);
 end loop;
 create trigger notification_user_removed after delete on public.profiles for each row execute function notification_private.source_event();
end $$;

create or replace function notification_private.reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare co record; tz text; today date; yesterday date; r record; d jsonb; event text; n integer:=0; total numeric; allowance numeric; ids uuid[]; local_hour integer;
begin
 for co in select id,timezone,settings from public.companies loop
   select name into tz from pg_timezone_names where name=co.timezone limit 1;
   tz:=coalesce(tz,'America/Edmonton'); today:=(p_now at time zone tz)::date;
   local_hour:=extract(hour from p_now at time zone tz); yesterday:=today-1;
   if local_hour<8 then continue; end if;
   for r in
     select 'tasks' as source,to_jsonb(t) as doc,(t.due_date at time zone tz)::date as due from public.tasks t
       where t.company_id=co.id and t.due_date is not null and lower(coalesce(t.status,'')) not in ('done','completed','complete','cancelled','canceled')
     union all select 'project_tasks',to_jsonb(t),t.due_date_target from public.project_tasks t
       where t.company_id=co.id and t.due_date_target is not null and lower(coalesce(t.status,'')) not in ('done','completed','complete','cancelled','canceled')
   loop
     if r.due<=today then
       event:=case when r.due=today then 'task_due_today' else 'task_overdue' end;
       n:=n+notification_private.row_event(r.doc,r.source,event,nullif(r.doc->>'project_id','')::uuid,
         notification_private.targets(co.id,r.doc->'assigned_to'),coalesce(r.doc->>'title','Task')||': due '||r.due,
         event||':'||(r.doc->>'id')||':'||r.due);
     end if;
   end loop;
   for r in select to_jsonb(i) as doc,i.due_date from public.invoices i where i.company_id=co.id and i.due_date<=today+3
     and coalesce(i.total,0)>coalesce(i.amount_paid,0) and lower(coalesce(i.status,'')) not in ('draft','cancelled','canceled','void','paid') loop
     event:=case when r.due_date<today then 'invoice_overdue' else 'invoice_due_soon' end;
     n:=n+notification_private.row_event(r.doc,'invoices',event,nullif(r.doc->>'project_id','')::uuid,'{}',coalesce(r.doc->>'invoice_number','Invoice')||': due '||r.due_date,event||':'||(r.doc->>'id')||':'||r.due_date);
   end loop;
   for r in select to_jsonb(q) as doc,q.expiry_date from public.quotes q where q.company_id=co.id and q.expiry_date<today and q.is_template is distinct from true
     and lower(coalesce(q.status,'')) in ('sent','viewed','pending','expired') loop
     n:=n+notification_private.row_event(r.doc,'quotes','quote_expired',null,'{}',coalesce(r.doc->>'quote_number','Quote')||': expired '||r.expiry_date,'quote_expired:'||(r.doc->>'id')||':'||r.expiry_date);
   end loop;
   for r in select to_jsonb(j) as doc from public.schedule_jobs j where j.company_id=co.id
     and (j.start_date_time at time zone tz)::date=today+1 and lower(coalesce(j.status,'')) not in ('cancelled','canceled','completed','done') loop
     n:=n+notification_private.row_event(r.doc,'schedule_jobs','schedule_tomorrow',(r.doc->>'project_id')::uuid,'{}',coalesce(r.doc->>'title','Scheduled work')||': tomorrow', 'schedule_tomorrow:'||(r.doc->>'id')||':'||(today+1));
   end loop;
   for r in select to_jsonb(s) as doc from public.subcontractors s where s.company_id=co.id and s.is_active is distinct from false
     and s.insurance_expiry<=today+30 loop
     n:=n+notification_private.row_event(r.doc,'subcontractors','subcontractor_insurance_expiring',null,'{}',coalesce(r.doc->>'company_name','Subcontractor')||': insurance expires '||(r.doc->>'insurance_expiry'),'subcontractor_insurance:'||(r.doc->>'id')||':'||(r.doc->>'insurance_expiry'));
   end loop;
   -- Missing submissions require explicit resource allocation AND scheduled work. Never assume every employee worked.
   for r in select distinct a.user_id,a.project_id,p.full_name from public.resource_allocations a
     join public.profiles p on p.id=a.user_id and p.company_id=a.company_id
     join public.projects pr on pr.id=a.project_id and pr.company_id=a.company_id
     where a.company_id=co.id and a.start_date<=yesterday and a.end_date>=yesterday and a.allocation_percentage>0
       and p.is_active is distinct from false and p.role in ('employee','subcontractor')
       and exists(select 1 from public.schedule_jobs j where j.company_id=co.id and j.project_id=a.project_id
         and (j.start_date_time at time zone tz)::date<=yesterday and (j.end_date_time at time zone tz)::date>=yesterday
         and lower(coalesce(j.status,'')) not in ('cancelled','canceled'))
   loop
     if not exists(select 1 from public.time_entries t where t.company_id=co.id and t.user_id=r.user_id and t.date=yesterday) then
       n:=n+notification_private.emit(co.id,'timesheet_missing','TimeEntry',r.user_id,r.project_id,array[r.user_id],'Submit your timesheet for '||yesterday,'timesheet_missing:'||r.user_id||':'||yesterday);
     end if;
     if not exists(select 1 from public.project_daily_logs l where l.company_id=co.id and l.project_id=r.project_id and l.user_id=r.user_id and l.date=yesterday) then
       n:=n+notification_private.emit(co.id,'daily_log_missing','ProjectRecord',r.project_id,r.project_id,array[r.user_id],'Submit your daily log for '||yesterday,'daily_log_missing:'||r.user_id||':'||r.project_id||':'||yesterday);
     end if;
   end loop;
   if extract(isodow from today)=1 and exists(select 1 from public.time_entries t where t.company_id=co.id and t.date>=today-7 and t.date<today and lower(t.status)='approved') then
     n:=n+notification_private.emit(co.id,'weekly_payroll_ready','TimeEntry',co.id,null,'{}','Approved hours for the week ending '||(today-1)||' are ready for payroll review.','payroll:'||co.id||':'||today);
   end if;
   for r in select to_jsonb(p) as doc from public.projects p where p.company_id=co.id and lower(coalesce(p.status,'')) not in ('closed','cancelled','completed','archived') loop
     d:=r.doc;
     allowance:=coalesce(nullif((d->>'budget_cost')::numeric,0),nullif((d->>'budget')::numeric,0),0);
     select coalesce(sum(e.amount),0) into total from public.expenses e where e.company_id=co.id and e.project_id=(d->>'id')::uuid and lower(e.status)='approved';
     if allowance>0 and total>=allowance*0.9 then
       event:=case when total>allowance then 'budget_exceeded' else 'budget_approaching' end;
       n:=n+notification_private.row_event(d,'projects',event,(d->>'id')::uuid,'{}',coalesce(d->>'name','Project')||': approved expenses have reached '||round(total/allowance*100)||'% of the cost budget.',event||':'||(d->>'id')||':'||allowance);
     end if;
     select coalesce(sum(t.estimated_hours),0) into allowance from public.project_tasks t where t.company_id=co.id and t.project_id=(d->>'id')::uuid;
     select coalesce(sum(t.total_hours),0) into total from public.time_entries t where t.company_id=co.id and t.project_id=(d->>'id')::uuid and lower(t.status)='approved';
     if allowance>0 and total>=allowance*0.9 then
       event:=case when total>allowance then 'labour_allowance_exceeded' else 'labour_allowance_approaching' end;
       n:=n+notification_private.row_event(d,'projects',event,(d->>'id')::uuid,'{}',coalesce(d->>'name','Project')||': approved labour has reached '||round(total/allowance*100)||'% of estimated task hours.',event||':'||(d->>'id')||':'||allowance);
     end if;
   end loop;
 end loop;
 return n;
end $$;
revoke all on function notification_private.reminders(timestamptz) from public,anon,authenticated;
-- Existing email reminder jobs are independent; this job writes only private in-app notifications.
select cron.schedule('fuzedflow-in-app-reminders','10 * * * *','select notification_private.reminders();');

-- This API is service-only. The edge function validates portal documents or the authenticated tenant.
create or replace function notification_private.document_event(p_event text,p_document uuid,p_company uuid,p_message text)
returns integer language plpgsql security definer set search_path='' as $$
declare d jsonb; t text; e text:=p_event;
begin
 if p_event in ('quote_viewed','quote_change_requested','quote_change_request') then t:='quotes'; if e='quote_change_request' then e:='quote_change_requested'; end if;
 elsif p_event in ('co_viewed','change_order_requested') then t:='change_orders';
 elsif p_event='invoice_viewed' then t:='invoices';
 else raise exception 'Unsupported portal event' using errcode='22023'; end if;
 execute format('select to_jsonb(d) from public.%I d where id=$1 and company_id=$2',t) into d using p_document,p_company;
 if d is null then raise exception 'Document not found' using errcode='22023'; end if;
 if lower(coalesce(d->>'status','')) in ('draft','cancelled','canceled','void') then raise exception 'Document is not shared' using errcode='42501'; end if;
 -- Serialize repeated loads; identical requests/view refreshes produce one alert each day.
 perform pg_advisory_xact_lock(hashtextextended(p_event||p_document::text,0));
 return notification_private.row_event(d,t,e,nullif(d->>'project_id','')::uuid,'{}',
  case when p_event like '%viewed' then coalesce(d->>'quote_number',d->>'change_order_number',d->>'invoice_number','Document')||' was viewed by a client.'
    else left(coalesce(p_message,'Client requested changes'),2000) end,
  'portal:'||e||':'||p_document||':'||current_date::text||
  case when p_event like '%viewed' then '' else ':'||md5(left(coalesce(p_message,''),2000)) end);
end $$;
revoke all on function notification_private.document_event(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function notification_private.document_event(text,uuid,uuid,text) to service_role;
create or replace function public.record_document_notification(p_event text,p_document uuid,p_company uuid,p_message text default '')
returns integer language sql security invoker set search_path='' as $$
 select notification_private.document_event(p_event,p_document,p_company,p_message);
$$;
revoke all on function public.record_document_notification(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_document_notification(text,uuid,uuid,text) to service_role;

create or replace function notification_private.security_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 o jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 uid uuid; c uuid; e text; events text[]:='{}'; label text;
begin
 uid:=case when tg_table_name='users' then (d->>'id')::uuid else (d->>'user_id')::uuid end;
 select company_id into c from public.profiles where id=uid and is_active is distinct from false;
 if c is null then return case when tg_op='DELETE' then old else new end; end if;
 if tg_table_name='users' then
   if tg_op='UPDATE' and d->>'encrypted_password' is distinct from o->>'encrypted_password' and nullif(o->>'encrypted_password','') is not null then events:=array_append(events,'password_changed'); end if;
   if tg_op='UPDATE' and d->>'email' is distinct from o->>'email' then events:=array_append(events,'email_changed'); end if;
 elsif tg_table_name='sessions' then
   if tg_op='INSERT' and nullif(d->>'user_agent','') is not null
     and exists(select 1 from auth.sessions s where s.user_id=uid and s.id!=(d->>'id')::uuid)
     and not exists(select 1 from auth.sessions s where s.user_id=uid and s.id!=(d->>'id')::uuid and s.user_agent=d->>'user_agent')
     then events:=array_append(events,'new_device_login'); end if;
 elsif tg_table_name='mfa_factors' then
   if (tg_op='DELETE' and o->>'status'='verified') or (d->>'status'='verified' and (tg_op='INSERT' or o->>'status' is distinct from 'verified'))
     then events:=array_append(events,'two_factor_changed'); end if;
 end if;
 foreach e in array events loop
   perform notification_private.emit(c,e,'User',uid,null,array[uid],case when e='new_device_login' then 'A sign-in used a browser/device signature not found in your recent sessions. If this was unexpected, review your account.' else 'Your account security settings changed. If this was unexpected, review your account.' end,
     'security:'||e||':'||(d->>'id')||':'||txid_current()::text,null);
 end loop;
 return case when tg_op='DELETE' then old else new end;
exception when others then
 -- Notification availability must never prevent login, account recovery, or MFA changes.
 raise warning 'Security notification delivery failed: %',sqlstate;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function notification_private.security_event() from public,anon,authenticated;
create trigger notification_account_security after update on auth.users for each row execute function notification_private.security_event();
create trigger notification_session_security after insert on auth.sessions for each row execute function notification_private.security_event();
create trigger notification_mfa_security after insert or update or delete on auth.mfa_factors for each row execute function notification_private.security_event();

-- No direct API execution of trigger helpers.
revoke all on function notification_private.guard_profile(),notification_private.guard_staff(),
 notification_private.source_identity(),notification_private.sync_read_state() from public,anon,authenticated;

create table notification_private.portal_deliveries (
  company_id uuid not null, document_id uuid not null, event_key text not null,
  delivery_day date not null default current_date, fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key(company_id,document_id,event_key,delivery_day,fingerprint)
);
revoke all on notification_private.portal_deliveries from public,anon,authenticated;
create or replace function notification_private.claim_delivery(p_company uuid,p_document uuid,p_event text,p_message text)
returns boolean language plpgsql security definer set search_path='' as $$
declare count_today integer; affected integer;
begin
 if p_event not in ('quote_viewed','quote_approved','quote_change_requested','co_viewed','co_approved','change_order_requested','invoice_viewed','payment_received','partial_payment_received','payment_failed','po_viewed') then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_document::text||p_event,0));
 select count(*) into count_today from notification_private.portal_deliveries where company_id=p_company and document_id=p_document and event_key=p_event and delivery_day=current_date;
 if count_today>=10 then return false; end if;
 insert into notification_private.portal_deliveries(company_id,document_id,event_key,fingerprint)
 values(p_company,p_document,p_event,case when p_event like '%requested' then md5(left(coalesce(p_message,''),2000)) else '' end)
 on conflict do nothing;
 get diagnostics affected=row_count;
 return affected=1;
end $$;
revoke all on function notification_private.claim_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function notification_private.claim_delivery(uuid,uuid,text,text) to service_role;
create or replace function public.claim_notification_delivery(p_company uuid,p_document uuid,p_event text,p_message text default '')
returns boolean language sql security invoker set search_path='' as $$
 select notification_private.claim_delivery(p_company,p_document,p_event,p_message);
$$;
revoke all on function public.claim_notification_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_notification_delivery(uuid,uuid,text,text) to service_role;
create or replace function notification_private.guard_invite() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
 if auth.uid() is null then
   if coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Authentication required' using errcode='42501'; end if;
 else
   if not exists(select 1 from public.profiles where id=auth.uid() and company_id=(d->>'company_id')::uuid and role in ('owner','admin') and is_active is distinct from false)
   then raise exception 'Only company administrators can invite users' using errcode='42501'; end if;
 end if;
 if tg_op!='DELETE' and new.role not in ('owner','admin','manager','office','employee','subcontractor') then raise exception 'Invalid role' using errcode='23514'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function notification_private.guard_invite() from public,anon,authenticated;
create trigger notification_guard_invite before insert or update or delete on public.team_invites for each row execute function notification_private.guard_invite();
alter table public.project_staff enable row level security;
create policy notification_staff_tenant on public.project_staff as restrictive for all to public
using (company_id=(select public.get_auth_company_id()))
with check (company_id=(select public.get_auth_company_id()));

-- Claim and creation share one transaction so a retry can recover from a database failure.
create or replace function notification_private.portal_event(p_company uuid,p_document uuid,p_event text,p_message text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not notification_private.claim_delivery(p_company,p_document,p_event,p_message) then return false; end if;
 perform notification_private.document_event(p_event,p_document,p_company,p_message);
 return true;
end $$;
revoke all on function notification_private.portal_event(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function notification_private.portal_event(uuid,uuid,text,text) to service_role;
create or replace function public.process_portal_notification(p_company uuid,p_document uuid,p_event text,p_message text default '')
returns boolean language sql security invoker set search_path='' as $$
 select notification_private.portal_event(p_company,p_document,p_event,p_message);
$$;
revoke all on function public.process_portal_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.process_portal_notification(uuid,uuid,text,text) to service_role;
-- Opens a mentioned log without giving field users a new broad log listing endpoint.
create or replace function public.get_notified_daily_log(p_log uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(l) from public.project_daily_logs l
 where l.id=p_log and exists (
   select 1 from public.notifications n where n.related_id=l.id and n.company_id=l.company_id
     and n.user_id=(select auth.uid()) and n.event_key in ('mentioned','project_comment')
 );
$$;
revoke all on function public.get_notified_daily_log(uuid) from public,anon;
grant execute on function public.get_notified_daily_log(uuid) to authenticated;
