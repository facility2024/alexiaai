
-- 1) Promote unique index to unique constraint so PostgREST upsert onConflict works.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crm_messages_wapi_unique'
  ) THEN
    ALTER TABLE public.crm_messages
      ADD CONSTRAINT crm_messages_wapi_unique
      UNIQUE USING INDEX crm_messages_wapi_unique;
  END IF;
END $$;

-- 2) Reagenda cron do retry passando o WAPI_WEBHOOK_SECRET via query string.
--    Guarda o segredo no vault para não expor no cron.command.
DO $$
DECLARE
  wapi_secret text;
BEGIN
  SELECT decrypted_secret INTO wapi_secret
  FROM vault.decrypted_secrets
  WHERE name = 'wapi_webhook_secret'
  LIMIT 1;

  IF wapi_secret IS NULL THEN
    -- Placeholder: precisa ser preenchido pelo operador via vault.
    PERFORM vault.create_secret('REPLACE_ME', 'wapi_webhook_secret', 'Segredo do webhook W-API para chamadas internas do cron.');
  END IF;
END $$;

SELECT cron.unschedule('wapi-media-retry')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry');

SELECT cron.schedule(
  'wapi-media-retry',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--2c01e5d5-35c1-4241-97c9-c9550f30905b.lovable.app/api/public/wapi-media-retry?secret=' ||
           (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'wapi_webhook_secret' LIMIT 1),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $cron$
);
