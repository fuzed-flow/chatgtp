-- Embedding maintenance is privileged work. This legacy view must not offer
-- a second API path around the help tables' authenticated role policies.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'knowledge_chunks_needing_embedding'
      AND c.relkind = 'v'
  ) THEN
    ALTER VIEW public.knowledge_chunks_needing_embedding SET (security_invoker = true);
    REVOKE ALL ON public.knowledge_chunks_needing_embedding FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.knowledge_chunks_needing_embedding TO service_role;
  END IF;
END $$;
