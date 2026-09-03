-- Cron job: deleta mensagens do CRM com mais de 7 dias
-- Roda todo dia às 3h da manhã (horário de Brasília)

SELECT cron.schedule(
  'cleanup-crm-messages-7d',
  '0 6 * * *',  -- 06:00 UTC = 03:00 BRT
  $$
    DELETE FROM crm_messages
    WHERE created_at < now() - interval '7 days';
  $$
);
