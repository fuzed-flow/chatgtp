-- Production guardrails for AI Rewrite. Text content is deliberately excluded
-- from the usage log; only tenant/user identifiers and operational metadata are
-- retained.

grant usage on schema workflow_private to service_role;

create table workflow_private.ai_rewrite_plan_limits (
  plan_id text primary key,
  enabled boolean not null default false,
  per_user_hour_limit integer not null check (per_user_hour_limit > 0),
  per_company_hour_limit integer not null check (per_company_hour_limit > 0),
  per_company_day_limit integer not null check (per_company_day_limit > 0),
  max_input_chars integer not null default 10000 check (max_input_chars between 1 and 10000),
  updated_at timestamptz not null default now()
);

insert into workflow_private.ai_rewrite_plan_limits
  (plan_id, enabled, per_user_hour_limit, per_company_hour_limit, per_company_day_limit)
values
  ('starter', false, 20, 60, 200),
  ('professional', true, 30, 150, 500),
  ('business', true, 60, 400, 2000)
on conflict (plan_id) do nothing;

alter table workflow_private.ai_rewrite_plan_limits enable row level security;
revoke all on workflow_private.ai_rewrite_plan_limits from public, anon, authenticated;
grant all on workflow_private.ai_rewrite_plan_limits to service_role;

create table workflow_private.ai_rewrite_company_access (
  company_id uuid primary key references public.companies(id) on delete cascade,
  grandfathered boolean not null default false,
  enabled_override boolean,
  per_user_hour_limit integer check (per_user_hour_limit is null or per_user_hour_limit > 0),
  per_company_hour_limit integer check (per_company_hour_limit is null or per_company_hour_limit > 0),
  per_company_day_limit integer check (per_company_day_limit is null or per_company_day_limit > 0),
  max_input_chars integer check (max_input_chars is null or max_input_chars between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Preserve AI Rewrite for subscribers who already had access before plan
-- entitlements were introduced. Subscription state is still checked per call.
insert into workflow_private.ai_rewrite_company_access (company_id, grandfathered, enabled_override)
select id, true, true
from public.companies
where lower(coalesce(subscription_status, '')) in ('active', 'trialing', 'past_due')
on conflict (company_id) do nothing;

alter table workflow_private.ai_rewrite_company_access enable row level security;
revoke all on workflow_private.ai_rewrite_company_access from public, anon, authenticated;
grant all on workflow_private.ai_rewrite_company_access to service_role;

create table workflow_private.ai_rewrite_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  field_category text not null check (length(field_category) between 1 and 80),
  input_chars integer not null check (input_chars >= 0),
  output_chars integer check (output_chars is null or output_chars >= 0),
  status text not null check (status in ('claimed', 'succeeded', 'failed', 'denied')),
  denial_reason text,
  provider text,
  model text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (company_id, request_id)
);

create index ai_rewrite_usage_company_recent
  on workflow_private.ai_rewrite_usage (company_id, created_at desc);
create index ai_rewrite_usage_user_recent
  on workflow_private.ai_rewrite_usage (company_id, user_id, created_at desc);
create index ai_rewrite_usage_user_fk
  on workflow_private.ai_rewrite_usage (user_id);

alter table workflow_private.ai_rewrite_usage enable row level security;
revoke all on workflow_private.ai_rewrite_usage from public, anon, authenticated;
grant all on workflow_private.ai_rewrite_usage to service_role;

create or replace function workflow_private.claim_ai_rewrite(
  p_company_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_input_chars integer,
  p_field_category text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_profile public.profiles%rowtype;
  v_plan workflow_private.ai_rewrite_plan_limits%rowtype;
  v_access workflow_private.ai_rewrite_company_access%rowtype;
  v_existing workflow_private.ai_rewrite_usage%rowtype;
  v_subscribed boolean := false;
  v_enabled boolean := false;
  v_user_limit integer := 20;
  v_company_hour_limit integer := 60;
  v_company_day_limit integer := 200;
  v_max_chars integer := 10000;
  v_user_hour integer := 0;
  v_company_hour integer := 0;
  v_company_day integer := 0;
  v_retry_after integer := 0;
  v_code text;
  v_usage_id uuid;
begin
  select * into v_profile
  from public.profiles
  where id = p_user_id
    and company_id = p_company_id
    and is_active is distinct from false;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'code', 'INVALID_COMPANY_CONTEXT',
      'message', 'Your account cannot use AI Rewrite right now.'
    );
  end if;

  select * into v_company from public.companies where id = p_company_id;
  if not found then
    return jsonb_build_object(
      'allowed', false,
      'code', 'INVALID_COMPANY_CONTEXT',
      'message', 'Your account cannot use AI Rewrite right now.'
    );
  end if;

  -- A company-scoped transaction lock makes the company burst check atomic,
  -- including concurrent requests from different users in the same tenant.
  perform pg_advisory_xact_lock(hashtextextended('ai-rewrite:' || p_company_id::text, 0));

  select * into v_existing
  from workflow_private.ai_rewrite_usage
  where company_id = p_company_id and request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'allowed', false,
      'code', 'DUPLICATE_REQUEST',
      'message', 'This rewrite request was already received.'
    );
  end if;

  select * into v_plan
  from workflow_private.ai_rewrite_plan_limits
  where plan_id = lower(coalesce(v_company.plan_id, v_company.subscription_tier, 'starter'));
  select * into v_access
  from workflow_private.ai_rewrite_company_access
  where company_id = p_company_id;

  v_subscribed := lower(coalesce(v_company.subscription_status, '')) in ('active', 'trialing', 'past_due');
  if v_access.enabled_override is not null then
    v_enabled := v_access.enabled_override;
  elsif v_plan.plan_id is not null then
    v_enabled := v_plan.enabled;
  else
    v_enabled := coalesce(v_access.grandfathered, false);
  end if;
  v_enabled := v_enabled and v_subscribed;

  v_user_limit := coalesce(v_access.per_user_hour_limit, v_plan.per_user_hour_limit, v_user_limit);
  v_company_hour_limit := coalesce(v_access.per_company_hour_limit, v_plan.per_company_hour_limit, v_company_hour_limit);
  v_company_day_limit := coalesce(v_access.per_company_day_limit, v_plan.per_company_day_limit, v_company_day_limit);
  v_max_chars := coalesce(v_access.max_input_chars, v_plan.max_input_chars, v_max_chars);

  if not v_enabled then
    insert into workflow_private.ai_rewrite_usage
      (company_id, user_id, request_id, field_category, input_chars, status, denial_reason, completed_at)
    values
      (p_company_id, p_user_id, p_request_id, left(coalesce(p_field_category, 'general_business_text'), 80), greatest(coalesce(p_input_chars, 0), 0), 'denied', 'PLAN_REQUIRED', clock_timestamp())
    returning id into v_usage_id;
    return jsonb_build_object(
      'allowed', false,
      'code', 'PLAN_REQUIRED',
      'message', 'AI Rewrite is available on Professional and Business plans.',
      'usage_id', v_usage_id
    );
  end if;

  if p_input_chars is null or p_input_chars < 1 or p_input_chars > v_max_chars then
    insert into workflow_private.ai_rewrite_usage
      (company_id, user_id, request_id, field_category, input_chars, status, denial_reason, completed_at)
    values
      (p_company_id, p_user_id, p_request_id, left(coalesce(p_field_category, 'general_business_text'), 80), greatest(coalesce(p_input_chars, 0), 0), 'denied', 'INPUT_TOO_LONG', clock_timestamp())
    returning id into v_usage_id;
    return jsonb_build_object(
      'allowed', false,
      'code', 'INPUT_TOO_LONG',
      'message', format('Enter between 1 and %s characters to rewrite.', v_max_chars),
      'usage_id', v_usage_id
    );
  end if;

  select count(*)::integer into v_user_hour
  from workflow_private.ai_rewrite_usage
  where company_id = p_company_id
    and user_id = p_user_id
    and status in ('claimed', 'succeeded', 'failed')
    and created_at >= clock_timestamp() - interval '1 hour';

  select count(*)::integer into v_company_hour
  from workflow_private.ai_rewrite_usage
  where company_id = p_company_id
    and status in ('claimed', 'succeeded', 'failed')
    and created_at >= clock_timestamp() - interval '1 hour';

  select count(*)::integer into v_company_day
  from workflow_private.ai_rewrite_usage
  where company_id = p_company_id
    and status in ('claimed', 'succeeded', 'failed')
    and created_at >= clock_timestamp() - interval '24 hours';

  if v_user_hour >= v_user_limit then
    v_code := 'USER_HOURLY_LIMIT';
    select greatest(1, ceil(extract(epoch from (min(created_at) + interval '1 hour' - clock_timestamp())))::integer)
      into v_retry_after
    from workflow_private.ai_rewrite_usage
    where company_id = p_company_id and user_id = p_user_id
      and status in ('claimed', 'succeeded', 'failed')
      and created_at >= clock_timestamp() - interval '1 hour';
  elsif v_company_hour >= v_company_hour_limit then
    v_code := 'COMPANY_HOURLY_LIMIT';
    select greatest(1, ceil(extract(epoch from (min(created_at) + interval '1 hour' - clock_timestamp())))::integer)
      into v_retry_after
    from workflow_private.ai_rewrite_usage
    where company_id = p_company_id
      and status in ('claimed', 'succeeded', 'failed')
      and created_at >= clock_timestamp() - interval '1 hour';
  elsif v_company_day >= v_company_day_limit then
    v_code := 'COMPANY_DAILY_LIMIT';
    select greatest(1, ceil(extract(epoch from (min(created_at) + interval '24 hours' - clock_timestamp())))::integer)
      into v_retry_after
    from workflow_private.ai_rewrite_usage
    where company_id = p_company_id
      and status in ('claimed', 'succeeded', 'failed')
      and created_at >= clock_timestamp() - interval '24 hours';
  end if;

  if v_code is not null then
    insert into workflow_private.ai_rewrite_usage
      (company_id, user_id, request_id, field_category, input_chars, status, denial_reason, completed_at)
    values
      (p_company_id, p_user_id, p_request_id, left(coalesce(p_field_category, 'general_business_text'), 80), p_input_chars, 'denied', v_code, clock_timestamp())
    returning id into v_usage_id;
    return jsonb_build_object(
      'allowed', false,
      'code', v_code,
      'message', 'AI Rewrite has reached its usage limit. Please try again later.',
      'retry_after_seconds', coalesce(v_retry_after, 60),
      'usage_id', v_usage_id
    );
  end if;

  insert into workflow_private.ai_rewrite_usage
    (company_id, user_id, request_id, field_category, input_chars, status, provider, model)
  values
    (p_company_id, p_user_id, p_request_id, left(coalesce(p_field_category, 'general_business_text'), 80), p_input_chars, 'claimed', 'openai', 'gpt-5.6-terra')
  returning id into v_usage_id;

  return jsonb_build_object(
    'allowed', true,
    'code', 'OK',
    'usage_id', v_usage_id,
    'user_hour_remaining', greatest(v_user_limit - v_user_hour - 1, 0),
    'company_hour_remaining', greatest(v_company_hour_limit - v_company_hour - 1, 0),
    'company_day_remaining', greatest(v_company_day_limit - v_company_day - 1, 0)
  );
end
$$;

revoke all on function workflow_private.claim_ai_rewrite(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function workflow_private.claim_ai_rewrite(uuid, uuid, uuid, integer, text) to service_role;

create or replace function public.claim_ai_rewrite(
  p_company_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_input_chars integer,
  p_field_category text
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select workflow_private.claim_ai_rewrite(p_company_id, p_user_id, p_request_id, p_input_chars, p_field_category)
$$;
revoke all on function public.claim_ai_rewrite(uuid, uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.claim_ai_rewrite(uuid, uuid, uuid, integer, text) to service_role;

create or replace function workflow_private.complete_ai_rewrite_usage(
  p_usage_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_status text,
  p_output_chars integer default null,
  p_duration_ms integer default null,
  p_error_code text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    return false;
  end if;
  update workflow_private.ai_rewrite_usage
  set status = p_status,
      output_chars = case when p_status = 'succeeded' then greatest(coalesce(p_output_chars, 0), 0) else null end,
      duration_ms = greatest(coalesce(p_duration_ms, 0), 0),
      denial_reason = case when p_status = 'failed' then left(coalesce(p_error_code, 'PROVIDER_ERROR'), 120) else null end,
      completed_at = clock_timestamp()
  where id = p_usage_id
    and company_id = p_company_id
    and user_id = p_user_id
    and status = 'claimed';
  return found;
end
$$;

revoke all on function workflow_private.complete_ai_rewrite_usage(uuid, uuid, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function workflow_private.complete_ai_rewrite_usage(uuid, uuid, uuid, text, integer, integer, text) to service_role;

create or replace function public.complete_ai_rewrite_usage(
  p_usage_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_status text,
  p_output_chars integer default null,
  p_duration_ms integer default null,
  p_error_code text default null
) returns boolean
language sql
security invoker
set search_path = ''
as $$
  select workflow_private.complete_ai_rewrite_usage(
    p_usage_id, p_company_id, p_user_id, p_status,
    p_output_chars, p_duration_ms, p_error_code
  )
$$;
revoke all on function public.complete_ai_rewrite_usage(uuid, uuid, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.complete_ai_rewrite_usage(uuid, uuid, uuid, text, integer, integer, text) to service_role;
