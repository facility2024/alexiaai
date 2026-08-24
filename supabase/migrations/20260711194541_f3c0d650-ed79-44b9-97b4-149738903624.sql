
-- Media processing state on crm_messages
ALTER TABLE public.crm_messages
  ADD COLUMN IF NOT EXISTS media_status text,
  ADD COLUMN IF NOT EXISTS media_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS media_last_error text;

-- Idempotency: same wapi_message_id per user/direction = same row.
-- Allows upsert so a slow first attempt can be completed by a retry.
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_wapi_unique
  ON public.crm_messages (user_id, direction, wapi_message_id)
  WHERE wapi_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_messages_media_pending_idx
  ON public.crm_messages (media_next_retry_at)
  WHERE media_status IN ('pending','processing','failed_retry');

-- Cron: retry pending media every minute
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry') THEN
    PERFORM cron.unschedule('wapi-media-retry');
  END IF;
END $$;

SELECT cron.schedule(
  'wapi-media-retry',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--2c01e5d5-35c1-4241-97c9-c9550f30905b.lovable.app/api/public/wapi-media-retry',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'WAPI_WEBHOOK_SECRET' LIMIT 1))
  );
  $$
);
