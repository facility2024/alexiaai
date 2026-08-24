DROP INDEX IF EXISTS public.crm_messages_wapi_unique;

CREATE UNIQUE INDEX crm_messages_wapi_unique
  ON public.crm_messages (user_id, direction, wapi_message_id);