-- Enrich future notifications from saved records and trusted tenant identities.
-- Historical notifications retain their original actor and wording.
create or replace function notification_private.presentation(
 p_company uuid,p_event text,p_related text,p_id uuid,p_project uuid,p_body text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid; actor_name text; entity_name text; noun text; action text; source_table text;
 d jsonb; client_name text; tz text; happened timestamptz:=statement_timestamp(); rendered text; rule_title text;
begin
 select name into tz from pg_timezone_names where name=(select timezone from public.companies where id=p_company);
 tz:=coalesce(tz,'America/Edmonton');
 actor_id:=coalesce(auth.uid(),p_actor);
 select nullif(trim(full_name),'') into actor_name from public.profiles
 where id=actor_id and company_id=p_company and is_active is distinct from false;
 if actor_name is null then actor_id:=null; actor_name:='Fuzed Flow'; end if;
 source_table:=case p_related when 'Lead' then 'leads' when 'Quote' then 'quotes' when 'ChangeOrder' then 'change_orders'
 when 'Invoice' then 'invoices' when 'Project' then 'projects' when 'Task' then 'tasks' when 'ProjectTask' then 'project_tasks'
 when 'PurchaseOrder' then 'purchase_orders' when 'Inventory' then 'inventory' when 'Subcontractor' then 'subcontractors'
 when 'Vendor' then 'vendors' when 'User' then 'profiles' when 'Company' then 'companies' when 'Message' then 'clients'
 when 'WarrantyClaim' then 'warranty_claims' when 'DocumentRequest' then 'document_requests' when 'ProjectPlan' then 'project_drawings'
 when 'Permit' then 'project_permits' when 'Material' then 'project_materials' when 'Trade' then 'project_subcontractors'
 when 'Reservation' then 'inventory_reservations' when 'TimeEntry' then 'time_entries' when 'Expense' then 'expenses'
 when 'LeaveRequest' then 'time_off_requests' when 'SupportTicket' then 'support_tickets' when 'ProjectPhase' then 'project_phases' when 'ProjectStaff' then 'project_staff'
 when 'Announcement' then 'platform_announcements' else null end;
 if source_table is not null and to_regclass('public.'||source_table) is not null then
  if p_related='Announcement' then select to_jsonb(a) into d from public.platform_announcements a where id=p_id;
  elsif p_related='Company' then select to_jsonb(c) into d from public.companies c where id=p_id and id=p_company;
  else execute format('select to_jsonb(t) from public.%I t where id=$1 and company_id=$2',source_table) into d using p_id,p_company; end if;
 end if;
 if d is null and p_related='Trade' then select to_jsonb(r) into d from public.vendor_requests r where id=p_id and company_id=p_company; end if;
 if d is null and p_project is not null then select to_jsonb(p) into d from public.projects p where id=p_project and company_id=p_company; end if;
 entity_name:=coalesce(nullif(d->>'contact_name',''),nullif(d->>'title',''),nullif(d->>'name',''),nullif(d->>'subject',''),
  nullif(d->>'file_name',''),nullif(d->>'quote_number',''),nullif(d->>'invoice_number',''),nullif(d->>'change_order_number',''),
  nullif(d->>'po_number',''),nullif(d->>'company_name',''),nullif(d->>'full_name',''),nullif(d->>'employee_name',''));
 if p_related='Reservation' and nullif(d->>'inventory_id','') is not null then
  select name into entity_name from public.inventory where id=(d->>'inventory_id')::uuid and company_id=p_company;
 elsif p_related='ProjectStaff' and nullif(d->>'user_id','') is not null then
  select full_name into entity_name from public.profiles where id=(d->>'user_id')::uuid and company_id=p_company;
 end if;
 noun:=case p_related when 'Lead' then 'lead' when 'Quote' then 'quote' when 'ChangeOrder' then 'change order' when 'Invoice' then 'invoice'
 when 'Project' then 'project' when 'Task' then 'task' when 'ProjectTask' then 'task' when 'PurchaseOrder' then 'purchase order'
 when 'Inventory' then 'inventory item' when 'Subcontractor' then 'subcontractor' when 'Vendor' then 'vendor' when 'User' then 'account'
 when 'Company' then case when p_event='company_notification_failed' then 'company alert' else 'subscription' end when 'Message' then 'client conversation' when 'WarrantyClaim' then 'warranty claim'
 when 'DocumentRequest' then 'document request' when 'ProjectPlan' then 'drawing' when 'Permit' then 'permit' when 'Material' then 'material'
 when 'Trade' then 'trade assignment' when 'Reservation' then 'equipment reservation' when 'TimeEntry' then 'timesheet'
 when 'Expense' then 'expense' when 'LeaveRequest' then 'leave request' when 'SupportTicket' then 'support request'
 when 'Announcement' then 'update' when 'ProjectPhase' then 'phase' when 'ProjectStaff' then 'project assignment' else 'project record' end;
 -- Customer action names come from the saved client, never a public form's supplied display name.
 if actor_id is null and p_event in ('lead_reply','client_message') then
  actor_name:=coalesce(nullif(d->>'contact_name',''),nullif(d->>'name',''),'The client');
 end if;
 if actor_id is null and p_event in ('quote_viewed','quote_signed','quote_accepted','quote_approved','quote_declined','co_viewed','co_signed','co_accepted','co_approved','co_declined','invoice_viewed') then
  if nullif(d->>'client_id','') is not null then
   select coalesce(nullif(to_jsonb(c)->>'name',''),nullif(to_jsonb(c)->>'contact_name','')) into client_name
   from public.clients c where id=(d->>'client_id')::uuid and company_id=p_company;
   actor_name:=coalesce(client_name,'The client');
  elsif p_project is not null then
   select coalesce(nullif(to_jsonb(c)->>'name',''),nullif(to_jsonb(c)->>'contact_name','')) into client_name
   from public.projects pr join public.clients c on c.id=pr.client_id and c.company_id=pr.company_id where pr.id=p_project and pr.company_id=p_company;
   actor_name:=coalesce(client_name,'The client');
  elsif nullif(d->>'lead_id','') is not null then
   select nullif(contact_name,'') into client_name from public.leads where id=(d->>'lead_id')::uuid and company_id=p_company;
   actor_name:=coalesce(client_name,'The client');
  else actor_name:='The client'; end if;
 end if;
 if actor_id is null and p_related='Trade' and nullif(d->>'vendor_id','') is not null and p_event in ('trade_accepted','trade_declined','subcontractor_quote','trade_quote_received') then
  select coalesce(nullif(to_jsonb(v)->>'name',''),nullif(to_jsonb(v)->>'company_name','')) into client_name from public.vendors v where id=(d->>'vendor_id')::uuid and company_id=p_company;
  actor_name:=coalesce(client_name,'The subcontractor');
 end if;
 if actor_id is null and p_related='DocumentRequest' and p_event in ('document_signed','document_reviewed','document_declined') then
  actor_name:=coalesce(nullif(d->>'signer_name',''),nullif(d->>'recipient_name',''),'The recipient');
 elsif actor_id is null and p_related='WarrantyClaim' and p_event in ('warranty_customer_update','warranty_customer_confirmed','warranty_reopened','warranty_claim_created') then
  actor_name:=coalesce(nullif(d->>'customer_name',''),'The customer');
 end if;
 action:=case
  when p_event in ('lead_reply','client_message') then 'replied to'
  when p_event='lead_created' then 'created'
  when p_event='lead_won' then 'won' when p_event='lead_lost' then 'closed as lost'
  when p_event='lead_converted' then 'converted'
  when p_event like '%internal_review_approved' then 'approved the internal review of'
  when p_event like '%internal_changes_required' then 'requested changes to'
  when p_event like '%reassigned' then 'reassigned'
  when p_event like '%assigned' then 'assigned'
  when p_event like '%created' or p_event like '%added' or p_event like '%submitted' then 'created'
  when p_event like '%signed' then 'signed' when p_event like '%viewed' then 'viewed'
  when p_event like '%declined' or p_event like '%rejected' then 'declined'
  when p_event like '%approved' or p_event like '%accepted' then 'approved'
  when p_event like '%cancelled' or p_event like '%canceled' then 'cancelled'
  when p_event like '%completed' or p_event like '%resolved' or p_event like '%returned' then 'completed'
  when p_event like '%send_failed' or p_event like '%delivery_failed' or p_event like '%copy_failed' then 'reported a delivery problem for'
  when p_event like '%sent' then 'sent'
  when p_event like '%uploaded' then 'uploaded' when p_event like '%revision%' then 'revised'
  when p_event like '%overdue' or p_event like '%due%' or p_event like '%expir%' or p_event like '%missing%'
   or p_event like '%approaching%' or p_event like '%exceeded%' then 'flagged'
  else null end;
 if p_event='user_removed' and d is null then entity_name:=nullif(trim(p_body),''); end if;
 entity_name:=left(coalesce(entity_name,noun),200);
 select title into rule_title from notification_private.event_rules where event_key=p_event;
 if action is not null then
  rendered:=actor_name||' '||action||' '||case when lower(entity_name)=noun then entity_name else noun||' '||entity_name end||' on '||to_char(happened at time zone tz,'FMMonth FMDD, YYYY')||'.';
 else rendered:=actor_name||' · '||coalesce(rule_title,'Update')||': '||entity_name||' · '||to_char(happened at time zone tz,'FMMonth FMDD, YYYY')||'.'; end if;
 if nullif(trim(p_body),'') is not null then rendered:=rendered||' '||p_body; end if;
 return jsonb_build_object('actor_id',actor_id,'actor_name',actor_name,'entity_name',entity_name,
  'event_at',happened,'event_timezone',tz,'body',left(rendered,2000));
end $$;
revoke all on function notification_private.presentation(uuid,text,text,uuid,uuid,text,uuid) from public,anon,authenticated;

create or replace function public.communication_reply_status()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('email',exists(select 1 from vault.decrypted_secrets where name='resend_reply_domain' and decrypted_secret!=''),
 'sms',exists(select 1 from vault.decrypted_secrets where name='notification_sms_reply_enabled' and decrypted_secret='true'))
 where exists(select 1 from public.profiles where id=auth.uid() and company_id is not null and is_active is distinct from false)
$$;
revoke all on function public.communication_reply_status() from public,anon;
grant execute on function public.communication_reply_status() to authenticated;

create table public.support_tickets (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 subject text not null check(length(trim(subject)) between 1 and 160),
 status text not null default 'Open' check(status in ('Open','In Progress','Resolved')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.support_ticket_messages (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 ticket_id uuid not null references public.support_tickets(id) on delete cascade,
 author_user_id uuid references public.profiles(id) on delete set null,
 author_name text not null,message text not null check(length(trim(message)) between 1 and 10000),
 is_support boolean not null default false,created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_tickets,public.support_ticket_messages from public,anon,authenticated;
grant select on public.support_tickets,public.support_ticket_messages to authenticated;
grant all on public.support_tickets,public.support_ticket_messages to service_role;
create policy support_ticket_own on public.support_tickets for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=support_tickets.company_id and p.is_active is distinct from false));
create policy support_ticket_message_own on public.support_ticket_messages for select to authenticated using(exists(select 1 from public.support_tickets t where t.id=support_ticket_messages.ticket_id and t.company_id=support_ticket_messages.company_id and t.user_id=auth.uid()));
create index support_ticket_user on public.support_tickets(user_id,created_at desc);
create index support_message_ticket on public.support_ticket_messages(ticket_id,created_at);

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
 ('support_ticket_created','Support request received','FYI','Support',array['owner','admin','manager','office','employee','subcontractor'],'personal',null),
 ('support_ticket_reply','Support replied','Action Required','Support',array['owner','admin','manager','office','employee','subcontractor'],'personal',null),
 ('support_ticket_resolved','Support request resolved','FYI','Support',array['owner','admin','manager','office','employee','subcontractor'],'personal',null),
 ('feature_update','Fuzed Flow update','FYI','Updates',array['owner','admin','manager','office','employee','subcontractor'],'personal',null),
 ('help_updated','Help articles updated','FYI','Updates',array['owner','admin','manager','office','employee','subcontractor'],'personal',null),
 ('service_announcement','Service announcement','Important','Updates',array['owner','admin','manager','office','employee','subcontractor'],'personal',null)
on conflict(event_key) do update set title=excluded.title,severity=excluded.severity,category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;

create or replace function public.submit_support_ticket(p_subject text,p_message text,p_ticket uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.profiles; t public.support_tickets; msg uuid;
begin
 select * into p from public.profiles where id=auth.uid() and is_active is distinct from false;
 if p.id is null or p.company_id is null then raise exception 'Active account required' using errcode='42501'; end if;
 if length(trim(coalesce(p_message,''))) not between 1 and 10000 then raise exception 'Enter a message between 1 and 10,000 characters'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support:'||p.id,0));
 if p_ticket is null then
  if (select count(*) from public.support_tickets where user_id=p.id and created_at>now()-interval '1 day')>=5 then raise exception 'Please reply to an existing request or contact support by email'; end if;
  insert into public.support_tickets(company_id,user_id,subject) values(p.company_id,p.id,trim(p_subject)) returning * into t;
 else
  select * into t from public.support_tickets where id=p_ticket and user_id=p.id and company_id=p.company_id for update;
  if t.id is null then raise exception 'Support request unavailable' using errcode='42501'; end if;
  update public.support_tickets set status='Open',updated_at=now() where id=t.id;
 end if;
 if (select count(*) from public.support_ticket_messages where author_user_id=p.id and created_at>now()-interval '1 minute')>=5 then raise exception 'Please wait a minute before sending another reply'; end if;
 insert into public.support_ticket_messages(company_id,ticket_id,author_user_id,author_name,message)
 values(p.company_id,t.id,p.id,coalesce(nullif(p.full_name,''),'Subscriber'),trim(p_message)) returning id into msg;
 if p_ticket is null then perform notification_private.emit(p.company_id,'support_ticket_created','SupportTicket',t.id,null,array[p.id],'Your support request was saved.','support_created:'||t.id,p.id); end if;
 -- The support mailbox receives only requests explicitly submitted with this action.
 perform notification_private.enqueue_transactional_email(p.company_id,msg,'support_request', 'support@fuzedflow.com',
  '[Support] '||t.subject,left(coalesce(p.full_name,'Subscriber')||' ('||coalesce((select email from auth.users where id=p.id),'No reply email saved')||') from '||(select name from public.companies where id=p.company_id)||E'\n\n'||trim(p_message),9900)||E'\n\nTicket: '||t.id,'https://app.fuzedflow.com/Contact?ticket='||t.id);
 return t.id;
end $$;
revoke all on function public.submit_support_ticket(text,text,uuid) from public,anon;
grant execute on function public.submit_support_ticket(text,text,uuid) to authenticated;

-- A platform operator uses a service credential. Company administrators cannot impersonate support.
create or replace function public.reply_support_ticket(p_ticket uuid,p_message text,p_resolved boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.support_tickets; msg uuid;
begin
 if coalesce(auth.role(),current_setting('role',true),'')!='service_role' then raise exception 'Platform support access required' using errcode='42501'; end if;
 select * into t from public.support_tickets where id=p_ticket for update;
 if t.id is null then raise exception 'Support request unavailable'; end if;
 insert into public.support_ticket_messages(company_id,ticket_id,author_name,message,is_support)
 values(t.company_id,t.id,'Fuzed Flow Support',trim(p_message),true) returning id into msg;
 update public.support_tickets set status=case when p_resolved then 'Resolved' else 'In Progress' end,updated_at=now() where id=t.id;
 perform notification_private.emit(t.company_id,case when p_resolved then 'support_ticket_resolved' else 'support_ticket_reply' end,'SupportTicket',t.id,null,array[t.user_id],
  left(trim(p_message),1200),'support_reply:'||msg,null);
 return msg;
end $$;
revoke all on function public.reply_support_ticket(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.reply_support_ticket(uuid,text,boolean) to service_role;

create table public.platform_announcements (
 id uuid primary key default gen_random_uuid(),title text not null check(length(title) between 1 and 160),
 body text not null check(length(body) between 1 and 2000),
 event_key text not null check(event_key in ('feature_update','help_updated','service_announcement')),
 route text not null default '/HelpArticles' check(route in ('/HelpArticles','/Contact','/FAQ')),
 published_at timestamptz not null default now()
);
alter table public.platform_announcements enable row level security;
revoke all on public.platform_announcements from public,anon,authenticated;
grant select on public.platform_announcements to authenticated;
grant all on public.platform_announcements to service_role;
create policy platform_announcement_active on public.platform_announcements for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and company_id is not null and is_active is distinct from false));
create or replace function public.publish_platform_announcement(p_title text,p_body text,p_event text default 'feature_update',p_route text default '/HelpArticles')
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.platform_announcements; c record; recipients uuid[];
begin
 if coalesce(auth.role(),current_setting('role',true),'')!='service_role' then raise exception 'Platform publishing access required' using errcode='42501'; end if;
 insert into public.platform_announcements(title,body,event_key,route) values(trim(p_title),trim(p_body),p_event,p_route) returning * into a;
 for c in select distinct company_id from public.profiles where company_id is not null and is_active is distinct from false loop
  select array_agg(id) into recipients from public.profiles where company_id=c.company_id and is_active is distinct from false;
  perform notification_private.emit(c.company_id,a.event_key,'Announcement',a.id,null,recipients,a.title||': '||a.body,'announcement:'||a.id,null);
 end loop;
 return a.id;
end $$;
revoke all on function public.publish_platform_announcement(text,text,text,text) from public,anon,authenticated;
grant execute on function public.publish_platform_announcement(text,text,text,text) to service_role;

CREATE OR REPLACE FUNCTION notification_private.emit(p_company uuid, p_event text, p_related text, p_id uuid, p_project uuid, p_targets uuid[], p_body text, p_dedupe text, p_actor uuid DEFAULT auth.uid())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r notification_private.event_rules; u record; n integer:=0; affected integer; link text; field_link text; targeted boolean; display jsonb; announcement_route text;
begin
  select * into r from notification_private.event_rules where event_key=p_event;
  if not found or p_company is null or p_id is null then return 0; end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and company_id=p_company) then return 0; end if;
  display:=notification_private.presentation(p_company,p_event,p_related,p_id,p_project,p_body,p_actor);
  if p_related='Announcement' then select route into announcement_route from public.platform_announcements where id=p_id; end if;
  link := case p_related
    when 'WarrantyClaim' then '/Warranty?id='||p_id
    when 'DocumentRequest' then '/DocumentRequests?id='||p_id
    when 'ProjectPlan' then '/PMProjectWorkspace?id='||p_project||'&tab=plans&drawing='||p_id
    when 'ProjectPhase' then '/PMProjectWorkspace?id='||p_project||'&tab=phases&phase='||p_id
    when 'ProjectStaff' then '/PMProjectWorkspace?id='||p_project||'&tab=staff'
    when 'SupportTicket' then '/Contact?ticket='||p_id
    when 'NotificationDelivery' then '/HelpArticles'
    when 'Announcement' then coalesce(announcement_route,'/HelpArticles')
    when 'Reservation' then '/Inventory?reservation='||p_id
    when 'Vendor' then '/Vendors?id='||p_id
    when 'Permit' then '/PMProjectWorkspace?id='||p_project||'&tab=permits&permit='||p_id
    when 'Material' then '/PMProjectWorkspace?id='||p_project||'&tab=materials&material='||p_id
    when 'Trade' then '/PMProjectWorkspace?id='||p_project||'&tab=subs&trade='||p_id
    when 'LeaveRequest' then '/HumanResources?tab=timeoff'
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
    when p_related='TimeEntry' then case when p_event='missing_clock_out' then 'time_clock' else 'timesheets' end
    when p_related='LeaveRequest' then 'vacation_tracker'
    when p_related='Expense' then 'expenses'
    when p_related='Inventory' then 'inventory&id='||p_id
    when p_related='Reservation' then 'inventory&reservation='||p_id
    when p_related='ProjectPhase' then 'projects&notificationProject='||p_project||'&notificationPhase='||p_id
    when p_related='ProjectPlan' then 'projects&notificationProject='||p_project||'&notificationDrawing='||p_id
    when p_related='ProjectStaff' then 'projects&notificationProject='||p_project
    when r.category='Security' then 'profile'
    when r.category='Financial' and p_project is not null then 'projects&notificationProject='||p_project
    else 'daily_logs&notificationLog='||p_id end;
  if p_related in ('WarrantyClaim','SupportTicket','Announcement','NotificationDelivery') then field_link:=link;
  elsif p_related='DocumentRequest' then field_link:=link;
  elsif p_related='LeaveRequest' then field_link:='/EmployeePortal?tab=vacation_tracker'; end if;
  for u in select id,role from public.profiles where company_id=p_company and is_active is distinct from false
  loop
    targeted := u.id=any(coalesce(p_targets,'{}'::uuid[]));
    if notification_private.eligible(u.id,p_company,p_event,p_project,targeted)
      and (p_related!='Invoice' or u.role in ('owner','admin','office'))
      and (u.id is distinct from p_actor or r.severity='Action Required' or r.audience='personal')
    then
      insert into public.notifications(company_id,user_id,type,event_key,dedupe_key,title,body,action_url,related_type,related_id,severity,category,metadata,is_read,status)
      values(p_company,u.id,p_event,p_event,p_dedupe,r.title,display->>'body',
        case when u.role in ('employee','subcontractor') or (u.role='manager' and p_related in ('TimeEntry','Expense','LeaveRequest')) then field_link else link end,
        p_related,p_id,r.severity,r.category,jsonb_build_object('project_id',p_project,'targeted',targeted,'employee_url',field_link)||(display-'body'),false,'unread')
      on conflict(user_id,event_key,dedupe_key) do nothing;
      get diagnostics affected=row_count; n:=n+affected;
    end if;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION notification_private.row_event(d jsonb, t text, e text, proj uuid, recipients uuid[], label text, k text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare related text;
begin
 related := case t when 'quotes' then 'Quote' when 'change_orders' then 'ChangeOrder'
  when 'invoices' then 'Invoice' when 'projects' then 'Project' when 'project_tasks' then 'ProjectTask'
  when 'tasks' then 'Task' when 'time_entries' then 'TimeEntry' when 'expenses' then 'Expense'
  when 'purchase_orders' then 'PurchaseOrder' when 'inventory' then 'Inventory'
  when 'subcontractors' then 'Subcontractor' when 'profiles' then 'User'
  when 'companies' then 'Company' when 'leads' then 'Lead' when 'project_drawings' then 'ProjectPlan' when 'project_phases' then 'ProjectPhase' when 'project_staff' then 'ProjectStaff' when 'project_permits' then 'Permit' when 'project_materials' then 'Material' when 'project_subcontractors' then 'Trade' when 'inventory_reservations' then 'Reservation' when 'warranty_claims' then 'WarrantyClaim' when 'document_requests' then 'DocumentRequest' when 'time_off_requests' then 'LeaveRequest' when 'vendors' then 'Vendor' else 'ProjectRecord' end;
 return notification_private.emit((d->>'company_id')::uuid,e,related,(d->>'id')::uuid,proj,recipients,label,k);
end $function$;

CREATE OR REPLACE FUNCTION notification_private.reminders(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

 if to_regprocedure('notification_private.submission_reminders(timestamp with time zone)') is not null then n:=n+notification_private.submission_reminders(p_now); end if;
 if to_regprocedure('notification_private.people_reminders(timestamp with time zone)') is not null then n:=n+notification_private.people_reminders(p_now); end if;
 if to_regprocedure('notification_private.costs_reminders(timestamp with time zone)') is not null then n:=n+notification_private.costs_reminders(p_now); end if;
 if to_regprocedure('notification_private.sales_reminders(timestamp with time zone)') is not null then n:=n+notification_private.sales_reminders(p_now); end if;
 if to_regprocedure('notification_private.document_reminders(timestamp with time zone)') is not null then n:=n+notification_private.document_reminders(p_now); end if;
 if to_regprocedure('notification_private.prepare_digests(timestamp with time zone)') is not null then n:=n+notification_private.prepare_digests(p_now); end if;
 return n;
end $function$;

CREATE OR REPLACE FUNCTION notification_private.source_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 d jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 o jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 c uuid := (d->>'company_id')::uuid; proj uuid := nullif(d->>'project_id','')::uuid;
 recipients uuid[] := '{}'::uuid[]; prior_recipients uuid[]; events text[] := '{}'; e text;
 label text := coalesce(d->>'title',d->>'name',d->>'file_name',d->>'employee_name',d->>'company_name',d->>'full_name','Activity update');
 prefix text; st text := lower(coalesce(d->>'status','')); previous text:=lower(coalesce(o->>'status',''));
 k text := tg_table_name||':'||(d->>'id')||':'||txid_current()::text;
 ref jsonb; amount numeric; target uuid;
begin
 if tg_table_name='companies' then c:=(d->>'id')::uuid; d:=d||jsonb_build_object('company_id',c); end if;
 if c is null then return case when tg_op='DELETE' then old else new end; end if;
 -- Do not create alerts in another tenant through a permissive legacy source-table policy.
 if auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and is_active is distinct from false)
   and not (tg_op='UPDATE' and tg_table_name in ('quotes','change_orders') and coalesce(current_setting('notification.public_decision',true),'')=tg_table_name||':'||(d->>'id'))
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
   if st='sent' and (tg_op='INSERT' or previous is distinct from 'sent') then events:=array_append(events,'subcontractor_invited');
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
     if replace(lower(coalesce(d->>'subscription_status','')),' ','_') in ('past_due','unpaid') and d->>'subscription_status' is distinct from o->>'subscription_status' then events:=array_append(events,'subscription_payment_failed'); end if;
   end if;
 else null;
 end case;
 foreach e in array events loop
   perform notification_private.row_event(d,tg_table_name,e,proj,recipients,label,
     case when tg_table_name='invoices' and e in ('payment_received','partial_payment_received') then 'invoice-payment:'||(d->>'id')||':'||round((d->>'amount_paid')::numeric,2)::text
       else k||':'||e end);
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $function$;
