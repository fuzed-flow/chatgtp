-- Route FuzedFlow subscription lifecycle alerts to the owners' .com mailbox.

create or replace function notification_private.enqueue_subscription_owner_email(
  p_company uuid,
  p_stripe_event_id text,
  p_event text,
  p_subject text,
  p_body text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  job uuid:=gen_random_uuid();
  action_url constant text:='https://app.fuzedflow.com/AdminSettings';
begin
  if not exists(select 1 from public.companies where id=p_company) then
    raise exception 'Company not found' using errcode='23503';
  end if;
  if p_stripe_event_id !~ '^evt_[A-Za-z0-9_]{1,155}$' then
    raise exception 'Invalid Stripe event id' using errcode='22023';
  end if;
  if p_event not in (
    'platform_subscription_created',
    'platform_subscription_updated',
    'platform_subscription_cancellation_scheduled',
    'platform_subscription_cancellation_removed',
    'platform_subscription_cancelled'
  ) then
    raise exception 'Unsupported subscription email event' using errcode='22023';
  end if;
  if nullif(trim(p_subject),'') is null or length(p_subject)>250
    or nullif(trim(p_body),'') is null or length(p_body)>10000 then
    raise exception 'Invalid subscription email content' using errcode='22023';
  end if;

  insert into notification_private.delivery_outbox(
    id,company_id,job_kind,channel,dedupe_key,payload
  ) values(
    job,p_company,'transactional','email','stripe-subscription:'||p_stripe_event_id,
    jsonb_build_object(
      'to','info@fuzedflow.com',
      'title',replace(replace(trim(p_subject),chr(13),' '),chr(10),' '),
      'body',trim(p_body),
      'url',action_url,
      'reference_id',job,
      'event_key',p_event,
      'stripe_event_id',p_stripe_event_id
    )
  )
  on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key
  returning id into job;
  return job;
end $$;
revoke all on function notification_private.enqueue_subscription_owner_email(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function notification_private.enqueue_subscription_owner_email(uuid,text,text,text,text) to service_role;

create or replace function workflow_private.notification_request_mail_allowed(p_reference uuid,p_event text,p_url text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare t text; cap workflow_private.capabilities;
begin
 if p_event in (
   'platform_subscription_created',
   'platform_subscription_updated',
   'platform_subscription_cancellation_scheduled',
   'platform_subscription_cancellation_removed',
   'platform_subscription_cancelled'
 ) then
   return p_url='https://app.fuzedflow.com/AdminSettings' and exists(
     select 1 from notification_private.delivery_outbox d
     where d.id=p_reference
       and d.job_kind='transactional'
       and d.channel='email'
       and d.payload->>'reference_id'=p_reference::text
       and d.payload->>'event_key'=p_event
       and d.payload->>'to'='info@fuzedflow.com'
       and d.dedupe_key='stripe-subscription:'||(d.payload->>'stripe_event_id')
   );
 end if;
 if p_event='support_request' then
   return exists(select 1 from public.support_ticket_messages m join public.support_tickets ticket on ticket.id=m.ticket_id and ticket.company_id=m.company_id
     join public.profiles p on p.id=ticket.user_id and p.company_id=ticket.company_id and p.is_active is distinct from false
     where m.id=p_reference and m.is_support=false and p_url='https://app.fuzedflow.com/Contact?ticket='||ticket.id);
 end if;
 t:=substring(p_url from '[?]token=([0-9a-f]{64})$');
 if t is null then return false; end if;
 select * into cap from workflow_private.capabilities where token_hash=workflow_private.token_hash(t) and entity_id=p_reference and revoked_at is null and expires_at>now();
 if not found then return false; end if;
 if p_event ~ '^document_(request|reminder)' then
   return cap.kind='document' and p_url='https://app.fuzedflow.com/DocumentResponse?token='||t and exists(select 1 from public.document_requests r where r.id=p_reference and r.company_id=cap.company_id and r.status='Pending' and r.expires_at>now());
 elsif p_event ~ '^warranty_access_' then
   return cap.kind='warranty' and p_url='https://app.fuzedflow.com/WarrantyResponse?token='||t and exists(select 1 from workflow_private.warranty_portals p where p.id=p_reference and p.company_id=cap.company_id);
 end if;
 return false;
end $$;
revoke all on function workflow_private.notification_request_mail_allowed(uuid,text,text) from public,anon,authenticated;
grant execute on function workflow_private.notification_request_mail_allowed(uuid,text,text) to service_role;
