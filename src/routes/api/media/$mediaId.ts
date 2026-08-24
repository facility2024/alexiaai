import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { bunnyGet, bunnySignedUrl } from "@/lib/bunny.server";

// Authenticated GET → 302 redirect to a short-lived signed Bunny CDN URL.
// Query: ?variant=full|thumb|preview
export const Route = createFileRoute("/api/media/$mediaId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Server not configured", { status: 500 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice(7);

        // RLS-scoped client (as the caller)
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
        if (claimsErr || !claims?.claims?.sub) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { data: asset, error } = await supabase
          .from("media_assets")
          .select("id, kind, mime, storage_path, thumbnail_path, status")
          .eq("id", params.mediaId)
          .maybeSingle();

        if (error) return new Response(error.message, { status: 500 });
        if (!asset) return new Response("Not found", { status: 404 });
        if (asset.status !== "ready" || !asset.storage_path) {
          return new Response("Not ready", { status: 409 });
        }

        const url = new URL(request.url);
        const variant = url.searchParams.get("variant") ?? "full";

        let path = asset.storage_path;
        if (variant === "thumb" || variant === "preview") {
          if (asset.thumbnail_path) {
            path = asset.thumbnail_path;
          }
        }

        // 302 → URL assinada da CDN (evita 502 do proxy/stream do worker).
        if (process.env.BUNNY_CDN_HOSTNAME && process.env.BUNNY_TOKEN_AUTH_KEY) {
          try {
            const signed = await bunnySignedUrl(path, { ttlSeconds: 600 });
            return new Response(null, {
              status: 302,
              headers: {
                location: signed,
                "cache-control": "private, max-age=300",
              },
            });
          } catch (e) {
            console.warn("[media] signed url failed, falling back to proxy", { err: String(e) });
          }
        }

        // Retry transientes (5xx / network / timeout) do storage externo.
        const MAX_ATTEMPTS = 3;
        const RETRY_DELAY_MS = 400;
        const ATTEMPT_TIMEOUT_MS = 8000;
        let upstream: Response | null = null;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
          try {
            const res = await bunnyGet(path, { signal: ctrl.signal });
            clearTimeout(timer);
            if (res.ok && res.body) {
              upstream = res;
              break;
            }
            const isTransient = res.status >= 500 || res.status === 408 || res.status === 429;
            if (!isTransient || attempt === MAX_ATTEMPTS) {
              const body = await res.text().catch(() => "");
              console.error("[media] upstream not ok", {
                attempt,
                status: res.status,
                path,
                body: body.slice(0, 300),
              });
              return new Response(`Upstream ${res.status}`, { status: 502 });
            }
            console.warn("[media] transient upstream, retrying", { attempt, status: res.status, path });
          } catch (e) {
            clearTimeout(timer);
            lastErr = e;
            console.warn("[media] fetch threw, retrying", { attempt, path, err: String(e) });
            if (attempt === MAX_ATTEMPTS) {
              console.error("[media] storage fetch failed after retries", { path, err: String(e) });
              return new Response("Upstream fetch failed", { status: 502 });
            }
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
        if (!upstream) {
          console.error("[media] no upstream after retries", { path, err: String(lastErr) });
          return new Response("Upstream fetch failed", { status: 502 });
        }
        const headers = new Headers();
        const ct = upstream.headers.get("content-type") ?? asset.mime ?? "application/octet-stream";
        headers.set("content-type", ct);
        const cl = upstream.headers.get("content-length");
        if (cl) headers.set("content-length", cl);
        headers.set("cache-control", "private, max-age=3600");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
