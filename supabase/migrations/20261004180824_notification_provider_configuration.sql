-- Provider signing credentials are never exposed to browser sessions.
create or replace function public.notification_provider_server_config()
returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(case name when 'resend_webhook_secret' then 'resend_webhook_secret'
  when 'resend_reply_domain' then 'resend_reply_domain' when 'stripe_connect_webhook_secret' then 'stripe_connect_webhook_secret' end,decrypted_secret),'{}'::jsonb)
 from vault.decrypted_secrets where name in ('resend_webhook_secret','resend_reply_domain','stripe_connect_webhook_secret')
$$;
revoke all on function public.notification_provider_server_config() from public,anon,authenticated;
grant execute on function public.notification_provider_server_config() to service_role;

create or replace function public.notification_provider_setup_config()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('setup_secret',(select decrypted_secret from vault.decrypted_secrets where name='notification_provider_setup_secret' limit 1),
  'resend_callback_url','https://ochqexofahdssmarnict.supabase.co/functions/v1/email-events',
  'twilio_callback_url','https://ochqexofahdssmarnict.supabase.co/functions/v1/sms-events','receiving_domain','reply.fuzedflow.com')
$$;
revoke all on function public.notification_provider_setup_config() from public,anon,authenticated;
grant execute on function public.notification_provider_setup_config() to service_role;
create or replace function public.notification_store_provider_secret(p_name text,p_value text)
returns boolean language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if p_name not in ('resend_webhook_secret','resend_reply_domain') or length(coalesce(p_value,'')) not between 1 and 2000 then raise exception 'Unsupported provider configuration'; end if;
 if p_name='resend_reply_domain' and p_value !~ '^([a-z0-9-]+\.)?fuzedflow\.com$' then raise exception 'Unexpected reply domain'; end if;
 select id into existing from vault.secrets where name=p_name limit 1;
 if existing is null then perform vault.create_secret(p_value,p_name,'Fuzed Flow provider configuration');
 else perform vault.update_secret(existing,p_value,p_name,'Fuzed Flow provider configuration'); end if;
 return true;
end $$;
revoke all on function public.notification_store_provider_secret(text,text) from public,anon,authenticated;
grant execute on function public.notification_store_provider_secret(text,text) to service_role;
