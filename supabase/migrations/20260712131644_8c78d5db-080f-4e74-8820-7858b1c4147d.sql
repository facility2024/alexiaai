
-- 1) Campos extras em clients (aditivo, sem tocar nos existentes)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2) Tabela de follow-ups por SMS
CREATE TABLE IF NOT EXISTS public.client_sms_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text,
  message text NOT NULL,
  phone text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error text,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_sms_followups_status_chk
    CHECK (status IN ('pending','sent','failed','canceled'))
);

CREATE INDEX IF NOT EXISTS client_sms_followups_client_idx
  ON public.client_sms_followups(client_id);
CREATE INDEX IF NOT EXISTS client_sms_followups_due_idx
  ON public.client_sms_followups(status, scheduled_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_sms_followups TO authenticated;
GRANT ALL ON public.client_sms_followups TO service_role;

ALTER TABLE public.client_sms_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own followups"
  ON public.client_sms_followups FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own followups"
  ON public.client_sms_followups FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own followups"
  ON public.client_sms_followups FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own followups"
  ON public.client_sms_followups FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger updated_at (reutiliza função existente do projeto)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$ LANGUAGE plpgsql SET search_path = public;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_client_sms_followups_updated ON public.client_sms_followups;
CREATE TRIGGER trg_client_sms_followups_updated
  BEFORE UPDATE ON public.client_sms_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
