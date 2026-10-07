-- Track every accounting payment independently so timeouts cannot create duplicates.
alter table public.qbo_invoice_exports
  add column payment_sync_status text not null default 'not_applicable'
    check (payment_sync_status in ('not_applicable','pending','complete','review_required'));

create table public.qbo_payment_exports (
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null check (environment in ('sandbox','production')),
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  realm_id text not null,
  qbo_invoice_id text not null,
  qbo_payment_id text,
  status text not null check (status in ('processing','exported','review_required')),
  request_id uuid not null,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (company_id, environment, payment_id)
);
create unique index qbo_payment_exports_remote_unique
  on public.qbo_payment_exports(environment,realm_id,qbo_payment_id) where qbo_payment_id is not null;
alter table public.qbo_payment_exports enable row level security;
revoke all on public.qbo_payment_exports from public, anon, authenticated;
grant select, insert, update on public.qbo_payment_exports to service_role;

create function public.qbo_claim_payment_export(
  p_company uuid, p_environment text, p_invoice uuid, p_payment uuid,
  p_realm text, p_remote_invoice text, p_request uuid
) returns table(claimed boolean, export_status text, request_id uuid, remote_id text)
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_request is null or p_environment not in ('sandbox','production')
    or p_realm !~ '^[0-9]{1,30}$' or p_remote_invoice !~ '^[0-9]+$'
    or not exists (select 1 from public.payments
      where id=p_payment and company_id=p_company and invoice_id=p_invoice)
    or not exists (select 1 from public.qbo_invoice_exports
      where company_id=p_company and environment=p_environment and invoice_id=p_invoice
        and realm_id=p_realm and qbo_invoice_id=p_remote_invoice and status='exported') then
    raise exception 'Invalid QuickBooks payment export';
  end if;
  insert into public.qbo_payment_exports(
    company_id,environment,payment_id,invoice_id,realm_id,qbo_invoice_id,status,request_id)
    values (p_company,p_environment,p_payment,p_invoice,p_realm,p_remote_invoice,'processing',p_request)
    on conflict do nothing;
  return query select x.request_id=p_request,x.status,x.request_id,x.qbo_payment_id
    from public.qbo_payment_exports x
    where x.company_id=p_company and x.environment=p_environment and x.payment_id=p_payment;
end $$;
revoke all on function public.qbo_claim_payment_export(uuid,text,uuid,uuid,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.qbo_claim_payment_export(uuid,text,uuid,uuid,text,text,uuid)
  to service_role;
