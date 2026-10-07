-- One outbound invoice per company, environment, and FuzedFlow invoice.
create table public.qbo_invoice_exports (
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  realm_id text not null,
  qbo_invoice_id text,
  qbo_customer_id text,
  status text not null check (status in ('processing','exported','review_required')),
  request_id uuid not null default gen_random_uuid(),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (company_id, environment, invoice_id)
);
create unique index qbo_invoice_exports_remote_unique
  on public.qbo_invoice_exports(environment, realm_id, qbo_invoice_id) where qbo_invoice_id is not null;
alter table public.qbo_invoice_exports enable row level security;
revoke all on public.qbo_invoice_exports from public, anon, authenticated;
grant select, insert, update on public.qbo_invoice_exports to service_role;

create table public.qbo_customer_links (
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  client_id uuid not null references public.clients(id) on delete cascade,
  realm_id text not null,
  qbo_customer_id text not null,
  created_at timestamptz not null default now(),
  primary key (company_id, environment, client_id)
);
alter table public.qbo_customer_links enable row level security;
revoke all on public.qbo_customer_links from public, anon, authenticated;
grant select, insert on public.qbo_customer_links to service_role;

-- Atomic claim makes simultaneous export requests safe. A failed or timed-out write
-- stays review_required, never silently retries an uncertain accounting operation.
create function public.qbo_claim_invoice_export(
  p_company uuid, p_environment text, p_invoice uuid, p_realm text, p_request uuid
) returns table(claimed boolean, export_status text, request_id uuid, remote_id text)
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_request is null or p_environment not in ('sandbox','production') or p_realm !~ '^[0-9]{1,30}$'
     or not exists (select 1 from public.invoices where id = p_invoice and company_id = p_company) then
    raise exception 'Invalid invoice export';
  end if;
  insert into public.qbo_invoice_exports(company_id, environment, invoice_id, realm_id, status, request_id)
    values(p_company, p_environment, p_invoice, p_realm, 'processing', p_request)
    on conflict do nothing;
  return query
    select x.request_id = p_request,
      x.status, x.request_id, x.qbo_invoice_id
    from public.qbo_invoice_exports x
    where x.company_id = p_company and x.environment = p_environment and x.invoice_id = p_invoice;
end $$;
revoke all on function public.qbo_claim_invoice_export(uuid,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.qbo_claim_invoice_export(uuid,text,uuid,text,uuid) to service_role;
