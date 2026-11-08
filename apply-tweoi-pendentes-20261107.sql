-- ============================================================================
-- Apply manual no SQL Editor do projeto tweoiunfpawwwyzezlax (07/11/2026)
-- Consolida 2 migrations ainda não aplicadas:
--   1) 20261105120000_whatsapp_campaigns.sql
--   2) 20261106100000_team_access_permissions.sql
-- Idempotente: pode ser colado mais de uma vez (CREATE IF NOT EXISTS / OR REPLACE).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) WhatsApp Campaigns
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- 2) Team access permissions (apply_invite_membership + realtime + backfill)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_invite_membership(
  _owner_id uuid,
  _member_id uuid,
  _role public.app_role DEFAULT 'agent'::public.app_role,
  _permissions jsonb DEFAULT '{}'::jsonb,
  _sector_ids uuid[] DEFAULT '{}',
  _active boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _owner_id IS NULL OR _member_id IS NULL OR _owner_id = _member_id THEN
    RETURN;
  END IF;

  INSERT INTO public.org_members (owner_id, member_id, role, active)
  VALUES (_owner_id, _member_id, COALESCE(_role, 'agent'::public.app_role), COALESCE(_active, false))
  ON CONFLICT (owner_id, member_id) DO UPDATE SET
    role = EXCLUDED.role,
    active = EXCLUDED.active,
    updated_at = now();

  INSERT INTO public.user_permissions (
    owner_id,
    user_id,
    can_view_all_chats,
    can_edit_kanban,
    can_manage_clients,
    can_manage_cases,
    can_send_billing,
    can_configure_ai,
    can_access_knowledge,
    can_manage_sectors,
    can_export,
    can_manage_contracts,
    extra
  ) VALUES (
    _owner_id,
    _member_id,
    COALESCE((_permissions->>'can_view_all_chats')::boolean, false),
    COALESCE((_permissions->>'can_edit_kanban')::boolean, true),
    COALESCE((_permissions->>'can_manage_clients')::boolean, true),
    COALESCE((_permissions->>'can_manage_cases')::boolean, true),
    COALESCE((_permissions->>'can_send_billing')::boolean, false),
    COALESCE((_permissions->>'can_configure_ai')::boolean, false),
    COALESCE((_permissions->>'can_access_knowledge')::boolean, true),
    COALESCE((_permissions->>'can_manage_sectors')::boolean, false),
    COALESCE((_permissions->>'can_export')::boolean, false),
    COALESCE((_permissions->>'can_manage_contracts')::boolean, true),
    jsonb_strip_nulls(jsonb_build_object(
      'can_access_agenda', _permissions->'can_access_agenda',
      'can_access_whatsapp', _permissions->'can_access_whatsapp',
      'can_access_guide', _permissions->'can_access_guide'
    ))
  )
  ON CONFLICT (owner_id, user_id) DO UPDATE SET
    can_view_all_chats = EXCLUDED.can_view_all_chats,
    can_edit_kanban = EXCLUDED.can_edit_kanban,
    can_manage_clients = EXCLUDED.can_manage_clients,
    can_manage_cases = EXCLUDED.can_manage_cases,
    can_send_billing = EXCLUDED.can_send_billing,
    can_configure_ai = EXCLUDED.can_configure_ai,
    can_access_knowledge = EXCLUDED.can_access_knowledge,
    can_manage_sectors = EXCLUDED.can_manage_sectors,
    can_export = EXCLUDED.can_export,
    can_manage_contracts = EXCLUDED.can_manage_contracts,
    extra = public.user_permissions.extra || EXCLUDED.extra,
    updated_at = now();

  IF _sector_ids IS NOT NULL AND array_length(_sector_ids, 1) IS NOT NULL THEN
    INSERT INTO public.sector_members (sector_id, user_id, is_lead)
    SELECT unnest(_sector_ids), _member_id, false
    ON CONFLICT (sector_id, user_id) DO NOTHING;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_member_id, COALESCE(_role, 'agent'::public.app_role))
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_invite_membership(uuid, uuid, public.app_role, jsonb, uuid[], boolean) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_permissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_permissions;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_permissions'
      AND column_name = 'can_manage_contracts'
  ) THEN
    UPDATE public.user_permissions
    SET can_manage_contracts = true, updated_at = now()
    WHERE can_manage_contracts = false;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Fim — esperado: "Success. No rows returned" (ou DO blocks sem erro)
-- ----------------------------------------------------------------------------
