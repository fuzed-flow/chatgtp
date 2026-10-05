-- Cover foreign keys used by joins and referential actions. The reporting
-- indexes begin with company_id, so they do not cover these FK columns alone.
create index if not exists sales_activity_client_fk
  on public.sales_activities(client_id)
  where client_id is not null;

create index if not exists sales_activity_lead_fk
  on public.sales_activities(lead_id)
  where lead_id is not null;

create index if not exists sales_activity_quote_fk
  on public.sales_activities(quote_id)
  where quote_id is not null;

create index if not exists sales_activity_user_fk
  on public.sales_activities(user_id)
  where user_id is not null;

create index if not exists sales_target_user_fk
  on public.sales_targets(user_id)
  where user_id is not null;
