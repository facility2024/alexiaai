// Cron público: dispara SMS de follow-ups agendados cujo horário já chegou.
// Chamado por pg_cron a cada minuto. Autenticado por apikey (anon).
import { createFileRoute } from "@tanstack/react-router";
import { sendSmsForUser } from "@/lib/sms-send.server";

export const Route = createFileRoute("/api/public/sms-cron")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: due, error } = await supabaseAdmin
          .from("client_sms_followups")
          .select("id, user_id, phone, message")
          .eq("status", "pending")
          .lte("scheduled_at", new Date().toISOString())
          .limit(50);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        for (const f of due ?? []) {
          try {
            const r = await sendSmsForUser(supabaseAdmin, {
              user_id: f.user_id,
              to: f.phone,
              message: f.message,
            });
            await supabaseAdmin.from("client_sms_followups").update({
              status: "sent",
              sent_at: new Date().toISOString(),
              provider: r.provider,
              error: null,
            }).eq("id", f.id);
            results.push({ id: f.id, ok: true });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await supabaseAdmin.from("client_sms_followups").update({
              status: "failed",
              error: msg.slice(0, 500),
            }).eq("id", f.id);
            results.push({ id: f.id, ok: false, error: msg });
          }
        }
        return Response.json({ ok: true, processed: results.length, results });
      },
      GET: async () => Response.json({ ok: true, hint: "POST para processar" }),
    },
  },
});
