DROP TRIGGER IF EXISTS trg_auto_pause_on_human ON public.crm_messages;
DROP FUNCTION IF EXISTS public.auto_pause_chatbot_on_human_message();