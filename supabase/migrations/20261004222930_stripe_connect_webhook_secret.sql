-- Expose only the Connect webhook signing key to the backend service role.
-- The actual key is encrypted in Vault and is never committed to source control.
create or replace function public.review_connect_webhook_secret() returns text
language sql stable security definer set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets
 where name='fuzedflow_stripe_connect_webhook'
 order by created_at desc limit 1
$$;
revoke all on function public.review_connect_webhook_secret() from public,anon,authenticated;
grant execute on function public.review_connect_webhook_secret() to service_role;
