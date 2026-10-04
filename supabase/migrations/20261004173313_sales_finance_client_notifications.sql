-- Sales notifications follow saved workflow state. Provider callbacks are service-only.
alter table public.leads add column if not exists next_meeting_date date;
alter table public.leads add column if not exists next_meeting_time time;
alter table public.quotes add column if not exists next_follow_up_date date;
alter table public.change_orders add column if not exists next_follow_up_date date;
alter table public.change_orders add column if not exists approval_due_date date;
alter table public.quotes add column if not exists decline_reason text;
alter table public.change_orders add column if not exists decline_reason text;
alter table public.quotes add column if not exists internal_review_status text;
alter table public.quotes add column if not exists internal_reviewed_at timestamptz;
alter table public.quotes add column if not exists internal_reviewed_by uuid references public.profiles(id);
alter table public.change_orders add column if not exists internal_review_status text;
alter table public.change_orders add column if not exists internal_reviewed_at timestamptz;
alter table public.change_orders add column if not exists internal_reviewed_by uuid references public.profiles(id);
alter table public.companies add column if not exists subscription_renews_at timestamptz;
alter table public.companies add column if not exists subscription_cancel_at timestamptz;
alter table public.companies add column if not exists subscription_card_expiry date;
alter table public.companies add column if not exists subscription_last_receipt_url text;

-- Production's communication tables require a client; permit a saved lead too.
create table if not exists public.client_communications(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 client_id uuid references public.clients(id) on delete cascade,type text not null,subject text not null,
 message text,direction text default 'Outbound',status text default 'Sent',sent_by text,created_at timestamptz not null default now()
);
alter table public.client_communications alter column client_id drop not null;
alter table public.client_communications add column if not exists lead_id uuid references public.leads(id) on delete cascade;
alter table public.client_communications add column if not exists answered_at timestamptz;
alter table public.client_communications add column if not exists answered_delivery_id text;
alter table public.client_communications add column if not exists response_due_at timestamptz;
alter table public.client_communications add column if not exists provider text;
alter table public.client_communications add column if not exists provider_message_id text;
create unique index if not exists communications_provider_message on public.client_communications(provider,provider_message_id);
create index if not exists communications_unanswered on public.client_communications(company_id,response_due_at) where answered_at is null and lower(direction)='inbound';
create table if not exists public.client_reminders(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 client_id uuid references public.clients(id) on delete cascade,title text not null,description text,due_date date,
 priority text default 'Medium',status text default 'Pending',assigned_to uuid,created_at timestamptz not null default now()
);
alter table public.client_reminders alter column client_id drop not null;
alter table public.client_reminders add column if not exists lead_id uuid references public.leads(id) on delete cascade;
alter table public.messages add column if not exists answered_at timestamptz;
alter table public.messages add column if not exists response_due_at timestamptz;
create index if not exists sales_lead_followups on public.leads(company_id,next_follow_up_date) where next_follow_up_date is not null;
create index if not exists sales_client_reminders on public.client_reminders(company_id,due_date) where lower(status)='pending';

create table if not exists notification_private.outbound_deliveries(
 provider text not null,provider_id text not null,company_id uuid not null references public.companies(id) on delete cascade,
 related_type text not null,related_id uuid not null,client_id uuid,lead_id uuid,actor_id uuid,
 kind text not null default 'document',is_copy boolean not null default false,recipient text,sender text,reply_id uuid,
 status text not null default 'accepted',created_at timestamptz not null default now(),
 primary key(provider,provider_id)
);
create table if not exists notification_private.reply_routes(
 token uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 client_id uuid,lead_id uuid,created_at timestamptz not null default now(),
 check ((client_id is not null)::integer+(lead_id is not null)::integer=1)
);
create index outbound_sms_reply_lookup on notification_private.outbound_deliveries(provider,recipient,sender,created_at desc) where not is_copy;
create index reply_route_party_lookup on notification_private.reply_routes(company_id,client_id,lead_id);
create table if not exists notification_private.provider_events(
 provider text not null,event_id text not null,created_at timestamptz not null default now(),primary key(provider,event_id)
);
alter table notification_private.outbound_deliveries enable row level security;
alter table notification_private.reply_routes enable row level security;
alter table notification_private.provider_events enable row level security;
revoke all on notification_private.outbound_deliveries,notification_private.reply_routes,notification_private.provider_events from public,anon,authenticated;

-- Twilio has no email-style idempotency header. Claim a stable user intent before making a send.
create table notification_private.sms_intents(
 company_id uuid not null references public.companies(id) on delete cascade,request_id uuid not null,
 fingerprint text not null,status text not null default 'pending',provider_id text,created_at timestamptz not null default now(),primary key(company_id,request_id)
);
alter table notification_private.sms_intents enable row level security;
revoke all on notification_private.sms_intents from public,anon,authenticated;
create or replace function public.claim_sms_intent(p_company uuid,p_request uuid,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r notification_private.sms_intents; affected integer;
begin
 if p_request is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'Invalid send intent'; end if;
 insert into notification_private.sms_intents(company_id,request_id,fingerprint) values(p_company,p_request,p_fingerprint) on conflict do nothing;
 get diagnostics affected=row_count;
 select * into r from notification_private.sms_intents where company_id=p_company and request_id=p_request for update;
 if r.fingerprint!=p_fingerprint then raise exception 'Send intent payload changed'; end if;
 if r.status='failed' then update notification_private.sms_intents set status='pending' where company_id=p_company and request_id=p_request; affected:=1; end if;
 return jsonb_build_object('claimed',affected=1,'status',case when affected=1 then 'pending' else r.status end,'provider_id',r.provider_id);
end $$;
create or replace function public.finish_sms_intent(p_company uuid,p_request uuid,p_status text,p_provider_id text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('sent','failed','unknown') or (p_status='sent' and (p_provider_id is null or p_provider_id !~ '^SM[0-9a-fA-F]{32}$')) then raise exception 'Invalid send outcome'; end if;
 update notification_private.sms_intents set status=p_status,provider_id=p_provider_id where company_id=p_company and request_id=p_request and status='pending';
end $$;
revoke all on function public.claim_sms_intent(uuid,uuid,text),public.finish_sms_intent(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_sms_intent(uuid,uuid,text),public.finish_sms_intent(uuid,uuid,text,text) to service_role;

insert into notification_private.event_rules(event_key,title,severity,category,roles,audience,module) values
 ('lead_assigned','Lead assigned','Action Required','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_reassigned','Lead reassigned','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_reply','Reply from lead','Action Required','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_followup_upcoming','Lead follow-up tomorrow','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_followup_due','Lead follow-up due','Action Required','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_followup_overdue','Lead follow-up overdue','Action Required','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_meeting_scheduled','Lead meeting scheduled','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_meeting_upcoming','Lead meeting tomorrow','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_meeting_due','Lead meeting today','Action Required','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_meeting_cancelled','Lead meeting cancelled','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_won','Lead won','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_lost','Lead lost','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('lead_converted','Lead converted to client','Important','Leads',array['owner','admin','manager','office'],'leadership','leads'),
 ('co_sent','Change order sent','FYI','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('quote_expiring','Quote expires soon','Important','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('quote_followup_due','Quote follow-up due','Action Required','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('quote_followup_sent','Quote follow-up sent','FYI','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('quote_followup_failed','Quote follow-up failed','Action Required','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('co_followup_due','Change order follow-up due','Action Required','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('co_followup_sent','Change order follow-up sent','FYI','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('co_followup_failed','Change order follow-up failed','Action Required','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('co_approval_due','Change order approval due soon','Action Required','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('co_approval_overdue','Change order approval overdue','Action Required','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('quote_internal_review_approved','Quote approved for sending','Important','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('quote_internal_changes_required','Quote requires internal changes','Action Required','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('co_internal_review_approved','Change order approved for sending','Important','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('co_internal_changes_required','Change order requires internal changes','Action Required','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('quote_send_failed','Quote delivery failed','Action Required','Quotes',array['owner','admin','manager','office'],'leadership','quotes'),
 ('co_send_failed','Change order delivery failed','Action Required','Change Orders',array['owner','admin','manager','office'],'leadership','change_orders'),
 ('invoice_send_failed','Invoice delivery failed','Action Required','Invoices',array['owner','admin','office'],'leadership','invoices'),
 ('document_copy_failed','Company email copy failed','Action Required','Documents',array['owner','admin'],'leadership',null),
 ('receipt_sent','Payment receipt sent','FYI','Invoices',array['owner','admin','office'],'leadership','invoices'),
 ('receipt_failed','Payment receipt delivery failed','Action Required','Invoices',array['owner','admin','office'],'leadership','invoices'),
 ('company_notification_failed','Company alert delivery failed','Action Required','General',array['owner','admin'],'leadership',null),
 ('client_send_failed','Client message delivery failed','Action Required','Mentions',array['owner','admin','manager','office'],'leadership','clients'),
 ('client_reply_unanswered','Client reply needs a response','Action Required','Mentions',array['owner','admin','manager','office'],'leadership','clients'),
 ('client_reminder_due','Client follow-up due','Action Required','Mentions',array['owner','admin','manager','office'],'leadership','clients'),
 ('client_reminder_overdue','Client follow-up overdue','Action Required','Mentions',array['owner','admin','manager','office'],'leadership','clients'),
 ('quote_deposit_received','Quote deposit received','Important','Financial',array['owner','admin','office'],'leadership','quotes'),
 ('payment_refunded','Payment refunded','Important','Financial',array['owner','admin','office'],'leadership','invoices'),
 ('payment_disputed','Payment disputed','Action Required','Financial',array['owner','admin','office'],'leadership','invoices'),
 ('subscription_renewal_upcoming','Subscription renewal approaching','Important','Billing',array['owner','admin'],'leadership',null),
 ('subscription_payment_received','Subscription payment received','FYI','Billing',array['owner','admin'],'leadership',null),
 ('subscription_receipt','Subscription receipt available','FYI','Billing',array['owner','admin'],'leadership',null),
 ('subscription_cancelled','Subscription cancelled','Important','Billing',array['owner','admin'],'leadership',null),
 ('subscription_cancellation_scheduled','Subscription cancellation scheduled','Important','Billing',array['owner','admin'],'leadership',null),
 ('subscription_card_expiring','Subscription payment card expires soon','Action Required','Billing',array['owner','admin'],'leadership',null),
 ('subscription_usage_limit','Subscription user limit reached','Action Required','Billing',array['owner','admin'],'leadership',null)
on conflict(event_key) do update set title=excluded.title,severity=excluded.severity,category=excluded.category,roles=excluded.roles,audience=excluded.audience,module=excluded.module;

-- Validate new source fields independently of legacy permissive source policies.
create or replace function notification_private.sales_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb:=to_jsonb(new); o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end; c uuid:=((d->>'company_id'))::uuid; actor public.profiles;
begin
 -- A public document decision can originate from a recipient signed in to another tenant.
 -- Mark only this exact row after checking the complete public update shape.
 if tg_table_name in ('quotes','change_orders') and tg_op='UPDATE' and lower(coalesce(o->>'status',''))='pending review'
  and lower(coalesce(d->>'status','')) not in ('pending review','draft') then raise exception 'The team is reviewing this document' using errcode='42501'; end if;
 if tg_table_name in ('quotes','change_orders') and tg_op='UPDATE' and (
  (auth.uid() is not null and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=c and p.is_active is distinct from false))
  or (auth.uid() is null and coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated'))) then
  if (d - array['status','client_selected_items_json','client_selected_items','subtotal','tax','total','client_signature','signed_at','signed_by','viewed_at','decline_reason','updated_at'])
     is distinct from (o - array['status','client_selected_items_json','client_selected_items','subtotal','tax','total','client_signature','signed_at','signed_by','viewed_at','decline_reason','updated_at'])
   or coalesce(d->>'is_template','false')='true'
   or lower(coalesce(o->>'status','')) not in ('draft','sent','viewed','pending','expired','approved')
   or lower(coalesce(d->>'status','')) not in ('approved','declined','viewed','pending')
   or (lower(coalesce(o->>'status',''))='approved' and (lower(coalesce(d->>'status',''))!='approved' or (d-array['client_signature','signed_at','signed_by','viewed_at','updated_at']) is distinct from (o-array['client_signature','signed_at','signed_by','viewed_at','updated_at'])))
   or coalesce((d->>'total')::numeric,0)<0 then raise exception 'Public document update is not permitted' using errcode='42501'; end if;
  perform set_config('notification.public_decision',tg_table_name||':'||(d->>'id'),true);
 end if;
 if tg_table_name in ('client_communications','client_reminders') then
  if ((d->>'client_id') is null)=((d->>'lead_id') is null) then raise exception 'A saved client or lead is required' using errcode='23514'; end if;
  if (d->>'client_id') is not null and not exists(select 1 from public.clients where id=((d->>'client_id'))::uuid and company_id=c) then raise exception 'Client is outside this company' using errcode='23514'; end if;
  if (d->>'lead_id') is not null and not exists(select 1 from public.leads where id=((d->>'lead_id'))::uuid and company_id=c) then raise exception 'Lead is outside this company' using errcode='23514'; end if;
  if tg_table_name='client_reminders' and (d->>'assigned_to') is not null and not exists(select 1 from public.profiles where id=((d->>'assigned_to'))::uuid and company_id=c and is_active is distinct from false) then raise exception 'Reminder assignee is outside this company' using errcode='23514'; end if;
 end if;
 if auth.uid() is not null and tg_table_name in ('client_communications','client_reminders') then
  select * into actor from public.profiles where id=auth.uid() and company_id=c and is_active is distinct from false;
  if not found then raise exception 'Active company account required' using errcode='42501'; end if;
 end if;
 if tg_table_name in ('quotes','change_orders') and (
  ((d->>'internal_review_status'),(d->>'internal_reviewed_at'),(d->>'internal_reviewed_by')) is distinct from ((o->>'internal_review_status'),(o->>'internal_reviewed_at'),(o->>'internal_reviewed_by'))
  or (lower(coalesce(d->>'status',''))='pending review' and (d->>'status') is distinct from (o->>'status'))) then
  if auth.uid() is null and coalesce(auth.role(),current_setting('role',true)) in ('anon','authenticated') then raise exception 'Internal review requires authentication' using errcode='42501'; end if;
  if auth.uid() is not null then
   select * into actor from public.profiles where id=auth.uid() and company_id=c and is_active is distinct from false;
   if not found then raise exception 'Active company account required' using errcode='42501'; end if;
  end if;
  if auth.uid() is not null and (actor.role not in ('owner','admin','manager','office') or
   (actor.role not in ('owner','admin') and coalesce(jsonb_array_length(actor.permissions),0)>0 and not(actor.permissions ? case tg_table_name when 'quotes' then 'quotes' else 'change_orders' end))) then raise exception 'Internal review permission required' using errcode='42501'; end if;
  if (d->>'internal_review_status') is null or (d->>'internal_review_status') not in ('Pending','Approved','Changes Required') then raise exception 'Invalid internal review outcome' using errcode='23514'; end if;
  if lower(coalesce(d->>'status',''))='pending review' and lower(coalesce(o->>'status','draft')) not in ('draft','sent','pending review') then raise exception 'Customer decisions cannot be reset by internal review' using errcode='23514'; end if;
  if lower(coalesce(d->>'status',''))='pending review' and (d->>'internal_review_status') is distinct from 'Pending' then raise exception 'Pending review requires a pending review outcome' using errcode='23514'; end if;
  if (d->>'internal_review_status') in ('Approved','Changes Required') and (d->>'internal_review_status') is distinct from (o->>'internal_review_status') and lower(coalesce(d->>'status',''))!='draft' then raise exception 'An internal decision returns the document to draft' using errcode='23514'; end if;
  if (d->>'internal_review_status') in ('Approved','Changes Required') and (d->>'internal_review_status') is distinct from (o->>'internal_review_status') and lower(coalesce(o->>'status',''))!='pending review' then raise exception 'A saved pending internal review is required' using errcode='23514'; end if;
  if (d->>'internal_review_status') in ('Approved','Changes Required') and auth.uid() is not null then
   new.internal_reviewed_by:=auth.uid(); new.internal_reviewed_at:=now();
  end if;
 end if;
 return new;
end $$;

create or replace function notification_private.sales_source_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare d jsonb:=to_jsonb(new); o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
 c uuid:=((d->>'company_id'))::uuid; source_id uuid:=((d->>'id'))::uuid; proj uuid:=nullif((d->>'project_id'),'')::uuid; e text;
 k text:=tg_table_name||':'||source_id||':'||txid_current(); targets uuid[]:='{}'; label text; prefix text;
begin
 if c is null then return new; end if;
 if auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and company_id=c and is_active is distinct from false) then return new; end if;
 case tg_table_name
 when 'leads' then
  label:=coalesce((d->>'contact_name'),'Lead'); targets:=notification_private.targets(c,d->'assigned_to');
  if nullif((d->>'assigned_to'),'') is not null and (d->>'assigned_to') is distinct from (o->>'assigned_to') then
   e:=case when nullif((o->>'assigned_to'),'') is null then 'lead_assigned' else 'lead_reassigned' end;
   perform notification_private.emit(c,e,'Lead',source_id,null,targets,label||': assigned to '||(d->>'assigned_to'),k||':assigned');
  end if;
  if lower(coalesce((d->>'pipeline_stage'),'')) in ('won','lost') and (d->>'pipeline_stage') is distinct from (o->>'pipeline_stage') then
   e:=case lower((d->>'pipeline_stage')) when 'won' then 'lead_won' else 'lead_lost' end;
   perform notification_private.emit(c,e,'Lead',source_id,null,targets,label||': marked '||(d->>'pipeline_stage'),k||':stage');
  end if;
  if (d->>'client_id') is not null and (d->>'client_id') is distinct from (o->>'client_id') and exists(select 1 from public.clients where id=((d->>'client_id'))::uuid and company_id=c) then
   perform notification_private.emit(c,'lead_converted','Lead',source_id,null,targets,label||': converted to a client.',k||':converted');
  end if;
  if ((d->>'next_meeting_date'),(d->>'next_meeting_time')) is distinct from ((o->>'next_meeting_date'),(o->>'next_meeting_time')) then
   if (d->>'next_meeting_date') is not null then
    perform notification_private.emit(c,'lead_meeting_scheduled','Lead',source_id,null,targets,label||': meeting '||(d->>'next_meeting_date')||coalesce(' at '||(d->>'next_meeting_time'),''),k||':meeting');
   elsif (o->>'next_meeting_date') is not null then perform notification_private.emit(c,'lead_meeting_cancelled','Lead',source_id,null,targets,label||': meeting cancelled.',k||':meeting'); end if;
  end if;
 when 'quotes','change_orders' then
  if d->>'is_template'='true' then return new; end if;
  prefix:=case tg_table_name when 'quotes' then 'quote' else 'co' end;
  if prefix='co' and lower(coalesce((d->>'status'),'')) in ('sent','issued') and (d->>'status') is distinct from (o->>'status') then perform notification_private.row_event(d,tg_table_name,'co_sent',proj,'{}',null,k||':sent'); end if;
  if (d->>'internal_review_status') is distinct from (o->>'internal_review_status') then
   e:=case (d->>'internal_review_status') when 'Approved' then prefix||'_internal_review_approved' when 'Changes Required' then prefix||'_internal_changes_required' else null end;
   if e is not null then perform notification_private.row_event(d,tg_table_name,e,proj,'{}',null,k||':review'); end if;
  end if;
 when 'client_communications' then
  if tg_op='INSERT' and lower(coalesce((d->>'direction'),''))='inbound' then
   if (d->>'lead_id') is not null then perform notification_private.emit(c,'lead_reply','Lead',((d->>'lead_id'))::uuid,null,'{}','New lead reply: '||left(coalesce((d->>'subject'),'Message'),160),k||':reply');
   else perform notification_private.emit(c,'client_message','Message',((d->>'client_id'))::uuid,null,'{}','New client reply: '||left(coalesce((d->>'subject'),'Message'),160),k||':reply'); end if;
  end if;
 else null;
 end case;
 return new;
end $$;
do $$ declare t text; begin
 foreach t in array array['leads','quotes','change_orders','client_communications','client_reminders'] loop
  execute format('drop trigger if exists sales_notifications on public.%I',t);
  execute format('create trigger sales_notifications after insert or update on public.%I for each row execute function notification_private.sales_source_event()',t);
  if t!='leads' then
   execute format('drop trigger if exists sales_source_guard on public.%I',t);
   execute format('create trigger sales_source_guard before insert or update on public.%I for each row execute function notification_private.sales_guard()',t);
  end if;
 end loop;
end $$;

-- Only trusted Edge functions can record delivery/provider outcomes. Saved entity ownership is checked again here.
create or replace function public.record_sales_event(p_company uuid,p_event text,p_related text,p_id uuid,p_message text,p_reference text,p_actor uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare d jsonb; t text; proj uuid;
begin
 if p_event not in ('quote_send_failed','co_send_failed','invoice_send_failed','document_copy_failed','receipt_sent','receipt_failed','client_send_failed',
  'quote_followup_sent','quote_followup_failed','co_followup_sent','co_followup_failed','quote_deposit_received','payment_failed','payment_refunded','payment_disputed',
  'subscription_renewal_upcoming','subscription_payment_received','subscription_receipt','subscription_cancelled','subscription_cancellation_scheduled','subscription_card_expiring','subscription_payment_failed',
  'vendor_request_delivery_failed','vendor_request_bounced','company_notification_failed') then raise exception 'Unsupported sales event' using errcode='22023'; end if;
 if p_reference is null or length(p_reference)>240 then raise exception 'Event reference required' using errcode='22023'; end if;
 if (p_event='company_notification_failed' and p_related!='Company') or (left(p_event,13)='subscription_' and p_related!='Company') or (left(p_event,15)='vendor_request_' and p_related!='Trade')
  or (left(p_event,6)='quote_' and p_related!='Quote') or (left(p_event,3)='co_' and p_related!='ChangeOrder')
  or (p_event in ('receipt_sent','receipt_failed','invoice_send_failed') and p_related!='Invoice')
  or (p_event in ('payment_failed','payment_refunded','payment_disputed') and p_related not in ('Invoice','Quote'))
  or (p_event='client_send_failed' and p_related not in ('Message','Lead')) then raise exception 'Event does not match its saved entity' using errcode='22023'; end if;
 t:=case p_related when 'Quote' then 'quotes' when 'ChangeOrder' then 'change_orders' when 'Invoice' then 'invoices' when 'Lead' then 'leads' when 'Message' then 'clients' when 'Company' then 'companies' when 'Trade' then 'vendor_requests' else null end;
 if t is null then raise exception 'Unsupported entity' using errcode='22023'; end if;
 if t='companies' then select to_jsonb(c) into d from public.companies c where id=p_company and id=p_id;
 else execute format('select to_jsonb(x) from public.%I x where id=$1 and company_id=$2',t) into d using p_id,p_company; end if;
 if d is null then raise exception 'Entity outside this company' using errcode='42501'; end if;
 if p_actor is not null and not exists(select 1 from public.profiles where id=p_actor and company_id=p_company) then raise exception 'Actor outside this company' using errcode='42501'; end if;
 if p_actor is not null and not exists(select 1 from public.profiles where id=p_actor and company_id=p_company and is_active is distinct from false) then p_actor:=null; end if;
 proj:=nullif((d->>'project_id'),'')::uuid;
 return notification_private.emit(p_company,p_event,p_related,p_id,proj,'{}',left(p_message,2000),'sales:'||p_event||':'||p_reference,p_actor);
end $$;
revoke all on function public.record_sales_event(uuid,text,text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.record_sales_event(uuid,text,text,uuid,text,text,uuid) to service_role;

create or replace function public.register_outbound_delivery(p_provider text,p_provider_id text,p_company uuid,p_related text,p_id uuid,p_client uuid default null,p_lead uuid default null,p_actor uuid default null,p_kind text default 'document',p_copy boolean default false,p_recipient text default null,p_sender text default null,p_reply uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare t text; doc jsonb;
begin
 if p_provider not in ('resend','twilio') or p_provider_id is null or length(p_provider_id)>160 or p_kind not in ('document','receipt','followup','communication','company_notification') then raise exception 'Invalid delivery context' using errcode='22023'; end if;
 if p_client is not null and not exists(select 1 from public.clients where id=p_client and company_id=p_company) then raise exception 'Client outside company' using errcode='42501'; end if;
 if p_lead is not null and not exists(select 1 from public.leads where id=p_lead and company_id=p_company) then raise exception 'Lead outside company' using errcode='42501'; end if;
 t:=case p_related when 'Quote' then 'quotes' when 'ChangeOrder' then 'change_orders' when 'Invoice' then 'invoices' when 'Lead' then 'leads' when 'Message' then 'clients' when 'Trade' then 'vendor_requests' when 'Company' then 'companies' else null end;
 if t is null or (p_related='Company' and p_kind!='company_notification') then raise exception 'Unsupported delivery entity'; end if;
 if t='companies' then select to_jsonb(x) into doc from public.companies x where x.id=p_company and x.id=p_id;
 else execute format('select to_jsonb(x) from public.%I x where id=$1 and company_id=$2',t) into doc using p_id,p_company; end if;
 if doc is null then raise exception 'Delivery entity outside company'; end if;
 if p_actor is not null and not exists(select 1 from public.profiles where id=p_actor and company_id=p_company) then raise exception 'Actor outside company'; end if;
 if p_reply is not null and (p_kind!='communication' or not exists(select 1 from public.client_communications where id=p_reply and company_id=p_company and lower(direction)='inbound' and
  ((p_client is not null and client_id=p_client) or (p_lead is not null and lead_id=p_lead)))) then raise exception 'Reply outside this conversation'; end if;
 insert into notification_private.outbound_deliveries(provider,provider_id,company_id,related_type,related_id,client_id,lead_id,actor_id,kind,is_copy,recipient,sender,reply_id)
 values(p_provider,p_provider_id,p_company,p_related,p_id,p_client,p_lead,p_actor,p_kind,p_copy,lower(p_recipient),lower(p_sender),p_reply) on conflict do nothing;
end $$;
revoke all on function public.register_outbound_delivery(text,text,uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_outbound_delivery(text,text,uuid,text,uuid,uuid,uuid,uuid,text,boolean,text,text,uuid) to service_role;

create or replace function public.record_delivery_callback(p_provider text,p_provider_id text,p_event_id text,p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare d notification_private.outbound_deliveries; e text; affected integer; relation_table text; entity_exists boolean; surviving_reply_delivery text;
begin
 select * into d from notification_private.outbound_deliveries where provider=p_provider and provider_id=p_provider_id for update;
 if not found then return false; end if;
 if p_status not in ('delivered','failed','bounced','undelivered','complained') then return false; end if;
 insert into notification_private.provider_events(provider,event_id) values(p_provider,p_event_id) on conflict do nothing;
 get diagnostics affected=row_count; if affected=0 then return true; end if;
 -- A late accepted/delivered callback never erases a terminal failure.
 if d.status in ('failed','bounced','undelivered','complained') and p_status='delivered' then return true; end if;
 update notification_private.outbound_deliveries set status=p_status where provider=p_provider and provider_id=p_provider_id;
 if not d.is_copy then update public.client_communications set status=initcap(p_status) where company_id=d.company_id and provider=p_provider and provider_message_id=p_provider_id; end if;
 if p_status='delivered' and d.kind='communication' and not d.is_copy and d.reply_id is not null then
  update public.client_communications set answered_at=now(),answered_delivery_id=p_provider||':'||p_provider_id where id=d.reply_id and company_id=d.company_id and answered_at is null;
 end if;
 if p_status!='delivered' then
  if d.reply_id is not null then
   select x.provider||':'||x.provider_id into surviving_reply_delivery from notification_private.outbound_deliveries x where x.company_id=d.company_id and x.reply_id=d.reply_id and x.status='delivered' and not x.is_copy order by x.created_at desc limit 1;
   update public.client_communications set answered_at=case when surviving_reply_delivery is null then null else answered_at end,answered_delivery_id=surviving_reply_delivery
    where id=d.reply_id and company_id=d.company_id and answered_delivery_id=p_provider||':'||p_provider_id;
  end if;
  if d.actor_id is not null and not exists(select 1 from public.profiles where id=d.actor_id and company_id=d.company_id and is_active is distinct from false) then d.actor_id:=null; end if;
  e:=case when d.kind='company_notification' then 'company_notification_failed' when d.is_copy then 'document_copy_failed' when d.kind='receipt' then 'receipt_failed'
   when d.kind='followup' and d.related_type='Quote' then 'quote_followup_failed' when d.kind='followup' and d.related_type='ChangeOrder' then 'co_followup_failed'
   when d.related_type='Trade' then case when p_status='bounced' then 'vendor_request_bounced' else 'vendor_request_delivery_failed' end
   when d.related_type='Quote' then 'quote_send_failed' when d.related_type='ChangeOrder' then 'co_send_failed' when d.related_type='Invoice' then 'invoice_send_failed' else 'client_send_failed' end;
  relation_table:=case d.related_type when 'Quote' then 'quotes' when 'ChangeOrder' then 'change_orders' when 'Invoice' then 'invoices' when 'Lead' then 'leads' when 'Message' then 'clients' when 'Trade' then 'vendor_requests' when 'Company' then 'companies' else null end;
  if relation_table='companies' then select exists(select 1 from public.companies where id=d.company_id) into entity_exists;
  elsif relation_table is not null then execute format('select exists(select 1 from public.%I where id=$1 and company_id=$2)',relation_table) into entity_exists using d.related_id,d.company_id; end if;
  if entity_exists then
   perform public.record_sales_event(d.company_id,e,d.related_type,d.related_id,'Delivery failed. Review the recipient and retry from the saved record.',p_provider||':'||p_provider_id||':failed',d.actor_id);
  else
   perform public.record_sales_event(d.company_id,'company_notification_failed','Company',d.company_id,'An outgoing message failed after its saved record was removed. Review delivery contact details.',p_provider||':'||p_provider_id||':failed',d.actor_id);
  end if;
 end if;
 return true;
end $$;
revoke all on function public.record_delivery_callback(text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_delivery_callback(text,text,text,text) to service_role;

create or replace function public.create_reply_route(p_company uuid,p_client uuid default null,p_lead uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare route uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||coalesce(p_client::text,p_lead::text),0));
 select token into route from notification_private.reply_routes where company_id=p_company and client_id is not distinct from p_client and lead_id is not distinct from p_lead limit 1;
 if route is not null then return route; end if;
 if (p_client is null)=(p_lead is null) then raise exception 'A single saved recipient is required'; end if;
 if p_client is not null and not exists(select 1 from public.clients where id=p_client and company_id=p_company) then raise exception 'Client outside company'; end if;
 if p_lead is not null and not exists(select 1 from public.leads where id=p_lead and company_id=p_company) then raise exception 'Lead outside company'; end if;
 insert into notification_private.reply_routes(company_id,client_id,lead_id) values(p_company,p_client,p_lead) returning token into route;
 return route;
end $$;
revoke all on function public.create_reply_route(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_reply_route(uuid,uuid,uuid) to service_role;

create or replace function public.record_inbound_reply(p_provider text,p_event_id text,p_route uuid,p_sender text,p_subject text,p_message text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r notification_private.reply_routes; affected integer;
begin
 select * into r from notification_private.reply_routes where token=p_route;
 if not found then return false; end if;
 -- Signed provider delivery proves transport, not sender identity: match the saved contact too.
 if r.client_id is not null and not exists(select 1 from public.clients where id=r.client_id and company_id=r.company_id and lower(trim(email))=lower(trim(p_sender))) then return false; end if;
 if r.lead_id is not null and not exists(select 1 from public.leads where id=r.lead_id and company_id=r.company_id and lower(trim(contact_email))=lower(trim(p_sender))) then return false; end if;
 insert into notification_private.provider_events(provider,event_id) values(p_provider,p_event_id) on conflict do nothing;
 get diagnostics affected=row_count; if affected=0 then return false; end if;
 insert into public.client_communications(company_id,client_id,lead_id,type,subject,message,direction,status,sent_by,provider,provider_message_id,response_due_at)
 values(r.company_id,r.client_id,r.lead_id,'Email',left(coalesce(p_subject,'Reply received'),250),left(coalesce(p_message,''),20000),'Inbound','Received',left(p_sender,254),p_provider,p_event_id,now()+interval '1 day');
 return true;
end $$;
revoke all on function public.record_inbound_reply(text,text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_inbound_reply(text,text,uuid,text,text,text) to service_role;

create or replace function notification_private.normalize_phone(p_phone text) returns text language sql immutable set search_path='' as $$
 select case when value ~ '^[0-9]{10}$' then '+1'||value when value ~ '^1[0-9]{10}$' then '+'||value else value end from (select regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g') value) x
$$;
revoke all on function notification_private.normalize_phone(text) from public,anon,authenticated;

create or replace function public.record_inbound_sms(p_event_id text,p_sender text,p_recipient text,p_message text) returns boolean
language plpgsql security definer set search_path='' as $$
declare d notification_private.outbound_deliveries; affected integer; companies integer;
begin
 -- A shared sending number must never route an ambiguous phone number across tenants.
 select count(distinct company_id) into companies from notification_private.outbound_deliveries
  where provider='twilio' and recipient=p_sender and sender=p_recipient and created_at>now()-interval '30 days' and not is_copy;
 if companies!=1 then return false; end if;
 select * into d from notification_private.outbound_deliveries where provider='twilio' and recipient=p_sender and sender=p_recipient
  and created_at>now()-interval '30 days' and not is_copy and (client_id is not null or lead_id is not null) order by created_at desc limit 1;
 if not found then return false; end if;
 if d.client_id is not null and not exists(select 1 from public.clients where id=d.client_id and company_id=d.company_id and notification_private.normalize_phone(phone)=p_sender) then return false; end if;
 if d.lead_id is not null and not exists(select 1 from public.leads where id=d.lead_id and company_id=d.company_id and notification_private.normalize_phone(contact_phone)=p_sender) then return false; end if;
 insert into notification_private.provider_events(provider,event_id) values('twilio',p_event_id) on conflict do nothing;
 get diagnostics affected=row_count; if affected=0 then return false; end if;
 insert into public.client_communications(company_id,client_id,lead_id,type,subject,message,direction,status,sent_by,provider,provider_message_id,response_due_at)
 values(d.company_id,d.client_id,d.lead_id,'SMS','SMS reply received',left(p_message,5000),'Inbound','Received',p_sender,'twilio',p_event_id,now()+interval '1 day');
 return true;
end $$;
revoke all on function public.record_inbound_sms(text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_inbound_sms(text,text,text,text) to service_role;

create or replace function notification_private.sales_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare co record; r record; tz text; today date; e text; n integer:=0; targets uuid[]; label text; d jsonb; prefix text; active_users integer;
begin
 for co in select * from public.companies loop
  select name into tz from pg_timezone_names where name=co.timezone limit 1; tz:=coalesce(tz,'America/Edmonton'); today:=(p_now at time zone tz)::date;
  if extract(hour from p_now at time zone tz)<8 then continue; end if;
  for r in select to_jsonb(l) doc from public.leads l where l.company_id=co.id and lower(coalesce(l.pipeline_stage,'')) not in ('won','lost') loop
   d:=r.doc; targets:=notification_private.targets(co.id,d->'assigned_to');
   if (d->>'next_follow_up_date') is not null and ((d->>'next_follow_up_date'))::date<=today+1 then
    e:=case when ((d->>'next_follow_up_date'))::date<today then 'lead_followup_overdue' when ((d->>'next_follow_up_date'))::date=today then 'lead_followup_due' else 'lead_followup_upcoming' end;
    n:=n+notification_private.emit(co.id,e,'Lead',((d->>'id'))::uuid,null,targets,coalesce((d->>'contact_name'),'Lead')||': follow up '||(d->>'next_follow_up_date'),e||':'||((d->>'id'))||':'||(d->>'next_follow_up_date'),null);
   end if;
   if (d->>'next_meeting_date') is not null and ((d->>'next_meeting_date'))::date between today and today+1 then
    e:=case when ((d->>'next_meeting_date'))::date=today then 'lead_meeting_due' else 'lead_meeting_upcoming' end;
    n:=n+notification_private.emit(co.id,e,'Lead',((d->>'id'))::uuid,null,targets,coalesce((d->>'contact_name'),'Lead')||': meeting '||(d->>'next_meeting_date')||coalesce(' at '||(d->>'next_meeting_time'),''),e||':'||(d->>'id')||':'||(d->>'next_meeting_date')||':'||coalesce(d->>'next_meeting_time',''),null);
   end if;
  end loop;
  for r in select 'quotes' source,to_jsonb(q) doc from public.quotes q where q.company_id=co.id and q.is_template is distinct from true
   union all select 'change_orders',to_jsonb(c) from public.change_orders c where c.company_id=co.id loop
   d:=r.doc; if d->>'is_template'='true' then continue; end if; prefix:=case r.source when 'quotes' then 'quote' else 'co' end;
   if lower(coalesce((d->>'status'),'')) in ('draft','approved','accepted','declined','rejected','paid','cancelled','canceled','void','invoiced','expired') then continue; end if;
   if prefix='quote' and (d->>'expiry_date') is not null and ((d->>'expiry_date'))::date between today and today+3 then
    n:=n+notification_private.row_event(d,r.source,'quote_expiring',null,'{}',coalesce((d->>'quote_number'),'Quote')||': expires '||(d->>'expiry_date'),'quote-expiring:'||((d->>'id'))||':'||(d->>'expiry_date'));
   end if;
   if (d->>'next_follow_up_date') is not null and ((d->>'next_follow_up_date'))::date<=today then
    e:=prefix||'_followup_due'; n:=n+notification_private.row_event(d,r.source,e,nullif((d->>'project_id'),'')::uuid,'{}','Follow up on '||coalesce((d->>'quote_number'),(d->>'change_order_number'),'Document')||': due '||(d->>'next_follow_up_date'),e||':'||((d->>'id'))||':'||(d->>'next_follow_up_date'));
   end if;
   if prefix='co' and (d->>'approval_due_date') is not null and ((d->>'approval_due_date'))::date<=today+2 then
    e:=case when ((d->>'approval_due_date'))::date<today then 'co_approval_overdue' else 'co_approval_due' end;
    n:=n+notification_private.row_event(d,r.source,e,nullif((d->>'project_id'),'')::uuid,'{}',coalesce((d->>'change_order_number'),'Change order')||': approval due '||(d->>'approval_due_date'),e||':'||((d->>'id'))||':'||(d->>'approval_due_date'));
   end if;
  end loop;
  for r in select to_jsonb(x) doc from public.client_reminders x where x.company_id=co.id and lower(coalesce(x.status,''))='pending' and x.due_date<=today loop
   d:=r.doc; targets:=notification_private.targets(co.id,d->'assigned_to'); e:=case when ((d->>'due_date'))::date<today then 'client_reminder_overdue' else 'client_reminder_due' end;
   n:=n+notification_private.emit(co.id,e,case when (d->>'lead_id') is not null then 'Lead' else 'Message' end,coalesce(nullif((d->>'lead_id'),''),(d->>'client_id'))::uuid,null,targets,coalesce((d->>'title'),'Follow up')||': due '||(d->>'due_date'),e||':'||((d->>'id'))||':'||(d->>'due_date'),null);
  end loop;
  for r in select to_jsonb(x) doc from public.client_communications x where x.company_id=co.id and lower(x.direction)='inbound' and x.answered_at is null and x.response_due_at<=p_now
   union all select to_jsonb(x) from public.messages x where x.company_id=co.id and lower(x.sender_type) in ('client','customer') and x.answered_at is null and coalesce(x.response_due_at,x.created_at+interval '1 day')<=p_now loop
   d:=r.doc;
   n:=n+notification_private.emit(co.id,'client_reply_unanswered',case when (d->>'lead_id') is not null then 'Lead' else 'Message' end,coalesce(nullif((d->>'lead_id'),''),(d->>'client_id'))::uuid,null,'{}','A client or lead reply has been waiting for a response for at least one day.','unanswered:'||((d->>'id')),null);
  end loop;
  if lower(replace(coalesce(co.subscription_status,''),' ','_')) in ('active','trialing','trial') and co.subscription_renews_at is not null and (co.subscription_renews_at at time zone tz)::date between today and today+7 then
   n:=n+notification_private.emit(co.id,'subscription_renewal_upcoming','Company',co.id,null,'{}','Your subscription renews on '||((co.subscription_renews_at at time zone tz)::date),'subscription-renewal:'||co.id||':'||co.subscription_renews_at,null);
  end if;
  if co.subscription_card_expiry is not null and co.subscription_card_expiry between today and today+30 then
   n:=n+notification_private.emit(co.id,'subscription_card_expiring','Company',co.id,null,'{}','The subscription payment card expires on '||co.subscription_card_expiry||'. Update the card in billing settings.','subscription-card:'||co.id||':'||co.subscription_card_expiry,null);
  end if;
  select count(*) into active_users from public.profiles p where p.company_id=co.id and p.is_active is distinct from false;
  if coalesce(co.max_users,0)>0 and active_users>=co.max_users then
   n:=n+notification_private.emit(co.id,'subscription_usage_limit','Company',co.id,null,'{}','Your company has '||active_users||' active users against a limit of '||co.max_users||'. Review team access or billing.','subscription-users:'||co.id||':'||co.max_users||':'||today,null);
  end if;
 end loop;
 return n;
end $$;
revoke all on function notification_private.sales_reminders(timestamptz),notification_private.sales_source_event(),notification_private.sales_guard() from public,anon,authenticated;

-- Scope exposed communication rows even where older policies were permissive.
alter table public.client_communications enable row level security;
alter table public.client_reminders enable row level security;
create policy sales_communication_company on public.client_communications as restrictive for all to authenticated
 using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()));
create policy sales_reminder_company on public.client_reminders as restrictive for all to authenticated
 using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()));
create policy sales_communication_member on public.client_communications as restrictive for all to authenticated
 using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=client_communications.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')))
 with check(exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=client_communications.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')));
create policy sales_reminder_member on public.client_reminders as restrictive for all to authenticated
 using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=client_reminders.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')))
 with check(exists(select 1 from public.profiles p where p.id=auth.uid() and p.company_id=client_reminders.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')));
grant select,insert,update,delete on public.client_communications,public.client_reminders to authenticated,service_role;
create policy sales_communication_access on public.client_communications for all to authenticated using(true) with check(true);
create policy sales_reminder_access on public.client_reminders for all to authenticated using(true) with check(true);

revoke all on public.client_communications,public.client_reminders from public,anon;

-- Payment fulfillment is atomic, tenant-bound and keyed by the trusted Checkout session.
alter table public.payments add column if not exists stripe_checkout_session_id text;
alter table public.payments add column if not exists stripe_payment_intent_id text;
create unique index payments_stripe_session on public.payments(stripe_checkout_session_id);
create index payments_stripe_intent on public.payments(stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create table notification_private.quote_deposits(
 stripe_checkout_session_id text primary key,company_id uuid not null references public.companies(id) on delete cascade,
 quote_id uuid not null references public.quotes(id) on delete cascade,amount numeric not null check(amount>0),stripe_payment_intent_id text,created_at timestamptz not null default now()
);
alter table notification_private.quote_deposits enable row level security;
revoke all on notification_private.quote_deposits from public,anon,authenticated;
create or replace function public.record_stripe_payment(p_company uuid,p_type text,p_document uuid,p_account text,p_session text,p_intent text,p_amount numeric,p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.invoices; q public.quotes; affected integer; paid numeric; remaining numeric; schedule_id uuid; allocation numeric; applied numeric; installment record;
begin
 if p_type is null or p_type not in ('invoice','quote') or p_amount is null or p_amount<=0 or p_amount>1000000000 or p_session is null or p_session !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'Invalid Stripe payment'; end if;
 if not exists(select 1 from public.companies c where c.id=p_company and c.stripe_account_id=p_account and p_account is not null) then raise exception 'Stripe account outside company'; end if;
 if p_type='invoice' then
  select * into inv from public.invoices where id=p_document and company_id=p_company for update;
  if not found then raise exception 'Invoice outside company'; end if;
 else
  select * into q from public.quotes where id=p_document and company_id=p_company and is_template is distinct from true for update;
  if not found then raise exception 'Quote outside company'; end if;
 end if;
 insert into notification_private.provider_events(provider,event_id) values('stripe','checkout:'||p_session) on conflict do nothing;
 get diagnostics affected=row_count;
 if affected=0 then return jsonb_build_object('processed',false); end if;
 if p_type='invoice' then
  paid:=greatest(coalesce(inv.amount_paid,0),coalesce((select sum(amount) from public.payments where invoice_id=inv.id and company_id=p_company),0))+p_amount;
  remaining:=greatest(coalesce(inv.total,0)-paid,0);
  -- Keep invoice totals in sync before the existing payment trigger calculates its dedupe bucket.
  update public.invoices set amount_paid=paid,balance_due=remaining,status=case when remaining=0 then 'Paid' else 'Partially Paid' end where id=inv.id and company_id=p_company;
  allocation:=p_amount;
  for installment in select * from public.invoice_payment_schedules where invoice_id=inv.id and company_id=p_company and coalesce(amount_paid,0)<coalesce(amount,0) order by sort_order,id for update loop
   if schedule_id is null then schedule_id:=installment.id; end if;
   applied:=least(allocation,greatest(coalesce(installment.amount,0)-coalesce(installment.amount_paid,0),0));
   if applied>0 then
    update public.invoice_payment_schedules set amount_paid=coalesce(installment.amount_paid,0)+applied,status=case when coalesce(installment.amount_paid,0)+applied>=coalesce(installment.amount,0) then 'Paid' else 'Partially Paid' end,paid_date=case when coalesce(installment.amount_paid,0)+applied>=coalesce(installment.amount,0) then p_paid_at::date else paid_date end where id=installment.id and company_id=p_company;
    allocation:=allocation-applied;
   end if;
   exit when allocation<=0;
  end loop;
  insert into public.payments(company_id,invoice_id,schedule_item_id,amount,payment_method,notes,payment_date,stripe_checkout_session_id,stripe_payment_intent_id)
   values(p_company,inv.id,schedule_id,p_amount,'Stripe','Stripe Checkout payment',p_paid_at::date,p_session,p_intent);
 else
  insert into notification_private.quote_deposits(stripe_checkout_session_id,company_id,quote_id,amount,stripe_payment_intent_id) values(p_session,p_company,q.id,p_amount,p_intent);
  select sum(amount) into paid from notification_private.quote_deposits where company_id=p_company and quote_id=q.id;
  if paid>=coalesce(q.deposit_amount,0) then update public.quotes set status='Paid' where id=q.id and company_id=p_company; end if;
  perform public.record_sales_event(p_company,'quote_deposit_received','Quote',q.id,'Quote deposit received. Open the saved quote to review the payment.','checkout:'||p_session,null);
 end if;
 return jsonb_build_object('processed',true,'amount_paid',paid);
end $$;
revoke all on function public.record_stripe_payment(uuid,text,uuid,text,text,text,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.record_stripe_payment(uuid,text,uuid,text,text,text,numeric,timestamptz) to service_role;

-- Resolve refunds and disputes from previously recorded provider IDs without trusting caller metadata.
create or replace function public.stripe_payment_context(p_intent text,p_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('company_id',p.company_id,'document_type','invoice','document_id',p.invoice_id,'stripe_account_id',c.stripe_account_id) into result from public.payments p join public.companies c on c.id=p.company_id
  where (p_intent is not null and p.stripe_payment_intent_id=p_intent) or (p_session is not null and p.stripe_checkout_session_id=p_session) limit 1;
 if result is null then select jsonb_build_object('company_id',p.company_id,'document_type','quote','document_id',p.quote_id,'stripe_account_id',c.stripe_account_id) into result from notification_private.quote_deposits p join public.companies c on c.id=p.company_id
  where (p_intent is not null and p.stripe_payment_intent_id=p_intent) or (p_session is not null and p.stripe_checkout_session_id=p_session) limit 1; end if;
 return result;
end $$;
revoke all on function public.stripe_payment_context(text,text) from public,anon,authenticated;
grant execute on function public.stripe_payment_context(text,text) to service_role;

-- Signed callbacks can arrive before the sending transaction records its provider ID.
-- Keep a short retry window, then acknowledge legacy/untracked IDs without endless provider retries.
create table notification_private.unregistered_delivery_callbacks(
 provider text not null,provider_id text not null,first_seen_at timestamptz not null default now(),primary key(provider,provider_id)
);
alter table notification_private.unregistered_delivery_callbacks enable row level security;
create index unregistered_callback_retention on notification_private.unregistered_delivery_callbacks(first_seen_at);
revoke all on notification_private.unregistered_delivery_callbacks from public,anon,authenticated;
create or replace function public.retry_unregistered_delivery(p_provider text,p_provider_id text) returns boolean
language plpgsql security definer set search_path='' as $$
declare first_seen timestamptz;
begin
 if p_provider not in ('resend','twilio') or p_provider_id is null or length(p_provider_id)>160 then return false; end if;
 delete from notification_private.unregistered_delivery_callbacks where first_seen_at<now()-interval '7 days';
 insert into notification_private.unregistered_delivery_callbacks(provider,provider_id) values(p_provider,p_provider_id) on conflict do nothing;
 select first_seen_at into first_seen from notification_private.unregistered_delivery_callbacks where provider=p_provider and provider_id=p_provider_id;
 return first_seen>now()-interval '10 minutes';
end $$;
revoke all on function public.retry_unregistered_delivery(text,text) from public,anon,authenticated;
grant execute on function public.retry_unregistered_delivery(text,text) to service_role;
