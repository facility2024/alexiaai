-- Fix multi-tenant leak: clients era global (RLS USING true)
-- Adiciona owner_id e corrige RLS para escopar por organização

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_owner_id ON public.clients(owner_id);

-- Backfill: atribui dono aos registros legados (primeiro usuário = master)
UPDATE public.clients SET owner_id = public.get_master_owner() WHERE owner_id IS NULL;

-- Recria RLS: remove políticas permissivas USING (true) e cria escopadas por org
DO $$ BEGIN
  DROP POLICY IF EXISTS "Authenticated can view clients" ON public.clients;
  DROP POLICY IF EXISTS "Authenticated can insert clients" ON public.clients;
  DROP POLICY IF EXISTS "Authenticated can update clients" ON public.clients;
  DROP POLICY IF EXISTS "Staff can delete clients" ON public.clients;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Leitura: dono ou membro da org do dono, ou legado sem owner (transição)
CREATE POLICY "clients org read" ON public.clients FOR SELECT TO authenticated
  USING (
    owner_id IS NULL
    OR owner_id = auth.uid()
    OR public.is_org_member(owner_id, auth.uid())
  );

-- Insert: só com owner_id da própria org
CREATE POLICY "clients org insert" ON public.clients FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid())
  );

-- Update: dono ou membro
CREATE POLICY "clients org update" ON public.clients FOR UPDATE TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid() OR public.is_org_member(owner_id, auth.uid()))
  WITH CHECK (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid()) OR owner_id IS NULL);

-- Delete: só dono
CREATE POLICY "clients owner delete" ON public.clients FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_org_member(owner_id, auth.uid()));

-- Opcional: garante que novos inserts via client-extract.server usem owner_id correto
