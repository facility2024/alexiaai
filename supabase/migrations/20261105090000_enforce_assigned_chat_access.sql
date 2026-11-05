DROP POLICY IF EXISTS "ca org read" ON public.chat_assignments;
DROP POLICY IF EXISTS "ca write" ON public.chat_assignments;
DROP POLICY IF EXISTS "ca owner write" ON public.chat_assignments;

CREATE POLICY "ca org read" ON public.chat_assignments
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (
      public.is_org_member(owner_id, auth.uid())
      AND (
        assigned_to = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_permissions p
          WHERE p.owner_id = chat_assignments.owner_id
            AND p.user_id = auth.uid()
            AND p.can_view_all_chats
        )
      )
    )
  );

CREATE POLICY "ca owner write" ON public.chat_assignments
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "crm_messages team visibility" ON public.crm_messages;

CREATE POLICY "crm_messages team visibility" ON public.crm_messages
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(user_id, auth.uid())
    AND (
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
    )
  );