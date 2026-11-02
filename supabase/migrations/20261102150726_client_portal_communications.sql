-- Portal messages use the existing conversation, with a narrow token-authorized
-- projection. No anonymous table grants or internal communication access.
create schema if not exists portal_private;
revoke all on schema portal_private from public,anon,authenticated;
create table portal_private.communication_links(
  token_hash text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '180 days',
  revoked_at timestamptz
);
create index portal_communication_links_client on portal_private.communication_links(company_id,client_id);
alter table portal_private.communication_links enable row level security;
revoke all on portal_private.communication_links from public,anon,authenticated;

create table portal_private.message_intents(
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  request_id uuid not null,
  communication_id uuid not null references public.client_communications(id) on delete cascade,
  fingerprint text not null,
  status text not null default 'pending' check(status in('pending','sent','failed','unknown')),
  provider text,
  provider_id text,
  created_at timestamptz not null default now(),
  primary key(company_id,client_id,request_id)
);
create index portal_message_rate on portal_private.message_intents(company_id,client_id,created_at);
create index portal_message_communication on portal_private.message_intents(communication_id);
create index if not exists portal_client_message_history on public.client_communications(company_id,client_id,created_at desc,id desc) where lead_id is null;
alter table portal_private.message_intents enable row level security;
revoke all on portal_private.message_intents from public,anon,authenticated;

create or replace function portal_private.communication_client(p_client uuid,p_token text,p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare co uuid; valid boolean:=false;
begin
  if p_client is null or p_token is null or length(p_token)<32 or length(p_token)>256 then
    raise exception 'Open a valid private client portal link to view messages.' using errcode='42501';
  end if;
  select company_id into co from public.clients where id=p_client;
  if co is null then raise exception 'This private portal link is unavailable.' using errcode='42501'; end if;
  if p_kind='portal' then
    select exists(select 1 from portal_private.communication_links l where l.client_id=p_client and l.company_id=co
      and l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null and l.expires_at>clock_timestamp()) into valid;
  elsif p_kind='quote' then
    select exists(select 1 from public.quote_approvals a join public.quotes q on q.id=a.quote_id and q.company_id=a.company_id
      where q.client_id=p_client and q.company_id=co and a.approval_token=p_token and (a.client_id is null or a.client_id=p_client) and coalesce(a.approval_status,'')<>'Revoked'
      and q.is_template is distinct from true and lower(coalesce(q.status,'')) not in('draft','pending review','cancelled','void')) into valid;
  elsif p_kind='invoice' then
    select exists(select 1 from public.invoice_share_links l join public.invoices i on i.id=l.invoice_id and i.company_id=l.company_id and i.client_id=l.client_id
      where l.client_id=p_client and l.company_id=co and l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and l.status='Active' and l.revoked_at is null and (l.expires_at is null or l.expires_at>clock_timestamp())
      and lower(coalesce(i.status,'')) in('sent','viewed','issued','partial','partially paid','overdue','past due','paid')) into valid;
  elsif p_kind='change_order' then
    select exists(select 1 from public.change_order_share_links l join public.change_orders d on d.id=l.change_order_id and d.company_id=l.company_id
      where l.client_id=p_client and l.company_id=co and coalesce(d.client_id,(select p.client_id from public.projects p where p.id=d.project_id and p.company_id=co))=p_client
      and l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.status='Active' and l.revoked_at is null
      and (l.expires_at is null or l.expires_at>clock_timestamp()) and lower(coalesce(d.status,'')) not in('draft','pending review','cancelled','void')) into valid;
  end if;
  if not valid then raise exception 'This private portal link is unavailable. Ask your contractor for a fresh link.' using errcode='42501'; end if;
  return co;
end $$;
revoke all on function portal_private.communication_client(uuid,text,text) from public,anon,authenticated;

create or replace function portal_private.client_messaging_enabled(p_features jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_features)='string' then
    begin p_features:=(p_features#>>'{}')::jsonb;
    exception when invalid_text_representation then return false; end;
  end if;
  return p_features->'direct_messaging' is distinct from 'false'::jsonb;
end $$;
revoke all on function portal_private.client_messaging_enabled(jsonb) from public,anon,authenticated;

create or replace function portal_private.communications_enabled(p_company uuid,p_client uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.companies c join public.clients cl on cl.company_id=c.id
    where c.id=p_company and cl.id=p_client
    and c.settings->'client_portal'->'show_communications'='true'::jsonb
    and c.settings->'client_portal'->'portal_active' is distinct from 'false'::jsonb
    and portal_private.client_messaging_enabled(cl.portal_features))
$$;
revoke all on function portal_private.communications_enabled(uuid,uuid) from public,anon,authenticated;

create or replace function public.issue_client_portal_communication_token(p_client uuid)
returns text language plpgsql security definer set search_path='' as $$
declare co uuid; token text;
begin
  select c.company_id into co from public.clients c join public.profiles p on p.company_id=c.company_id
    where c.id=p_client and p.id=auth.uid() and p.is_active is distinct from false and p.role in('owner','admin','manager','office');
  if co is null then raise exception 'Active company access required.' using errcode='42501'; end if;
  if not portal_private.communications_enabled(co,p_client) then return null; end if;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into portal_private.communication_links(token_hash,company_id,client_id)
    values(encode(extensions.digest(token,'sha256'),'hex'),co,p_client);
  return token;
end $$;
revoke all on function public.issue_client_portal_communication_token(uuid) from public,anon,authenticated;
grant execute on function public.issue_client_portal_communication_token(uuid) to authenticated;

-- Match outbound deliveries to the saved client's destination; do not reveal
-- company copies, messages to other recipients, manual call logs or documents.
create or replace function portal_private.shared_communication(m public.client_communications)
returns boolean language sql stable security definer set search_path='' as $$
 select (m).lead_id is null and (m).type in('Email','SMS')
   and ((m).delivery_kind is null or (m).delivery_kind='communication')
   and (
     ((m).provider='portal' and lower((m).direction)='inbound' and exists(select 1 from portal_private.message_intents i where i.communication_id=(m).id and i.company_id=(m).company_id and i.client_id=(m).client_id))
     or ((m).provider in('resend','twilio') and (m).provider_message_id is not null and lower((m).direction)='inbound')
     or ((m).provider in('resend','twilio') and (m).provider_message_id is not null and lower((m).direction)='outbound'
       and exists(select 1 from notification_private.outbound_deliveries d join public.clients c on c.id=d.client_id and c.company_id=d.company_id
         where d.company_id=(m).company_id and d.client_id=(m).client_id and d.provider=(m).provider and d.provider_id=(m).provider_message_id
         and not d.is_copy and d.kind='communication'
         and (((m).type='Email' and lower(btrim(d.recipient))=lower(btrim(c.email)))
           or ((m).type='SMS' and notification_private.normalize_phone(d.recipient)=notification_private.normalize_phone(c.phone)))))
   )
$$;
revoke all on function portal_private.shared_communication(public.client_communications) from public,anon,authenticated;

create or replace function public.get_client_portal_communications(p_client uuid,p_token text,p_kind text,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid; result jsonb; company public.companies;
begin
  co:=portal_private.communication_client(p_client,p_token,p_kind);
  if not portal_private.communications_enabled(co,p_client) then return jsonb_build_object('enabled',false,'messages','[]'::jsonb); end if;
  if p_before is not null and p_before_id is null then raise exception 'Invalid message page.'; end if;
  select * into company from public.companies where id=co;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc,m.id desc),'[]'::jsonb) into result from (
    select id,type,subject,message,direction,status,created_at from public.client_communications m
    where company_id=co and client_id=p_client and lead_id is null
      and portal_private.shared_communication(m)
      and (p_before is null or (created_at,id)<(p_before,p_before_id))
    order by created_at desc,id desc limit 51
  ) m;
  return jsonb_build_object('enabled',true,'company_name',company.name,
    'email_available',nullif(btrim(company.settings->>'email'),'') is not null,
    'sms_available',nullif(btrim(coalesce(nullif(company.phone,''),company.settings->>'phone')),'') is not null,
    'has_more',jsonb_array_length(result)>50,
    'messages',case when jsonb_array_length(result)>50 then result-50 else result end);
end $$;
revoke all on function public.get_client_portal_communications(uuid,text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.get_client_portal_communications(uuid,text,text,timestamptz,uuid) to anon,authenticated;

-- Only the service endpoint may create a portal message or access its fixed
-- recipient. Validate the capability and the current on/off setting every time.
create or replace function public.claim_client_portal_message(p_client uuid,p_token text,p_kind text,p_request uuid,p_channel text,p_subject text,p_message text,p_reply uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co uuid; company public.companies; client public.clients; previous portal_private.message_intents;
  fingerprint text; message_id uuid; recipient text; reply public.client_communications;
begin
  co:=portal_private.communication_client(p_client,p_token,p_kind);
  if not portal_private.communications_enabled(co,p_client) then raise exception 'Messaging is unavailable in this portal.' using errcode='42501'; end if;
  p_message:=btrim(p_message);p_subject:=btrim(regexp_replace(coalesce(p_subject,''),'[\r\n]+',' ','g'));
  if p_request is null or p_channel not in('Email','SMS') or p_channel is null or p_message is null or length(p_message)<1
    or length(p_message)>(case when p_channel='SMS' then 1600 else 5000 end) or length(p_subject)>160
    or (p_channel='Email' and length(p_subject)=0) then raise exception 'Enter a valid subject and message.' using errcode='22023'; end if;
  select * into company from public.companies where id=co;
  select * into client from public.clients where id=p_client and company_id=co;
  recipient:=case when p_channel='Email' then nullif(btrim(company.settings->>'email'),'') else coalesce(nullif(btrim(company.phone),''),nullif(btrim(company.settings->>'phone'),'')) end;
  if recipient is null then raise exception 'Your contractor has not configured this contact method.' using errcode='22023'; end if;
  if p_reply is not null then
    select * into reply from public.client_communications m where id=p_reply and company_id=co and client_id=p_client
      and lower(direction)='outbound' and portal_private.shared_communication(m);
    if not found then raise exception 'Message is outside this conversation.' using errcode='42501'; end if;
  end if;
  fingerprint:=encode(extensions.digest(jsonb_build_array(p_channel,p_subject,p_message,p_reply,recipient)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('portal-message:'||co::text||p_client::text,0));
  select * into previous from portal_private.message_intents where company_id=co and client_id=p_client and request_id=p_request for update;
  if found then
    if previous.fingerprint<>fingerprint then raise exception 'This send request has changed. Start a new message.' using errcode='22023'; end if;
    return jsonb_build_object('claimed',false,'status',previous.status,'message_id',previous.communication_id);
  end if;
  if (select count(*) from portal_private.message_intents where company_id=co and client_id=p_client and created_at>now()-interval '1 hour')>=10
    or (select count(*) from portal_private.message_intents where company_id=co and created_at>now()-interval '1 hour')>=100 then
    raise exception 'Message limit reached. Please try again later.' using errcode='54000';
  end if;
  insert into public.client_communications(company_id,client_id,type,direction,subject,message,status,sent_by,provider,provider_message_id,delivery_kind,response_due_at)
    values(co,p_client,p_channel,'Inbound',case when p_channel='SMS' then 'SMS from client portal' else p_subject end,p_message,'Sending',
      coalesce(nullif(client.name,''),'Client')||' (client portal)','portal',p_client::text||':'||p_request::text,'communication',now()+interval '1 day') returning id into message_id;
  insert into portal_private.message_intents(company_id,client_id,request_id,communication_id,fingerprint) values(co,p_client,p_request,message_id,fingerprint);
  return jsonb_build_object('claimed',true,'message_id',message_id,'company_id',co,'company_name',company.name,
    'client_name',client.name,'client_email',client.email,'recipient',recipient,'channel',p_channel,'subject',p_subject,'message',p_message);
end $$;
revoke all on function public.claim_client_portal_message(uuid,text,text,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_client_portal_message(uuid,text,text,uuid,text,text,text,uuid) to service_role;

create or replace function public.finish_client_portal_message(p_client uuid,p_request uuid,p_status text,p_provider text default null,p_provider_id text default null)
returns void language plpgsql security definer set search_path='' as $$
declare intent portal_private.message_intents;
begin
  if p_status is null or p_status not in('sent','failed','unknown') then raise exception 'Invalid message outcome.'; end if;
  select * into intent from portal_private.message_intents where client_id=p_client and request_id=p_request for update;
  if not found or intent.status<>'pending' then return; end if;
  update portal_private.message_intents set status=p_status,provider=p_provider,provider_id=p_provider_id
    where company_id=intent.company_id and client_id=p_client and request_id=p_request;
  update public.client_communications set status=case p_status when 'sent' then 'Sent' when 'failed' then 'Failed' else 'Unconfirmed' end
    where id=intent.communication_id and client_id=p_client and company_id=intent.company_id;
end $$;
revoke all on function public.finish_client_portal_message(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.finish_client_portal_message(uuid,uuid,text,text,text) to service_role;
