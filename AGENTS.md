# AGENTS.md

## Stack

TanStack Start + React 19 + Vite 7 + Tailwind CSS 4 + Supabase + shadcn/ui `new-york`. TypeScript strict. UI in pt-BR.

## Commands

```bash
bun run dev          # vite dev
bun run build        # vite build -> .output/ (Nitro node-server) — primary verification gate
bun run build:dev    # vite build --mode development
bun run preview      # vite preview
bun run lint         # eslint . (includes prettier rules via eslint-plugin-prettier)
bun run format       # prettier --write .  (100 chars, double quotes, semicolons)
```

No `typecheck` script, no test suite, no CI, no pre-commit hooks. Verify with `bun run build` (~20s, passes). **Baseline is not clean:**

- `bun run lint` fails out of the box: ~10k pre-existing prettier errors across ~107 files (mostly auto-fixable). Don't mass-fix or run `bun run format` repo-wide in an unrelated change — scope to files you touch (`bunx prettier --write <file>`, `bunx eslint <file>`).
- `bunx tsc --noEmit` fails with 1 pre-existing error: `wapi-webhook.ts` reassigns `phone` that `handlePost` destructures as `const` (~line 326). A red lint/tsc at baseline is not your fault.

## Package Manager

Bun only — `bun.lock` + `bunfig.toml` are authoritative (Dockerfile runs `bun install`). A tracked `package-lock.json` also exists; ignore it, don't run `npm install`. `bunfig.toml` enforces `minimumReleaseAge = 86400` (24h supply-chain guard). If a new package fails to install, add it to `minimumReleaseAgeExcludes` — confirm with user first. Currently excludes: `@lovable.dev/vite-tanstack-config`, `@lovable.dev/mcp-js`.

## Vite Config — Do Not Duplicate Plugins

`vite.config.ts:7` imports `defineConfig` from `@lovable.dev/vite-tanstack-config` which already bundles `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro`, `componentTagger`, `VITE_*` injection, `@` alias, and dedupe. Adding any of those manually breaks the build. Only extend via `defineConfig({ vite: {...} })`.

- `tanstackStart.server.entry = "server"` redirects to `src/server.ts` (SSR error wrapper).
- `nitro.preset` — `netlify` quando `NETLIFY=true` (build na Netlify; gera `dist/` + `.netlify/functions-internal/`), senão `node-server` (EasyPanel/Docker, `node .output/server/index.mjs` na porta 3000 — `Dockerfile:49`).

## Routing

File-based in `src/routes/` (see `src/routes/README.md:1`).

- `__root.tsx` — app shell, must preserve `<Outlet />`
- `_authenticated/route.tsx` — auth gate (`supabase.auth.getUser()` + `ssr: false`), all CRM routes are children
- `api/public/*` — unauthenticated webhook/cron handlers (Asaas, MercadoPago, WAPI, Autentique, SMS/followup/contracts crons) — do not add auth middleware
- Dynamic params use bare `$` (`$id.tsx`, `$token.tsx`), not `:id` or `{id}`
- `routeTree.gen.ts` — auto-generated, never edit
- `wapi-webhook.t` (`.t`, not `.ts`) is a stale duplicate of `wapi-webhook.ts` — not a route, ignore it

## Supabase — Two Clients

`src/integrations/supabase/` — all files auto-generated, do not edit:

| File | Usage | Secret |
|------|-------|--------|
| `client.ts` | Browser/SSR, lazy proxy, user RLS | `VITE_SUPABASE_*` |
| `client.server.ts` | Admin, bypasses RLS | `SUPABASE_SERVICE_ROLE_KEY` |

- **Never** static-import `client.server.ts` from a route or `*.functions.ts` — those ship to the client bundle. Dynamic-import inside handler: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")` (`client.server.ts:35`).
- `requireSupabaseAuth` (`auth-middleware.ts:9`) — attach per-function via `.middleware([requireSupabaseAuth])` on `createServerFn`; validates `Bearer` token, injects `{ supabase, userId, claims }`.
- `attachSupabaseAuth` (`auth-attacher.ts:7`) — global `functionMiddleware` in `src/start.ts:27`; without it browser RPCs send no token.
- **Projeto Supabase único (desde 03/11/2026):** `axqtambeoioknqqpexol` — `supabase/config.toml`, `.env`, `client.server.ts:9` e `EASYPANEL.md` usam o mesmo ref/URL. Keys no formato novo `sb_publishable_*` / `sb_secret_*`. Migrations em `supabase/migrations/`; schema consolidado p/ projeto novo em `supabase/full-schema.sql`.

## Server-Only Code

ESLint (`eslint.config.js:23`) bans `import "server-only"`. Use file suffix instead:

- `*.server.ts` — never bundled to client (admin clients, secrets, `src/lib/config.server.ts`)
- `*.functions.ts` — `createServerFn` handlers, **are** bundled to client (keep secrets out, use dynamic import above)
- Plain `*.ts` — client-safe

`src/lib/*.server.ts` (14 files: `wapi`, `media`, `ai-gateway`, `contracts-pdf`, etc.) and `src/lib/*.functions.ts` (18 files) follow this split.

## Env Variables

- `VITE_*` — public, via `import.meta.env`, ships to browser
- Unprefixed — server-only, via `process.env` **inside** functions/handlers only
- Never read `process.env` at module scope in `*.server.ts` — wrap in a function (`src/lib/config.server.ts:19`)
- Local dev needs a gitignored `.env` with `VITE_SUPABASE_*` (full set in `EASYPANEL.md`); without it the Supabase client throws at runtime

## SSR Error Handling

- `src/server.ts:23` — catches h3-swallowed 500s (`{"unhandled":true}`) and renders `renderErrorPage()`
- `src/start.ts:6` — request middleware that skips `/lovable/` paths; do not remove either layer

## Aliases & UI

- `@/*` → `./src/*` (`tsconfig.json:23`, `components.json:14`)
- shadcn aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`; style `new-york`, CSS `src/styles.css`
- Icons `lucide-react`, DnD `@dnd-kit`, email `@react-email/*`

## Deploy

EasyPanel auto-deploys on push to **`master`** per `EASYPANEL.md` — but active development is pushed to **`main`** (`origin/main` is currently ahead of `origin/master`). Confirm which branch should receive the push before relying on auto-deploy. `Dockerfile:1` — multi-stage `node:22-alpine` + `bun@1.1` build, copies `.output` + `node_modules` to runtime. Requires `VITE_SUPABASE_*` / `SUPABASE_*` build args. See `EASYPANEL.md` for full config.

**Netlify** (alternativa via `netlify.toml`): build `npm run build` → preset trocado por `NETLIFY=true`; publish `dist/` (NUNCA `.output/` — o preset netlify gera `dist/`, não `.output/public`). Exige `NODE_VERSION=22` e as env vars `VITE_SUPABASE_*` (build) + `SUPABASE_*`/secrets (functions) na UI da Netlify.

## Root Scripts (ad-hoc)

- `test-chat.ps1` / `test-flow.ps1` — POST to the **production** webhook (`crmlexia.com.br/...wapi-webhook?secret=...`). Running them sends real messages; don't run casually.
- `reset-kanban.sql` — destructive, meant for manual execution in the Supabase SQL Editor.
