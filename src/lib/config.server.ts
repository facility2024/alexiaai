import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Add server-only values here, e.g.:
    //   databaseUrl: process.env.DATABASE_URL,
    //   stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  };
}

export function getPublicAppUrl() {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    "https://voluble-ganache-7bd240.netlify.app",
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;

    try {
      const url = new URL(value.startsWith("http") ? value : `https://${value}`);
      if (url.protocol === "https:" && !/localhost|127\.0\.0\.1/i.test(url.hostname)) {
        return url.origin;
      }
    } catch {
      continue;
    }
  }

  throw new Error("URL pública do aplicativo não configurada.");
}
