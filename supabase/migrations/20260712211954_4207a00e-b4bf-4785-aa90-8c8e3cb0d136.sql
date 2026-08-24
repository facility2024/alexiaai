
-- 1) Ratings recebidos por agente
CREATE TABLE public.crm_agent_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  chat_id text NOT NULL,
  agent_key text NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  raw_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_agent_ratings_owner_created_idx ON public.crm_agent_ratings (owner_id, created_at DESC);
CREATE INDEX crm_agent_ratings_owner_agent_idx ON public.crm_agent_ratings (owner_id, agent_key, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_agent_ratings TO authenticated;
GRANT ALL ON public.crm_agent_ratings TO service_role;

ALTER TABLE public.crm_agent_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own ratings"
  ON public.crm_agent_ratings FOR SELECT TO authenticated
  USING (owner_id = public.get_org_owner(auth.uid()));

CREATE POLICY "service manages ratings"
  ON public.crm_agent_ratings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2) Estado da pesquisa por chat (idempotência)
CREATE TABLE public.crm_chat_surveys (
  owner_id uuid NOT NULL,
  chat_id text NOT NULL,
  sent_at timestamptz,
  answered_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, chat_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_chat_surveys TO authenticated;
GRANT ALL ON public.crm_chat_surveys TO service_role;

ALTER TABLE public.crm_chat_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own surveys"
  ON public.crm_chat_surveys FOR SELECT TO authenticated
  USING (owner_id = public.get_org_owner(auth.uid()));

CREATE POLICY "service manages surveys"
  ON public.crm_chat_surveys FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_crm_chat_surveys_updated
  BEFORE UPDATE ON public.crm_chat_surveys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_agent_ratings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_chat_surveys;
