-- FAQs and long guides share the current, permission-filtered answer store.
ALTER TABLE public.help_faqs
  ADD COLUMN IF NOT EXISTS article_type text NOT NULL DEFAULT 'faq'
    CHECK (article_type IN ('faq','guide')),
  ADD COLUMN IF NOT EXISTS read_minutes smallint NOT NULL DEFAULT 2
    CHECK (read_minutes BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS related_slugs text[] NOT NULL DEFAULT '{}';

-- Split Markdown at second-level headings at query time. No second copy of
-- article text can become stale after an answer is edited. All reads continue
-- in the caller's context, including section scoring and semantic fallback.
CREATE OR REPLACE FUNCTION public.search_help_articles(
  query_text text,
  query_embedding public.vector DEFAULT NULL,
  current_path text DEFAULT NULL,
  match_count integer DEFAULT 5
)
RETURNS TABLE(id uuid,slug text,question text,feature_area text,answer text,route text,score double precision)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH tokens AS (
    SELECT coalesce(pg_catalog.array_agg(term),'{}'::text[]) AS terms
    FROM (
      SELECT term
      FROM pg_catalog.unnest(pg_catalog.tsvector_to_array(
        pg_catalog.to_tsvector('english',pg_catalog.left(coalesce(query_text,''),2000))
      )) AS term
      -- Generic follow-up and interface words should not match every guide.
      WHERE term NOT IN ('fuzedflow','fuzed','flow','app','help','pleas','page','use','need','issu','problem','step')
      LIMIT 24
    ) meaningful
  ), query AS (
    SELECT terms,CASE WHEN pg_catalog.cardinality(terms)>0 THEN
      pg_catalog.to_tsquery('english',(
        SELECT pg_catalog.string_agg(pg_catalog.quote_literal(term),' | ')
        FROM pg_catalog.unnest(terms) AS term
      )) ELSE ''::pg_catalog.tsquery END AS q
    FROM tokens
  ), documents AS (
    SELECT f.*,q.terms,q.q,
      pg_catalog.replace(coalesce(nullif(f.answer_long,''),f.answer_short),E'\r\n',E'\n') AS body,
      pg_catalog.to_tsvector('english',f.question || ' ' || f.feature_area || ' ' || coalesce(pg_catalog.array_to_string(f.search_terms,' '),'')) AS title_vector,
      pg_catalog.to_tsvector('english',coalesce(nullif(f.answer_long,''),f.answer_short)) AS body_vector,
      CASE WHEN query_embedding IS NOT NULL AND f.embedding IS NOT NULL
        THEN (1-(f.embedding OPERATOR(public.<=>) query_embedding))::double precision ELSE 0 END AS semantic,
      CASE WHEN f.route IS NOT NULL AND pg_catalog.split_part(f.route,'?',1)=pg_catalog.split_part(current_path,'?',1)
        THEN 0.08 ELSE 0 END AS page_bonus
    FROM public.help_faqs f CROSS JOIN query q WHERE f.is_active
  ), coverage AS (
    SELECT d.*,
      (SELECT count(*)::double precision FROM pg_catalog.unnest(d.terms) term
        WHERE d.title_vector @@ pg_catalog.plainto_tsquery('english',term)) / greatest(pg_catalog.cardinality(d.terms),1) AS title_coverage,
      (SELECT count(*)::double precision FROM pg_catalog.unnest(d.terms) term
        WHERE d.body_vector @@ pg_catalog.plainto_tsquery('english',term)) / greatest(pg_catalog.cardinality(d.terms),1) AS body_coverage
    FROM documents d
  ), ranked AS (
    SELECT d.*,(
      d.title_coverage*1.8+d.body_coverage*1.2+
      pg_catalog.ts_rank_cd(d.body_vector,d.q,32)::double precision*0.4+
      greatest(d.semantic,0)*0.65+d.page_bonus+d.priority::double precision*0.0002
    ) AS relevance
    FROM coverage d
    WHERE d.title_coverage>0 OR d.body_coverage>0 OR d.semantic>=0.45
  ), selected AS (
    SELECT r.* FROM ranked r
    ORDER BY relevance DESC,priority DESC,slug
    LIMIT greatest(1,least(coalesce(match_count,5),8))
  )
  SELECT r.id,r.slug,r.question,r.feature_area,
    CASE WHEN r.article_type='guide' THEN pg_catalog.left(
      CASE WHEN r.body !~ '^##[[:space:]]' THEN pg_catalog.left(pg_catalog.split_part(r.body,E'\n## ',1),900) || E'\n\n' ELSE '' END ||
      coalesce((
        SELECT pg_catalog.string_agg(pg_catalog.left(section,2450),E'\n\n' ORDER BY section_score DESC,position)
        FROM (
          SELECT section,position,
            pg_catalog.ts_rank_cd(pg_catalog.to_tsvector('english',section),r.q,32) AS section_score
          FROM pg_catalog.regexp_split_to_table(r.body,E'\n(?=##[ \t]+)') WITH ORDINALITY AS sections(section,position)
          WHERE section ~ '^##[[:space:]]'
          ORDER BY section_score DESC,position
          LIMIT 2
        ) relevant_sections
      ),pg_catalog.left(r.body,5100)),6000)
    ELSE pg_catalog.left(r.body,6000) END,
    r.route,r.relevance
  FROM selected r ORDER BY r.relevance DESC,r.priority DESC,r.slug;
$$;
REVOKE ALL ON FUNCTION public.search_help_articles(text,public.vector,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_help_articles(text,public.vector,text,integer) TO authenticated,service_role;
