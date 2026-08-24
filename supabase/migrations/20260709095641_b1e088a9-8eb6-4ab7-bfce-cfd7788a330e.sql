
CREATE TABLE public.chat_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  created_by uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#22c55e',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_labels TO authenticated;
GRANT ALL ON public.chat_labels TO service_role;

ALTER TABLE public.chat_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view labels"
  ON public.chat_labels FOR SELECT TO authenticated
  USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can create labels"
  ON public.chat_labels FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Owner or creator can update labels"
  ON public.chat_labels FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid());

CREATE POLICY "Owner or creator can delete labels"
  ON public.chat_labels FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR created_by = auth.uid());


CREATE TABLE public.chat_label_assignments (
  owner_id uuid NOT NULL,
  chat_id text NOT NULL,
  label_id uuid NOT NULL REFERENCES public.chat_labels(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, label_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_label_assignments TO authenticated;
GRANT ALL ON public.chat_label_assignments TO service_role;

ALTER TABLE public.chat_label_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view assignments"
  ON public.chat_label_assignments FOR SELECT TO authenticated
  USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can create assignments"
  ON public.chat_label_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND assigned_by = auth.uid());

CREATE POLICY "Org members can delete assignments"
  ON public.chat_label_assignments FOR DELETE TO authenticated
  USING (public.is_org_member(owner_id, auth.uid()));

CREATE INDEX chat_label_assignments_chat_idx ON public.chat_label_assignments(chat_id);
CREATE INDEX chat_label_assignments_owner_idx ON public.chat_label_assignments(owner_id);
