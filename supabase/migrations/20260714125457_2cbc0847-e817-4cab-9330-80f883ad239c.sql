CREATE TABLE public.eduardo_contract_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  card_id uuid REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  draft_sent_at timestamptz,
  draft_message text,
  approved_at timestamptz,
  handed_off_at timestamptz,
  handoff_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eduardo_reviews_contract ON public.eduardo_contract_reviews(contract_id);
CREATE INDEX idx_eduardo_reviews_owner ON public.eduardo_contract_reviews(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.eduardo_contract_reviews TO authenticated;
GRANT ALL ON public.eduardo_contract_reviews TO service_role;

ALTER TABLE public.eduardo_contract_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eduardo_reviews_owner_all"
  ON public.eduardo_contract_reviews
  FOR ALL
  TO authenticated
  USING (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid()))
  WITH CHECK (owner_id = COALESCE(public.get_org_owner(auth.uid()), auth.uid()));

CREATE TRIGGER eduardo_reviews_updated_at
  BEFORE UPDATE ON public.eduardo_contract_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();