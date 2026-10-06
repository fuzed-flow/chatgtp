-- Secure public invoice sharing behind an opaque capability token.
-- Only SHA-256 token digests are stored. Issuing another link creates a new
-- active capability and deliberately leaves earlier, non-revoked links valid so
-- resending an invoice does not unexpectedly invalidate a client's email.

create table if not exists public.invoice_share_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'Active' check (status in ('Active', 'Revoked', 'Expired')),
  expires_at timestamptz,
  issued_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count bigint not null default 0 check (view_count >= 0),
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((status = 'Revoked') = (revoked_at is not null))
);

create index if not exists invoice_share_links_invoice_active_idx
  on public.invoice_share_links(invoice_id, issued_at desc)
  where status = 'Active' and revoked_at is null;
create index if not exists invoice_share_links_client_idx
  on public.invoice_share_links(company_id, client_id, invoice_id);

alter table public.invoice_share_links enable row level security;
revoke all on table public.invoice_share_links from public, anon, authenticated;
grant select, insert, update, delete on table public.invoice_share_links to service_role;

create or replace function public.issue_invoice_share_token(p_invoice uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  actor public.profiles;
  result_token text;
  result_hash text;
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
  attempt integer := 0;
begin
  if p_invoice is null then
    raise exception 'Invoice unavailable' using errcode = 'P0002';
  end if;

  select * into invoice_row
  from public.invoices
  where id = p_invoice
  for update;

  if not found or invoice_row.client_id is null then
    raise exception 'Invoice unavailable' using errcode = 'P0002';
  end if;

  if lower(coalesce(invoice_row.status, '')) in ('cancelled', 'canceled', 'void') then
    raise exception 'Invoice unavailable' using errcode = 'P0002';
  end if;

  if not is_service then
    if auth.uid() is null then
      raise exception 'Authentication required' using errcode = '42501';
    end if;

    select * into actor
    from public.profiles
    where id = auth.uid()
      and company_id = invoice_row.company_id
      and is_active is distinct from false;

    if not found
      or actor.role not in ('owner', 'admin', 'office')
      or not (select app_review_private.module_allowed('invoices')) then
      raise exception 'Invoice sharing permission required' using errcode = '42501';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(invoice_row.id::text, 19)
  );

  update public.invoice_share_links
  set status = 'Expired'
  where invoice_id = invoice_row.id
    and company_id = invoice_row.company_id
    and status = 'Active'
    and revoked_at is null
    and expires_at is not null
    and expires_at <= pg_catalog.clock_timestamp();

  if (
    select count(*)
    from public.invoice_share_links
    where invoice_id = invoice_row.id
      and company_id = invoice_row.company_id
      and status = 'Active'
      and revoked_at is null
      and (expires_at is null or expires_at > pg_catalog.clock_timestamp())
  ) >= 50 then
    raise exception 'Too many active invoice links. Revoke old links before creating another.'
      using errcode = '54000';
  end if;

  loop
    attempt := attempt + 1;
    result_token := pg_catalog.replace(gen_random_uuid()::text, '-', '')
      || pg_catalog.replace(gen_random_uuid()::text, '-', '');
    result_hash := encode(extensions.digest(result_token, 'sha256'), 'hex');

    begin
      insert into public.invoice_share_links(
        company_id, invoice_id, client_id, token_hash, expires_at, created_by
      ) values (
        invoice_row.company_id,
        invoice_row.id,
        invoice_row.client_id,
        result_hash,
        null,
        case when is_service then null else auth.uid() end
      );
      exit;
    exception when unique_violation then
      if attempt >= 3 then
        raise exception 'A secure invoice link could not be created' using errcode = '40001';
      end if;
    end;
  end loop;

  return result_token;
end;
$$;

create or replace function public.revoke_invoice_share_token(
  p_invoice uuid,
  p_token text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  actor public.profiles;
  affected integer;
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  select * into invoice_row
  from public.invoices
  where id = p_invoice
  for update;

  if not found then
    raise exception 'Invoice unavailable' using errcode = 'P0002';
  end if;

  if not is_service then
    if auth.uid() is null then
      raise exception 'Authentication required' using errcode = '42501';
    end if;

    select * into actor
    from public.profiles
    where id = auth.uid()
      and company_id = invoice_row.company_id
      and is_active is distinct from false;

    if not found
      or actor.role not in ('owner', 'admin', 'office')
      or not (select app_review_private.module_allowed('invoices')) then
      raise exception 'Invoice sharing permission required' using errcode = '42501';
    end if;
  end if;

  if p_token is not null and p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  update public.invoice_share_links
  set status = 'Revoked', revoked_at = pg_catalog.clock_timestamp()
  where invoice_id = invoice_row.id
    and company_id = invoice_row.company_id
    and status = 'Active'
    and revoked_at is null
    and (p_token is null or token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex'));

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Scheduled reminder retries need byte-for-byte stable email payloads. This
-- service-only issuer derives one durable capability per invoice/reminder stage
-- without ever storing the returned plaintext token.
create or replace function public.issue_invoice_reminder_share_token(
  p_invoice uuid,
  p_stage integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  config jsonb;
  signing_secret text;
  result_token text;
  result_hash text;
  saved_link public.invoice_share_links;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_invoice is null or p_stage is null or p_stage < 0 or p_stage > 100 then
    raise exception 'Invalid invoice reminder stage' using errcode = '22023';
  end if;

  select * into invoice_row
  from public.invoices
  where id = p_invoice
    and client_id is not null
    and lower(coalesce(status, '')) in (
      'sent', 'viewed', 'issued', 'partial', 'partially paid',
      'overdue', 'past due', 'paid'
    )
  for update;

  if not found then
    raise exception 'Invoice unavailable' using errcode = 'P0002';
  end if;

  config := notification_private.server_config();
  signing_secret := nullif(config ->> 'notification_cron_secret', '');
  if signing_secret is null or char_length(signing_secret) < 32 then
    raise exception 'Invoice reminder signing secret is unavailable'
      using errcode = '55000';
  end if;

  result_token := encode(extensions.hmac(
    'invoice-reminder-share:v1:'
      || invoice_row.company_id::text || ':'
      || invoice_row.client_id::text || ':'
      || invoice_row.id::text || ':'
      || p_stage::text,
    signing_secret,
    'sha256'
  ), 'hex');
  result_hash := encode(extensions.digest(result_token, 'sha256'), 'hex');

  insert into public.invoice_share_links(
    company_id,
    invoice_id,
    client_id,
    token_hash,
    status,
    expires_at,
    created_by
  ) values (
    invoice_row.company_id,
    invoice_row.id,
    invoice_row.client_id,
    result_hash,
    'Active',
    null,
    null
  )
  on conflict (token_hash) do nothing;

  select * into saved_link
  from public.invoice_share_links
  where token_hash = result_hash
    and company_id = invoice_row.company_id
    and invoice_id = invoice_row.id
    and client_id = invoice_row.client_id
    and status = 'Active'
    and revoked_at is null
    and expires_at is null;

  if not found then
    raise exception 'Invoice reminder link is unavailable' using errcode = '42501';
  end if;

  return result_token;
end;
$$;

create or replace function public.get_public_invoice_bundle(p_invoice uuid, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  client_row public.clients;
  company_row public.companies;
  link_row public.invoice_share_links;
  project_json jsonb;
  phase_rows jsonb;
  item_rows jsonb;
  schedule_rows jsonb;
  payment_rows jsonb;
begin
  if p_invoice is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  select * into link_row
  from public.invoice_share_links
  where invoice_id = p_invoice
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and status = 'Active'
    and revoked_at is null
    and (expires_at is null or expires_at > pg_catalog.clock_timestamp())
  limit 1;

  if not found then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  select * into invoice_row
  from public.invoices
  where id = p_invoice
    and company_id = link_row.company_id
    and client_id = link_row.client_id
    and lower(coalesce(status, '')) in (
      'sent', 'viewed', 'issued', 'partial', 'partially paid',
      'overdue', 'past due', 'paid'
    );

  if not found then
    raise exception 'Invoice is unavailable' using errcode = 'P0002';
  end if;

  select * into client_row
  from public.clients
  where id = invoice_row.client_id
    and company_id = invoice_row.company_id;

  select * into company_row
  from public.companies
  where id = invoice_row.company_id;

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'project_number', p.project_number,
    'site_address', p.site_address
  ) into project_json
  from public.projects p
  where p.id = invoice_row.project_id
    and p.company_id = invoice_row.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'invoice_id', p.invoice_id,
    'phase_name', p.phase_name,
    'scope_of_work', p.scope_of_work,
    'sort_order', p.sort_order
  ) order by p.sort_order, p.id), '[]'::jsonb)
  into phase_rows
  from public.invoice_phases p
  where p.invoice_id = invoice_row.id
    and p.company_id = invoice_row.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'invoice_id', i.invoice_id,
    'phase_id', i.phase_id,
    'name', i.name,
    'description', i.description,
    'quantity', i.quantity,
    'unit', i.unit,
    'unit_price', i.unit_price,
    'amount', i.amount,
    'line_total', i.line_total,
    'taxable', i.taxable,
    'display_order', i.display_order
  ) order by i.display_order, i.id), '[]'::jsonb)
  into item_rows
  from public.invoice_line_items i
  where i.invoice_id = invoice_row.id
    and i.company_id = invoice_row.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'invoice_id', s.invoice_id,
    'payment_name', s.payment_name,
    'due_event', s.due_event,
    'amount', s.amount,
    'amount_paid', s.amount_paid,
    'status', s.status,
    'sort_order', s.sort_order,
    'paid_date', s.paid_date,
    'amount_type', s.amount_type,
    'percentage', s.percentage,
    'due_date', s.due_date
  ) order by s.sort_order, s.id), '[]'::jsonb)
  into schedule_rows
  from public.invoice_payment_schedules s
  where s.invoice_id = invoice_row.id
    and s.company_id = invoice_row.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'invoice_id', p.invoice_id,
    'schedule_item_id', p.schedule_item_id,
    'amount', p.amount,
    'payment_method', p.payment_method,
    'payment_date', p.payment_date,
    'created_at', p.created_at
  ) order by p.payment_date desc nulls last, p.created_at desc, p.id), '[]'::jsonb)
  into payment_rows
  from public.payments p
  where p.invoice_id = invoice_row.id
    and p.company_id = invoice_row.company_id;

  return jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', invoice_row.id,
      'company_id', invoice_row.company_id,
      'client_id', invoice_row.client_id,
      'project_id', invoice_row.project_id,
      'invoice_number', invoice_row.invoice_number,
      'status', invoice_row.status,
      'issue_date', invoice_row.issue_date,
      'due_date', invoice_row.due_date,
      'site_address', invoice_row.site_address,
      'subtotal', invoice_row.subtotal,
      'tax', invoice_row.tax,
      'total', invoice_row.total,
      'amount_paid', invoice_row.amount_paid,
      'balance_due', invoice_row.balance_due,
      'deposit_amount', invoice_row.deposit_amount,
      'has_payment_schedule', invoice_row.has_payment_schedule,
      'notes', case when coalesce(invoice_row.show_notes, false) then invoice_row.notes else null end,
      'billing_address', invoice_row.billing_address,
      'due_terms', invoice_row.due_terms,
      'show_notes', invoice_row.show_notes,
      'discount_amount', invoice_row.discount_amount,
      'discount_type', invoice_row.discount_type,
      'created_at', invoice_row.created_at
    ),
    'client', case when client_row.id is null then null else jsonb_build_object(
      'id', client_row.id,
      'name', client_row.name,
      'first_name', client_row.first_name,
      'surname', client_row.surname,
      'billing_address', client_row.billing_address,
      'site_address', client_row.site_address
    ) end,
    'recipient', case when client_row.id is null then null else jsonb_build_object(
      'source_type', 'client',
      'name', coalesce(nullif(client_row.name, ''), nullif(trim(concat_ws(' ', client_row.first_name, client_row.surname)), '')),
      'billing_address', client_row.billing_address,
      'site_address', client_row.site_address
    ) end,
    'company', case when company_row.id is null then null else jsonb_build_object(
      'id', company_row.id,
      'name', company_row.name,
      'logo_url', company_row.logo_url,
      'company_logo_url', company_row.company_logo_url,
      'settings', jsonb_build_object(
        'address', company_row.settings -> 'address',
        'phone', company_row.settings -> 'phone',
        'email', company_row.settings -> 'email',
        'website', company_row.settings -> 'website',
        'tax_id', company_row.settings -> 'tax_id',
        'tax_label', company_row.settings -> 'tax_label',
        'tax_rate', company_row.settings -> 'tax_rate',
        'enable_secondary_tax', company_row.settings -> 'enable_secondary_tax',
        'secondary_tax_label', company_row.settings -> 'secondary_tax_label',
        'secondary_tax_rate', company_row.settings -> 'secondary_tax_rate',
        'currency', company_row.settings -> 'currency',
        'pdf', jsonb_build_object(
          'brand_color', company_row.settings #> '{pdf,brand_color}'
        )
      )
    ) end,
    'project', project_json,
    'phases', phase_rows,
    'items', item_rows,
    'schedule_items', schedule_rows,
    'payments', payment_rows,
    'link', jsonb_build_object(
      'expires_at', link_row.expires_at,
      'viewed_at', link_row.first_viewed_at
    )
  );
end;
$$;

-- Preserve the existing notification relay for quote/change-order/purchase-order
-- callers, but move its unrestricted implementation out of the exposed schema.
-- The public wrapper rejects raw anonymous invoice UUIDs; invoice view events
-- can reach the relay only through track_public_invoice_view after token checks.
create schema if not exists invoice_share_private;
revoke all on schema invoice_share_private from public, anon, authenticated, service_role;

alter function public.request_document_notification(uuid, text, text)
  set schema invoice_share_private;
revoke all on function invoice_share_private.request_document_notification(uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.request_document_notification(
  p_document uuid,
  p_event text,
  p_message text default ''
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event = 'invoice_viewed'
    and coalesce(auth.role(), 'anon') = 'anon' then
    raise exception 'Invoice view notification requires a valid secure link'
      using errcode = '42501';
  end if;

  return invoice_share_private.request_document_notification(
    p_document,
    p_event,
    p_message
  );
end;
$$;

revoke all on function public.request_document_notification(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.request_document_notification(uuid, text, text)
  to anon, authenticated, service_role;

create or replace function public.track_public_invoice_view(p_invoice uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.invoice_share_links;
  invoice_row public.invoices;
begin
  if p_invoice is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  select * into link_row
  from public.invoice_share_links
  where invoice_id = p_invoice
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and status = 'Active'
    and revoked_at is null
    and (expires_at is null or expires_at > pg_catalog.clock_timestamp())
  limit 1
  for update;

  if not found then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  select * into invoice_row
  from public.invoices
  where id = p_invoice
    and company_id = link_row.company_id
    and client_id = link_row.client_id
    and lower(coalesce(status, '')) in (
      'sent', 'viewed', 'issued', 'partial', 'partially paid',
      'overdue', 'past due', 'paid'
    );

  if not found then
    raise exception 'Invoice is unavailable' using errcode = 'P0002';
  end if;

  update public.invoice_share_links
  set first_viewed_at = coalesce(first_viewed_at, pg_catalog.clock_timestamp()),
      last_viewed_at = pg_catalog.clock_timestamp(),
      view_count = view_count + 1
  where id = link_row.id;

  update public.invoices
  set status = 'Viewed'
  where id = invoice_row.id
    and company_id = invoice_row.company_id
    and lower(coalesce(status, '')) = 'sent';

  -- The legacy relay accepts only a document UUID. Invoke it only after this
  -- function has validated the invoice capability; notification delivery is
  -- best-effort and must not make an otherwise valid invoice link fail.
  begin
    perform invoice_share_private.request_document_notification(
      invoice_row.id,
      'invoice_viewed',
      ''
    );
  exception when others then
    null;
  end;

  return true;
end;
$$;

-- A client-portal invoice capability remains invoice-scoped: it can list only
-- the exact invoice represented by that token, never every invoice for a client.
create or replace function public.get_client_portal_invoices(p_client uuid, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invoice_row public.invoices;
  link_row public.invoice_share_links;
begin
  if p_client is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  select * into link_row
  from public.invoice_share_links
  where client_id = p_client
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and status = 'Active'
    and revoked_at is null
    and (expires_at is null or expires_at > pg_catalog.clock_timestamp())
  limit 1;

  if not found then
    raise exception 'Invoice link is invalid' using errcode = '42501';
  end if;

  select * into invoice_row
  from public.invoices
  where id = link_row.invoice_id
    and company_id = link_row.company_id
    and client_id = link_row.client_id
    and lower(coalesce(status, '')) in (
      'sent', 'viewed', 'issued', 'partial', 'partially paid',
      'overdue', 'past due', 'paid'
    );

  if not found then
    raise exception 'Invoice is unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_array(jsonb_build_object(
    'id', invoice_row.id,
    'invoice_number', invoice_row.invoice_number,
    'status', invoice_row.status,
    'total', invoice_row.total,
    'amount_paid', invoice_row.amount_paid,
    'balance_due', invoice_row.balance_due,
    'issue_date', invoice_row.issue_date,
    'due_date', invoice_row.due_date,
    'created_at', invoice_row.created_at,
    'share_token', p_token
  ));
end;
$$;

-- Remove policies that granted either PUBLIC or anon direct access. This also
-- removes legacy policies declared without a TO clause (which means PUBLIC).
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'invoices', 'invoice_phases', 'invoice_line_items',
        'invoice_payment_schedules', 'payments'
      )
      and exists (
        select 1
        from unnest(roles) role_name
        where role_name::text in ('public', 'anon')
      )
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

alter table public.invoices enable row level security;
alter table public.invoice_phases enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_payment_schedules enable row level security;
alter table public.payments enable row level security;

drop policy if exists invoice_staff_access on public.invoices;
create policy invoice_staff_access on public.invoices
  for all to authenticated
  using (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and actor.company_id = invoices.company_id
        and actor.is_active is distinct from false
        and actor.role in ('owner', 'admin', 'office')
    )
  )
  with check (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.profiles actor
      where actor.id = auth.uid()
        and actor.company_id = invoices.company_id
        and actor.is_active is distinct from false
        and actor.role in ('owner', 'admin', 'office')
    )
  );

drop policy if exists invoice_phase_staff_access on public.invoice_phases;
create policy invoice_phase_staff_access on public.invoice_phases
  for all to authenticated
  using (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = invoice_phases.invoice_id
        and parent.company_id = invoice_phases.company_id
    )
  )
  with check (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = invoice_phases.invoice_id
        and parent.company_id = invoice_phases.company_id
    )
  );

drop policy if exists invoice_line_item_staff_access on public.invoice_line_items;
create policy invoice_line_item_staff_access on public.invoice_line_items
  for all to authenticated
  using (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = invoice_line_items.invoice_id
        and parent.company_id = invoice_line_items.company_id
    )
  )
  with check (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = invoice_line_items.invoice_id
        and parent.company_id = invoice_line_items.company_id
    )
  );

drop policy if exists invoice_schedule_staff_access on public.invoice_payment_schedules;
create policy invoice_schedule_staff_access on public.invoice_payment_schedules
  for all to authenticated
  using (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = invoice_payment_schedules.invoice_id
        and parent.company_id = invoice_payment_schedules.company_id
    )
  )
  with check (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = invoice_payment_schedules.invoice_id
        and parent.company_id = invoice_payment_schedules.company_id
    )
  );

drop policy if exists invoice_payment_staff_access on public.payments;
create policy invoice_payment_staff_access on public.payments
  for all to authenticated
  using (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = payments.invoice_id
        and parent.company_id = payments.company_id
    )
  )
  with check (
    company_id = (select app_review_private.member_company())
    and (select app_review_private.module_allowed('invoices'))
    and exists (
      select 1 from public.invoices parent
      where parent.id = payments.invoice_id
        and parent.company_id = payments.company_id
    )
  );

-- invoice_payment_schedules was omitted from the original module-boundary list.
drop policy if exists review_company_boundary on public.invoice_payment_schedules;
create policy review_company_boundary on public.invoice_payment_schedules
  as restrictive for all to authenticated
  using (company_id = (select app_review_private.member_company()))
  with check (company_id = (select app_review_private.member_company()));

drop policy if exists review_module_access on public.invoice_payment_schedules;
create policy review_module_access on public.invoice_payment_schedules
  as restrictive for all to authenticated
  using ((select app_review_private.module_allowed('invoices')))
  with check ((select app_review_private.module_allowed('invoices')));

-- A restrictive billing-role boundary cannot be OR'ed around by permissive
-- legacy policies. Managers may own sales work but cannot read or mutate billing
-- records unless they also hold an owner, admin or office billing role.
drop policy if exists invoice_billing_role_access on public.invoices;
create policy invoice_billing_role_access on public.invoices
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoices.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoices.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ));

drop policy if exists invoice_billing_role_access on public.invoice_phases;
create policy invoice_billing_role_access on public.invoice_phases
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoice_phases.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoice_phases.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ));

drop policy if exists invoice_billing_role_access on public.invoice_line_items;
create policy invoice_billing_role_access on public.invoice_line_items
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoice_line_items.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoice_line_items.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ));

drop policy if exists invoice_billing_role_access on public.invoice_payment_schedules;
create policy invoice_billing_role_access on public.invoice_payment_schedules
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoice_payment_schedules.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = invoice_payment_schedules.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ));

drop policy if exists invoice_billing_role_access on public.payments;
create policy invoice_billing_role_access on public.payments
  as restrictive for all to authenticated
  using (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = payments.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ))
  with check (exists (
    select 1 from public.profiles actor
    where actor.id = auth.uid()
      and actor.company_id = payments.company_id
      and actor.is_active is distinct from false
      and actor.role in ('owner', 'admin', 'office')
  ));

revoke all on table public.invoices, public.invoice_phases,
  public.invoice_line_items, public.invoice_payment_schedules, public.payments
  from public, anon;
grant select, insert, update, delete on table public.invoices,
  public.invoice_phases, public.invoice_line_items,
  public.invoice_payment_schedules, public.payments
  to authenticated, service_role;

revoke all on function public.issue_invoice_share_token(uuid) from public, anon, authenticated;
revoke all on function public.issue_invoice_reminder_share_token(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.revoke_invoice_share_token(uuid, text) from public, anon, authenticated;
revoke all on function public.get_public_invoice_bundle(uuid, text) from public, anon, authenticated;
revoke all on function public.track_public_invoice_view(uuid, text) from public, anon, authenticated;
revoke all on function public.get_client_portal_invoices(uuid, text) from public, anon, authenticated;

grant execute on function public.issue_invoice_share_token(uuid) to authenticated, service_role;
grant execute on function public.issue_invoice_reminder_share_token(uuid, integer) to service_role;
grant execute on function public.revoke_invoice_share_token(uuid, text) to authenticated, service_role;
grant execute on function public.get_public_invoice_bundle(uuid, text) to anon, authenticated, service_role;
grant execute on function public.track_public_invoice_view(uuid, text) to anon, authenticated, service_role;
grant execute on function public.get_client_portal_invoices(uuid, text) to anon, authenticated, service_role;

-- This trigger function executes only through its invoice trigger. It has no
-- reason to be a directly callable API and must not inherit caller search paths.
alter function public.handle_invoice_status_update() set search_path = '';
revoke all on function public.handle_invoice_status_update() from public, anon, authenticated, service_role;

-- Correct only the exact invoice template previously shipped by the product.
-- Subscriber-edited wording is intentionally left untouched.
update public.companies
set settings = jsonb_set(
  settings,
  '{templates,invoice_email_body}',
  to_jsonb($new_invoice_email$Hi {{client_name}},

Your invoice {{invoice_number}} for ${{balance_due}} is ready to review.

Use the private secure link below to view the detailed invoice and payment options.$new_invoice_email$::text),
  true
)
where settings #>> '{templates,invoice_email_body}' = $old_invoice_email$Hi {{client_name}},

Please find attached Invoice {{invoice_number}} for the amount of ${{balance_due}}.

You can view your interactive invoice history, milestones, and secure credit card payment options online using the link provided.$old_invoice_email$;
