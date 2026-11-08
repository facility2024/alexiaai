-- Agendamento de campanhas WhatsApp: coluna scheduled_at, status 'scheduled'
-- e job pg_cron (1 min) que ativa vencidas e dirige os envios no servidor.

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

ALTER TABLE public.whatsapp_campaigns
  DROP CONSTRAINT IF EXISTS whatsapp_campaigns_status_check;
ALTER TABLE public.whatsapp_campaigns
  ADD CONSTRAINT whatsapp_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'));

CREATE INDEX IF NOT EXISTS whatsapp_campaigns_due_idx
  ON public.whatsapp_campaigns (scheduled_at)
  WHERE status = 'scheduled';

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-campaign-cron') THEN
    PERFORM cron.unschedule('whatsapp-campaign-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'whatsapp-campaign-cron',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://crmlexia.com.br/api/public/whatsapp-campaign-cron',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
