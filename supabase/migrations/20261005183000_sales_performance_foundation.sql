-- Sales performance uses the existing lead, quote, communication and payment
-- workflows. This additive foundation records reliable transition timestamps,
-- provides an append-only activity feed and stores company/rep monthly targets.

alter table public.leads add column if not exists assigned_to_user_id uuid references public.profiles(id) on delete set null;
alter table public.leads add column if not exists stage_changed_at timestamptz;
alter table public.leads add column if not exists first_contact_at timestamptz;
alter table public.leads add column if not exists qualified_at timestamptz;
alter table public.leads add column if not exists appointment_at timestamptz;
alter table public.leads add column if not exists quote_sent_at timestamptz;
alter table public.leads add column if not exists won_at timestamptz;
alter table public.leads add column if not exists lost_at timestamptz;
alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists probability smallint check(probability between 0 and 100);
alter table public.leads add column if not exists expected_close_date date;
alter table public.leads add column if not exists service_type text;
alter table public.leads add column if not exists campaign text;
alter table public.leads add column if not exists branch text;

update public.leads
set stage_changed_at=coalesce(stage_changed_at,created_at,now());

update public.leads l
set assigned_to_user_id=p.id
from public.profiles p
where l.assigned_to_user_id is null
  and p.company_id=l.company_id
  and p.is_active is distinct from false
  and (l.assigned_to=p.id::text or lower(l.assigned_to)=lower(p.email) or lower(l.assigned_to)=lower(p.full_name));

alter table public.leads alter column stage_changed_at set default now();
alter table public.leads alter column stage_changed_at set not null;
create index if not exists sales_leads_period on public.leads(company_id,created_at desc);
create index if not exists sales_leads_assignee on public.leads(company_id,assigned_to_user_id,created_at desc);
create index if not exists sales_leads_pipeline on public.leads(company_id,pipeline_stage,created_at desc);
create index if not exists sales_leads_followup_health on public.leads(company_id,next_follow_up_date) where next_follow_up_date is not null;

create table if not exists public.sales_activities(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 lead_id uuid references public.leads(id) on delete cascade,
 client_id uuid references public.clients(id) on delete set null,
 quote_id uuid references public.quotes(id) on delete set null,
 user_id uuid references public.profiles(id) on delete set null,
 activity_type text not null check(activity_type ~ '^[a-z][a-z0-9_]{1,49}$'),
 title text not null check(char_length(title) between 1 and 240),
 description text,
 metadata jsonb not null default '{}'::jsonb,
 source_table text,
 source_id uuid,
 source_event text,
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 check(lead_id is not null or client_id is not null or quote_id is not null)
);
create unique index if not exists sales_activity_source_once on public.sales_activities(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null;
create index if not exists sales_activity_company_time on public.sales_activities(company_id,occurred_at desc);
create index if not exists sales_activity_lead_time on public.sales_activities(company_id,lead_id,occurred_at desc) where lead_id is not null;

create table if not exists public.sales_targets(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 period_start date not null check(period_start=date_trunc('month',period_start)::date),
 revenue_target numeric not null default 0 check(revenue_target>=0),
 deals_target integer not null default 0 check(deals_target>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists sales_target_company_period on public.sales_targets(company_id,period_start) where user_id is null;
create unique index if not exists sales_target_rep_period on public.sales_targets(company_id,user_id,period_start) where user_id is not null;
create index if not exists sales_targets_period on public.sales_targets(company_id,period_start desc);

alter table public.sales_activities enable row level security;
alter table public.sales_targets enable row level security;
revoke all on public.sales_activities,public.sales_targets from public,anon;
grant select on public.sales_activities to authenticated;
grant select,insert,update,delete on public.sales_targets to authenticated;
grant all on public.sales_activities,public.sales_targets to service_role;

create policy sales_activity_company_boundary on public.sales_activities as restrictive for all to authenticated
 using(company_id=(select public.get_auth_company_id()))
 with check(company_id=(select public.get_auth_company_id()));
create policy sales_activity_management_read on public.sales_activities for select to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=sales_activities.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')));
create policy sales_target_company_boundary on public.sales_targets as restrictive for all to authenticated
 using(company_id=(select public.get_auth_company_id()))
 with check(company_id=(select public.get_auth_company_id()));
create policy sales_target_management on public.sales_targets for all to authenticated
 using(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=sales_targets.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')))
 with check(exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.company_id=sales_targets.company_id and p.is_active is distinct from false and p.role in ('owner','admin','manager','office')));

create schema if not exists sales_private;
revoke all on schema sales_private from public,anon,authenticated;

create or replace function sales_private.add_activity(
 p_company uuid,p_lead uuid,p_client uuid,p_quote uuid,p_user uuid,p_type text,p_title text,
 p_description text,p_metadata jsonb,p_source_table text,p_source_id uuid,p_source_event text,p_occurred_at timestamptz
) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_company is null or p_type !~ '^[a-z][a-z0-9_]{1,49}$' or nullif(trim(p_title),'') is null then return; end if;
 if p_lead is null and p_client is null and p_quote is null then return; end if;
 insert into public.sales_activities(company_id,lead_id,client_id,quote_id,user_id,activity_type,title,description,metadata,source_table,source_id,source_event,occurred_at)
 values(p_company,p_lead,p_client,p_quote,p_user,p_type,left(trim(p_title),240),nullif(trim(p_description),''),coalesce(p_metadata,'{}'::jsonb),p_source_table,p_source_id,p_source_event,coalesce(p_occurred_at,now()))
 on conflict(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null do nothing;
end $$;
revoke all on function sales_private.add_activity(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,uuid,text,timestamptz) from public,anon,authenticated;

create or replace function sales_private.lead_before_write() returns trigger language plpgsql security definer set search_path='' as $$
declare p_company uuid;
begin
 if (tg_op='INSERT' and new.assigned_to_user_id is null) or (tg_op='UPDATE' and new.assigned_to is distinct from old.assigned_to) then
  new.assigned_to_user_id=null;
  if nullif(trim(new.assigned_to),'') is not null then
   select id into new.assigned_to_user_id from public.profiles
   where company_id=new.company_id and is_active is distinct from false
    and (id::text=new.assigned_to or lower(email)=lower(new.assigned_to) or lower(full_name)=lower(new.assigned_to))
   order by id limit 1;
  end if;
 end if;
 if new.assigned_to_user_id is not null then
  select company_id into p_company from public.profiles where id=new.assigned_to_user_id and is_active is distinct from false;
  if p_company is distinct from new.company_id then raise exception 'Sales assignee must belong to this company' using errcode='23514'; end if;
 end if;
 if tg_op='INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
  new.stage_changed_at=now();
  case lower(coalesce(new.pipeline_stage,''))
   when 'contacted' then new.first_contact_at=coalesce(new.first_contact_at,now());
   when 'qualified' then new.qualified_at=coalesce(new.qualified_at,now());
   when 'booked visit' then new.appointment_at=coalesce(new.appointment_at,now());
   when 'appointment scheduled' then new.appointment_at=coalesce(new.appointment_at,now());
   when 'quoted' then new.quote_sent_at=coalesce(new.quote_sent_at,now());
   when 'quote sent' then new.quote_sent_at=coalesce(new.quote_sent_at,now());
   when 'won' then new.won_at=coalesce(new.won_at,now());
   when 'lost' then new.lost_at=coalesce(new.lost_at,now());
   else null;
  end case;
 end if;
 return new;
end $$;
revoke all on function sales_private.lead_before_write() from public,anon,authenticated;
drop trigger if exists sales_lead_before_write on public.leads;
create trigger sales_lead_before_write before insert or update of pipeline_stage,assigned_to,assigned_to_user_id on public.leads for each row execute function sales_private.lead_before_write();

create or replace function sales_private.lead_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); kind text; label text;
begin
 if actor is not null and not exists(select 1 from public.profiles p where p.id=actor and p.company_id=new.company_id) then actor=null; end if;
 if tg_op='INSERT' then
  perform sales_private.add_activity(new.company_id,new.id,new.client_id,null,actor,'lead_created','New lead: '||new.contact_name,null,jsonb_build_object('stage',new.pipeline_stage,'source',new.source),'leads',new.id,'created',new.created_at);
 elsif new.pipeline_stage is distinct from old.pipeline_stage then
  kind:=case lower(coalesce(new.pipeline_stage,'')) when 'won' then 'deal_won' when 'lost' then 'deal_lost' else 'stage_changed' end;
  label:=case kind when 'deal_won' then 'Deal won: ' when 'deal_lost' then 'Deal lost: ' else 'Stage changed: ' end||new.contact_name;
  perform sales_private.add_activity(new.company_id,new.id,new.client_id,null,actor,kind,label,'Moved from '||coalesce(old.pipeline_stage,'Unassigned')||' to '||coalesce(new.pipeline_stage,'Unassigned'),jsonb_build_object('from',old.pipeline_stage,'to',new.pipeline_stage,'value',new.value_estimate),'leads',new.id,'stage:'||coalesce(new.pipeline_stage,'')||':'||new.stage_changed_at::text,new.stage_changed_at);
 end if;
 return new;
end $$;
revoke all on function sales_private.lead_activity() from public,anon,authenticated;
drop trigger if exists sales_lead_activity on public.leads;
create trigger sales_lead_activity after insert or update of pipeline_stage on public.leads for each row execute function sales_private.lead_activity();

create or replace function sales_private.quote_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; label text; event text; happened timestamptz;
begin
 if coalesce(new.is_template,false) then return new; end if;
 if tg_op='INSERT' then kind:='quote_created';label:='Quote created: '||new.title;event:='created';happened:=new.created_at;
 elsif new.status is distinct from old.status then
  kind:=case lower(coalesce(new.status,'')) when 'sent' then 'quote_sent' when 'approved' then 'quote_approved' when 'declined' then 'quote_declined' else 'quote_status_changed' end;
  label:=case lower(coalesce(new.status,'')) when 'sent' then 'Quote sent: ' when 'approved' then 'Quote approved: ' when 'declined' then 'Quote declined: ' else 'Quote updated: ' end||new.title;
  happened:=coalesce(new.updated_at,now());event:='status:'||coalesce(new.status,'')||':'||happened::text;
 else return new; end if;
 perform sales_private.add_activity(new.company_id,new.lead_id,new.client_id,new.id,new.user_id,kind,label,null,jsonb_build_object('status',new.status,'total',new.total,'quote_number',new.quote_number),'quotes',new.id,event,happened);
 return new;
end $$;
revoke all on function sales_private.quote_activity() from public,anon,authenticated;
drop trigger if exists sales_quote_activity on public.quotes;
create trigger sales_quote_activity after insert or update of status on public.quotes for each row execute function sales_private.quote_activity();

create or replace function sales_private.quote_view_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare q public.quotes;
begin
 select * into q from public.quotes where id=new.quote_id;
 if not found or coalesce(q.is_template,false) then return new; end if;
 perform sales_private.add_activity(q.company_id,q.lead_id,q.client_id,q.id,null,'proposal_viewed','Quote viewed: '||q.title,null,jsonb_build_object('viewer_type',new.viewer_type,'quote_number',q.quote_number),'quote_views',new.id,'viewed',new.viewed_at);
 return new;
end $$;
revoke all on function sales_private.quote_view_activity() from public,anon,authenticated;
drop trigger if exists sales_quote_view_activity on public.quote_views;
create trigger sales_quote_view_activity after insert on public.quote_views for each row execute function sales_private.quote_view_activity();

create or replace function sales_private.communication_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if lower(coalesce(new.direction,''))!='outbound' then return new; end if;
 kind:=case lower(new.type) when 'sms' then 'sms' when 'call' then 'call' else 'email' end;
 perform sales_private.add_activity(new.company_id,new.lead_id,new.client_id,null,null,kind,coalesce(new.subject,initcap(kind)),left(coalesce(new.message,''),500),jsonb_build_object('status',new.status,'direction',new.direction),'client_communications',new.id,'sent',new.created_at);
 return new;
end $$;
revoke all on function sales_private.communication_activity() from public,anon,authenticated;
drop trigger if exists sales_communication_activity on public.client_communications;
create trigger sales_communication_activity after insert on public.client_communications for each row execute function sales_private.communication_activity();

create or replace function sales_private.payment_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare qid uuid:=new.quote_id; q public.quotes; inv public.invoices;
begin
 if qid is null and new.invoice_id is not null then select * into inv from public.invoices where id=new.invoice_id; qid:=inv.quote_id; end if;
 if qid is not null then select * into q from public.quotes where id=qid; end if;
 if q.id is null then return new; end if;
 perform sales_private.add_activity(coalesce(new.company_id,q.company_id),q.lead_id,q.client_id,q.id,null,'payment_received','Payment received: '||q.title,null,jsonb_build_object('amount',new.amount,'payment_method',new.payment_method),'payments',new.id,'received',coalesce(new.payment_date::timestamptz,new.created_at));
 return new;
end $$;
revoke all on function sales_private.payment_activity() from public,anon,authenticated;
drop trigger if exists sales_payment_activity on public.payments;
create trigger sales_payment_activity after insert on public.payments for each row execute function sales_private.payment_activity();

create or replace function sales_private.target_before_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.user_id is not null and not exists(select 1 from public.profiles p where p.id=new.user_id and p.company_id=new.company_id and p.is_active is distinct from false) then raise exception 'Sales target user must belong to this company' using errcode='23514'; end if;
 new.updated_at=now();return new;
end $$;
revoke all on function sales_private.target_before_write() from public,anon,authenticated;
drop trigger if exists sales_target_before_write on public.sales_targets;
create trigger sales_target_before_write before insert or update on public.sales_targets for each row execute function sales_private.target_before_write();

-- Backfill a compact activity history from authoritative existing records.
insert into public.sales_activities(company_id,lead_id,client_id,activity_type,title,metadata,source_table,source_id,source_event,occurred_at)
select company_id,id,client_id,'lead_created','New lead: '||contact_name,jsonb_build_object('stage',pipeline_stage,'source',source),'leads',id,'created',created_at from public.leads
on conflict(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null do nothing;
insert into public.sales_activities(company_id,lead_id,client_id,quote_id,user_id,activity_type,title,metadata,source_table,source_id,source_event,occurred_at)
select company_id,lead_id,client_id,id,user_id,'quote_created','Quote created: '||title,
 jsonb_build_object('current_status',status,'total',total,'quote_number',quote_number,'historical_snapshot',true),'quotes',id,'created',created_at
from public.quotes where coalesce(is_template,false)=false
on conflict(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null do nothing;
insert into public.sales_activities(company_id,lead_id,client_id,quote_id,activity_type,title,metadata,source_table,source_id,source_event,occurred_at)
select q.company_id,q.lead_id,q.client_id,q.id,'proposal_viewed','Quote viewed: '||q.title,jsonb_build_object('viewer_type',v.viewer_type,'quote_number',q.quote_number),'quote_views',v.id,'viewed',v.viewed_at
from public.quote_views v join public.quotes q on q.id=v.quote_id where coalesce(q.is_template,false)=false
on conflict(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null do nothing;
insert into public.sales_activities(company_id,lead_id,client_id,activity_type,title,description,metadata,source_table,source_id,source_event,occurred_at)
select company_id,lead_id,client_id,case lower(type) when 'sms' then 'sms' when 'call' then 'call' else 'email' end,coalesce(subject,type),left(coalesce(message,''),500),jsonb_build_object('status',status,'direction',direction),'client_communications',id,'sent',created_at
from public.client_communications where lower(coalesce(direction,''))='outbound' and (lead_id is not null or client_id is not null)
on conflict(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null do nothing;
insert into public.sales_activities(company_id,lead_id,client_id,quote_id,activity_type,title,metadata,source_table,source_id,source_event,occurred_at)
select coalesce(p.company_id,q.company_id),q.lead_id,q.client_id,q.id,'payment_received','Payment received: '||q.title,jsonb_build_object('amount',p.amount,'payment_method',p.payment_method),'payments',p.id,'received',coalesce(p.payment_date::timestamptz,p.created_at)
from public.payments p left join public.invoices i on i.id=p.invoice_id join public.quotes q on q.id=coalesce(p.quote_id,i.quote_id)
on conflict(company_id,source_table,source_id,source_event) where source_table is not null and source_id is not null and source_event is not null do nothing;

do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sales_activities') then
  alter publication supabase_realtime add table public.sales_activities;
 end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sales_targets') then
  alter publication supabase_realtime add table public.sales_targets;
 end if;
end $$;
