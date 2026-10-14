create or replace function public.convert_lead_to_client(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_lead public.leads%rowtype;
  matched_client public.clients%rowtype;
  client_id_value uuid;
  candidate_ids uuid[] := '{}'::uuid[];
  candidate_count integer := 0;
  linked_quote_count integer := 0;
  created_client boolean := false;
  lead_email text;
  lead_phone text;
  photo_url text;
  document_value jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to convert a lead.' using errcode = '42501';
  end if;

  select * into source_lead
  from public.leads
  where id = p_lead_id;

  if not found then
    raise exception 'Lead not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.company_id = source_lead.company_id
      and p.is_active is distinct from false
  ) then
    raise exception 'You do not have access to this lead.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_lead_id::text, 0));

  select * into source_lead
  from public.leads
  where id = p_lead_id
  for update;

  if source_lead.client_id is not null then
    select * into matched_client
    from public.clients c
    where c.id = source_lead.client_id
      and c.company_id = source_lead.company_id;

    if not found then
      raise exception 'The lead is linked to a client outside this company.' using errcode = '23503';
    end if;

    update public.leads
    set pipeline_stage = 'Won',
        won_at = coalesce(won_at, pg_catalog.now()),
        stage_changed_at = case when pipeline_stage is distinct from 'Won' then pg_catalog.now() else stage_changed_at end
    where id = source_lead.id
      and company_id = source_lead.company_id;

    update public.quotes
    set client_id = matched_client.id,
        lead_id = null,
        updated_at = pg_catalog.now()
    where company_id = source_lead.company_id
      and lead_id = source_lead.id;
    get diagnostics linked_quote_count = row_count;

    return pg_catalog.jsonb_build_object(
      'id', matched_client.id,
      'client_id', matched_client.id,
      'name', matched_client.name,
      'created', false,
      'linked_quote_count', linked_quote_count
    );
  end if;

  lead_email := nullif(pg_catalog.lower(pg_catalog.btrim(source_lead.contact_email)), '');
  lead_phone := nullif(pg_catalog.regexp_replace(coalesce(source_lead.contact_phone, ''), '[^0-9]', '', 'g'), '');

  select coalesce(pg_catalog.array_agg(c.id order by c.id), '{}'::uuid[])
  into candidate_ids
  from public.clients c
  where c.company_id = source_lead.company_id
    and (
      (lead_email is not null and pg_catalog.lower(pg_catalog.btrim(c.email)) = lead_email)
      or
      (lead_phone is not null and pg_catalog.regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = lead_phone)
    );

  candidate_count := coalesce(pg_catalog.array_length(candidate_ids, 1), 0);

  if candidate_count > 1 then
    raise exception 'More than one existing client matches this lead. Select the correct client before converting.';
  elsif candidate_count = 1 then
    client_id_value := candidate_ids[1];

    select * into matched_client
    from public.clients c
    where c.id = client_id_value
      and c.company_id = source_lead.company_id;

    if lead_email is not null
       and nullif(pg_catalog.lower(pg_catalog.btrim(matched_client.email)), '') is not null
       and pg_catalog.lower(pg_catalog.btrim(matched_client.email)) <> lead_email then
      raise exception 'An existing client matches the lead phone but has a different email. Select the correct client before converting.';
    end if;

    if lead_phone is not null
       and nullif(pg_catalog.regexp_replace(coalesce(matched_client.phone, ''), '[^0-9]', '', 'g'), '') is not null
       and pg_catalog.regexp_replace(coalesce(matched_client.phone, ''), '[^0-9]', '', 'g') <> lead_phone then
      raise exception 'An existing client matches the lead email but has a different phone. Select the correct client before converting.';
    end if;
  else
    insert into public.clients (
      company_id, name, first_name, surname, primary_contact_name,
      email, phone, site_address, billing_address, notes, tags, type
    ) values (
      source_lead.company_id,
      coalesce(nullif(pg_catalog.btrim(source_lead.contact_name), ''), 'Unnamed Client'),
      nullif(pg_catalog.split_part(pg_catalog.btrim(source_lead.contact_name), ' ', 1), ''),
      nullif(pg_catalog.regexp_replace(pg_catalog.btrim(source_lead.contact_name), '^\\S+\\s*', ''), ''),
      coalesce(source_lead.contact_name, ''),
      nullif(pg_catalog.btrim(source_lead.contact_email), ''),
      nullif(pg_catalog.btrim(source_lead.contact_phone), ''),
      coalesce(source_lead.site_address, ''),
      coalesce(source_lead.site_address, ''),
      pg_catalog.concat_ws(E'\n\n', nullif(source_lead.description, ''), nullif(source_lead.notes, '')),
      case when nullif(pg_catalog.btrim(source_lead.source), '') is null
        then '{}'::text[] else array[source_lead.source]::text[] end,
      'Residential'
    ) returning * into matched_client;

    client_id_value := matched_client.id;
    created_client := true;
  end if;

  insert into public.notes (
    company_id, related_type, related_id, content, category,
    author_name, is_pinned, mention_user_ids
  )
  select
    n.company_id, 'Client', client_id_value, n.content, n.category,
    n.author_name, n.is_pinned, n.mention_user_ids
  from public.notes n
  where n.company_id = source_lead.company_id
    and n.related_type = 'Lead'
    and n.related_id = source_lead.id
    and not exists (
      select 1 from public.notes existing_note
      where existing_note.company_id = n.company_id
        and existing_note.related_type = 'Client'
        and existing_note.related_id = client_id_value
        and existing_note.content = n.content
        and existing_note.category is not distinct from n.category
        and existing_note.author_name is not distinct from n.author_name
    );

  for photo_url in
    select value
    from pg_catalog.jsonb_array_elements_text(coalesce(source_lead.photos, '[]'::jsonb)) as photo(value)
  loop
    if nullif(pg_catalog.btrim(photo_url), '') is not null
       and not exists (
         select 1 from public.attachments a
         where a.company_id = source_lead.company_id
           and a.related_type = 'Client'
           and a.related_id = client_id_value
           and a.file_url = photo_url
       ) then
      insert into public.attachments (
        company_id, related_type, related_id, file_url, file_name, caption
      ) values (
        source_lead.company_id, 'Client', client_id_value, photo_url,
        coalesce(nullif(pg_catalog.regexp_replace(photo_url, '^.*/', ''), ''), 'Lead photo'),
        'Site Photos/Info'
      );
    end if;
  end loop;

  for document_value in
    select value
    from pg_catalog.jsonb_array_elements(coalesce(source_lead.documents, '[]'::jsonb)) as document(value)
  loop
    photo_url := coalesce(document_value ->> 'file_url', document_value ->> 'url');
    if nullif(pg_catalog.btrim(photo_url), '') is not null
       and not exists (
         select 1 from public.attachments a
         where a.company_id = source_lead.company_id
           and a.related_type = 'Client'
           and a.related_id = client_id_value
           and a.file_url = photo_url
       ) then
      insert into public.attachments (
        company_id, related_type, related_id, file_url, file_name, caption
      ) values (
        source_lead.company_id, 'Client', client_id_value, photo_url,
        coalesce(document_value ->> 'file_name', document_value ->> 'name', 'Lead document'),
        'Lead Document'
      );
    end if;
  end loop;

  update public.leads
  set pipeline_stage = 'Won',
      client_id = client_id_value,
      won_at = coalesce(won_at, pg_catalog.now()),
      stage_changed_at = case when pipeline_stage is distinct from 'Won' then pg_catalog.now() else stage_changed_at end
  where id = source_lead.id
    and company_id = source_lead.company_id;

  update public.quotes
  set client_id = client_id_value,
      lead_id = null,
      updated_at = pg_catalog.now()
  where company_id = source_lead.company_id
    and lead_id = source_lead.id;
  get diagnostics linked_quote_count = row_count;

  return pg_catalog.jsonb_build_object(
    'id', client_id_value,
    'client_id', client_id_value,
    'name', matched_client.name,
    'created', created_client,
    'linked_quote_count', linked_quote_count
  );
end;
$$;

revoke all on function public.convert_lead_to_client(uuid) from public;
revoke all on function public.convert_lead_to_client(uuid) from anon;
grant execute on function public.convert_lead_to_client(uuid) to authenticated;

create or replace function public.ensure_quote_client(p_quote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_quote public.quotes%rowtype;
  client_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to convert a quote.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_quote_id::text, 0));

  select * into source_quote
  from public.quotes
  where id = p_quote_id
  for update;

  if not found then
    raise exception 'Quote not found.' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.company_id = source_quote.company_id
      and p.is_active is distinct from false
  ) then
    raise exception 'You do not have access to this quote.' using errcode = '42501';
  end if;

  if source_quote.client_id is not null then
    if not exists (
      select 1 from public.clients c
      where c.id = source_quote.client_id
        and c.company_id = source_quote.company_id
    ) then
      raise exception 'The quote is linked to a client outside this company.' using errcode = '23503';
    end if;

    return pg_catalog.jsonb_build_object(
      'quote_id', source_quote.id,
      'client_id', source_quote.client_id,
      'created', false,
      'converted_lead', false
    );
  end if;

  if source_quote.lead_id is null then
    raise exception 'Select a lead or client before converting this quote.';
  end if;

  client_result := public.convert_lead_to_client(source_quote.lead_id);

  return pg_catalog.jsonb_build_object(
    'quote_id', source_quote.id,
    'client_id', client_result ->> 'client_id',
    'created', coalesce((client_result ->> 'created')::boolean, false),
    'converted_lead', true,
    'linked_quote_count', coalesce((client_result ->> 'linked_quote_count')::integer, 0)
  );
end;
$$;

revoke all on function public.ensure_quote_client(uuid) from public;
revoke all on function public.ensure_quote_client(uuid) from anon;
grant execute on function public.ensure_quote_client(uuid) to authenticated;

alter function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric)
rename to convert_quote_to_invoice_core;

revoke all on function public.convert_quote_to_invoice_core(uuid, uuid, jsonb, numeric, numeric, numeric) from public;
revoke all on function public.convert_quote_to_invoice_core(uuid, uuid, jsonb, numeric, numeric, numeric) from anon;
revoke all on function public.convert_quote_to_invoice_core(uuid, uuid, jsonb, numeric, numeric, numeric) from authenticated;

create function public.convert_quote_to_invoice(
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
begin
  perform public.ensure_quote_client(p_quote_id);

  return public.convert_quote_to_invoice_core(
    p_quote_id,
    p_project_id,
    p_selected_items,
    p_subtotal,
    p_tax,
    p_total
  );
end;
$$;

revoke all on function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric) from public;
revoke all on function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric) from anon;
grant execute on function public.convert_quote_to_invoice(uuid, uuid, jsonb, numeric, numeric, numeric) to authenticated;
