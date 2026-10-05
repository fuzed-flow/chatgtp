-- Public links can report only activity on their exact saved document UUID.
-- Company IDs, recipients, provider endpoints and server credentials are derived here.
create table notification_private.portal_relay_requests (
 document_id uuid not null,event_key text not null,delivery_day date not null default current_date,
 fingerprint text not null,created_at timestamptz not null default now(),
 primary key(document_id,event_key,delivery_day,fingerprint)
);
alter table notification_private.portal_relay_requests enable row level security;
revoke all on notification_private.portal_relay_requests from public,anon,authenticated;

create or replace function public.request_document_notification(p_document uuid,p_event text,p_message text default '')
returns boolean language plpgsql security definer set search_path='' as $$
declare table_name text; doc jsonb; config jsonb; affected integer; request_id bigint; fingerprint text;
begin
 table_name:=case when p_event in ('quote_viewed','quote_approved','quote_change_requested') then 'quotes'
  when p_event in ('co_viewed','co_approved','change_order_requested') then 'change_orders'
  when p_event='invoice_viewed' then 'invoices' when p_event='po_viewed' then 'purchase_orders' end;
 if table_name is null or p_document is null then raise exception 'Unsupported document activity' using errcode='22023'; end if;
 execute format('select to_jsonb(d) from public.%I d where id=$1',table_name) into doc using p_document;
 if doc is null or doc->>'company_id' is null or doc->>'is_template'='true'
  or lower(coalesce(doc->>'status','draft')) in ('draft','cancelled','canceled','void','expired') then raise exception 'Document unavailable' using errcode='42501'; end if;
 if p_event like '%approved' and lower(doc->>'status') not in ('approved','accepted') then raise exception 'Approval is not recorded'; end if;
 if auth.uid() is not null then
  if not exists(select 1 from public.profiles where id=auth.uid() and company_id=(doc->>'company_id')::uuid and is_active is distinct from false) then raise exception 'Document unavailable' using errcode='42501'; end if;
  if p_event like '%viewed' then return false; end if;
 end if;
 if p_event like '%requested' and length(btrim(coalesce(p_message,''))) not between 1 and 2000 then raise exception 'A change request is required'; end if;
 config:=notification_private.server_config();
 if nullif(config->>'notification_cron_secret','') is null or nullif(config->>'project_url','') is null then raise exception 'Notification relay unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_document::text||p_event,4));
 if (select count(*) from notification_private.portal_relay_requests where document_id=p_document and event_key=p_event and delivery_day=current_date)>=10 then return false; end if;
 fingerprint:=case when p_event like '%requested' then md5(left(p_message,2000)) else '' end;
 insert into notification_private.portal_relay_requests(document_id,event_key,fingerprint) values(p_document,p_event,fingerprint) on conflict do nothing;
 get diagnostics affected=row_count; if affected=0 then return false; end if;
 select net.http_post(
  url:=(config->>'project_url')||'/functions/v1/company-notifier',
  headers:=jsonb_build_object('Content-Type','application/json','X-Notification-Cron-Secret',config->>'notification_cron_secret'),
  body:=jsonb_build_object('company_id',doc->>'company_id','document_uuid',p_document,'event_key',p_event,'message_body',left(coalesce(p_message,''),2000)),
  timeout_milliseconds:=10000
 ) into request_id;
 return true;
end $$;
revoke all on function public.request_document_notification(uuid,text,text) from public;
grant execute on function public.request_document_notification(uuid,text,text) to anon,authenticated;
