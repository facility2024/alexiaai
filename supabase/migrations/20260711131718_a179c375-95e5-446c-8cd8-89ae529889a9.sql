ALTER TABLE public.knowledge_base
  ADD COLUMN IF NOT EXISTS agent_keys text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_knowledge_base_agent_keys
  ON public.knowledge_base USING GIN (agent_keys);