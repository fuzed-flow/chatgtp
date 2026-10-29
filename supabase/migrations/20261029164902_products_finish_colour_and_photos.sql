-- Preview release: nullable user-entered Finish / Colour. Existing records remain blank.
begin;
alter table public.products add column if not exists finish_colour text;
alter table public.quote_line_items add column if not exists finish_colour text;
alter table public.change_order_line_items add column if not exists finish_colour text;
alter table public.invoice_line_items add column if not exists finish_colour text;
alter table public.purchase_order_line_items add column if not exists finish_colour text;
alter table public.invoice_line_items add column if not exists photo_url text;
alter table public.purchase_order_line_items add column if not exists photo_url text;

-- Preserve the existing recipient-token validation and public field allowlist.
CREATE OR REPLACE FUNCTION public.get_public_change_order_bundle(p_change_order uuid, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare link public.change_order_share_links; co public.change_orders; recipient public.clients; company public.companies; project public.projects;
  phase_rows jsonb; item_rows jsonb;
begin
  if p_change_order is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into link from public.change_order_share_links where change_order_id=p_change_order
    and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and status='Active' and revoked_at is null
    and (expires_at is null or expires_at>clock_timestamp()) limit 1;
  if not found then raise exception 'Change order link is invalid' using errcode='42501'; end if;
  select * into co from public.change_orders where id=p_change_order and company_id=link.company_id
    and lower(coalesce(status,'')) not in ('draft','pending review','cancelled','void');
  if not found then raise exception 'Change order unavailable' using errcode='P0002'; end if;
  select * into recipient from public.clients where id=link.client_id and company_id=link.company_id;
  select * into company from public.companies where id=link.company_id;
  select * into project from public.projects where id=co.project_id and company_id=link.company_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'change_order_id',p.change_order_id,'phase_name',p.phase_name,
    'scope_of_work',p.scope_of_work,'show_scope_to_client',p.show_scope_to_client,'photos',p.photos,'sort_order',p.sort_order,
    'is_optional',p.is_optional,'default_selected',p.default_selected) order by p.sort_order),'[]'::jsonb) into phase_rows
    from public.change_order_phases p where p.change_order_id=co.id and p.company_id=co.company_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'change_order_id',i.change_order_id,'phase_id',i.phase_id,'name',i.name,
    'description',i.description, 'finish_colour', i.finish_colour,'quantity',i.quantity,'unit',i.unit,'unit_price',i.unit_price,'taxable',i.taxable,
    'display_order',i.display_order,'is_optional',i.is_optional,'default_selected',i.default_selected,'photo_url',i.photo_url)
    order by i.display_order),'[]'::jsonb) into item_rows from public.change_order_line_items i
    where i.change_order_id=co.id and i.company_id=co.company_id;
  return jsonb_build_object(
    'change_order',jsonb_build_object('id',co.id,'company_id',co.company_id,'project_id',co.project_id,'client_id',link.client_id,
      'title',co.title,'change_order_number',co.change_order_number,'status',co.status,'issue_date',co.issue_date,
      'client_message',co.client_message,'terms',co.terms,'overall_scope',co.overall_scope,'show_overall_scope',co.show_overall_scope,
      'hero_image_url',co.hero_image_url,'end_photos',co.end_photos,'documents',co.documents,'subtotal',co.subtotal,'tax',co.tax,'total',co.total,
      'client_selected_items_json',co.client_selected_items_json),
    'client',jsonb_build_object('id',recipient.id,'name',recipient.name,'first_name',recipient.first_name,'surname',recipient.surname,
      'formatted_name',coalesce(nullif(recipient.name,''),nullif(trim(coalesce(recipient.first_name,'')||' '||coalesce(recipient.surname,'')),''),'Client'),
      'billing_address',recipient.billing_address,'site_address',recipient.site_address),
    'company',jsonb_build_object('id',company.id,'name',company.name,'logo_url',company.logo_url,'company_logo_url',company.company_logo_url,
      'settings',jsonb_build_object('address',company.settings->'address','phone',company.settings->'phone','email',company.settings->'email',
        'website',company.settings->'website','tax_id',company.settings->'tax_id','tax_rate',company.settings->'tax_rate',
        'tax_label',company.settings->'tax_label','enable_secondary_tax',company.settings->'enable_secondary_tax',
        'secondary_tax_rate',company.settings->'secondary_tax_rate','secondary_tax_label',company.settings->'secondary_tax_label',
        'currency',company.settings->'currency','pdf',jsonb_build_object('brand_color',company.settings#>'{pdf,brand_color}'))),
    'project',case when project.id is null then null else jsonb_build_object('id',project.id,'name',project.name,'project_number',project.project_number,'site_address',project.site_address) end,
    'phases',phase_rows,'items',item_rows);
end;
$function$
;

-- Preserve the existing recipient-token validation and public field allowlist.
CREATE OR REPLACE FUNCTION public.get_public_invoice_bundle(p_invoice uuid, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'description', i.description, 'finish_colour', i.finish_colour, 'photo_url', i.photo_url,
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
$function$
;

-- Preserve the existing recipient-token validation and public field allowlist.
CREATE OR REPLACE FUNCTION public.get_public_quote_bundle(p_quote uuid, p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'description', i.description, 'finish_colour', i.finish_colour,
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
$function$
;

-- Keep the authenticated, company-scoped conversion and transaction intact.
CREATE OR REPLACE FUNCTION public.convert_quote_to_invoice_core(p_quote_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_selected_items jsonb DEFAULT NULL::jsonb, p_subtotal numeric DEFAULT NULL::numeric, p_tax numeric DEFAULT NULL::numeric, p_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      company_id, invoice_id, phase_id, name, description, finish_colour, photo_url, quantity, unit,
      unit_price, taxable, line_total, amount, display_order
    )
    select
      q.company_id, created_invoice.id, created_phase.id, qi.name,
      coalesce(qi.description, ''), qi.finish_colour, qi.photo_url, coalesce(qi.quantity, 1), coalesce(qi.unit, 'ea'),
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
$function$
;
notify pgrst, 'reload schema';
commit;
