ALTER TABLE public.crm_messages REPLICA IDENTITY FULL;
ALTER TABLE public.crm_paused_chats REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_paused_chats;