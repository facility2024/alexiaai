-- Remove conversas com chat_id que parece LID (≥15 dígitos, sem ser telefone BR)
-- Telefones BR têm no máximo 13 dígitos (55 + DDD + 9 dígitos)

-- Primeiro: vê quantos registros afeta
SELECT chat_id, count(*) as msgs 
FROM crm_messages 
WHERE chat_id ~ '^\d{15,}$'
GROUP BY chat_id;

-- Deleta mensagens com chat_id LID
DELETE FROM crm_messages 
WHERE chat_id ~ '^\d{15,}$';

-- Deleta cards do kanban com contact_phone LID
DELETE FROM kanban_cards 
WHERE contact_phone ~ '^\d{15,}$';

-- Deleta flow_conversations com chat_id LID
DELETE FROM flow_conversations 
WHERE chat_id ~ '^\d{15,}$';

-- Deleta chat_assignments com chat_id LID
DELETE FROM chat_assignments 
WHERE chat_id ~ '^\d{15,}$';

-- Deleta crm_paused_chats com chat_id LID
DELETE FROM crm_paused_chats 
WHERE chat_id ~ '^\d{15,}$';
