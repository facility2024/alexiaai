CREATE TABLE public.crm_chat_reads (
  user_id uuid NOT NULL,
  chat_id text NOT NULL,
  owner_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chat_id)
);

CREATE INDEX idx_crm_chat_reads_owner_chat ON public.crm_chat_reads (owner_id, chat_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_chat_reads TO authenticated;
GRANT ALL ON public.crm_chat_reads TO service_role;

ALTER TABLE public.crm_chat_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own read markers"
ON public.crm_chat_reads
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE TRIGGER update_crm_chat_reads_updated_at
BEFORE UPDATE ON public.crm_chat_reads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();