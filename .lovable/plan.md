## Módulo Contratos + Autentique + IA — plano isolado

Regra-mãe: nada existente é alterado. Tudo novo mora em arquivos novos, tabelas novas e um item de menu novo. Sem tocar em `whatsapp.functions.ts`, `wapi-*`, `crm.tsx`, `chat-*`, `kanban`, `sms`, IA existente, `handle_new_user`, políticas ou tabelas atuais.

---

### 1. Segredo
- `AUTENTIQUE_API_TOKEN` como secret backend (pedido via `add_secret` no momento da execução).
- Nunca exposto ao frontend. Todas as chamadas GraphQL passam por server functions / server route.

### 2. Menu lateral (edição mínima)
Em `src/components/app-sidebar.tsx`, dentro do bloco de itens já existente, adicionar **um único item novo**:
- `Contratos` → `/contratos` (ícone `FileSignature`), gated por permissão nova `can_manage_contracts` (fallback: admin).

Nenhum item existente é removido ou reordenado.

### 3. Banco (migration única, tudo novo)
Tabelas novas em `public`:
- `contract_templates` (id, owner_id, name, body_html, variables jsonb, active, timestamps)
- `contracts` (contract_code `CTR-YYYY-NNNNNN`, client_id, responsible_agent_id, template_id, owner_id, values jsonb, payment_method, pdf_url, autentique_document_id, status enum, integrity_score, integrity_report jsonb, created_at, sent_at, signed_at, updated_at)
- `contract_events` (contract_id, event_type, payload jsonb, source enum `ia|autentique|user|system`, dedupe_key unique, created_at) — histórico imutável + idempotência webhook
- `contract_reminders` (contract_id, level 1/2/3, sent_at)
- Enum `contract_status` com os 15 estados listados.

RLS por org (`owner_id = get_org_owner(auth.uid())`), GRANTs padrão (`authenticated` + `service_role`; sem `anon`).

### 4. Server-side (arquivos novos)
- `src/lib/autentique.server.ts` — cliente GraphQL (fetch), lê `process.env.AUTENTIQUE_API_TOKEN` dentro do handler. Nunca importado por rota/componente diretamente.
- `src/lib/contracts.functions.ts` — server functions autenticadas (`requireSupabaseAuth`):
  - `listTemplates`, `upsertTemplate`, `duplicateTemplate`, `toggleTemplate`
  - `listContracts`, `getContract`
  - `createContractDraft({ client_id, template_id, values })` — preenche variáveis a partir de `clients`, `profiles`, org.
  - `runContractAudit(contract_id)` — IA auditor (via `resolveUserAi` já existente, fallback gateway). Retorna score + issues; grava em `integrity_report`.
  - `generateContractPdf(contract_id)` — render HTML→PDF server-side (pdf-lib ou puppeteer não; usar `@react-pdf/renderer` ou HTML→PDF via serviço leve; decidir na execução).
  - `sendContractToAutentique(contract_id)` — bloqueia se score < threshold ou variáveis `{{}}` remanescentes. Chama `autentique.server.ts`.
  - `cancelContract`, `resendContract`.
- `src/routes/api/public/autentique-webhook.ts` — endpoint público, valida assinatura/segredo próprio (`AUTENTIQUE_WEBHOOK_SECRET`), idempotência via `contract_events.dedupe_key`, atualiza status, dispara WhatsApp de assinatura (reusa `whatsapp.functions.ts` **sem alterá-lo** — só chama).
- `src/routes/api/public/contracts-reminders-cron.ts` — cron que percorre contratos `ENVIADO_PARA_ASSINATURA` / `AGUARDANDO_ASSINATURA` e dispara lembretes 24h/48h/72h respeitando status.

### 5. Frontend (arquivos novos)
- `src/routes/_authenticated/contratos.tsx` — painel: lista + filtros + colunas pedidas (código, cliente, agente, template, valor, score, status, datas) e botões (Visualizar, Revisar IA, Aprovar, Enviar, Reenviar, Histórico, PDF, Cancelar) todos condicionais a status/permissão.
- `src/routes/_authenticated/contratos.templates.tsx` — CRUD de templates com editor rich-text e paleta de variáveis `{{...}}`.
- `src/routes/_authenticated/contratos.$contractId.tsx` — detalhe: preview do documento, painel de auditoria IA, histórico de eventos, ações.
- Componentes em `src/components/contracts/` (dialog de criação, dialog de auditoria, badge de status, tabela).

### 6. WhatsApp / e-mail
- Reusar `whatsapp.functions.ts` **apenas chamando** — nunca editar. Mensagens de "enviado para assinatura" e "assinado" saem do backend após confirmação da Autentique.
- E-mail delegado à Autentique (não duplicamos entrega).

### 7. Permissões
- Nova flag `can_manage_contracts` em `user_permissions` (migration adiciona coluna com default `false`; admin sempre passa). Sem quebrar leitura existente.

### 8. Ordem de execução (quando você disser "produzir")
1. Pedir `AUTENTIQUE_API_TOKEN` e `AUTENTIQUE_WEBHOOK_SECRET` via `add_secret`.
2. Rodar migration (enum + 4 tabelas + coluna de permissão).
3. Criar `autentique.server.ts` + `contracts.functions.ts`.
4. Criar rotas de UI + item no sidebar.
5. Criar webhook e cron de lembretes.
6. `tsgo` para validar.

### O que NÃO será tocado
`whatsapp.functions.ts`, `whatsapp.server.ts`, `wapi-*`, `media-*`, `crm.tsx`, `chat-*`, `sms*`, `kanban*`, IA existente, `handle_new_user`, políticas/tabelas atuais, `client.ts` / `client.server.ts` / `types.ts`, `.env`, `supabase/config.toml`.

Confirma com **"produzir"** para eu começar pela Etapa 1 (secrets) e Etapa 2 (migration)?
