
-- =========================================================
-- Kanban Inteligente
-- =========================================================

-- 1) COLUNAS
CREATE TABLE public.kanban_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#8b5cf6',
  icon text NOT NULL DEFAULT 'Circle',
  rule_prompt text,
  auto_action text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_columns TO authenticated;
GRANT ALL ON public.kanban_columns TO service_role;
ALTER TABLE public.kanban_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_columns" ON public.kanban_columns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kanban_columns_user ON public.kanban_columns(user_id, position);

-- 2) TAGS
CREATE TABLE public.kanban_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_tags TO authenticated;
GRANT ALL ON public.kanban_tags TO service_role;
ALTER TABLE public.kanban_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_tags" ON public.kanban_tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) CARDS (1 por chat)
CREATE TABLE public.kanban_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES public.kanban_columns(id) ON DELETE RESTRICT,
  chat_id text NOT NULL,
  contact_name text,
  contact_phone text,
  tag_ids uuid[] NOT NULL DEFAULT '{}',
  assignee text,
  estimated_value numeric(12,2),
  summary text,
  position integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  ai_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_cards TO authenticated;
GRANT ALL ON public.kanban_cards TO service_role;
ALTER TABLE public.kanban_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_cards" ON public.kanban_cards
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kanban_cards_col ON public.kanban_cards(user_id, column_id, position);

-- 4) EVENTOS / HISTÓRICO
CREATE TABLE public.kanban_card_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES public.kanban_cards(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- moved | tag_added | tag_removed | ai_decision | note | auto_action
  from_column_id uuid,
  to_column_id uuid,
  actor text NOT NULL DEFAULT 'user', -- user | ai | system
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_card_events TO authenticated;
GRANT ALL ON public.kanban_card_events TO service_role;
ALTER TABLE public.kanban_card_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_card_events" ON public.kanban_card_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_kanban_events_card ON public.kanban_card_events(card_id, created_at DESC);

-- 5) CHECKLIST DE DOCUMENTOS
CREATE TABLE public.kanban_doc_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_type text NOT NULL DEFAULT 'geral',
  document_name text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kanban_doc_checklist TO authenticated;
GRANT ALL ON public.kanban_doc_checklist TO service_role;
ALTER TABLE public.kanban_doc_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own kanban_doc_checklist" ON public.kanban_doc_checklist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6) TRIGGERS updated_at
CREATE TRIGGER trg_kanban_columns_updated BEFORE UPDATE ON public.kanban_columns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_kanban_cards_updated BEFORE UPDATE ON public.kanban_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) SEED de colunas padrão para novos usuários (e existentes)
CREATE OR REPLACE FUNCTION public.seed_kanban_defaults(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kanban_columns WHERE user_id = _user_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.kanban_columns (user_id, name, position, color, icon, rule_prompt, auto_action, is_default) VALUES
    (_user_id, 'Primeiro Atendimento', 0, '#a78bfa', 'Inbox',        'Novo lead que acabou de chamar; ainda não demonstrou interesse claro.', NULL, true),
    (_user_id, 'Interesse',            1, '#8b5cf6', 'Sparkles',     'Cliente demonstrou interesse no serviço, fez perguntas ou pediu detalhes.', NULL, true),
    (_user_id, 'Call/Meet',            2, '#7c3aed', 'Video',        'Cliente aceitou marcar uma reunião ou call.', 'schedule_meeting', true),
    (_user_id, 'Falar c/ Especialista',3, '#6d28d9', 'UserCheck',    'Reunião pré-agendada; especialista humano deve assumir.', 'assign_specialist', true),
    (_user_id, 'Envio de Documentos', 4, '#5b21b6', 'FileUp',       'Especialista fechou o atendimento humanizado; solicitar documentos ao cliente.', 'request_documents', true),
    (_user_id, 'Análise IA',           5, '#4c1d95', 'ScanSearch',   'Documentos recebidos; agente analisa se atende o checklist.', 'analyze_document', true),
    (_user_id, 'Contrato',             6, '#8b5cf6', 'FileSignature','Documentos ok; jurídico finaliza contrato pelo WhatsApp.', NULL, true),
    (_user_id, 'Fechado',              7, '#22c55e', 'CheckCircle2', 'Cliente assinado e onboardado.', NULL, true);

  INSERT INTO public.kanban_tags (user_id, name, color) VALUES
    (_user_id, 'urgente',      '#ef4444'),
    (_user_id, 'VIP',          '#f59e0b'),
    (_user_id, 'trabalhista',  '#8b5cf6'),
    (_user_id, 'cível',        '#3b82f6'),
    (_user_id, 'família',      '#ec4899')
  ON CONFLICT (user_id, name) DO NOTHING;
END;
$$;

-- Seed para todos os usuários existentes
DO $$
DECLARE u record;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    PERFORM public.seed_kanban_defaults(u.id);
  END LOOP;
END $$;

-- Estender handle_new_user para semear kanban ao criar conta
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
  RETURN NEW;
END;
$$;
