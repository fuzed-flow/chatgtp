create or replace function public.convert_quote_to_invoice(
  p_quote_id uuid,
  p_project_id uuid default null,
  p_selected_items jsonb default null,
  p_subtotal numeric default null,
  p_tax numeric default null,
  p_total numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.quotes%rowtype;
  c public.companies%rowtype;
  existing_invoice public.invoices%rowtype;
  created_invoice public.invoices%rowtype;
  source_phase public.quote_phases%rowtype;
  created_phase public.invoice_phases%rowtype;
  selections jsonb := '{}'::jsonb;
  invoice_number_value text;
  invoice_sequence integer;
  phase_selected boolean;
  item_count integer := 0;
  phase_count integer := 0;
  schedule_count integer := 0;
  expected_item_count integer := 0;
  expected_phase_count integer := 0;
  expected_schedule_count integer := 0;
  inserted_rows integer := 0;
  existing_phase_count integer := 0;
  existing_item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to convert a quote.' using errcode = '42501';
  end if;

  select * into q
  from public.quotes
  where id = p_quote_id;

  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.company_id = q.company_id
      and p.is_active is distinct from false
  ) then
    raise exception 'You do not have access to this quote.' using errcode = '42501';
  end if;

  if p_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.company_id = q.company_id
  ) then
    raise exception 'The selected project does not belong to this company.' using errcode = '23503';
  end if;

  -- Serialize conversions for one quote and make retries idempotent.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_quote_id::text, 0));

  select * into existing_invoice
  from public.invoices i
  where i.quote_id = p_quote_id
    and coalesce(i.status, '') not in ('Void', 'Cancelled', 'Canceled')
  order by i.created_at
  limit 1;

  if found then
    select count(*) into existing_phase_count
    from public.invoice_phases where invoice_id = existing_invoice.id;
    select count(*) into existing_item_count
    from public.invoice_line_items where invoice_id = existing_invoice.id;

    if existing_phase_count = 0 or existing_item_count = 0 then
      raise exception 'This quote already has an incomplete invoice. Repair that invoice instead of creating a duplicate.';
    end if;

    return jsonb_build_object(
      'id', existing_invoice.id,
      'invoice_number', existing_invoice.invoice_number,
      'phase_count', existing_phase_count,
      'line_item_count', existing_item_count,
      'reused', true
    );
  end if;

  selections := coalesce(p_selected_items, q.client_selected_items, '{}'::jsonb);
  if p_selected_items is null
     and selections = '{}'::jsonb
     and nullif(q.client_selected_items_json, '') is not null then
    begin
      selections := q.client_selected_items_json::jsonb;
    exception when others then
      selections := '{}'::jsonb;
    end;
  end if;

  select count(*) into expected_phase_count
  from public.quote_phases qp
  where qp.quote_id = q.id
    and (
      not coalesce(qp.is_optional, false)
      or coalesce((selections ->> qp.id::text)::boolean, qp.default_selected, false)
    );

  select count(*) into expected_item_count
  from public.quote_line_items qi
  join public.quote_phases qp on qp.id = qi.phase_id and qp.quote_id = q.id
  where qi.quote_id = q.id
    and (
      not coalesce(qp.is_optional, false)
      or coalesce((selections ->> qp.id::text)::boolean, qp.default_selected, false)
    )
    and (
      not coalesce(qi.is_optional, false)
      or coalesce((selections ->> qi.id::text)::boolean, qi.default_selected, false)
    );

  if expected_phase_count = 0 or expected_item_count = 0 then
    raise exception 'The quote has no included phases or line items. The invoice was not created.';
  end if;

  if coalesce(q.has_payment_schedule, false) then
    select count(*) into expected_schedule_count
    from public.quote_payment_schedules where quote_id = q.id;
    if expected_schedule_count = 0 then
      raise exception 'The quote requires a payment schedule, but no payment stages were found.';
    end if;
  end if;

  select * into c
  from public.companies
  where id = q.company_id
  for update;

  invoice_sequence := coalesce(c.next_invoice_number, 1001);
  loop
    invoice_number_value := coalesce(c.invoice_number_prefix, 'INV-') || invoice_sequence::text;
    exit when not exists (
      select 1 from public.invoices i
      where i.company_id = q.company_id and i.invoice_number = invoice_number_value
    );
    invoice_sequence := invoice_sequence + 1;
  end loop;

  insert into public.invoices (
    company_id, client_id, project_id, quote_id, invoice_number, status,
    issue_date, due_date, due_terms, site_address, billing_address,
    subtotal, tax, total, amount_paid, balance_due, deposit_amount,
    has_payment_schedule, notes, show_notes, discount_amount, discount_type
  )
  select
    q.company_id, q.client_id, p_project_id, q.id, invoice_number_value, 'Draft',
    current_date, current_date, 'due_on_receipt',
    coalesce(nullif(q.site_address, ''), nullif(cl.site_address, ''), ''),
    coalesce(nullif(cl.billing_address, ''), nullif(cl.site_address, ''), nullif(q.site_address, ''), ''),
    coalesce(p_subtotal, q.subtotal, 0),
    coalesce(p_tax, q.tax, 0),
    coalesce(p_total, q.total, 0),
    0,
    coalesce(p_total, q.total, 0),
    coalesce(q.deposit_amount, 0),
    coalesce(q.has_payment_schedule, false),
    coalesce(nullif(q.terms, ''), nullif(q.client_message, ''), c.settings ->> 'default_invoice_terms', ''),
    true,
    coalesce(q.discount_amount, 0),
    coalesce(q.discount_type, 'fixed')
  from (select 1) seed
  left join public.clients cl on cl.id = q.client_id and cl.company_id = q.company_id
  returning * into created_invoice;

  for source_phase in
    select qp.*
    from public.quote_phases qp
    where qp.quote_id = q.id
      and (
        not coalesce(qp.is_optional, false)
        or coalesce((selections ->> qp.id::text)::boolean, qp.default_selected, false)
      )
    order by coalesce(qp.sort_order, 0), qp.id
  loop
    insert into public.invoice_phases (
      company_id, invoice_id, phase_name, scope_of_work, sort_order
    ) values (
      q.company_id, created_invoice.id, source_phase.phase_name,
      coalesce(source_phase.scope_of_work, ''), coalesce(source_phase.sort_order, phase_count)
    ) returning * into created_phase;
    phase_count := phase_count + 1;

    insert into public.invoice_line_items (
      company_id, invoice_id, phase_id, name, description, quantity, unit,
      unit_price, taxable, line_total, amount, display_order
    )
    select
      q.company_id, created_invoice.id, created_phase.id, qi.name,
      coalesce(qi.description, ''), coalesce(qi.quantity, 1), coalesce(qi.unit, 'ea'),
      coalesce(qi.unit_price, 0), coalesce(qi.taxable, false),
      coalesce(qi.quantity, 1) * coalesce(qi.unit_price, 0),
      coalesce(qi.quantity, 1) * coalesce(qi.unit_price, 0),
      coalesce(qi.display_order, 0)
    from public.quote_line_items qi
    where qi.quote_id = q.id
      and qi.phase_id = source_phase.id
      and (
        not coalesce(qi.is_optional, false)
        or coalesce((selections ->> qi.id::text)::boolean, qi.default_selected, false)
      )
    order by coalesce(qi.display_order, 0), qi.id;
    get diagnostics inserted_rows = row_count;
    item_count := item_count + inserted_rows;
  end loop;

  if coalesce(q.has_payment_schedule, false) then
    insert into public.invoice_payment_schedules (
      company_id, invoice_id, payment_name, due_event, amount, amount_paid,
      status, sort_order, amount_type, percentage, due_date
    )
    select
      q.company_id, created_invoice.id, qs.payment_name, coalesce(qs.due_event, ''),
      case when qs.amount_type = 'percentage'
        then round(coalesce(p_total, q.total, 0) * coalesce(qs.percentage, 0) / 100, 2)
        else coalesce(qs.amount, 0)
      end,
      0, 'Pending', coalesce(qs.sort_order, 0), coalesce(qs.amount_type, 'fixed'),
      coalesce(qs.percentage, 0), current_date
    from public.quote_payment_schedules qs
    where qs.quote_id = q.id
    order by coalesce(qs.sort_order, 0), qs.id;
    get diagnostics schedule_count = row_count;
  end if;

  if phase_count <> expected_phase_count
     or item_count <> expected_item_count
     or schedule_count <> expected_schedule_count then
    raise exception 'Invoice conversion validation failed. Nothing was created.';
  end if;

  update public.companies
  set next_invoice_number = invoice_sequence + 1
  where id = q.company_id;

  update public.quotes
  set status = 'Approved',
      client_selected_items = case when p_selected_items is null then client_selected_items else selections end,
      client_selected_items_json = case when p_selected_items is null then client_selected_items_json else selections::text end,
      subtotal = coalesce(p_subtotal, subtotal),
      tax = coalesce(p_tax, tax),
      total = coalesce(p_total, total),
      updated_at = now()
  where id = q.id;

  return jsonb_build_object(
    'id', created_invoice.id,
    'invoice_number', created_invoice.invoice_number,
    'phase_count', phase_count,
    'line_item_count', item_count,
    'schedule_count', schedule_count,
    'reused', false
  );
end;
$$;

revoke all on function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric) from public;
revoke all on function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric) from anon;
grant execute on function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric) to authenticated;

