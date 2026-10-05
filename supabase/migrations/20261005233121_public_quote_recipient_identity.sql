-- Resolve the customer-facing quote recipient without exposing the underlying
-- lead record. Client quotes retain their existing public address projection;
-- lead quotes expose only the display name required by the document.

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
  lead_name text;
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

  select * into c
  from public.clients
  where id = q.client_id
    and company_id = q.company_id;

  if c.id is null and q.lead_id is not null then
    select nullif(btrim(contact_name), '') into lead_name
    from public.leads
    where id = q.lead_id
      and company_id = q.company_id;
  end if;

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
    'recipient', case
      when c.id is not null then jsonb_build_object(
        'source_type', 'client',
        'name', coalesce(nullif(btrim(c.name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.surname)), '')),
        'billing_address', c.billing_address,
        'site_address', c.site_address
      )
      when lead_name is not null then jsonb_build_object(
        'source_type', 'lead',
        'name', lead_name
      )
      else null
    end,
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

revoke all on function public.get_public_quote_bundle(uuid, text) from public, anon, authenticated;
grant execute on function public.get_public_quote_bundle(uuid, text) to anon, authenticated, service_role;

comment on function public.get_public_quote_bundle(uuid, text) is
  'Returns the token-authorized public quote bundle with a minimal client-or-lead recipient projection.';
