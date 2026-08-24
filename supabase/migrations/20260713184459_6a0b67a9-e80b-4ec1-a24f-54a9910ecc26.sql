
-- ============ contract_templates ============
CREATE TABLE public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  created_by uuid,
  name text NOT NULL,
  description text,
  body_html text NOT NULL DEFAULT '',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_templates TO authenticated;
GRANT ALL ON public.contract_templates TO service_role;

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read templates"
ON public.contract_templates FOR SELECT TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "org members can insert templates"
ON public.contract_templates FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND owner_id = public.get_org_owner(auth.uid()));

CREATE POLICY "org members can update templates"
ON public.contract_templates FOR UPDATE TO authenticated
USING (public.is_org_member(owner_id, auth.uid()))
WITH CHECK (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "owner can delete templates"
ON public.contract_templates FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE TRIGGER trg_contract_templates_updated_at
BEFORE UPDATE ON public.contract_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ contract_reminders ============
CREATE TABLE public.contract_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  channel text NOT NULL DEFAULT 'whatsapp',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, level)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_reminders TO authenticated;
GRANT ALL ON public.contract_reminders TO service_role;

ALTER TABLE public.contract_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read reminders"
ON public.contract_reminders FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.contracts c
  WHERE c.id = contract_id AND public.is_org_member(c.owner_id, auth.uid())
));

CREATE POLICY "service role manages reminders"
ON public.contract_reminders FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============ contracts: colunas novas ============
CREATE SEQUENCE IF NOT EXISTS public.contract_code_seq;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responsible_agent_id uuid,
  ADD COLUMN IF NOT EXISTS values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS integrity_score integer,
  ADD COLUMN IF NOT EXISTS integrity_report jsonb;

CREATE OR REPLACE FUNCTION public.assign_contract_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.contract_code IS NULL OR NEW.contract_code = '' THEN
    NEW.contract_code := 'CTR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.contract_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_assign_code ON public.contracts;
CREATE TRIGGER trg_contracts_assign_code
BEFORE INSERT ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.assign_contract_code();

-- ============ contract_events: dedupe_key ============
ALTER TABLE public.contract_events
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS contract_events_dedupe_key_uidx
  ON public.contract_events(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ============ permissão nova ============
ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS can_manage_contracts boolean NOT NULL DEFAULT false;
