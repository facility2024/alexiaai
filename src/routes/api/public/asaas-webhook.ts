import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, asaas-access-token",
  "Content-Type": "application/json",
};

// Asaas envia o token configurado no painel via header `asaas-access-token`.
export const Route = createFileRoute("/api/public/asaas-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const expected = process.env.ASAAS_WEBHOOK_TOKEN;
        if (!expected) return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers: cors });
        const got = request.headers.get("asaas-access-token");
        if (got !== expected) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: cors });

        const raw = await request.text();
        let body: {
          event?: string;
          payment?: {
            id?: string; status?: string; value?: number; netValue?: number;
            billingType?: string; dueDate?: string; paymentDate?: string;
            invoiceUrl?: string; bankSlipUrl?: string;
            externalReference?: string;
          };
        };
        try { body = JSON.parse(raw); }
        catch { return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: cors }); }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("payment_webhook_events").insert({
          gateway: "asaas", event_type: body.event ?? null,
          external_id: body.payment?.id ?? null, payload: body as never,
        });

        const p = body.payment;
        if (p?.id) {
          const statusMap: Record<string, string> = {
            PAYMENT_CREATED: "pending", PAYMENT_CONFIRMED: "confirmed",
            PAYMENT_RECEIVED: "paid", PAYMENT_OVERDUE: "overdue",
            PAYMENT_REFUNDED: "refunded", PAYMENT_DELETED: "cancelled",
          };
          const status = statusMap[body.event ?? ""] ?? p.status?.toLowerCase() ?? "pending";
          const { error } = await supabaseAdmin.from("billings").update({
            status,
            paid_at: p.paymentDate ? new Date(p.paymentDate).toISOString() : null,
            invoice_url: p.invoiceUrl ?? null,
            bank_slip_url: p.bankSlipUrl ?? null,
            raw: body as never,
          }).eq("gateway", "asaas").eq("external_id", p.id);
          if (error) {
            await supabaseAdmin.from("payment_webhook_events")
              .update({ error: error.message })
              .eq("external_id", p.id).eq("gateway", "asaas");
          } else {
            await supabaseAdmin.from("payment_webhook_events")
              .update({ processed: true })
              .eq("external_id", p.id).eq("gateway", "asaas");
          }
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      },
    },
  },
});
