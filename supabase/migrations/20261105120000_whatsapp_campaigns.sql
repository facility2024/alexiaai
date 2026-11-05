CREATE TABLE IF NOT EXISTS public.whatsapp_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 3000),
  media_id text REFERENCES public.media_assets(id) ON DELETE SET NULL,
  delay_seconds integer NOT NULL DEFAULT 30 CHECK (delay_seconds BETWEEN 30 AND 600),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (id, owner_id)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^55[0-9]{10,11}$'),
  display_name text,
  consent_confirmed boolean NOT NULL DEFAULT false,
  consent_confirmed_at timestamptz,
  consent_confirmed_by uuid REFERENCES auth.users(id),
  consent_source text NOT NULL CHECK (consent_source IN ('manual', 'spreadsheet')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempted_at timestamptz,
  processing_at timestamptz,
  sent_at timestamptz,
  wapi_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, phone),
  FOREIGN KEY (campaign_id, owner_id)
    REFERENCES public.whatsapp_campaigns(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.whatsapp_campaign_optouts (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL CHECK (phone ~ '^55[0-9]{10,11}$'),
  source text NOT NULL DEFAULT 'whatsapp_keyword',
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, phone)
);

ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_campaign_optouts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_campaign_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_campaign_optouts TO authenticated;
GRANT ALL ON public.whatsapp_campaigns TO service_role;
GRANT ALL ON public.whatsapp_campaign_recipients TO service_role;
GRANT ALL ON public.whatsapp_campaign_optouts TO service_role;

DROP POLICY IF EXISTS "campaigns owner access" ON public.whatsapp_campaigns;
CREATE POLICY "campaigns owner access" ON public.whatsapp_campaigns
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "campaign recipients owner access" ON public.whatsapp_campaign_recipients;
CREATE POLICY "campaign recipients owner access" ON public.whatsapp_campaign_recipients
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "campaign optouts owner access" ON public.whatsapp_campaign_optouts;
CREATE POLICY "campaign optouts owner access" ON public.whatsapp_campaign_optouts
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS whatsapp_campaigns_owner_created_idx
  ON public.whatsapp_campaigns (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_campaign_recipients_queue_idx
  ON public.whatsapp_campaign_recipients (campaign_id, status, created_at);
CREATE INDEX IF NOT EXISTS whatsapp_campaign_recipients_attempt_idx
  ON public.whatsapp_campaign_recipients (owner_id, attempted_at DESC);

DROP INDEX IF EXISTS public.whatsapp_campaigns_one_running_per_owner;
CREATE UNIQUE INDEX whatsapp_campaigns_one_running_per_owner
  ON public.whatsapp_campaigns (owner_id)
  WHERE status = 'running';

CREATE OR REPLACE FUNCTION public.claim_whatsapp_campaign_recipient(
  _owner_id uuid,
  _campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  campaign_row public.whatsapp_campaigns%ROWTYPE;
  recipient_row public.whatsapp_campaign_recipients%ROWTYPE;
  last_attempt timestamptz;
  attempts_today integer;
  wait_milliseconds integer;
BEGIN
  SELECT * INTO campaign_row
  FROM public.whatsapp_campaigns
  WHERE id = _campaign_id AND owner_id = _owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF campaign_row.status <> 'running' THEN
    RETURN jsonb_build_object('status', campaign_row.status);
  END IF;

  UPDATE public.whatsapp_campaign_recipients
  SET status = 'failed',
      processing_at = NULL,
      error_message = 'Envio interrompido antes da confirmação; verifique antes de reenviar.',
      updated_at = now()
  WHERE campaign_id = _campaign_id
    AND status = 'sending'
    AND processing_at < now() - interval '5 minutes';

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_campaign_recipients
    WHERE campaign_id = _campaign_id AND status = 'sending'
  ) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;

  SELECT count(*) INTO attempts_today
  FROM public.whatsapp_campaign_recipients
  WHERE owner_id = _owner_id
    AND attempted_at >= now() - interval '24 hours';
  IF attempts_today >= 50 THEN
    UPDATE public.whatsapp_campaigns
    SET status = 'paused', updated_at = now()
    WHERE id = _campaign_id;
    RETURN jsonb_build_object('status', 'daily_limit');
  END IF;

  SELECT max(attempted_at) INTO last_attempt
  FROM public.whatsapp_campaign_recipients
  WHERE owner_id = _owner_id;
  IF last_attempt IS NOT NULL THEN
    wait_milliseconds := greatest(
      0,
      ceil(extract(epoch FROM (last_attempt + make_interval(secs => greatest(campaign_row.delay_seconds, 30)) - now())) * 1000)::integer
    );
    IF wait_milliseconds > 0 THEN
      RETURN jsonb_build_object('status', 'waiting', 'wait_ms', wait_milliseconds);
    END IF;
  END IF;

  UPDATE public.whatsapp_campaign_recipients r
  SET status = 'skipped',
      error_message = 'Contato solicitou não receber mensagens.',
      updated_at = now()
  WHERE r.campaign_id = _campaign_id
    AND r.status = 'queued'
    AND EXISTS (
      SELECT 1 FROM public.whatsapp_campaign_optouts o
      WHERE o.owner_id = _owner_id AND o.phone = r.phone
    );

  SELECT * INTO recipient_row
  FROM public.whatsapp_campaign_recipients
  WHERE campaign_id = _campaign_id
    AND status = 'queued'
    AND consent_confirmed
  ORDER BY created_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.whatsapp_campaigns
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = _campaign_id;
    RETURN jsonb_build_object('status', 'completed');
  END IF;

  UPDATE public.whatsapp_campaign_recipients
  SET status = 'sending', attempted_at = now(), processing_at = now(),
      error_message = NULL, updated_at = now()
  WHERE id = recipient_row.id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'recipient_id', recipient_row.id,
    'phone', recipient_row.phone,
    'display_name', recipient_row.display_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp_campaign_recipient(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_whatsapp_campaign_recipient(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp_campaign_recipient(uuid, uuid) TO service_role;

DROP TRIGGER IF EXISTS whatsapp_campaign_updated_at ON public.whatsapp_campaigns;
CREATE TRIGGER whatsapp_campaign_updated_at
  BEFORE UPDATE ON public.whatsapp_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS whatsapp_campaign_recipient_updated_at ON public.whatsapp_campaign_recipients;
CREATE TRIGGER whatsapp_campaign_recipient_updated_at
  BEFORE UPDATE ON public.whatsapp_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();