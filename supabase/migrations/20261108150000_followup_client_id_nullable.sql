-- Follow-up agendado a partir do chat de atendimento: o contato pode não
-- existir em clients, então client_id passa a ser opcional (phone basta).
-- Idempotente: pode ser executada mais de uma vez.
ALTER TABLE public.client_sms_followups ALTER COLUMN client_id DROP NOT NULL;
