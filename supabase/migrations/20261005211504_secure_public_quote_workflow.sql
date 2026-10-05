-- Secure public quote sharing behind an opaque approval token. Public clients
-- receive a deliberately small projection and can only make validated,
-- server-calculated decisions through the RPCs below.

create table if not exists public.quote_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  approval_id uuid references public.quote_approvals(id) on delete set null,
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'Open' check (status in ('Open', 'Resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists quote_change_requests_quote_created_idx
  on public.quote_change_requests(quote_id, created_at desc);

alter table public.quote_change_requests enable row level security;

drop policy if exists quote_change_requests_company_read on public.quote_change_requests;
create policy quote_change_requests_company_read on public.quote_change_requests
  for select to authenticated
  using (company_id = (select public.get_auth_company_id()));

drop policy if exists quote_change_requests_company_update on public.quote_change_requests;
create policy quote_change_requests_company_update on public.quote_change_requests
  for update to authenticated
  using (company_id = (select public.get_auth_company_id()))
  with check (company_id = (select public.get_auth_company_id()));

revoke all on table public.quote_change_requests from public, anon;
grant select, update on table public.quote_change_requests to authenticated;
grant select, insert, update, delete on table public.quote_change_requests to service_role;

create index if not exists quote_approvals_quote_created_idx
  on public.quote_approvals(quote_id, created_at desc);

insert into public.quote_approvals(company_id, quote_id, client_id, approval_token, approval_status, sent_at, viewed_at, signed_at)
select q.company_id, q.id, q.client_id,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  case
    when q.status = 'Approved' then 'Approved'
    when q.status = 'Declined' then 'Declined'
    when q.status = 'Viewed' then 'Viewed'
    when q.status = 'Pending' then 'Changes Requested'
    else 'Sent'
  end,
  coalesce(q.updated_at, q.created_at, now()),
  case when q.status = 'Viewed' then coalesce(q.updated_at, q.created_at, now()) else null end,
  case when q.status = 'Approved' then coalesce(q.updated_at, q.created_at, now()) else null end
from public.quotes q
where q.is_template is distinct from true
  and q.status in ('Sent', 'Viewed', 'Pending', 'Approved', 'Declined', 'Paid', 'Invoiced', 'Expired')
  and not exists(select 1 from public.quote_approvals a where a.quote_id = q.id);

create or replace function public.issue_quote_share_token(p_quote uuid)
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
        approval_status = case
          when approval_status in ('Approved', 'Declined') then approval_status
          else 'Sent'
        end,
        sent_at = now()
    where id = approval_id;
  end if;

  return result_token;
end;
$$;

create or replace function public.get_public_quote_bundle(p_quote uuid, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.quotes;
  c public.clients;
  co public.companies;
  approval public.quote_approvals;
  phase_rows jsonb;
  item_rows jsonb;
  schedule_rows jsonb;
begin
  if p_quote is null or p_token is null or char_length(p_token) < 32 or char_length(p_token) > 256 then
    raise exception 'Quote link is invalid' using errcode = '42501';
  end if;

  select * into approval
  from public.quote_approvals
  where quote_id = p_quote
    and approval_token = p_token
    and coalesce(approval_status, '') <> 'Revoked'
  order by created_at desc nulls last, id desc
  limit 1;

  if not found then
    raise exception 'Quote link is invalid' using errcode = '42501';
  end if;

  select * into q
  from public.quotes
  where id = p_quote
    and company_id = approval.company_id
    and is_template is distinct from true
    and lower(coalesce(status, '')) not in ('draft', 'pending review');

  if not found then
    raise exception 'Quote is unavailable' using errcode = 'P0002';
  end if;

  select * into c from public.clients where id = q.client_id and company_id = q.company_id;
  select * into co from public.companies where id = q.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'quote_id', p.quote_id,
    'phase_name', p.phase_name,
    'scope_of_work', p.scope_of_work,
    'show_scope_to_client', p.show_scope_to_client,
    'photos', p.photos,
    'sort_order', p.sort_order,
    'is_optional', p.is_optional,
    'default_selected', p.default_selected
  ) order by p.sort_order, p.id), '[]'::jsonb)
  into phase_rows
  from public.quote_phases p
  where p.quote_id = q.id and p.company_id = q.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'quote_id', i.quote_id,
    'phase_id', i.phase_id,
    'name', i.name,
    'description', i.description,
    'quantity', i.quantity,
    'unit', i.unit,
    'unit_price', i.unit_price,
    'taxable', i.taxable,
    'photo_url', i.photo_url,
    'is_optional', i.is_optional,
    'default_selected', i.default_selected,
    'display_order', i.display_order
  ) order by i.display_order, i.id), '[]'::jsonb)
  into item_rows
  from public.quote_line_items i
  where i.quote_id = q.id and i.company_id = q.company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'quote_id', s.quote_id,
    'payment_name', s.payment_name,
    'due_event', s.due_event,
    'amount', s.amount,
    'amount_type', s.amount_type,
    'percentage', s.percentage,
    'sort_order', s.sort_order
  ) order by s.sort_order, s.id), '[]'::jsonb)
  into schedule_rows
  from public.quote_payment_schedules s
  where s.quote_id = q.id and s.company_id = q.company_id;

  return jsonb_build_object(
    'quote', jsonb_build_object(
      'id', q.id,
      'company_id', q.company_id,
      'client_id', q.client_id,
      'quote_number', q.quote_number,
      'title', q.title,
      'status', q.status,
      'subtotal', q.subtotal,
      'tax', q.tax,
      'total', q.total,
      'overall_scope', q.overall_scope,
      'client_message', q.client_message,
      'terms', q.terms,
      'deposit_amount', q.deposit_amount,
      'deposit_paid_amount', q.deposit_paid_amount,
      'discount_amount', q.discount_amount,
      'discount_type', q.discount_type,
      'discount_percentage', q.discount_percentage,
      'show_discount_amount', q.show_discount_amount,
      'has_payment_schedule', q.has_payment_schedule,
      'hero_image_url', q.hero_image_url,
      'end_photos', q.end_photos,
      'documents', q.documents,
      'site_address', q.site_address,
      'show_overall_scope', q.show_overall_scope,
      'issue_date', q.issue_date,
      'expiry_date', q.expiry_date,
      'client_selected_items_json', q.client_selected_items_json,
      'signed_at', q.signed_at,
      'signed_by', q.signed_by,
      'decline_reason', q.decline_reason
    ),
    'client', case when c.id is null then null else jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'first_name', c.first_name,
      'surname', c.surname,
      'billing_address', c.billing_address,
      'site_address', c.site_address
    ) end,
    'company', jsonb_build_object(
      'id', co.id,
      'name', co.name,
      'logo_url', co.logo_url,
      'company_logo_url', co.company_logo_url,
      'settings', jsonb_build_object(
        'address', co.settings -> 'address',
        'phone', co.settings -> 'phone',
        'email', co.settings -> 'email',
        'website', co.settings -> 'website',
        'tax_id', co.settings -> 'tax_id',
        'tax_label', co.settings -> 'tax_label',
        'tax_rate', co.settings -> 'tax_rate',
        'enable_secondary_tax', co.settings -> 'enable_secondary_tax',
        'secondary_tax_label', co.settings -> 'secondary_tax_label',
        'secondary_tax_rate', co.settings -> 'secondary_tax_rate',
        'currency', co.settings -> 'currency',
        'quote_client_message', co.settings -> 'quote_client_message',
        'default_terms', co.settings -> 'default_terms',
        'pdf', jsonb_build_object('brand_color', co.settings #> '{pdf,brand_color}')
      )
    ),
    'phases', phase_rows,
    'items', item_rows,
    'schedule_items', schedule_rows,
    'approval', jsonb_build_object(
      'id', approval.id,
      'status', approval.approval_status,
      'signer_name', approval.signer_name,
      'signed_at', approval.signed_at
    ),
    'is_expired', q.expiry_date is not null and q.expiry_date < current_date
  );
end;
$$;

create or replace function public.track_public_quote_view(p_quote uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval public.quote_approvals;
  q public.quotes;
begin
  if p_quote is null or p_token is null or char_length(p_token) < 32 or char_length(p_token) > 256 then
    raise exception 'Quote link is invalid' using errcode = '42501';
  end if;

  select * into approval
  from public.quote_approvals
  where quote_id = p_quote and approval_token = p_token and coalesce(approval_status, '') <> 'Revoked'
  order by created_at desc nulls last, id desc
  limit 1
  for update;

  if not found then
    raise exception 'Quote link is invalid' using errcode = '42501';
  end if;

  select * into q
  from public.quotes
  where id = p_quote and company_id = approval.company_id and is_template is distinct from true
  for update;

  if not found then
    raise exception 'Quote is unavailable' using errcode = 'P0002';
  end if;

  insert into public.quote_views(company_id, quote_id, viewer_type, viewed_at)
  values (q.company_id, q.id, 'client', now());

  update public.quote_approvals
  set viewed_at = coalesce(viewed_at, now()),
      approval_status = case when approval_status in ('Pending', 'Sent') then 'Viewed' else approval_status end
  where id = approval.id;

  if lower(coalesce(q.status, '')) = 'sent' then
    update public.quotes set status = 'Viewed', viewed_at = current_date, updated_at = now() where id = q.id;
  end if;

  return true;
end;
$$;

create or replace function public.get_client_portal_quotes(p_client uuid, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'quote_number', q.quote_number,
    'title', q.title,
    'status', q.status,
    'total', q.total,
    'created_at', q.created_at,
    'issue_date', q.issue_date,
    'expiry_date', q.expiry_date,
    'hero_image_url', q.hero_image_url,
    'end_photos', q.end_photos,
    'documents', q.documents,
    'approval_token', a.approval_token
  ) order by q.created_at desc), '[]'::jsonb)
  from public.quotes q
  join public.quote_approvals a
    on a.quote_id = q.id
    and a.company_id = q.company_id
    and a.approval_token = p_token
    and coalesce(a.approval_status, '') <> 'Revoked'
  where q.client_id = p_client
    and p_token is not null
    and char_length(p_token) between 32 and 256
    and q.is_template is distinct from true
    and lower(coalesce(q.status, '')) not in ('draft', 'pending review');
$$;

create or replace function public.respond_to_public_quote(
  p_quote uuid,
  p_token text,
  p_action text,
  p_selections jsonb default '{}'::jsonb,
  p_signer_name text default null,
  p_signer_email text default null,
  p_terms_accepted boolean default false,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval public.quote_approvals;
  q public.quotes;
  co public.companies;
  action text := lower(trim(coalesce(p_action, '')));
  selections jsonb := coalesce(p_selections, '{}'::jsonb);
  subtotal_amount numeric := 0;
  taxable_amount numeric := 0;
  primary_rate numeric := 0;
  secondary_rate numeric := 0;
  total_tax numeric := 0;
  discount_amount numeric := 0;
  total_amount numeric := 0;
  phase_selected boolean;
  item_selected boolean;
  phase_row public.quote_phases;
  item_row public.quote_line_items;
  request_ip text;
begin
  if p_quote is null or p_token is null or char_length(p_token) < 32 or char_length(p_token) > 256 then
    raise exception 'Quote link is invalid' using errcode = '42501';
  end if;

  select * into approval
  from public.quote_approvals
  where quote_id = p_quote and approval_token = p_token and coalesce(approval_status, '') <> 'Revoked'
  order by created_at desc nulls last, id desc
  limit 1
  for update;

  if not found then
    raise exception 'Quote link is invalid' using errcode = '42501';
  end if;

  select * into q
  from public.quotes
  where id = p_quote and company_id = approval.company_id and is_template is distinct from true
  for update;

  if not found then
    raise exception 'Quote is unavailable' using errcode = 'P0002';
  end if;

  if action not in ('approve', 'decline', 'request_changes') then
    raise exception 'Unsupported quote response' using errcode = '22023';
  end if;

  begin
    request_ip := nullif(trim(split_part(
      coalesce((coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb) ->> 'x-forwarded-for', ''),
      ',', 1
    )), '');
  exception when others then
    request_ip := null;
  end;

  if lower(coalesce(q.status, '')) not in ('sent', 'viewed') then
    raise exception 'This quote no longer accepts a response' using errcode = '23514';
  end if;

  if action = 'approve' then
    if q.expiry_date is not null and q.expiry_date < current_date then
      raise exception 'This quote expired on %', q.expiry_date using errcode = '23514';
    end if;
    if not p_terms_accepted then
      raise exception 'Accept the terms before approving the quote' using errcode = '23514';
    end if;
    if char_length(trim(coalesce(p_signer_name, ''))) < 2 or char_length(trim(p_signer_name)) > 120 then
      raise exception 'Enter the approving client name' using errcode = '23514';
    end if;
    if nullif(trim(coalesce(p_signer_email, '')), '') is not null
      and trim(p_signer_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
      raise exception 'Enter a valid signer email address' using errcode = '23514';
    end if;
    if jsonb_typeof(selections) <> 'object' then
      raise exception 'Invalid optional item selections' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_each(selections) e where jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'Invalid optional item selections' using errcode = '22023';
    end if;
    if exists(
      select 1 from jsonb_object_keys(selections) k
      where not exists(select 1 from public.quote_phases p where p.quote_id = q.id and p.id::text = k)
        and not exists(select 1 from public.quote_line_items i where i.quote_id = q.id and i.id::text = k)
    ) then
      raise exception 'Unknown optional item selection' using errcode = '22023';
    end if;

    select * into co from public.companies where id = q.company_id;
    begin
      primary_rate := coalesce(nullif(co.settings ->> 'tax_rate', '')::numeric, 5) / 100;
    exception when others then
      primary_rate := 0.05;
    end;
    begin
      secondary_rate := case when coalesce((co.settings ->> 'enable_secondary_tax')::boolean, false)
        then coalesce(nullif(co.settings ->> 'secondary_tax_rate', '')::numeric, 0) / 100 else 0 end;
    exception when others then
      secondary_rate := 0;
    end;

    for phase_row in
      select * from public.quote_phases where quote_id = q.id and company_id = q.company_id order by sort_order, id
    loop
      phase_selected := not coalesce(phase_row.is_optional, false)
        or coalesce((selections ->> phase_row.id::text)::boolean, coalesce(phase_row.default_selected, false));
      if phase_selected then
        for item_row in
          select * from public.quote_line_items where quote_id = q.id and company_id = q.company_id and phase_id = phase_row.id
        loop
          item_selected := not coalesce(item_row.is_optional, false)
            or coalesce((selections ->> item_row.id::text)::boolean, coalesce(item_row.default_selected, false));
          if item_selected then
            subtotal_amount := subtotal_amount + coalesce(item_row.quantity, 0) * coalesce(item_row.unit_price, 0);
            if coalesce(item_row.taxable, false) then
              taxable_amount := taxable_amount + coalesce(item_row.quantity, 0) * coalesce(item_row.unit_price, 0);
            end if;
          end if;
        end loop;
      end if;
    end loop;

    total_tax := round(taxable_amount * (primary_rate + secondary_rate), 2);
    discount_amount := case when q.discount_type = 'percentage'
      then round((subtotal_amount + total_tax) * coalesce(q.discount_percentage, 0) / 100, 2)
      else coalesce(q.discount_amount, 0) end;
    total_amount := greatest(round(subtotal_amount + total_tax - discount_amount, 2), 0);

    update public.quotes
    set status = 'Approved',
        client_selected_items = selections,
        client_selected_items_json = selections::text,
        subtotal = round(subtotal_amount, 2),
        tax = total_tax,
        total = total_amount,
        client_signature = trim(p_signer_name),
        signed_by = trim(p_signer_name),
        signed_at = now()::text,
        updated_at = now()
    where id = q.id;

    update public.quote_approvals
    set approval_status = 'Approved',
        signer_name = trim(p_signer_name),
        signer_email = nullif(trim(coalesce(p_signer_email, '')), ''),
        client_ip = request_ip,
        signed_at = now()
    where id = approval.id;

    return jsonb_build_object('status', 'Approved', 'subtotal', round(subtotal_amount, 2), 'tax', total_tax, 'total', total_amount);
  end if;

  if action = 'decline' then
    update public.quotes
    set status = 'Declined', decline_reason = nullif(left(trim(coalesce(p_message, '')), 2000), ''), updated_at = now()
    where id = q.id;
    update public.quote_approvals set approval_status = 'Declined', client_ip = request_ip where id = approval.id;
    return jsonb_build_object('status', 'Declined');
  end if;

  if char_length(trim(coalesce(p_message, ''))) < 1 or char_length(trim(p_message)) > 2000 then
    raise exception 'Describe the requested changes' using errcode = '23514';
  end if;

  insert into public.quote_change_requests(company_id, quote_id, approval_id, message)
  values (q.company_id, q.id, approval.id, trim(p_message));
  update public.quotes set status = 'Pending', updated_at = now() where id = q.id;
  update public.quote_approvals set approval_status = 'Changes Requested', client_ip = request_ip where id = approval.id;
  return jsonb_build_object('status', 'Pending', 'change_request_status', 'Open');
end;
$$;

-- Remove anonymous table access for quote data. Authenticated company users keep
-- their existing tenant-scoped RLS policies; public recipients must use the
-- token-validated functions above.
drop policy if exists "Allow public link viewing for sent quotes" on public.quotes;
drop policy if exists "Public can read Quotes if they have the ID" on public.quotes;
drop policy if exists "Allow public to update quote status" on public.quotes;
drop policy if exists "Allow public link viewing for phases" on public.quote_phases;
drop policy if exists "Public can read Quote Phases if they have the ID" on public.quote_phases;
drop policy if exists "Allow public link viewing for line items" on public.quote_line_items;
drop policy if exists "Public can read Quote Line Items if they have the ID" on public.quote_line_items;
drop policy if exists "Public can read Quote Schedules if they have the ID" on public.quote_payment_schedules;
drop policy if exists "Anyone can insert views" on public.quote_views;
drop policy if exists "Company users can read views" on public.quote_views;

revoke all on table public.quotes, public.quote_phases, public.quote_line_items,
  public.quote_payment_schedules, public.quote_views, public.quote_approvals from public, anon;
grant select, insert, update, delete on table public.quotes, public.quote_phases,
  public.quote_line_items, public.quote_payment_schedules, public.quote_views,
  public.quote_approvals to authenticated, service_role;

revoke all on function public.issue_quote_share_token(uuid) from public, anon, authenticated;
revoke all on function public.get_public_quote_bundle(uuid, text) from public, anon, authenticated;
revoke all on function public.track_public_quote_view(uuid, text) from public, anon, authenticated;
revoke all on function public.respond_to_public_quote(uuid, text, text, jsonb, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.get_client_portal_quotes(uuid, text) from public, anon, authenticated;

grant execute on function public.issue_quote_share_token(uuid) to authenticated, service_role;
grant execute on function public.get_public_quote_bundle(uuid, text) to anon, authenticated, service_role;
grant execute on function public.track_public_quote_view(uuid, text) to anon, authenticated, service_role;
grant execute on function public.respond_to_public_quote(uuid, text, text, jsonb, text, text, boolean, text) to anon, authenticated, service_role;
grant execute on function public.get_client_portal_quotes(uuid, text) to anon, authenticated, service_role;
