# AGENTS.md

## Stack

TanStack Start + React 19 + Vite 7 + Tailwind CSS 4 + Supabase + shadcn/ui `new-york`. TypeScript strict. UI in pt-BR.

## Commands

```bash
bun run dev          # vite dev
bun run build        # vite build -> .output/ (Nitro node-server)
bun run build:dev    # vite build --mode development
bun run preview      # vite preview
bun run lint         # eslint .
bun run format       # prettier --write .  (100 chars, double quotes, semicolons)
```

No `typecheck` or `test` scripts. `tsc --noEmit` works via `tsconfig.json` if needed. Verify with `bun run lint` + `bun run build`.

## Package Manager

Bun only (`bun.lock`). `bunfig.toml` enforces `minimumReleaseAge = 86400` (24h supply-chain guard). If a new package fails to install, add it to `minimumReleaseAgeExcludes` — confirm with user first. Currently excludes: `@lovable.dev/vite-tanstack-config`, `@lovable.dev/mcp-js`.

## Vite Config — Do Not Duplicate Plugins

`vite.config.ts:8` uses `defineConfig` from `@lovable.dev/vite-tanstack-config` which already bundles `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro`, `componentTagger`, `VITE_*` injection, `@` alias, and dedupe. Adding any of those manually breaks the build. Only extend via `defineConfig({ vite: {...} })`.

- `tanstackStart.server.entry = "server"` redirects to `src/server.ts` (SSR error wrapper).
- `nitro.preset = "node-server"`, runtime `node .output/server/index.mjs` on port 3000 (`Dockerfile:31`).

## Routing

File-based in `src/routes/` (see `src/routes/README.md:1`).

- `__root.tsx` — app shell, must preserve `<Outlet />`
- `_authenticated/route.tsx` — auth gate (`supabase.auth.getUser()` + `ssr: false`), all CRM routes are children
- `api/public/*` — unauthenticated webhook/cron handlers (Asaas, MercadoPago, WAPI, Autentique, SMS/followup crons) — do not add auth middleware
- Dynamic params use bare `$` (`$id.tsx`, `$token.tsx`), not `:id` or `{id}`
- `routeTree.gen.ts` — auto-generated, never edit

## Supabase — Two Clients

`src/integrations/supabase/` — all files auto-generated, do not edit:

| File | Usage | Secret |
|------|-------|--------|
| `client.ts` | Browser/SSR, lazy proxy, user RLS | `VITE_SUPABASE_*` |
| `client.server.ts` | Admin, bypasses RLS | `SUPABASE_SERVICE_ROLE_KEY` |

- **Never** static-import `client.server.ts` from a route or `*.functions.ts` — those ship to the client bundle. Dynamic-import inside handler: `const { supabaseAdmin } = await import("@/integrations/supabase/client.server")` (`client.server.ts:35`).
- `requireSupabaseAuth` (`auth-middleware.ts:9`) — attach to `createServerFn` that needs user; validates `Bearer` token, injects `{ supabase, userId, claims }`.
- `attachSupabaseAuth` (`auth-attacher.ts:7`) — global `functionMiddleware` in `src/start.ts:27`; without it browser RPCs send no token.
- Project ID `kicyouhseqkpyywpkpbp`, migrations in `supabase/migrations/`.

## Server-Only Code

ESLint (`eslint.config.js:23`) bans `import "server-only"`. Use file suffix instead:

- `*.server.ts` — never bundled to client (admin clients, secrets, `src/lib/config.server.ts`)
- `*.functions.ts` — `createServerFn` handlers, **are** bundled to client (keep secrets out, use dynamic import above)
- Plain `*.ts` — client-safe

`src/lib/*.server.ts` (15 files: `wapi`, `media`, `ai-gateway`, `contracts-pdf`, etc.) and `src/lib/*.functions.ts` (19 files) follow this split.

## Env Variables

- `VITE_*` — public, via `import.meta.env`, ships to browser
- Unprefixed — server-only, via `process.env` **inside** functions/handlers only
- Never read `process.env` at module scope in `*.server.ts` — Cloudflare Workers bind env at request time, so wrap in a function (`src/lib/config.server.ts:19`)

## SSR Error Handling

- `src/server.ts:23` — catches h3-swallowed 500s (`{"unhandled":true}`) and renders `renderErrorPage()`
- `src/start.ts:6` — request middleware that skips `/lovable/` paths; do not remove either layer

## Aliases & UI

- `@/*` → `./src/*` (`tsconfig.json:23`, `components.json:14`)
- shadcn aliases: `@/components`, `@/components/ui`, `@/lib/utils`, `@/hooks`; style `new-york`, CSS `src/styles.css`
- Icons `lucide-react`, DnD `@dnd-kit`, email `@react-email/*`

## Docker

Multi-stage `Dockerfile:1` — `node:22.12-alpine` + `bun@1.1` for build, copies `.output` + `node_modules` to runtime. Requires `VITE_SUPABASE_*` / `SUPABASE_*` build args. `Dokerfile` (typo) is stale — ignore.
