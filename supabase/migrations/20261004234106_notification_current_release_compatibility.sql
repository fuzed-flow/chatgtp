-- Preserve the payment ledger and deposit credit shipped by the storefront review.
-- No historical financial rows are rewritten by this compatibility migration.
create or replace function public.record_stripe_payment(p_company uuid,p_type text,p_document uuid,p_account text,p_session text,p_intent text,p_amount numeric,p_paid_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; saved public.payments; paid numeric;
begin
 if p_type is null or p_type not in ('invoice','quote') or p_amount is null or p_amount<=0 or p_amount>1000000000 or p_session is null or p_session !~ '^cs_[A-Za-z0-9_]+$' then raise exception 'Invalid Stripe payment'; end if;
 if not exists(select 1 from public.companies where id=p_company and stripe_account_id=p_account and p_account is not null) then raise exception 'Stripe account outside company'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 select * into saved from public.payments where stripe_checkout_session_id=p_session;
 if found then
  if saved.company_id is distinct from p_company or (p_type='quote' and saved.quote_id is distinct from p_document) or (p_type='invoice' and saved.invoice_id is distinct from p_document) then raise exception 'Payment context mismatch'; end if;
  return jsonb_build_object('processed',false);
 end if;
 if p_type='quote' and not exists(select 1 from public.quotes where id=p_document and company_id=p_company and is_template is distinct from true) then raise exception 'Quote outside company'; end if;
 result:=public.record_checkout_payment(p_session,p_company,case when p_type='invoice' then p_document end,case when p_type='quote' then p_document end,p_amount,coalesce(p_paid_at,now())::date);
 if (result->>'duplicate')::boolean then return jsonb_build_object('processed',false); end if;
 update public.payments set stripe_payment_intent_id=p_intent where stripe_checkout_session_id=p_session and company_id=p_company;
 insert into notification_private.provider_events(provider,event_id) values('stripe','checkout:'||p_session) on conflict do nothing;
 if p_type='quote' then
  insert into notification_private.quote_deposits(stripe_checkout_session_id,company_id,quote_id,amount,stripe_payment_intent_id) values(p_session,p_company,p_document,p_amount,p_intent) on conflict do nothing;
  select deposit_paid_amount into paid from public.quotes where id=p_document;
  perform public.record_sales_event(p_company,'quote_deposit_received','Quote',p_document,'Quote deposit received. Open the saved quote to review the payment.','checkout:'||p_session,null);
 else
  select amount_paid into paid from public.invoices where id=p_document;
 end if;
 return jsonb_build_object('processed',true,'amount_paid',paid);
end $$;
revoke all on function public.record_stripe_payment(uuid,text,uuid,text,text,text,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.record_stripe_payment(uuid,text,uuid,text,text,text,numeric,timestamptz) to service_role;

create or replace function public.stripe_payment_context(p_intent text,p_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('company_id',p.company_id,'document_type',case when p.quote_id is not null then 'quote' else 'invoice' end,'document_id',coalesce(p.quote_id,p.invoice_id),'stripe_account_id',c.stripe_account_id) into result
 from public.payments p join public.companies c on c.id=p.company_id
 where (p_intent is not null and p.stripe_payment_intent_id=p_intent) or (p_session is not null and p.stripe_checkout_session_id=p_session) limit 1;
 if result is null then
  select jsonb_build_object('company_id',p.company_id,'document_type','quote','document_id',p.quote_id,'stripe_account_id',c.stripe_account_id) into result
  from notification_private.quote_deposits p join public.companies c on c.id=p.company_id
  where (p_intent is not null and p.stripe_payment_intent_id=p_intent) or (p_session is not null and p.stripe_checkout_session_id=p_session) limit 1;
 end if;
 return result;
end $$;
revoke all on function public.stripe_payment_context(text,text) from public,anon,authenticated;
grant execute on function public.stripe_payment_context(text,text) to service_role;

-- Reuse the already configured Connect endpoint and signing key.
create or replace function public.notification_provider_server_config()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_strip_nulls(jsonb_build_object(
  'resend_webhook_secret',(select decrypted_secret from vault.decrypted_secrets where name='resend_webhook_secret' limit 1),
  'resend_reply_domain',(select decrypted_secret from vault.decrypted_secrets where name='resend_reply_domain' limit 1),
  'stripe_connect_webhook_secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='fuzedflow_stripe_connect_webhook' limit 1),(select decrypted_secret from vault.decrypted_secrets where name='stripe_connect_webhook_secret' limit 1))
 ))
$$;
revoke all on function public.notification_provider_server_config() from public,anon,authenticated;
grant execute on function public.notification_provider_server_config() to service_role;
