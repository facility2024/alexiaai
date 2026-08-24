
-- org_members
CREATE TABLE public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'agent',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_org_owner(_user_id UUID)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT owner_id FROM public.org_members WHERE member_id = _user_id AND active LIMIT 1),
    _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_owner UUID, _user UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT _owner = _user
    OR EXISTS (
      SELECT 1 FROM public.org_members
      WHERE owner_id = _owner AND member_id = _user AND active
    );
$$;

CREATE POLICY "org_members read" ON public.org_members
  FOR SELECT USING (owner_id = auth.uid() OR member_id = auth.uid());
CREATE POLICY "org_members owner writes" ON public.org_members
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_org_members_updated_at
  BEFORE UPDATE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- user_permissions
CREATE TABLE public.user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_view_all_chats BOOLEAN NOT NULL DEFAULT false,
  can_edit_kanban BOOLEAN NOT NULL DEFAULT true,
  can_manage_clients BOOLEAN NOT NULL DEFAULT true,
  can_manage_cases BOOLEAN NOT NULL DEFAULT true,
  can_send_billing BOOLEAN NOT NULL DEFAULT false,
  can_configure_ai BOOLEAN NOT NULL DEFAULT false,
  can_access_knowledge BOOLEAN NOT NULL DEFAULT true,
  can_manage_sectors BOOLEAN NOT NULL DEFAULT false,
  can_export BOOLEAN NOT NULL DEFAULT false,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perms owner all" ON public.user_permissions
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "perms user read" ON public.user_permissions
  FOR SELECT USING (user_id = auth.uid());

CREATE TRIGGER trg_user_permissions_updated_at
  BEFORE UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sectors
CREATE TABLE public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  icon TEXT,
  color TEXT DEFAULT '#8b5cf6',
  active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sectors TO authenticated;
GRANT ALL ON public.sectors TO service_role;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sectors org read" ON public.sectors
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "sectors owner write" ON public.sectors
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TRIGGER trg_sectors_updated_at
  BEFORE UPDATE ON public.sectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- sector_members
CREATE TABLE public.sector_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_lead BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sector_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sector_members TO authenticated;
GRANT ALL ON public.sector_members TO service_role;
ALTER TABLE public.sector_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sm org read" ON public.sector_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.sectors s
    WHERE s.id = sector_members.sector_id
      AND public.is_org_member(s.owner_id, auth.uid())
  ));
CREATE POLICY "sm owner write" ON public.sector_members
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.sectors s
    WHERE s.id = sector_members.sector_id AND s.owner_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.sectors s
    WHERE s.id = sector_members.sector_id AND s.owner_id = auth.uid()
  ));

-- invites
CREATE TABLE public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email TEXT,
  role public.app_role NOT NULL DEFAULT 'agent',
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  sector_ids UUID[] NOT NULL DEFAULT '{}',
  note TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites owner all" ON public.invites
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- chat_assignments
CREATE TABLE public.chat_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
  assigned_by TEXT NOT NULL DEFAULT 'ai',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, chat_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_assignments TO authenticated;
GRANT ALL ON public.chat_assignments TO service_role;
ALTER TABLE public.chat_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ca org read" ON public.chat_assignments
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "ca write" ON public.chat_assignments
  FOR ALL USING (
    owner_id = auth.uid()
    OR (public.is_org_member(owner_id, auth.uid()) AND assigned_to = auth.uid())
  ) WITH CHECK (
    owner_id = auth.uid()
    OR (public.is_org_member(owner_id, auth.uid()) AND assigned_to = auth.uid())
  );

CREATE TRIGGER trg_chat_assignments_updated_at
  BEFORE UPDATE ON public.chat_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- chat_transfer_log
CREATE TABLE public.chat_transfer_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  from_user UUID,
  to_user UUID,
  sector_id UUID,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_transfer_log TO authenticated;
GRANT ALL ON public.chat_transfer_log TO service_role;
ALTER TABLE public.chat_transfer_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctl org read" ON public.chat_transfer_log
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "ctl insert" ON public.chat_transfer_log
  FOR INSERT WITH CHECK (public.is_org_member(owner_id, auth.uid()));

-- ai_global_state
CREATE TABLE public.ai_global_state (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_global_state TO authenticated;
GRANT ALL ON public.ai_global_state TO service_role;
ALTER TABLE public.ai_global_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ags org read" ON public.ai_global_state
  FOR SELECT USING (public.is_org_member(owner_id, auth.uid()));
CREATE POLICY "ags owner write" ON public.ai_global_state
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Extra SELECT policy em crm_messages para membros e responsáveis
CREATE POLICY "crm_messages team visibility" ON public.crm_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_permissions p
      WHERE p.owner_id = crm_messages.user_id
        AND p.user_id = auth.uid()
        AND p.can_view_all_chats
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_assignments ca
      WHERE ca.owner_id = crm_messages.user_id
        AND ca.chat_id = crm_messages.chat_id
        AND ca.assigned_to = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_chat_assignments_lookup
  ON public.chat_assignments (owner_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_assignments_user
  ON public.chat_assignments (assigned_to);
CREATE INDEX IF NOT EXISTS idx_org_members_member
  ON public.org_members (member_id);
