-- Keep the original records and provider identifiers so delivery callbacks,
-- answered state, assignments and dates survive conversion without duplicates.
create or replace function sales_private.transfer_lead_client_history(p_lead uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare source public.leads%rowtype;
begin
  select l.* into source from public.leads l
  join public.clients c on c.id=l.client_id and c.company_id=l.company_id
  where l.id=p_lead for update of l;
  if not found then return; end if;

  -- Existing matched clients keep their populated contact details. Fill gaps so
  -- replies to the lead's earlier messages can still verify the saved sender.
  update public.clients c set
    email=coalesce(nullif(btrim(c.email),''),nullif(btrim(source.contact_email),'')),
    phone=coalesce(nullif(btrim(c.phone),''),nullif(btrim(source.contact_phone),''))
  where c.id=source.client_id and c.company_id=source.company_id
    and ((nullif(btrim(c.email),'') is null and nullif(btrim(source.contact_email),'') is not null)
      or (nullif(btrim(c.phone),'') is null and nullif(btrim(source.contact_phone),'') is not null));

  update public.client_communications set client_id=source.client_id,lead_id=null
  where company_id=source.company_id and lead_id=source.id
    and (client_id is null or client_id=source.client_id);
  update public.client_reminders set client_id=source.client_id,lead_id=null
  where company_id=source.company_id and lead_id=source.id
    and (client_id is null or client_id=source.client_id);
  update public.tasks set client_id=source.client_id,lead_id=null
  where company_id=source.company_id and lead_id=source.id
    and (client_id is null or client_id=source.client_id);
  update notification_private.reply_routes set client_id=source.client_id,lead_id=null
  where company_id=source.company_id and lead_id=source.id
    and (client_id is null or client_id=source.client_id);
  update notification_private.outbound_deliveries set client_id=source.client_id,lead_id=null
  where company_id=source.company_id and lead_id=source.id
    and (client_id is null or client_id=source.client_id);
end $$;
revoke all on function sales_private.transfer_lead_client_history(uuid) from public,anon,authenticated;

create or replace function sales_private.lead_client_history_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform sales_private.transfer_lead_client_history(new.id);
  return new;
end $$;
revoke all on function sales_private.lead_client_history_trigger() from public,anon,authenticated;

-- Covers manual conversion, quote conversion, and re-conversion of linked leads.
create trigger lead_client_history_continuity
after insert or update of client_id,pipeline_stage on public.leads
for each row when (new.client_id is not null)
execute function sales_private.lead_client_history_trigger();

-- A provider or an already-open lead page may write after conversion. Lock the
-- saved lead before inserting so an in-flight write cannot be left behind.
create or replace function sales_private.follow_converted_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if new.lead_id is null then return new; end if;
  select l.client_id into target from public.leads l
  where l.id=new.lead_id and l.company_id=new.company_id for share;
  if target is null then return new; end if;
  if not exists(select 1 from public.clients c where c.id=target and c.company_id=new.company_id)
    or (new.client_id is not null and new.client_id<>target) then
    raise exception 'Converted lead client is outside this conversation' using errcode='23514';
  end if;
  new.client_id:=target;
  new.lead_id:=null;
  return new;
end $$;
revoke all on function sales_private.follow_converted_lead() from public,anon,authenticated;

create trigger follow_converted_lead before insert on public.client_communications
for each row execute function sales_private.follow_converted_lead();
create trigger follow_converted_lead before insert on public.client_reminders
for each row execute function sales_private.follow_converted_lead();
create trigger follow_converted_lead before insert on public.tasks
for each row execute function sales_private.follow_converted_lead();
create trigger follow_converted_lead before insert on notification_private.reply_routes
for each row execute function sales_private.follow_converted_lead();
create trigger follow_converted_lead before insert on notification_private.outbound_deliveries
for each row execute function sales_private.follow_converted_lead();

-- Repair history for existing conversions as well as future conversions.
do $$ declare converted record; begin
  for converted in select l.id from public.leads l
    join public.clients c on c.id=l.client_id and c.company_id=l.company_id
    order by l.id
  loop
    perform sales_private.transfer_lead_client_history(converted.id);
  end loop;
end $$;

-- Keep old email tokens and SMS reply registrations attached to the client.
create or replace function public.register_outbound_delivery(p_provider text,p_provider_id text,p_company uuid,p_related text,p_id uuid,p_client uuid default null,p_lead uuid default null,p_actor uuid default null,p_kind text default 'document',p_copy boolean default false,p_recipient text default null,p_sender text default null,p_reply uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare t text; doc jsonb; converted_client uuid;
begin

 -- Resolve a converted lead before validating linked replies or finding routes.
 -- This lock serializes provider registration with the conversion transaction.
 if p_lead is not null then
  select l.client_id into converted_client from public.leads l
  where l.id=p_lead and l.company_id=p_company for share;
  if converted_client is not null then
   if p_client is not null and p_client<>converted_client then raise exception 'Reply outside this conversation'; end if;
   p_client:=converted_client; p_lead:=null;
  end if;
 end if;
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


create or replace function public.create_reply_route(p_company uuid,p_client uuid default null,p_lead uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare route uuid; converted_client uuid;
begin
 if (p_client is null)=(p_lead is null) then raise exception 'A single saved recipient is required'; end if;

 -- Resolve a converted lead before validating linked replies or finding routes.
 -- This lock serializes provider registration with the conversion transaction.
 if p_lead is not null then
  select l.client_id into converted_client from public.leads l
  where l.id=p_lead and l.company_id=p_company for share;
  if converted_client is not null then
   if p_client is not null and p_client<>converted_client then raise exception 'Reply outside this conversation'; end if;
   p_client:=converted_client; p_lead:=null;
  end if;
 end if;
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

