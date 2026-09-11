-- Busca trechos de treinamento por relevância de texto (sem embeddings).
-- Retorna os chunks mais relevantes para uma query, usando ts_rank com fuzzy matching.
CREATE OR REPLACE FUNCTION public.search_training_chunks(
  _user_id UUID,
  _query TEXT,
  _match_count INT DEFAULT 10
)
RETURNS TABLE (id UUID, document_id UUID, content TEXT, rank FLOAT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH terms AS (
    SELECT regexp_replace(lower(unnest(regexp_split_to_array(_query, '\s+'))), '[^a-z0-9à-ú]', '', 'g') AS term
  ),
  scored AS (
    SELECT kc.id, kc.document_id, kc.content,
           sum(
             CASE WHEN lower(kc.content) ILIKE '%' || t.term || '%' THEN 1.0 ELSE 0.0 END
           ) AS score
    FROM public.knowledge_chunks kc, terms t
    WHERE kc.user_id = _user_id
      AND t.term <> ''
      AND length(t.term) > 2
    GROUP BY kc.id, kc.document_id, kc.content
  )
  SELECT s.id, s.document_id, s.content, s.score AS rank
  FROM scored s
  WHERE s.score > 0
  ORDER BY s.score DESC
  LIMIT _match_count;
$$;
