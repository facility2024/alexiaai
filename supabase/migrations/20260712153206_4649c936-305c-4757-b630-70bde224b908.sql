
-- 1) Novas colunas em clients (todas opcionais, zero impacto no existente)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS zip text,
  ADD COLUMN IF NOT EXISTS interest_level text,
  ADD COLUMN IF NOT EXISTS is_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS followup_queued_at timestamptz;

-- 2) Templates SMS de follow-up
CREATE TABLE IF NOT EXISTS public.sms_followup_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  message text NOT NULL,
  send_hour smallint NOT NULL DEFAULT 10 CHECK (send_hour BETWEEN 0 AND 23),
  send_minute smallint NOT NULL DEFAULT 0 CHECK (send_minute BETWEEN 0 AND 59),
  days_after_inactivity smallint NOT NULL DEFAULT 1 CHECK (days_after_inactivity BETWEEN 0 AND 30),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_followup_templates TO authenticated;
GRANT ALL ON public.sms_followup_templates TO service_role;

ALTER TABLE public.sms_followup_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sms templates"
  ON public.sms_followup_templates
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_sms_followup_templates_user_active
  ON public.sms_followup_templates(user_id, active);

CREATE INDEX IF NOT EXISTS idx_clients_followup_queue
  ON public.clients(followup_status, followup_queued_at)
  WHERE followup_status = 'queued';

-- Trigger updated_at (reutiliza função pública se existir; caso contrário cria)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sms_followup_templates_updated_at ON public.sms_followup_templates;
CREATE TRIGGER trg_sms_followup_templates_updated_at
  BEFORE UPDATE ON public.sms_followup_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
