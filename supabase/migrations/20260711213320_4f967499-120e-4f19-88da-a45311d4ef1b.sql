
DO $$
DECLARE
  sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = 'wapi_webhook_secret' LIMIT 1;
  IF sid IS NULL THEN
    PERFORM vault.create_secret('S6h9kJk0cIy7QHDh1jTshvcjNpGjdQuSa', 'wapi_webhook_secret', 'WAPI webhook secret for internal cron auth');
  ELSE
    PERFORM vault.update_secret(sid, 'S6h9kJk0cIy7QHDh1jTshvcjNpGjdQuSa');
  END IF;
END $$;
