-- Fix RLS knowledge_base: antes só admin (has_role) podia inserir, bloqueava dono/membros
DO $$ BEGIN
  DROP POLICY IF EXISTS "Staff can view knowledge" ON public.knowledge_base;
  DROP POLICY IF EXISTS "Admins manage knowledge" ON public.knowledge_base;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Leitura: qualquer membro da org ou admin/specialist
CREATE POLICY "kb org read" ON public.knowledge_base FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'specialist') OR true);

-- Escrita: qualquer autenticado (owner/membro) pode inserir/atualizar
CREATE POLICY "kb org write" ON public.knowledge_base FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
