-- 1) Extend kanban_cards with legal intelligence fields
ALTER TABLE public.kanban_cards
  ADD COLUMN IF NOT EXISTS legal_area text,
  ADD COLUMN IF NOT EXISTS urgency text CHECK (urgency IN ('baixa','media','alta','urgente')),
  ADD COLUMN IF NOT EXISTS viability_score integer CHECK (viability_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS estimated_ticket numeric(12,2),
  ADD COLUMN IF NOT EXISTS case_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS case_timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_ai_analysis_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_client_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_kanban_cards_urgency ON public.kanban_cards(user_id, urgency);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_last_msg ON public.kanban_cards(user_id, last_client_message_at);

-- 2) Legal area checklist templates (per user, per area)
CREATE TABLE IF NOT EXISTS public.legal_area_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  area text NOT NULL,
  document_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, area, document_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_area_templates TO authenticated;
GRANT ALL ON public.legal_area_templates TO service_role;
ALTER TABLE public.legal_area_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own legal_area_templates" ON public.legal_area_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) Per-card checklist status (documents received per lead)
CREATE TABLE IF NOT EXISTS public.kanban_card_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.kanban_cards(id) ON DELETE CASCADE,
  document_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  received boolean NOT NULL DEFAULT false,
  received_at timestamptz,
  notes text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(card_id, document_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_card_documents TO authenticated;
GRANT ALL ON public.kanban_card_documents TO service_role;
ALTER TABLE public.kanban_card_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_card_documents" ON public.kanban_card_documents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_kanban_card_documents_updated
  BEFORE UPDATE ON public.kanban_card_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_kanban_card_documents_card ON public.kanban_card_documents(card_id);

-- 4) Seed defaults for legal area templates
CREATE OR REPLACE FUNCTION public.seed_legal_area_templates(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.legal_area_templates WHERE user_id = _user_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.legal_area_templates (user_id, area, document_name, required, position) VALUES
    -- Trabalhista
    (_user_id,'trabalhista','RG e CPF', true, 0),
    (_user_id,'trabalhista','Comprovante de residência', true, 1),
    (_user_id,'trabalhista','CTPS (carteira de trabalho)', true, 2),
    (_user_id,'trabalhista','Últimos 6 holerites', true, 3),
    (_user_id,'trabalhista','Contrato de trabalho', false, 4),
    (_user_id,'trabalhista','Aviso prévio / rescisão', false, 5),
    (_user_id,'trabalhista','Extrato do FGTS', false, 6),
    -- Cível
    (_user_id,'cível','RG e CPF', true, 0),
    (_user_id,'cível','Comprovante de residência', true, 1),
    (_user_id,'cível','Contrato objeto da ação', true, 2),
    (_user_id,'cível','Comprovantes de pagamento', false, 3),
    (_user_id,'cível','Provas (fotos, e-mails, prints)', false, 4),
    -- Família
    (_user_id,'família','RG e CPF', true, 0),
    (_user_id,'família','Certidão de casamento / união estável', true, 1),
    (_user_id,'família','Certidões dos filhos', false, 2),
    (_user_id,'família','Comprovantes de renda', true, 3),
    (_user_id,'família','Comprovantes de bens', false, 4),
    -- Previdenciário
    (_user_id,'previdenciário','RG e CPF', true, 0),
    (_user_id,'previdenciário','CNIS (extrato INSS)', true, 1),
    (_user_id,'previdenciário','CTPS', true, 2),
    (_user_id,'previdenciário','Carnês de contribuição', false, 3),
    (_user_id,'previdenciário','Laudos médicos', false, 4),
    -- Criminal
    (_user_id,'criminal','RG e CPF', true, 0),
    (_user_id,'criminal','Boletim de ocorrência', true, 1),
    (_user_id,'criminal','Cópia do processo / inquérito', false, 2),
    -- Consumidor
    (_user_id,'consumidor','RG e CPF', true, 0),
    (_user_id,'consumidor','Nota fiscal / contrato', true, 1),
    (_user_id,'consumidor','Protocolos de reclamação', true, 2),
    (_user_id,'consumidor','Prints / e-mails', false, 3),
    -- Tributário
    (_user_id,'tributário','CNPJ / contrato social', true, 0),
    (_user_id,'tributário','Auto de infração / CDA', true, 1),
    (_user_id,'tributário','Guias e comprovantes', false, 2),
    -- Empresarial
    (_user_id,'empresarial','Contrato social', true, 0),
    (_user_id,'empresarial','Faturamento dos últimos 12 meses', false, 1),
    (_user_id,'empresarial','Contratos objeto da questão', true, 2)
  ON CONFLICT (user_id, area, document_name) DO NOTHING;
END;
$$;

-- 5) Update handle_new_user to also seed legal area templates
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  PERFORM public.seed_kanban_defaults(NEW.id);
  PERFORM public.seed_legal_area_templates(NEW.id);
  RETURN NEW;
END;
$$;

-- 6) Backfill: seed templates for existing users who don't have any
DO $$
DECLARE u record;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    PERFORM public.seed_legal_area_templates(u.id);
  END LOOP;
END $$;
