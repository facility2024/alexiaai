-- =========================================
-- CONTRACTS
-- =========================================
CREATE TABLE public.contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  created_by UUID NOT NULL,
  card_id UUID REFERENCES public.kanban_cards(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','signed','rejected','expired','cancelled')),
  autentique_document_id TEXT UNIQUE,
  autentique_public_id TEXT,
  file_url TEXT,
  signed_file_url TEXT,
  sent_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contracts_owner_idx ON public.contracts(owner_id);
CREATE INDEX contracts_card_idx ON public.contracts(card_id);
CREATE INDEX contracts_client_idx ON public.contracts(client_id);
CREATE INDEX contracts_autentique_doc_idx ON public.contracts(autentique_document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view contracts"
ON public.contracts FOR SELECT TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can insert contracts"
ON public.contracts FOR INSERT TO authenticated
WITH CHECK (public.is_org_member(owner_id, auth.uid()) AND created_by = auth.uid());

CREATE POLICY "Org members can update contracts"
ON public.contracts FOR UPDATE TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Owner can delete contracts"
ON public.contracts FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE TRIGGER update_contracts_updated_at
BEFORE UPDATE ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- CONTRACT SIGNERS
-- =========================================
CREATE TABLE public.contract_signers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  action TEXT NOT NULL DEFAULT 'sign' CHECK (action IN ('sign','approve','acknowledge','witness')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','viewed','signed','rejected')),
  autentique_signer_id TEXT,
  signing_url TEXT,
  viewed_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contract_signers_contract_idx ON public.contract_signers(contract_id);
CREATE INDEX contract_signers_email_idx ON public.contract_signers(email);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_signers TO authenticated;
GRANT ALL ON public.contract_signers TO service_role;

ALTER TABLE public.contract_signers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view signers"
ON public.contract_signers FOR SELECT TO authenticated
USING (public.is_org_member(owner_id, auth.uid()));

CREATE POLICY "Org members can manage signers"
ON public.contract_signers FOR ALL TO authenticated
USING (public.is_org_member(owner_id, auth.uid()))
WITH CHECK (public.is_org_member(owner_id, auth.uid()));

CREATE TRIGGER update_contract_signers_updated_at
BEFORE UPDATE ON public.contract_signers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- CONTRACT EVENTS (webhook audit trail)
-- =========================================
CREATE TABLE public.contract_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE CASCADE,
  autentique_document_id TEXT,
  event_type TEXT NOT NULL,
  signer_email TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contract_events_contract_idx ON public.contract_events(contract_id);
CREATE INDEX contract_events_doc_idx ON public.contract_events(autentique_document_id);

GRANT SELECT ON public.contract_events TO authenticated;
GRANT ALL ON public.contract_events TO service_role;

ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view events of their contracts"
ON public.contract_events FOR SELECT TO authenticated
USING (
  contract_id IS NULL OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = contract_events.contract_id
      AND public.is_org_member(c.owner_id, auth.uid())
  )
);