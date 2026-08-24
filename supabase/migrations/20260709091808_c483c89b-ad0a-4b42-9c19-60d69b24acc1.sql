CREATE TABLE public.sms_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  display_name TEXT,
  api_key TEXT NOT NULL,
  api_secret TEXT,
  sender_id TEXT,
  base_url TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_credentials TO authenticated;
GRANT ALL ON public.sms_credentials TO service_role;

ALTER TABLE public.sms_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own sms creds" ON public.sms_credentials
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_sms_credentials_updated_at
  BEFORE UPDATE ON public.sms_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();