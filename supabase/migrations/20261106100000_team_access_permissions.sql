-- Equipe & Permissões — 7 módulos padrão de acesso inicial da equipe +
-- chaves extras de módulo em user_permissions.extra.
--
-- apply_invite_membership passa a gravar:
--   * can_manage_contracts (default true = "Gestão de contratos" é módulo inicial);
--   * as chaves extras (can_access_agenda / can_access_whatsapp / can_access_guide)
--     em user_permissions.extra, mesclando com o que já existir na linha.
--
-- O trigger handle_new_user (versão vigente) delega as duas rotas de convite
-- (invite_access_requests e invites diretos) para esta função, então este
-- CREATE OR REPLACE cobre o cadastro de membros por convite inteiro.
--
-- Aplicar manualmente no SQL Editor do Supabase (padrão deste projeto).

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

-- Realtime: a tela do app acompanha alterações de permissão via canal
-- postgres_changes em user_permissions — a tabela precisa estar na publicação.
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

-- Backfill: a coluna can_manage_contracts entrou em 2026-07-13 com DEFAULT
-- false e nunca teve toggle no painel — todos os membros existentes sempre
-- abriram /contratos. Alinha-os ao módulo inicial dos novos convites.
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
