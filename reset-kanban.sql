-- ZERA KANBAN - roda no SQL Editor do Supabase

-- 1. Move todos os cards para Etapa 1
UPDATE kanban_cards 
SET column_id = (
  SELECT id FROM kanban_columns 
  WHERE name ILIKE '%primeiro atendimento%' 
  AND user_id = kanban_cards.user_id 
  LIMIT 1
),
updated_at = now(),
last_message_at = now(),
last_client_message_at = now(),
summary = '';

-- 2. Limpa mensagens de numeros LID antigos
DELETE FROM crm_messages WHERE chat_id ~ '^\d{15,}$';

-- 3. Limpa conversation flow
DELETE FROM flow_conversations;

-- 4. Limpa atribuicoes
DELETE FROM chat_assignments;

-- 5. Limpa pausas
DELETE FROM crm_paused_chats;

-- 6. Limpa events do kanban
DELETE FROM kanban_card_events;
