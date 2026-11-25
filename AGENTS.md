# AGENTS.md

## Stack

TanStack Start + React 19 + Vite 7 + Tailwind CSS 4 + Supabase + shadcn/ui `new-york`. TypeScript strict. UI in pt-BR.

## Commands

```bash
bun run dev          # vite dev — http://localhost:8080 (port forced by lovable config)
bun run build        # vite build -> .output/ (Nitro node-server) — primary verification gate (~45-60s)
bun run build:dev    # vite build --mode development
bun run preview      # vite preview
bun run lint         # eslint . (includes prettier rules via eslint-plugin-prettier)
bun run format       # prettier --write .  (100 chars, double quotes, semicolons)
```

No `typecheck` script, no test suite (0 test files outside `node_modules`), no CI (`.github/` absent), no pre-commit hooks. Verify with `bun run build` + **`bunx tsc --noEmit`** (passou com 0 erros em 25/11/2026; types.ts regenerado do schema ao vivo). Se voltar a aparecer erro em massa em queries novas, o types.ts foi mexido/regenerado errado, não "conserte" as queries.

- `bunx eslint "src/**/*.{ts,tsx}"` reports **~10k** pre-existing problems (9,745 medidos em 25/11/2026; 99% `prettier/prettier`, mostly auto-fixable). Don't mass-fix or run `bun run format` repo-wide in an unrelated change — scope to files you touch (`bunx prettier --write <file>`, `bunx eslint <file>`).
- **Lint counts depend on local build artifacts:** `eslint.config.js:9` ignores `dist`/`.output`/`.vinxi` but NOT `.netlify/` — after a Netlify-mode build (435 generated files on disk em 25/11/2026), `bun run lint` reports **~66k** problems (65,865 medidos) instead of ~10k. Compare source-only with `bunx eslint "src/**/*.{ts,tsx}"`; the inflation is not a regression.

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
- `api/public/*` — unauthenticated by design: webhooks (Asaas, MercadoPago, WAPI, Autentique, import), crons (SMS/followup/contracts/whatsapp-campaign), public media/TTS/audio token routes, `wapi-media-retry`. Do not add auth middleware.
- Dynamic params use `$`, in two shapes: flat files as `name.$param.tsx` (e.g. `convite.$token.tsx`, `contratos.$id.tsx`) or inside dirs as `$param.tsx` (e.g. `api/public/media/$mediaId.ts`). Never `:id` or `{id}`.
- `routeTree.gen.ts` — auto-generated, never edit (also in `.prettierignore`); regenerates on `dev`/`build`, so `git status` showing it modified is normal
- `api/public/wapi-webhook.t` (`.t`, not `.ts`) is a stale near-duplicate of `wapi-webhook.ts` — not a route, ignore it

## Supabase — Two Clients

`src/integrations/supabase/` — client/middleware files are auto-generated, do not edit:

| File               | Usage                             | Secret                      |
| ------------------ | --------------------------------- | --------------------------- |
| `client.ts`        | Browser/SSR, lazy proxy, user RLS | `VITE_SUPABASE_*`           |
| `client.server.ts` | Admin, bypasses RLS               | `SUPABASE_SERVICE_ROLE_KEY` |

- **Never** static-import `client.server.ts` from a route or `*.functions.ts` — those ship to the client bundle. Dynamic-import inside handler: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")` (`client.server.ts:35`).
- `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts:9`) — attach per-function via `.middleware([requireSupabaseAuth])` on `createServerFn`; validates `Bearer` token, injects `{ supabase, userId, claims }`.
- `attachSupabaseAuth` (`src/integrations/supabase/auth-attacher.ts:7`) — global `functionMiddleware` in `src/start.ts:27`; without it browser RPCs send no token.
- `types.ts` (same dir) is generated from the live schema — regenerado em 20/11/2026 com `SUPABASE_ACCESS_TOKEN` (o token pessoal está no `.env`, gitignored) + `supabase gen types typescript --project-id tweoiunfpawwwyzezlax > src/integrations/supabase/types.ts` (CLI v2.122 instalado via npm; sem o token a conta local não vê o projeto). Nova migration → rode o gen de novo antes de escrever queries contra as colunas novas.
- **Projeto Supabase único:** `tweoiunfpawwwyzezlax` — `supabase/config.toml`, `.env`, `client.server.ts` e `EASYPANEL.md` usam o mesmo ref/URL. Keys em formato JWT antigo (`eyJ...` anon/service_role). Migrations em `supabase/migrations/`; schema consolidado em `supabase/full-schema.sql` (**defasado** — em 20/11/2026 ainda não incluía `20261105090000`, `20261108150000`, `20261108160000` nem `20261112120000_company_licenses`; confira antes de usá-lo como referência). **Migrations todas aplicadas** (verificado via Management API em 20/11/2026): `whatsapp_campaign*`, `company_licenses`, `is_platform_admin`, `apply_invite_membership` v2 e `client_id` nullable já estão no banco — `apply-tweoi-pendentes-20261107.sql` não precisa mais ser rodado.

## Licenças SaaS (camada aditiva)

- `company_licenses` (migration `20261112120000`): 1 linha = 1 empresa/tenant criada pelo painel `/admin/licencas`. **Workspace sem linha na tabela = painel oficial, comportamento histórico intacto.**
- Gate: `canAccess` (`src/lib/access.ts`) valida `ctx.license.features` para workspaces licenciados (owner **não** passa mais livre); `LicenseBlockedScreen` em `src/routes/_authenticated/route.tsx` bloqueia licença vencida/desativada; crons (SMS/followup/whatsapp-campaign) filtram owners com `filterBlockedLicenseOwners` (`src/lib/license-check.ts`); o webhook WAPI tem seu próprio check inline de `company_licenses` (`wapi-webhook.ts:610-628`) — mensagens seguem sendo gravadas.
- Gestão: `src/lib/licenses.functions.ts` (guard `profiles.is_platform_admin`, flag protegida por trigger) + `admin.licencas.tsx`. Convite de empresa: rota pública `convite-empresa.$token.tsx` (fluxo próprio — NÃO confundir com `convite.$token.tsx` de equipe).
- `types.ts` foi regenerado em 20/11/2026 e já contém `company_licenses`/`profiles.is_platform_admin` — casts `any` antigos em `licenses.functions.ts`/`admin.functions.ts` continuam funcionando mas são dispensáveis; código novo não precisa deles.

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
- `src/start.ts:8` — request middleware that skips `/lovable/` paths; do not remove either layer

## Aliases & UI

- `@/*` → `./src/*` (`tsconfig.json`, `components.json`)
- shadcn aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`; style `new-york`, CSS `src/styles.css`, baseColor slate

## Deploy

EasyPanel auto-deploys on push to **`master`** per `EASYPANEL.md` (Branch: master, **não** main) — active development is on **`main`** (`origin/HEAD` → `main`). `origin/main` e `origin/master` estavam no mesmo commit em 25/11/2026 (`08959a1`), mas o ref local `master` pode atrasar — confira com `git rev-parse origin/main origin/master` antes de assumir; **push só em `main` não dispara EasyPanel** (faça também `git push origin main:master`). `Dockerfile` — multi-stage `node:22-alpine` + `bun@1.4.3` build (bun ≥1.4 required to read this `bun.lock`; 1.1 fails frozen-lockfile and pulls breaking versions), copies `.output` + `node_modules` to runtime (`ENV PORT=3000`). Requires `VITE_SUPABASE_*` / `SUPABASE_*` build args. See `EASYPANEL.md` for full config.

**Netlify** (alternativa via `netlify.toml`): build `npm run build` → preset trocado por `NETLIFY=true`; publish `dist/` (NUNCA `.output/` — o preset netlify gera `dist/`, não `.output/public`). Exige `NODE_VERSION=22` e as env vars `VITE_SUPABASE_*` (build) + `SUPABASE_*`/secrets (functions) na UI da Netlify.

## Root Scripts & Scratch Files (ad-hoc)

- `test-chat.ps1` / `test-flow.ps1` — POST to the **production** webhook (`crmlexia.com.br/...wapi-webhook?secret=...`). Running them sends real messages; don't run casually.
- `test-chat-local.ps1` / `test-flow-local.ps1` — same tests against `http://localhost:8080` (requires `bun run dev`); safe to run.
- `reset-kanban.sql` — destructive, meant for manual execution in the Supabase SQL Editor.
- `pending-20261105.sql` — RLS policy scratch for `chat_assignments`; sits outside `supabase/migrations/`, so it is never auto-applied.

## Regra de mudança ( pedido do usuário, 12/11/2026 )

**Atualizações novas são ADITIVAS — não refatorar nem "consertar" código já construído e funcionando.** Nunca reescreva/fluide lógica existente sem pedido explícito do usuário para mudar aquilo; apenas acrescente funcionalidade ao redor. Se uma correção em código antigo parecer necessária, pergunte antes de alterar. Exemplos concretos sancionados: não rodar prettier/eslint `--fix` sobre `src/lib/whatsapp.functions.ts` ou `crm.tsx` inteiros (reformatariam centenas de linhas antigas não relacionadas).

## Gotchas confirmados (não óbvios do código/DB)

- **W-API exige URL de mídia terminando literalmente em `.mp3`/`.ogg`** — query string depois da extensão é rejeitada (mesmo motivo do workaround do TTS). `sendOperatorMedia` (`src/lib/whatsapp.functions.ts:396`, override de áudio em `:472`) reescreve a URL assinada para `/api/public/audio/<payload>.<sig>.<ext>` (rota espelho de `tts/$audioToken.ts`). Requer env `WAPI_WEBHOOK_SECRET` + `PUBLIC_APP_URL`; `getPublicAppUrl()` (`config.server.ts`) **rejeita localhost**, então envio de áudio em dev local só funciona com `PUBLIC_APP_URL` apontando à origem de produção.
- **Mídia no painel autoriza por org, não por RLS:** `media_assets.user_id` é sempre o dono da org (upload usa `get_org_owner` p/ dedupe cross-operador); a leitura em `/api/media/$mediaId` faz SELECT com `supabaseAdmin` + autorização via rpc `is_org_member` (dono direto pula o rpc). Sem membership ativa → 404. Membros entram em `org_members` com `active: false` por padrão (`handle_new_user` / `apply_invite_membership` em `20261106100000`) — inativo = sem acesso, comportamento esperado; `is_org_member` exige `active`.
- **Flags de permissão moram no JSONB `user_permissions.extra`** (`admin.functions.ts`): `sign_messages` (padrão **on**; `false` desliga — merge em `updateMemberPermissions`), `can_manage_campaigns` (padrão `false`; `/marketing-whatsapp` deixou de exigir `role_admin`). `updateMemberRole` remove `user_roles` antigos ao trocar papel (um papel 'admin' antigo preso virava ownership).
- **Saudação do Dashboard = usuário logado** (`dashboard.tsx:155`), não o contato — para testar painel como colaborador, use janela anônima.

## Estado operacional (re-verificado 25/11/2026 — re-verificar antes de assumir)

- 25/11/2026: `bunx tsc --noEmit` 0 erros; `types.ts` contém `company_licenses`/`is_platform_admin`/`fish_audio_*`; migrations `20261112120000_company_licenses` e `20261120130000_ai_settings_fish_audio` presentes em `supabase/migrations/`. Fish Audio (toggle + key + voice id em `ai_settings.fish_audio_*`) no painel.
- Histórico 20/11/2026 (re-confirmar no banco, não re-verificado hoje): todas as migrations aplicadas via Management API (`SUPABASE_ACCESS_TOKEN` no `.env`); Manual Linking ativo no Supabase; `is_platform_admin` ativo para `talitamenuzo@gmail.com`; Google Calendar aguardando Client ID/Secret do Google Cloud (provider já ativado); SQL de limpeza de conversas-fantasma (LIDs) entregue ao usuário para execução manual.
