-- Support company-scoped recent-match retrieval without changing access policies.
SET LOCAL lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS clients_global_search_company_recent_idx
  ON public.clients (company_id, created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS leads_global_search_company_recent_idx
  ON public.leads (company_id, created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS quotes_global_search_company_recent_idx
  ON public.quotes (company_id, created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS projects_global_search_company_recent_idx
  ON public.projects (company_id, created_at DESC NULLS LAST, id DESC);
CREATE INDEX IF NOT EXISTS invoices_global_search_company_recent_idx
  ON public.invoices (company_id, created_at DESC NULLS LAST, id DESC);
