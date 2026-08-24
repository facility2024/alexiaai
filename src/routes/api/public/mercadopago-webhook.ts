import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Signature, X-Request-Id",
  "Content-Type": "application/json",
};

// Mercado Pago envia headers `x-signature` (ts=..,v1=..) e `x-request-id`.
// Assinatura HMAC-SHA256 sobre: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
function verifyMpSignature(dataId: string, reqId: string, sigHeader: string | null, secret: string): boolean {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map(kv => kv.trim().split("=")));
  const ts = parts.ts; const v1 = parts.v1;
  if (!ts || !v1) return false;
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(v1); const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export const Route = createFileRoute("/api/public/mercadopago-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
        if (!secret) return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers: cors });

        const raw = await request.text();
        let body: { action?: string; type?: string; data?: { id?: string } };
        try { body = JSON.parse(raw); }
        catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: cors }); }

        const dataId = body.data?.id ?? "";
        const reqId = request.headers.get("x-request-id") ?? "";
        const sig = request.headers.get("x-signature");
        if (!verifyMpSignature(dataId, reqId, sig, secret)) {
          return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401, headers: cors });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("payment_webhook_events").insert({
          gateway: "mercadopago", event_type: body.action ?? body.type ?? null,
          external_id: dataId || null, payload: body as never,
        });

        // Atualiza billing se já existe registro (a criação vem da server function createMpCharge)
        if (dataId) {
          const { data: b } = await supabaseAdmin.from("billings")
            .select("id").eq("gateway", "mercadopago").eq("external_id", dataId).maybeSingle();
          if (b) {
            const status = body.action === "payment.updated" ? "confirmed" : "pending";
            await supabaseAdmin.from("billings").update({
              status, raw: body as never,
            }).eq("id", b.id);
          }
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      },
    },
  },
});
