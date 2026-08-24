ALTER TABLE public.crm_messages DROP CONSTRAINT IF EXISTS crm_messages_sender_check;
ALTER TABLE public.crm_messages ADD CONSTRAINT crm_messages_sender_check
  CHECK (sender = ANY (ARRAY['contact','bot','operator','system','whatsapp','triagem','analise','documentos']));