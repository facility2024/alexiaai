
ALTER TABLE public.payment_credentials DROP CONSTRAINT IF EXISTS payment_credentials_gateway_check;
ALTER TABLE public.payment_credentials ADD COLUMN IF NOT EXISTS display_name text;
