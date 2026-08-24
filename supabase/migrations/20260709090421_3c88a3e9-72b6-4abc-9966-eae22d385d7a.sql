
CREATE TABLE public.payment_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway text NOT NULL CHECK (gateway IN ('asaas','mercadopago','stripe')),
  api_key text,
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox')),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gateway)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_credentials TO authenticated;
GRANT ALL ON public.payment_credentials TO service_role;
ALTER TABLE public.payment_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own creds" ON public.payment_credentials FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER payment_credentials_updated_at BEFORE UPDATE ON public.payment_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
