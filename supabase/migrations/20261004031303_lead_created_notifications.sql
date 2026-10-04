-- Leads require follow-up, including when created by the recipient.
insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module)
values('lead_created','New lead created','Action Required','Leads',
  array['owner','admin','manager','office'],'leadership','leads')
on conflict(event_key) do update set title=excluded.title,severity=excluded.severity,
  category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;

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
    when 'Lead' then '/LeadDetail?id='||p_id
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


-- Private helper is shared by the trigger and controlled recovery of missed alerts.
create or replace function notification_private.lead_created(p_lead uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare l public.leads;
begin
  select * into l from public.leads where id=p_lead;
  if not found or l.company_id is null then return 0; end if;
  if auth.uid() is not null and not exists (
    select 1 from public.profiles where id=auth.uid() and company_id=l.company_id
      and is_active is distinct from false
  ) then return 0; end if;
  if auth.uid() is null and coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated')
    then return 0; end if;
  return notification_private.emit(l.company_id,'lead_created','Lead',l.id,null,'{}',
    coalesce(nullif(l.contact_name,''),'New lead')||': review the enquiry and arrange follow-up.',
    'lead_created:'||l.id::text);
end $$;
revoke all on function notification_private.lead_created(uuid) from public,anon,authenticated;

create or replace function notification_private.lead_created_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform notification_private.lead_created(new.id);
  return new;
end $$;
revoke all on function notification_private.lead_created_trigger() from public,anon,authenticated;

drop trigger if exists notification_lead_created on public.leads;
create trigger notification_lead_created after insert on public.leads
for each row execute function notification_private.lead_created_trigger();
