
-- ============ Performance indexes ============
CREATE INDEX IF NOT EXISTS idx_kanban_cards_user_column_pos
  ON public.kanban_cards(user_id, column_id, position);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_user_chat
  ON public.kanban_cards(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_crm_messages_user_chat_created
  ON public.crm_messages(user_id, chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_user_created
  ON public.crm_messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_events_user_card_created
  ON public.kanban_card_events(user_id, card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_user_pos
  ON public.kanban_columns(user_id, position);

-- ============ Import events (webhook log) ============
CREATE TABLE IF NOT EXISTS public.import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_events TO authenticated;
GRANT ALL ON public.import_events TO service_role;
ALTER TABLE public.import_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own import events" ON public.import_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_import_events_user_created
  ON public.import_events(user_id, created_at DESC);

-- ============ Billings (cobranças multi-gateway) ============
CREATE TABLE IF NOT EXISTS public.billings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  gateway TEXT NOT NULL CHECK (gateway IN ('asaas','mercadopago','stripe','manual')),
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  billing_type TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  description TEXT,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  invoice_url TEXT,
  pix_code TEXT,
  bank_slip_url TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (gateway, external_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billings TO authenticated;
GRANT ALL ON public.billings TO service_role;
ALTER TABLE public.billings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own billings" ON public.billings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_billings_user_created
  ON public.billings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billings_user_card
  ON public.billings(user_id, card_id);
CREATE TRIGGER update_billings_updated_at
  BEFORE UPDATE ON public.billings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Payment webhook events log ============
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL,
  event_type TEXT,
  external_id TEXT,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.payment_webhook_events TO service_role;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
-- no user policies — only service_role writes/reads
CREATE INDEX IF NOT EXISTS idx_pwe_gateway_received
  ON public.payment_webhook_events(gateway, received_at DESC);
