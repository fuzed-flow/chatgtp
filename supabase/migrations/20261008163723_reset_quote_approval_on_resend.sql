-- A resent quote starts a new response cycle. Keep the existing opaque token so
-- a delivery already accepted by the email/SMS provider remains valid, while
-- removing the prior decision and any selections tied to replaced line IDs.
create or replace function public.reset_quote_approval_cycle(p_quote uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  actor public.profiles;
  result_token text;
  approval_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into q from public.quotes where id = p_quote for update;
  if not found or q.is_template is true then
    raise exception 'Quote unavailable' using errcode = 'P0002';
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid()
    and company_id = q.company_id
    and is_active is distinct from false;

  if not found or actor.role not in ('owner', 'admin', 'manager', 'office') then
    raise exception 'Quote sharing permission required' using errcode = '42501';
  end if;

  select id, approval_token into approval_id, result_token
  from public.quote_approvals
  where quote_id = q.id
    and company_id = q.company_id
    and coalesce(approval_status, '') <> 'Revoked'
  order by created_at desc nulls last, id desc
  limit 1
  for update;

  if result_token is null then
    result_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.quote_approvals(
      company_id, quote_id, client_id, approval_token, approval_status, sent_at
    ) values (
      q.company_id, q.id, q.client_id, result_token, 'Sent', now()
    );
  else
    update public.quote_approvals
    set client_id = q.client_id,
        approval_status = 'Sent',
        sent_at = now(),
        viewed_at = null,
        signed_at = null,
        signer_name = null,
        signer_email = null,
        client_ip = null
    where id = approval_id;
  end if;

  update public.quotes
  set client_selected_items = '{}'::jsonb,
      client_selected_items_json = null,
      client_signature = null,
      signed_at = null,
      signed_by = null,
      decline_reason = null,
      viewed_at = null
  where id = q.id;

  return result_token;
end;
$$;

revoke all on function public.reset_quote_approval_cycle(uuid) from public, anon, authenticated;
grant execute on function public.reset_quote_approval_cycle(uuid) to authenticated, service_role;
