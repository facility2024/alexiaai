DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wapi-media-retry') THEN
    PERFORM cron.unschedule('wapi-media-retry');
  END IF;
END $$;

SELECT cron.schedule(
  'wapi-media-retry',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--2c01e5d5-35c1-4241-97c9-c9550f30905b.lovable.app/api/public/wapi-media-retry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);