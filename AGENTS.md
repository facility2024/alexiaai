# AGENTS.md

## Stack

TanStack Start + React 19 + Vite 7 + Tailwind CSS 4 + Supabase + shadcn/ui `new-york`. TypeScript strict. UI in pt-BR.

## Commands

```bash
bun run dev          # vite dev — http://localhost:8080 (port forced by lovable config)
bun run build        # vite build -> .output/ (Nitro node-server) — primary verification gate (~30s)
bun run build:dev    # vite build --mode development
bun run preview      # vite preview
bun run lint         # eslint . (includes prettier rules via eslint-plugin-prettier)
bun run format       # prettier --write .  (100 chars, double quotes, semicolons)
```

No `typecheck` script, no test suite (0 test files outside `node_modules`), no CI (`.github/` absent), no pre-commit hooks. Verify with `bun run build` — but note the build does **not** typecheck (it passes with a fully red `tsc`). Baseline is not clean (re-measured 12/11/2026):

- `bunx eslint "src/**/*.{ts,tsx}"` reports **~10,500** pre-existing problems (99% `prettier/prettier`, mostly auto-fixable). Don't mass-fix or run `bun run format` repo-wide in an unrelated change — scope to files you touch (`bunx prettier --write <file>`, `bunx eslint <file>`).
- **Lint counts depend on local build artifacts:** `eslint.config.js:9` ignores `dist`/`.output`/`.vinxi` but NOT `.netlify/` — after a Netlify-mode build (435 generated files currently on disk), `bun run lint` reports **~66k** problems instead of ~10k. Compare source-only with `bunx eslint "src/**/*.{ts,tsx}"`; the inflation is not a regression.
- `bunx tsc --noEmit` fails with **85 pre-existing errors** in 4 files — a red tsc at baseline is not your fault. All stem from stale generated Supabase `src/integrations/supabase/types.ts` (still lacks `whatsapp_campaign*` tables; regenerated types fix most of them):
  - `src/lib/whatsapp-campaigns.functions.ts` (54) + `src/routes/_authenticated/marketing-whatsapp.tsx` (10) + `src/routes/api/public/whatsapp-campaign-cron.ts` (16): queries against `whatsapp_campaigns` / `whatsapp_campaign_recipients`. Regenerate the types; don't "fix" these by rewriting queries.
  - `src/routes/api/public/wapi-webhook.ts` (5, lines 321/323): insert payload hitting the same stale types (`string` → `never`).

## Package Manager

Bun only — `bun.lock` + `bunfig.toml` are authoritative (Dockerfile runs `bun install`). `bunfig.toml` enforces `minimumReleaseAge = 86400` (24h supply-chain guard). If a new package fails to install, add it to `minimumReleaseAgeExcludes` — confirm with user first. Currently excludes: `@lovable.dev/vite-tanstack-config`, `@lovable.dev/mcp-js`.

A tracked `package-lock.json` also exists: never run `npm install` locally (it would drift from `bun.lock`), but don't delete it either — Netlify builds run `npm run build` against it (`netlify.toml`).

## Vite Config — Do Not Duplicate Plugins

`vite.config.ts:7` imports `defineConfig` from `@lovable.dev/vite-tanstack-config` which already bundles `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro`, `componentTagger`, `VITE_*` injection, `@` alias, and dedupe. Adding any of those manually breaks the build. Only extend via `defineConfig({ vite: {...} })`.

- `tanstackStart.server.entry = "server"` redirects to `src/server.ts` (SSR error wrapper).
- `nitro.preset` — `netlify` quando `NETLIFY=true` (build na Netlify; gera `dist/` + `.netlify/functions-internal/`), senão `node-server` (EasyPanel/Docker, `node .output/server/index.mjs` na porta 3000 — `Dockerfile:53`).

## Routing

File-based in `src/routes/` (see `src/routes/README.md:1`).

- `__root.tsx` — app shell, must preserve `<Outlet />`
- `_authenticated/route.tsx` — auth gate (`supabase.auth.getUser()` + `ssr: false`, `route.tsx:33-35`), all CRM routes are children; also runs a URL-access guard (`canAccess`/`firstAllowedUrl`) with a 10s org-context cache (`route.tsx:21`)
- `api/public/*` — unauthenticated by design: webhooks (Asaas, MercadoPago, WAPI, Autentique, import), crons (SMS/followup/contracts/whatsapp-campaign), public media/TTS token routes, `wapi-media-retry`. Do not add auth middleware.
- Dynamic params use bare `$` (`$id.tsx`, `$token.tsx`, `api/public/media/$mediaId.ts`), not `:id` or `{id}`
- `routeTree.gen.ts` — auto-generated, never edit (also in `.prettierignore`); regenerates on `dev`/`build`, so `git status` showing it modified is normal
- `api/public/wapi-webhook.t` (`.t`, not `.ts`) is a stale near-duplicate of `wapi-webhook.ts` — not a route, ignore it

## Supabase — Two Clients

`src/integrations/supabase/` — client/middleware files are auto-generated, do not edit:

| File               | Usage                             | Secret                      |
| ------------------ | --------------------------------- | --------------------------- |
| `client.ts`        | Browser/SSR, lazy proxy, user RLS | `VITE_SUPABASE_*`           |
| `client.server.ts` | Admin, bypasses RLS               | `SUPABASE_SERVICE_ROLE_KEY` |

- **Never** static-import `client.server.ts` from a route or `*.functions.ts` — those ship to the client bundle. Dynamic-import inside handler: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")` (`client.server.ts:35`).
- `requireSupabaseAuth` (`auth-middleware.ts:9`) — attach per-function via `.middleware([requireSupabaseAuth])` on `createServerFn`; validates `Bearer` token, injects `{ supabase, userId, claims }`.
- `attachSupabaseAuth` (`auth-attacher.ts:7`) — global `functionMiddleware` in `src/start.ts:27`; without it browser RPCs send no token.
- `types.ts` (same dir) is generated from the live schema and **lags `supabase/migrations/`** — new tables/columns cause bursts of tsc errors until regenerated (see baseline above).
- **Projeto Supabase único:** `tweoiunfpawwwyzezlax` — `supabase/config.toml`, `.env`, `client.server.ts` e `EASYPANEL.md` usam o mesmo ref/URL. Keys em formato JWT antigo (`eyJ...` anon/service_role). Migrations em `supabase/migrations/`; schema consolidado em `supabase/full-schema.sql`. Migrations `20261105120000_whatsapp_campaigns` e `20261106100000_team_access_permissions` estavam pendentes de aplicação (verificado 07/11/2026) — consolide-as em `apply-tweoi-pendentes-20261107.sql` (raiz, idempotente) e execute no SQL Editor; **re-verifique o estado atual antes de assumir**. `types.ts` ainda não contém `whatsapp_campaign*` (verificado 12/11/2026), então regenerar os tipos continua pendente. Novas migrations posteriores: `20261108150000_followup_client_id_nullable`, `20261108160000_whatsapp_campaign_schedule`, `20261112120000_company_licenses` (pendente de aplicação).

## Licenças SaaS (camada aditiva)

- `company_licenses` (migration `20261112120000`, precisa ser aplicada no SQL Editor): 1 linha = 1 empresa/tenant criada pelo painel `/admin/licencas`. **Workspace sem linha na tabela = painel oficial, comportamento histórico intacto.**
- Gate: `canAccess` (`src/lib/access.ts`) passa a validar `ctx.license.features` para workspaces licenciados (owner **não** passa mais livre); `LicenseBlockedScreen` em `src/routes/_authenticated/route.tsx` bloqueia licença vencida/desativada; webhook + crons param respostas/envios automáticos via `src/lib/license-check.ts` (mensagens seguem sendo gravadas).
- Gestão: `src/lib/licenses.functions.ts` (guard `profiles.is_platform_admin`, flag protegida por trigger) + `admin.licencas.tsx`. Convite de empresa: `/convite-empresa/$token` (rota pública, fluxo próprio — NÃO confundir com `/convite/$token` de equipe).
- `types.ts` também não tem `company_licenses`/`profiles.is_platform_admin` — código novo usa casts `any` documentados; regenerar os tipos os torna dispensáveis.

## Server-Only Code

ESLint (`eslint.config.js:23`) bans `import "server-only"`. Use file suffix instead:

- `*.server.ts` — never bundled to client (admin clients, secrets, `src/lib/config.server.ts`)
- `*.functions.ts` — `createServerFn` handlers, **are** bundled to client (keep secrets out, use dynamic import above)
- Plain `*.ts` — client-safe

The `src/lib/` directory follows this split (15 `*.server.ts`, 20 `*.functions.ts`: `wapi`, `media`, `ai-gateway`, `contracts-pdf`, `whatsapp-campaigns`, etc.).

## Env Variables

- `VITE_*` — public, via `import.meta.env`, ships to browser
- Unprefixed — server-only, via `process.env` **inside** functions/handlers only
- Never read `process.env` at module scope in `*.server.ts` — wrap in a function (`src/lib/config.server.ts:19`)
- Local dev needs a gitignored `.env` with `VITE_SUPABASE_*` (full set in `EASYPANEL.md`); without it the Supabase client throws at runtime (`client.ts:18`)

## SSR Error Handling

- `src/server.ts` — catches h3-swallowed 500s (`{"unhandled":true}`) and renders `renderErrorPage()`
- `src/start.ts:6` — request middleware that skips `/lovable/` paths; do not remove either layer

## Aliases & UI

- `@/*` → `./src/*` (`tsconfig.json`, `components.json`)
- shadcn aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`; style `new-york`, CSS `src/styles.css`, baseColor slate

## Deploy

EasyPanel auto-deploys on push to **`master`** per `EASYPANEL.md` — active development is on **`main`** (`origin/HEAD` → `main`). As of 12/11/2026 `main` and `master` point to the **same commit**; confirm which branch should receive the push before relying on auto-deploy (pushing only to `main` does not trigger EasyPanel). `Dockerfile` — multi-stage `node:22-alpine` + `bun@1.4.3` build (bun ≥1.4 required to read this `bun.lock`; 1.1 fails frozen-lockfile and pulls breaking versions), copies `.output` + `node_modules` to runtime. Requires `VITE_SUPABASE_*` / `SUPABASE_*` build args. See `EASYPANEL.md` for full config.

**Netlify** (alternativa via `netlify.toml`): build `npm run build` → preset trocado por `NETLIFY=true`; publish `dist/` (NUNCA `.output/` — o preset netlify gera `dist/`, não `.output/public`). Exige `NODE_VERSION=22` e as env vars `VITE_SUPABASE_*` (build) + `SUPABASE_*`/secrets (functions) na UI da Netlify.

## Root Scripts & Scratch Files (ad-hoc)

- `test-chat.ps1` / `test-flow.ps1` — POST to the **production** webhook (`crmlexia.com.br/...wapi-webhook?secret=...`). Running them sends real messages; don't run casually.
- `test-chat-local.ps1` / `test-flow-local.ps1` — same tests against `http://localhost:8080` (requires `bun run dev`); safe to run.
- `reset-kanban.sql` — destructive, meant for manual execution in the Supabase SQL Editor.
- `pending-20261105.sql` — RLS policy scratch for `chat_assignments`; sits outside `supabase/migrations/`, so it is never auto-applied.

## Regra de mudança ( pedido do usuário, 12/11/2026 )

**Atualizações novas são ADITIVAS — não refatorar nem "consertar" código já construído e funcionando.** Nunca reescreva/fluide lógica existente sem pedido explícito do usuário para mudar aquilo; apenas acrescente funcionalidade ao redor. Se uma correção em código antigo parecer necessária, pergunte antes de alterar.

## Progresso — onde paramos (atualizado 12/11/2026)

**RESOLVIDO e confirmado pelo usuário (12/11/2026) — envio de imagem/áudio no WhatsApp + renderização no painel, os dois pontos:**

1. **Envio de áudio** (`a9036f5` + docs `b8678dd`, main + master): `A URL do áudio deve ser nos formatos .mp3 ou .ogg.` — a W-API exige URL que termine **literalmente** em `.mp3`/`.ogg` (query string depois da extensão é rejeitada; mesmo motivo do workaround do TTS). Fix aditivo: (1) nova rota pública `src/routes/api/public/audio/$audioToken.ts` (espelho de `tts/$audioToken.ts`: assinatura HMAC no caminho, payload base64url `exp:storagePath`, download via `bunnyGet`, path guard `includes("/operator/")`, content-type `audio/mpeg|ogg`); (2) `sendOperatorMedia` (`whatsapp.functions.ts:469`) ganhou override pós-`bunnySignedUrl`: `kindTop === "audio"` → `mediaUrl = ${getPublicAppUrl()}/api/public/audio/${payload}.${sig}.${ext}`. Pré-requisito de env: `WAPI_WEBHOOK_SECRET` + `PUBLIC_APP_URL` (mesmos do TTS). Confirmado: nota de voz chega no WhatsApp. **não** rodar prettier no `whatsapp.functions.ts` inteiro (reformataria 244 linhas antigas — Regra de mudança).

2. **"Falha ao carregar mídia" no painel** (`132a046` + docs `de691ff`, main + master): `media_assets.user_id` é sempre o DONO da org (upload usa `get_org_owner` p/ dedupe cross-operador), mas a policy RLS de leitura é `auth.uid() = user_id` — membros (ex.: ANDRE, agente ativo) tomavam **404** em `/api/media/$mediaId` e o `Media` mostrava o erro. Fix: SELECT com `supabaseAdmin` + autorização via `rpc("is_org_member", {_owner: asset.user_id, _user: sub})` (dono direto pula o rpc). Verificado e2e local com usuário temporário (removido depois): próprio asset 200, sem membership 404, membership ativa 200. Confirmado no deploy: painel do colaborador renderiza imagem/áudio enviados. Nota: trigger cria membros `org_members` como `active: false` — membership inativa = sem acesso.

Antes: tarefa **botão de nota de voz no CRM** — commitada e enviada como `33209f4` (`feat(crm): botao de nota de voz no composer...`, main + master). Hook `src/hooks/use-voice-recorder.ts` (MediaRecorder → `AudioContext.decodeAudioData` → MP3 mono/64kbps via `@breezystack/lamejs@1.2.7`, arquivo `nota-voz-<stamp>.mp3`; reamostra via `OfflineAudioContext` se sampleRate fora da lista MPEG; API `{recording, busy, seconds, supported, start, stop, cancel}`; normalizado para LF pelo prettier — sem diff de conteúdo); `crm.tsx`: mic ao lado do paperclip, linha do composer vira bolinha vermelha + cronômetro + X/▶, `openPreview` cria objectURL para `audio/*`, preview do dialog com `<audio controls>`, lista de conversas mostra "🎤 Áudio" (`message_type`). Fluxo: `confirmSendMedia` → `uploadOperatorMedia` → `sendOperatorMedia` (kind audio → `send-audio`); inbound player já existia. Prettier no `crm.tsx` reformatau 5 trechos cosméticos pré-existentes (collateral sancionado). AGENTS.md "Regra de mudança" commitada junto (`33209f4`).

Última tarefa commitada: **correção "colaborador vira admin"** — `updateMemberRole` (`admin.functions.ts`) agora remove `user_roles` antigos ao trocar o papel (papel 'admin' antigo ficava preso e virava ownership); `getMyOrgContext` endurecido: linha própria (`owner_id = member_id`) não conta como "ter equipe" e QUALQUER membership bloqueia o atalho do papel 'admin' — com isso os interruptores de permissão voltam a valer para colaboradores. Nota de diagnóstico: o cumprimento do Dashboard mostra o nome do USUÁRIO LOGADO (`dashboard.tsx:155`) — para testar como colaborador, usar janela anônima.

Tarefas anteriores da sessão: **liberação de Campanhas WhatsApp por colaborador** — permissão `can_manage_campaigns` (extra JSONB, padrão `false`; `/marketing-whatsapp` deixou de ser `role_admin`), interruptor em Equipe & Permissões, fora do convite de propósito. **Assinatura do colaborador** — `sendOperatorMessage` (`whatsapp.functions.ts`) prefixa `*Nome*` (negrito no WhatsApp; `SignedContent` em `crm.tsx` renderiza em negrito) **ligada por padrão**; interruptor em Equipe & Permissões (`admin.usuarios.tsx`) DESLIGA por colaborador (flag `sign_messages` no JSONB `user_permissions.extra`, `false` = off, ausente = on; merge em `updateMemberPermissions`, `admin.functions.ts`). Envio no CRM tem retry automático quando o token de sessão expira (`handleSend` em `crm.tsx`).

Correções da sessão 12/11 já commitadas e enviadas (nada pendente): nomes na lista de conversas (`492044a`), instância única do painel para usuário atribuído (`11d3090`), menu ADMINISTRAÇÃO só para o dono (`89fd7e7`), licenças SaaS (`3259b9f`/`a190566`), unificação LID (`913c4d7`), nomes em Equipe/Setores (`b640177`), aviso Manual Linking (`e3de8c7`).

Fora do código (status): migration `company_licenses` aplicada no SQL Editor; `is_platform_admin` ativo para `talitamenuzo@gmail.com`; Manual Linking ativado no Supabase; Google Calendar aguardando Client ID/Secret do Google Cloud + provider Google ativado no Supabase; SQL de limpeza de conversas-fantasma (LIDs) já fornecido ao usuário (execução manual); exclusão de nomes duplicados na equipe = outra tarefa (via Equipe & Permissões → lixeira).
