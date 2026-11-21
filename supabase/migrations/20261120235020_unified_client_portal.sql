-- One client-scoped portal accepts existing document links without exposing
-- draft documents, other clients, or private company settings.
create schema if not exists client_portal_private;
revoke all on schema client_portal_private from public, anon, authenticated;

create table client_portal_private.links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 year',
  revoked_at timestamptz
);
alter table client_portal_private.links enable row level security;
revoke all on client_portal_private.links from public, anon, authenticated;

-- A document credential opened from the portal must not become a new portal
-- credential, or prolong portal access beyond its original link's lifetime.
create table client_portal_private.document_tokens (
  token_hash text primary key,
  company_id uuid not null references public.companies(id) on delete cascade
);
alter table client_portal_private.document_tokens enable row level security;
revoke all on client_portal_private.document_tokens from public,anon,authenticated;

create function client_portal_private.company_for_link(p_client uuid, p_token text)
returns uuid language plpgsql stable set search_path = '' as $$
declare company_uuid uuid;
begin
  select c.company_id into company_uuid from public.clients c
  join public.companies co on co.id=c.company_id
  where c.id=p_client and co.settings->'client_portal'->>'portal_active' is distinct from 'false';
  if company_uuid is null then raise exception 'Portal unavailable' using errcode='42501'; end if;
  if p_token is null or length(p_token) not between 32 and 256 then
    raise exception 'Open the secure portal link from your contractor' using errcode='42501';
  end if;
  if exists (
    select 1 from client_portal_private.links l
    where l.client_id=p_client and l.company_id=company_uuid
      and l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and l.revoked_at is null and l.expires_at>now()
  ) or exists (
    select 1 from public.quote_approvals a join public.quotes q on q.id=a.quote_id and q.company_id=a.company_id
    where q.client_id=p_client and q.company_id=company_uuid and a.approval_token=p_token
      and coalesce(a.approval_status,'') <> 'Revoked' and q.is_template is distinct from true
      and lower(coalesce(q.status,'')) not in ('draft','pending review','cancelled','canceled','void')
  ) or exists (
    select 1 from public.invoice_share_links l join public.invoices i on i.id=l.invoice_id and i.company_id=l.company_id and i.client_id=l.client_id
    where l.client_id=p_client and l.company_id=company_uuid
      and l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and l.status='Active' and l.revoked_at is null and (l.expires_at is null or l.expires_at>now())
      and not exists(select 1 from client_portal_private.document_tokens d where d.token_hash=l.token_hash)
      and lower(coalesce(i.status,'')) in ('sent','viewed','issued','partial','partially paid','overdue','past due','paid')
  ) or exists (
    select 1 from public.change_order_share_links l join public.change_orders c on c.id=l.change_order_id and c.company_id=l.company_id and c.client_id=l.client_id
    where l.client_id=p_client and l.company_id=company_uuid
      and l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
      and l.status='Active' and l.revoked_at is null and (l.expires_at is null or l.expires_at>now())
      and not exists(select 1 from client_portal_private.document_tokens d where d.token_hash=l.token_hash)
      and lower(coalesce(c.status,'')) not in ('draft','pending review','cancelled','canceled','void')
  ) then return company_uuid; end if;
  raise exception 'Portal link is invalid or expired' using errcode='42501';
end;
$$;

create function public.issue_client_portal_token(p_client uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare company_uuid uuid; token text;
begin
  select c.company_id into company_uuid from public.clients c
  join public.profiles p on p.company_id=c.company_id and p.id=auth.uid()
  where c.id=p_client and p.is_active is distinct from false
    and p.role in ('owner','admin','manager','office')
    and (app_review_private.module_allowed('clients') or app_review_private.module_allowed('projects'));
  if company_uuid is null then raise exception 'Client sharing permission required' using errcode='42501'; end if;
  token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into client_portal_private.links(company_id,client_id,token_hash,created_by)
  values(company_uuid,p_client,encode(extensions.digest(token,'sha256'),'hex'),auth.uid());
  return token;
end;
$$;

create function public.get_client_portal_bundle(p_client uuid, p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare company_uuid uuid; client_row public.clients; company_row public.companies;
  portal jsonb; quotes_json jsonb := '[]'; invoices_json jsonb := '[]'; changes_json jsonb := '[]';
  updates_json jsonb := '[]'; closeouts_json jsonb := '[]'; settings_json jsonb;
begin
  company_uuid := client_portal_private.company_for_link(p_client,p_token);
  select * into client_row from public.clients where id=p_client and company_id=company_uuid;
  select * into company_row from public.companies where id=company_uuid;
  portal := coalesce(company_row.settings->'client_portal','{}'::jsonb);
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into settings_json
  from jsonb_each(coalesce(company_row.settings,'{}'::jsonb))
  where key in ('client_portal','pdf','currency','currency_code','address','phone','email','website','tax_id','tax_rate','tax_label','enable_secondary_tax','secondary_tax_rate','secondary_tax_label');

  if portal->>'show_quotes' is distinct from 'false' or portal->>'show_documents' is distinct from 'false' or portal->>'show_portfolio' is distinct from 'false' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',q.id,'quote_number',q.quote_number,'title',q.title,'status',q.status,'total',q.total,
      'created_at',q.created_at,'issue_date',q.issue_date,'expiry_date',q.expiry_date,
      'hero_image_url',case when portal->>'show_portfolio' is distinct from 'false' then q.hero_image_url end,
      'end_photos',case when portal->>'show_portfolio' is distinct from 'false' then q.end_photos end,
      'documents',case when portal->>'show_documents' is distinct from 'false' then q.documents end
    ) order by q.created_at desc),'[]'::jsonb) into quotes_json
    from public.quotes q where q.client_id=p_client and q.company_id=company_uuid and q.is_template is distinct from true
      and lower(coalesce(q.status,'')) not in ('draft','pending review','cancelled','canceled','void')
      and exists(select 1 from public.quote_approvals a where a.quote_id=q.id and a.company_id=company_uuid and coalesce(a.approval_status,'')<>'Revoked');
  end if;
  if portal->>'show_invoices' is distinct from 'false' then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'status',i.status,
      'total',i.total,'amount_paid',i.amount_paid,'balance_due',i.balance_due,'issue_date',i.issue_date,'due_date',i.due_date,'created_at',i.created_at)
      order by i.created_at desc),'[]'::jsonb) into invoices_json
    from public.invoices i where i.client_id=p_client and i.company_id=company_uuid
      and lower(coalesce(i.status,'')) in ('sent','viewed','issued','partial','partially paid','overdue','past due','paid')
      and exists(select 1 from public.invoice_share_links l where l.invoice_id=i.id and l.company_id=company_uuid and l.client_id=p_client
        and l.status='Active' and l.revoked_at is null and (l.expires_at is null or l.expires_at>now())
        and not exists(select 1 from client_portal_private.document_tokens d where d.token_hash=l.token_hash));
  end if;
  if portal->>'show_change_orders' is distinct from 'false' then
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'co_number',c.change_order_number,'title',c.title,'status',c.status,'total',c.total,'created_at',c.created_at)
      order by c.created_at desc),'[]'::jsonb) into changes_json
    from public.change_orders c where c.client_id=p_client and c.company_id=company_uuid
      and lower(coalesce(c.status,'')) not in ('draft','pending review','cancelled','canceled','void')
      and exists(select 1 from public.change_order_share_links l where l.change_order_id=c.id and l.company_id=company_uuid and l.client_id=p_client
        and l.status='Active' and l.revoked_at is null and (l.expires_at is null or l.expires_at>now())
        and not exists(select 1 from client_portal_private.document_tokens d where d.token_hash=l.token_hash));
  end if;
  if portal->>'show_client_updates' is distinct from 'false' then
    select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) into updates_json from workflow_private.client_portal_updates(p_client) u;
  end if;
  if portal->>'show_project_closeouts' is distinct from 'false' then
    select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into closeouts_json from workflow_private.client_portal_closeouts(p_client) c;
  end if;
  return jsonb_build_object(
    'client',jsonb_build_object('id',client_row.id,'name',client_row.name,'company_id',company_uuid),
    'company',jsonb_build_object('id',company_uuid,'name',company_row.name,'logo_url',company_row.logo_url,'company_logo_url',company_row.company_logo_url,'settings',settings_json),
    'quotes',quotes_json,'invoices',invoices_json,'change_orders',changes_json,'updates',updates_json,'closeouts',closeouts_json);
end;
$$;

create function public.get_client_portal_document_link(p_client uuid, p_token text, p_kind text, p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare bundle jsonb; company_uuid uuid; token text; result_token text;
begin
  if p_kind not in ('quote','invoice','change_order') then raise exception 'Document unavailable' using errcode='42501'; end if;
  bundle := public.get_client_portal_bundle(p_client,p_token);
  company_uuid := (bundle->'company'->>'id')::uuid;
  if p_kind='quote' then
    if bundle->'company'->'settings'->'client_portal'->>'show_quotes'='false'
      or not exists(select 1 from jsonb_array_elements(bundle->'quotes') d where (d->>'id')::uuid=p_document) then
      raise exception 'Document unavailable' using errcode='42501'; end if;
    select a.approval_token into result_token from public.quote_approvals a
    where a.quote_id=p_document and a.company_id=company_uuid and coalesce(a.approval_status,'')<>'Revoked'
    order by a.created_at desc nulls last, a.id desc limit 1;
    return result_token;
  end if;
  if not exists(select 1 from jsonb_array_elements(bundle->case when p_kind='invoice' then 'invoices' else 'change_orders' end) d
    where (d->>'id')::uuid=p_document) then raise exception 'Document unavailable' using errcode='42501'; end if;
  -- Reuse one short-lived child link per portal credential and document.
  token := encode(extensions.hmac(p_kind || ':' || p_document::text,p_token,'sha256'),'hex');
  insert into client_portal_private.document_tokens(token_hash,company_id)
  values(encode(extensions.digest(token,'sha256'),'hex'),company_uuid) on conflict do nothing;
  if p_kind='invoice' then
    insert into public.invoice_share_links(company_id,invoice_id,client_id,token_hash,expires_at)
    values(company_uuid,p_document,p_client,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '1 hour')
    on conflict(token_hash) do update set expires_at=excluded.expires_at
      where invoice_share_links.status='Active' and invoice_share_links.revoked_at is null
    returning token_hash into result_token;
  else
    insert into public.change_order_share_links(company_id,change_order_id,client_id,token_hash,expires_at)
    values(company_uuid,p_document,p_client,encode(extensions.digest(token,'sha256'),'hex'),now()+interval '1 hour')
    on conflict(token_hash) do update set expires_at=excluded.expires_at
      where change_order_share_links.status='Active' and change_order_share_links.revoked_at is null
    returning token_hash into result_token;
  end if;
  if result_token is null then raise exception 'Document link was revoked' using errcode='42501'; end if;
  return token;
end;
$$;

revoke all on all functions in schema client_portal_private from public,anon,authenticated;
revoke all on function public.issue_client_portal_token(uuid) from public,anon,authenticated;
grant execute on function public.issue_client_portal_token(uuid) to authenticated;
revoke all on function public.get_client_portal_bundle(uuid,text) from public,anon,authenticated;
revoke all on function public.get_client_portal_document_link(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.get_client_portal_bundle(uuid,text) to anon,authenticated,service_role;
grant execute on function public.get_client_portal_document_link(uuid,text,text,uuid) to anon,authenticated,service_role;
