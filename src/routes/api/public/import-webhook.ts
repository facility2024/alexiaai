import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Signature, X-User-Id",
  "Content-Type": "application/json",
};

const PayloadSchema = z.object({
  user_id: z.string().uuid(),
  source: z.string().min(1).max(80),
  type: z.enum(["lead", "cliente", "caso", "mensagem"]),
  data: z.record(z.string(), z.unknown()),
});

function verifySig(body: string, sig: string | null, secret: string): boolean {
  if (!sig) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export const Route = createFileRoute("/api/public/import-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const secret = process.env.IMPORT_WEBHOOK_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers: cors });
        }
        const raw = await request.text();
        if (!verifySig(raw, request.headers.get("x-signature"), secret)) {
          return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401, headers: cors });
        }
        let parsed;
        try { parsed = PayloadSchema.parse(JSON.parse(raw)); }
        catch (e) {
          return new Response(JSON.stringify({ error: "bad_payload", detail: String(e) }), { status: 400, headers: cors });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: evt, error: insErr } = await supabaseAdmin
          .from("import_events")
          .insert({
            user_id: parsed.user_id,
            source: parsed.source,
            event_type: parsed.type,
            status: "pending",
            payload: parsed.data as never,
          })
          .select("id").single();
        if (insErr) {
          return new Response(JSON.stringify({ error: insErr.message }), { status: 500, headers: cors });
        }

        // Process async — return 202 immediately
        (async () => {
          try {
            let result: unknown = null;
            const d = parsed.data as Record<string, string>;
            if (parsed.type === "lead" || parsed.type === "cliente" || parsed.type === "caso") {
              // Cria um card na primeira coluna do funil do usuário
              const { data: col } = await supabaseAdmin.from("kanban_columns")
                .select("id").eq("user_id", parsed.user_id)
                .order("position").limit(1).maybeSingle();
              if (!col) throw new Error("Usuário sem colunas do Kanban configuradas");
              const contactName = d.name ?? d.full_name ?? d.title ?? "Importado";
              const chatId = d.phone ?? d.whatsapp ?? d.email ?? `import-${Date.now()}`;
              const { data: card, error } = await supabaseAdmin.from("kanban_cards").insert({
                user_id: parsed.user_id,
                column_id: col.id,
                chat_id: chatId,
                contact_name: contactName,
                contact_phone: d.phone ?? d.whatsapp ?? null,
                summary: d.description ?? d.summary ?? `Importado de ${parsed.source}`,
              }).select("id").single();
              if (error) throw error;
              result = { card_id: card.id, kind: parsed.type };
            } else if (parsed.type === "mensagem") {
              const { data: msg, error } = await supabaseAdmin.from("crm_messages").insert({
                user_id: parsed.user_id,
                chat_id: d.chat_id ?? d.phone ?? "unknown",
                direction: (d.direction === "outbound" ? "outbound" : "inbound"),
                sender: d.sender ?? "importado",
                content: d.content ?? d.message ?? "",
                message_type: "text",
                status: "received",
              }).select("id").single();
              if (error) throw error;
              result = { message_id: msg.id };
            }
            await supabaseAdmin.from("import_events").update({
              status: "processed", result: result as never, processed_at: new Date().toISOString(),
            }).eq("id", evt.id);
          } catch (e) {
            await supabaseAdmin.from("import_events").update({
              status: "failed", error: String(e), processed_at: new Date().toISOString(),
            }).eq("id", evt.id);
          }
        })();

        return new Response(JSON.stringify({ ok: true, id: evt.id, status: "accepted" }), {
          status: 202, headers: cors,
        });
      },
    },
  },
});
