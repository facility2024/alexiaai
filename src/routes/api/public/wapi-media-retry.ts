import { createFileRoute } from "@tanstack/react-router";
import { processPendingMediaRow } from "@/lib/wapi-media.server";

function timingSafeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function handle(request: Request) {
  const expected = process.env.WAPI_WEBHOOK_SECRET;
  if (!expected) return new Response("Missing WAPI_WEBHOOK_SECRET", { status: 500 });

  const url = new URL(request.url);
  let provided = url.searchParams.get("secret") ?? request.headers.get("x-webhook-secret") ?? "";
  if (!provided && request.method === "POST") {
    try {
      const body: any = await request.clone().json();
      if (body?.secret) provided = String(body.secret);
    } catch { /* ignore */ }
  }
  const authorization = request.headers.get("authorization") ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const serviceAuthorized = serviceRole.length > 0 && timingSafeEq(authorization, `Bearer ${serviceRole}`);
  if (!timingSafeEq(provided, expected) && !serviceAuthorized) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await supabaseAdmin
    .from("crm_messages")
    .select("id, user_id, chat_id, media_attempts, media_status, raw, wapi_message_id")
    .in("media_status", ["pending", "failed_retry"])
    .or(`media_next_retry_at.is.null,media_next_retry_at.lte.${nowIso}`)
    .order("media_next_retry_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (error) {
    console.error("[wapi-media-retry] query error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let processed = 0;
  for (const row of rows ?? []) {
    try {
      await processPendingMediaRow(supabaseAdmin, row);
      processed++;
    } catch (e: any) {
      console.error("[wapi-media-retry] process error:", e?.message ?? e);
    }
  }

  return Response.json({ ok: true, processed, total: rows?.length ?? 0 });
}

export const Route = createFileRoute("/api/public/wapi-media-retry")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
