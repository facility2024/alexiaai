# AGENTS.md

## Stack

TanStack Start + React 19 + Vite 7 + Tailwind CSS 4 + Supabase + shadcn/ui `new-york`. TypeScript strict. UI in pt-BR.

## Commands

```bash
bun run dev          # vite dev — http://localhost:8080 (port forced by lovable config)
bun run build        # vite build -> .output/ (Nitro node-server) — primary verification gate (~35s)
bun run build:dev    # vite build --mode development
bun run preview      # vite preview
bun run lint         # eslint . (includes prettier rules via eslint-plugin-prettier)
bun run format       # prettier --write .  (100 chars, double quotes, semicolons)
```

No `typecheck` script, no test suite (0 test files outside `node_modules`), no CI (`.github/` absent), no pre-commit hooks. Verify with `bun run build` — but note the build does **not** typecheck (it passes with a fully red `tsc`). Baseline is not clean:

- `bunx eslint "src/**/*.{ts,tsx}"` reports **10,162** pre-existing problems (99% `prettier/prettier`, mostly auto-fixable). Don't mass-fix or run `bun run format` repo-wide in an unrelated change — scope to files you touch (`bunx prettier --write <file>`, `bunx eslint <file>`).
- **Lint counts depend on local build artifacts:** `eslint.config.js:9` ignores `dist`/`.output`/`.vinxi` but NOT `.netlify/` — after a Netlify-mode build (435 generated files currently on disk), `bun run lint` reports **66,282** problems instead of ~10k. Compare source-only with `bunx eslint "src/**/*.{ts,tsx}"`; the inflation is not a regression.
- `bunx tsc --noEmit` fails with **111 pre-existing errors** in 3 files — a red tsc at baseline is not your fault:
  - `src/lib/whatsapp-campaigns.functions.ts` (87) + `src/routes/_authenticated/marketing-whatsapp.tsx` (18): generated Supabase `src/integrations/supabase/types.ts` is stale — migration `supabase/migrations/20261105120000_whatsapp_campaigns.sql` added `whatsapp_campaigns` / `whatsapp_campaign_recipients`, but the types were never regenerated from the schema. Regenerate the types; don't "fix" these by rewriting queries.
  - `src/routes/api/public/wapi-webhook.ts` (6): `phone = resolved` (line 344) reassigns the `const phone` destructured in `handlePost` (line 220), plus insert calls hitting the same stale `types.ts`.

## Package Manager

Bun only — `bun.lock` + `bunfig.toml` are authoritative (Dockerfile runs `bun install`). `bunfig.toml` enforces `minimumReleaseAge = 86400` (24h supply-chain guard). If a new package fails to install, add it to `minimumReleaseAgeExcludes` — confirm with user first. Currently excludes: `@lovable.dev/vite-tanstack-config`, `@lovable.dev/mcp-js`.

A tracked `package-lock.json` also exists: never run `npm install` locally (it would drift from `bun.lock`), but don't delete it either — Netlify builds run `npm run build` against it (`netlify.toml`).

## Vite Config — Do Not Duplicate Plugins

`vite.config.ts:7` imports `defineConfig` from `@lovable.dev/vite-tanstack-config` which already bundles `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro`, `componentTagger`, `VITE_*` injection, `@` alias, and dedupe. Adding any of those manually breaks the build. Only extend via `defineConfig({ vite: {...} })`.

- `tanstackStart.server.entry = "server"` redirects to `src/server.ts` (SSR error wrapper).
- `nitro.preset` — `netlify` quando `NETLIFY=true` (build na Netlify; gera `dist/` + `.netlify/functions-internal/`), senão `node-server` (EasyPanel/Docker, `node .output/server/index.mjs` na porta 3000 — `Dockerfile:49`).

## Routing

File-based in `src/routes/` (see `src/routes/README.md:1`).

- `__root.tsx` — app shell, must preserve `<Outlet />`
- `_authenticated/route.tsx` — auth gate (`supabase.auth.getUser()` + `ssr: false`, `route.tsx:33-35`), all CRM routes are children; also runs a URL-access guard (`canAccess`/`firstAllowedUrl`) with a 10s org-context cache
- `api/public/*` — unauthenticated by design: webhooks (Asaas, MercadoPago, WAPI, Autentique, import), crons (SMS/followup/contracts), public media/TTS token routes. Do not add auth middleware.
- Dynamic params use bare `$` (`$id.tsx`, `$token.tsx`, `api/public/media/$mediaId.ts`), not `:id` or `{id}`
- `routeTree.gen.ts` — auto-generated, never edit (also in `.prettierignore`)
- `wapi-webhook.t` (`.t`, not `.ts`) is a stale 1699-line duplicate of `wapi-webhook.ts` (1867 lines) — not a route, ignore it

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
- **Projeto Supabase único:** `tweoiunfpawwwyzezlax` — `supabase/config.toml`, `.env`, `client.server.ts:9` e `EASYPANEL.md` usam o mesmo ref/URL. Keys em formato JWT antigo (`eyJ...` anon/service_role). Migrations em `supabase/migrations/`; schema consolidado em `supabase/full-schema.sql`. **Migrations `20261105120000_whatsapp_campaigns` e `20261106100000_team_access_permissions` ainda NÃO aplicadas neste projeto (07/11/2026).**

## Server-Only Code

ESLint (`eslint.config.js:23`) bans `import "server-only"`. Use file suffix instead:

- `*.server.ts` — never bundled to client (admin clients, secrets, `src/lib/config.server.ts`)
- `*.functions.ts` — `createServerFn` handlers, **are** bundled to client (keep secrets out, use dynamic import above)
- Plain `*.ts` — client-safe

The `src/lib/` directory follows this split (~15 `*.server.ts`, ~19 `*.functions.ts`: `wapi`, `media`, `ai-gateway`, `contracts-pdf`, `whatsapp-campaigns`, etc.).

## Env Variables

- `VITE_*` — public, via `import.meta.env`, ships to browser
- Unprefixed — server-only, via `process.env` **inside** functions/handlers only
- Never read `process.env` at module scope in `*.server.ts` — wrap in a function (`src/lib/config.server.ts:19`)
- Local dev needs a gitignored `.env` with `VITE_SUPABASE_*` (full set in `EASYPANEL.md`); without it the Supabase client throws at runtime (`client.ts:11`)

## SSR Error Handling

- `src/server.ts:23` — catches h3-swallowed 500s (`{"unhandled":true}`) and renders `renderErrorPage()`
- `src/start.ts:6` — request middleware that skips `/lovable/` paths; do not remove either layer

## Aliases & UI

- `@/*` → `./src/*` (`tsconfig.json:23`, `components.json:14`)
- shadcn aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`; style `new-york`, CSS `src/styles.css`, baseColor slate

## Deploy

EasyPanel auto-deploys on push to **`master`** per `EASYPANEL.md` — but active development is pushed to **`main`** (`origin/HEAD` → `main`; `main` is 21 commits ahead of `master` when last verified). Confirm which branch should receive the push before relying on auto-deploy. `Dockerfile:1` — multi-stage `node:22-alpine` + `bun@1.1` build, copies `.output` + `node_modules` to runtime. Requires `VITE_SUPABASE_*` / `SUPABASE_*` build args. See `EASYPANEL.md` for full config.

**Netlify** (alternativa via `netlify.toml`): build `npm run build` → preset trocado por `NETLIFY=true`; publish `dist/` (NUNCA `.output/` — o preset netlify gera `dist/`, não `.output/public`). Exige `NODE_VERSION=22` e as env vars `VITE_SUPABASE_*` (build) + `SUPABASE_*`/secrets (functions) na UI da Netlify.

## Root Scripts & Scratch Files (ad-hoc)

- `test-chat.ps1` / `test-flow.ps1` — POST to the **production** webhook (`crmlexia.com.br/...wapi-webhook?secret=...`). Running them sends real messages; don't run casually.
- `test-chat-local.ps1` / `test-flow-local.ps1` — same tests against `http://localhost:8080` (requires `bun run dev`); safe to run. Currently untracked.
- `reset-kanban.sql` — destructive, meant for manual execution in the Supabase SQL Editor.
- `pending-20261105.sql` (untracked) — RLS policy scratch for `chat_assignments`; sits outside `supabase/migrations/`, so it is never auto-applied.
