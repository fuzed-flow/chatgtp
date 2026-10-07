-- QuickBooks sandbox OAuth: one-time state and one encrypted Vault token per company.
create table if not exists public.qbo_oauth_states (
  state_hash text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  initiated_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists qbo_oauth_states_expiry_idx on public.qbo_oauth_states(expires_at);

create table if not exists public.qbo_connections (
  company_id uuid primary key references public.companies(id) on delete cascade,
  realm_id text not null unique,
  token_secret_id uuid not null,
  access_expires_at timestamptz not null,
  connected_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qbo_oauth_states enable row level security;
alter table public.qbo_connections enable row level security;
revoke all on public.qbo_oauth_states, public.qbo_connections from public, anon, authenticated;
grant select, insert, delete on public.qbo_oauth_states to service_role;
grant select on public.qbo_connections to service_role;

-- Only server code holding the Supabase service key may call this function.
-- Vault keeps token contents encrypted in database backups and replication.
create or replace function public.qbo_store_tokens(
  p_company uuid, p_realm text, p_actor uuid, p_access text, p_refresh text, p_expires_at timestamptz
) returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  secret_id uuid;
  token_json text;
begin
  if p_company is null or p_actor is null or p_realm !~ '^[0-9]{1,30}$'
     or nullif(p_access, '') is null or nullif(p_refresh, '') is null or p_expires_at <= now() then
    raise exception 'Invalid QuickBooks connection';
  end if;
  if not exists(select 1 from public.profiles
      where id = p_actor and company_id = p_company and is_active is not false and role in ('owner','admin')) then
    raise exception 'Company administrator required';
  end if;
  select token_secret_id into secret_id from public.qbo_connections where company_id = p_company for update;
  token_json := jsonb_build_object('access_token', p_access, 'refresh_token', p_refresh)::text;
  if secret_id is null then
    secret_id := vault.create_secret(token_json, 'qbo-' || p_company::text, 'QuickBooks sandbox OAuth tokens');
  else
    perform vault.update_secret(secret_id, token_json);
  end if;
  insert into public.qbo_connections(company_id, realm_id, token_secret_id, access_expires_at, connected_by)
    values(p_company, p_realm, secret_id, p_expires_at, p_actor)
    on conflict (company_id) do update set realm_id = excluded.realm_id,
      access_expires_at = excluded.access_expires_at, connected_by = excluded.connected_by, updated_at = now();
  update public.companies set qbo_connected = true, qbo_realm_id = p_realm where id = p_company;
end $$;

create or replace function public.qbo_read_tokens(p_company uuid)
returns table(realm_id text, access_token text, refresh_token text, access_expires_at timestamptz)
language sql security definer set search_path = pg_catalog as $$
  select c.realm_id, (v.decrypted_secret::jsonb)->>'access_token',
    (v.decrypted_secret::jsonb)->>'refresh_token', c.access_expires_at
  from public.qbo_connections c
  join vault.decrypted_secrets v on v.id = c.token_secret_id
  where c.company_id = p_company;
$$;

revoke all on function public.qbo_store_tokens(uuid,text,uuid,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.qbo_read_tokens(uuid) from public, anon, authenticated;
grant execute on function public.qbo_store_tokens(uuid,text,uuid,text,text,timestamptz) to service_role;
grant execute on function public.qbo_read_tokens(uuid) to service_role;
