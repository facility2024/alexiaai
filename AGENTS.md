# AGENTS.md

## Stack

TanStack Start + React 19 + Vite 7 + Tailwind CSS 4 + Supabase + shadcn/ui (new-york). TypeScript strict. Portuguese (pt-BR) UI.

## Commands

```bash
bun run dev          # Vite dev server
bun run build        # Production build (outputs to .output/)
bun run lint         # ESLint
bun run format       # Prettier --write .
```

No typecheck script exists; TypeScript strict mode is enforced via tsconfig but there's no standalone `tsc --noEmit` command wired up.

## Package Manager

Bun. `bun.lock` is the lockfile. `bunfig.toml` enforces a 24h minimum release age for supply-chain safety. If a fresh install fails on a new package, add it to `minimumReleaseAgeExcludes` in `bunfig.toml` (confirm with user first).

## Server-Only Code Convention

**Do NOT use `import "server-only"`.** ESLint forbids it. TanStack Start uses the `.server.ts` file suffix to exclude code from the client bundle.

- `*.server.ts` — server-only modules (config, integrations, admin clients)
- `*.functions.ts` — TanStack Start server functions (`createServerFn`)
- Client-safe code has no `.server.ts` suffix

The `.server.ts` suffix is the only reliable way to keep secrets out of the browser bundle. Route files and `*.functions.ts` are bundled for the client.

## Supabase

Two clients in `src/integrations/supabase/`:

| File | Purpose | Auth |
|------|---------|------|
| `client.ts` | Browser/SSR client (lazy proxy) | User session via `VITE_SUPABASE_*` env vars |
| `client.server.ts` | Admin client (bypasses RLS) | Service role key via `SUPABASE_SERVICE_ROLE_KEY` |

**Loading `client.server.ts`**: Use dynamic import inside handlers to avoid bundling the service role key into client code:
```ts
const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
```

**Auth middleware** (`requireSupabaseAuth`): Apply to server functions that need the logged-in user. It validates the Bearer token and injects `{ userId, supabase }` into context.

**Auth attacher** (`attachSupabaseAuth`): Registered as global `functionMiddleware` in `src/start.ts`. Without it, browser RPCs won't send the Bearer token.

Auto-generated files (`client.ts`, `client.server.ts`, `auth-attacher.ts`, `auth-middleware.ts`, `types.ts`) — do not edit directly.

## Routing

File-based in `src/routes/`. See `src/routes/README.md` for conventions.

- `__root.tsx` — app shell, preserves `<Outlet />`
- `_authenticated/` — protected routes (27 routes for CRM features)
- `routeTree.gen.ts` — auto-generated, do not edit
- Dynamic params use bare `$` (e.g., `$id.tsx`), not `:id`

## Vite Config

Uses `@lovable.dev/vite-tanstack-config`. **Do NOT manually add plugins** — the config bundle already includes tanstackStart, React, Tailwind, tsConfigPaths, Nitro, componentTagger, env injection, path aliases, and deduplication. Adding duplicates will break the build.

Nitro preset is `node-server`. Server entry is redirected to `src/server.ts`.

## Environment Variables

- `VITE_*` prefix: public, shipped to browser via `import.meta.env`
- No prefix: server-only, read via `process.env` inside handlers or `.server.ts` files
- Never use `process.env` at module scope in `.server.ts` — read inside functions (Cloudflare Workers bind env at request time)

## SSR Error Handling

`src/server.ts` wraps the TanStack Start server entry. It catches h3-swallowed SSR errors (status 500 + `{"unhandled":true}`) and renders a user-facing error page. `src/start.ts` adds a request-level error middleware that skips `/lovable/` paths.

## UI Components

shadcn/ui with `new-york` style. Path aliases from `components.json`:
- `@/components` — components
- `@/components/ui` — UI primitives
- `@/lib/utils` — utility functions (cn, etc.)
- `@/hooks` — custom hooks

Icons: `lucide-react`. Drag-and-drop: `@dnd-kit`.

## Formatting

Prettier: 100 char width, semicolons, double quotes, trailing commas.

## Database

Supabase migrations in `supabase/migrations/`. Project ID: `kicyouhseqkpyywpkpbp`.

## Docker

Multi-stage: Bun 1.1 for build, Node 22 Alpine for runtime. Production server runs on port 3000 via `node --env-file=.env .output/server/index.mjs`.
