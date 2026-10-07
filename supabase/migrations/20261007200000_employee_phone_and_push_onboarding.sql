alter table public.team_invites
  add column if not exists phone text;

comment on column public.team_invites.phone is
  'Optional E.164 phone number copied to the invited user profile when signup completes.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'team_invites_phone_e164_check'
      and conrelid = 'public.team_invites'::regclass
  ) then
    alter table public.team_invites
      add constraint team_invites_phone_e164_check
      check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_role text;
  v_user_full_name text;
  v_invite_id uuid;
  v_invite_full_name text;
  v_hourly_rate numeric;
  v_phone text;
  v_company_name text;
  v_plan_id text;
begin
  v_user_full_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'New User');
  v_company_name := coalesce(nullif(trim(new.raw_user_meta_data->>'company_name'), ''), v_user_full_name || '''s Company');
  v_plan_id := coalesce(nullif(trim(new.raw_user_meta_data->>'plan_id'), ''), 'starter');

  select id, company_id, role, full_name, hourly_rate, phone
    into v_invite_id, v_company_id, v_role, v_invite_full_name, v_hourly_rate, v_phone
  from public.team_invites
  where lower(email) = lower(new.email)
    and is_pending = true
  order by created_at desc nulls last
  limit 1;

  if v_invite_id is not null then
    v_user_full_name := coalesce(nullif(trim(v_invite_full_name), ''), v_user_full_name);
    update public.team_invites
      set is_pending = false
      where id = v_invite_id;
  else
    v_role := 'admin';
    insert into public.companies (name, plan_id)
      values (v_company_name, v_plan_id)
      returning id into v_company_id;
  end if;

  insert into public.profiles (id, full_name, email, company_id, role, hourly_rate, phone)
    values (new.id, v_user_full_name, new.email, v_company_id, v_role, v_hourly_rate, v_phone);

  return new;
end;
$$;

