// Cron público: (1) marca clientes inativos há N dias como "queued" para follow-up,
// (2) dispara SMS aos "queued" no horário do template ativo.
// Executa a cada 5 min. Autenticado por apikey (anon) no header.
// Nota: clients não é escopada por user_id; usamos crm_messages (que tem user_id)
// para correlacionar cada cliente ao dono da conversa.
import { createFileRoute } from "@tanstack/react-router";
import { sendSmsForUser } from "@/lib/sms-send.server";

export const Route = createFileRoute("/api/public/followup-cron")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();

        const { data: templates } = await supabaseAdmin
          .from("sms_followup_templates")
          .select("id, user_id, name, message, send_hour, send_minute, days_after_inactivity")
          .eq("active", true);
        if (!templates?.length) {
          return Response.json({ ok: true, queued: 0, sent: 0, hint: "sem templates ativos" });
        }

        let queued = 0;
        let sent = 0;
        const errors: string[] = [];

        for (const tpl of templates) {
          const cutoff = new Date(now.getTime() - tpl.days_after_inactivity * 24 * 60 * 60 * 1000).toISOString();

          const { data: candidates } = await supabaseAdmin
            .from("clients")
            .select("id, phone")
            .eq("is_complete", false)
            .eq("followup_status", "none")
            .not("phone", "is", null)
            .limit(500);

          for (const c of candidates ?? []) {
            const { data: lastMsg } = await supabaseAdmin
              .from("crm_messages")
              .select("created_at")
              .eq("user_id", tpl.user_id)
              .eq("chat_id", c.phone!)
              .order("created_at", { ascending: false })
              .limit(1).maybeSingle();
            if (!lastMsg) continue;
            if (lastMsg.created_at > cutoff) continue;
            await supabaseAdmin.from("clients").update({
              followup_status: "queued",
              followup_queued_at: now.toISOString(),
            }).eq("id", c.id);
            queued++;
          }

          const isHour = now.getUTCHours() === tpl.send_hour;
          const minuteDiff = Math.abs(now.getUTCMinutes() - tpl.send_minute);
          if (!isHour || minuteDiff > 4) continue;

          const { data: queue } = await supabaseAdmin
            .from("clients")
            .select("id, phone, full_name")
            .eq("followup_status", "queued")
            .not("phone", "is", null)
            .limit(200);

          for (const c of queue ?? []) {
            // Confirma que este cliente pertence à conversa deste usuário
            const { data: hasChat } = await supabaseAdmin
              .from("crm_messages")
              .select("id")
              .eq("user_id", tpl.user_id)
              .eq("chat_id", c.phone!)
              .limit(1).maybeSingle();
            if (!hasChat) continue;

            try {
              const firstName = (c.full_name ?? "").trim().split(/\s+/)[0] ?? "";
              const msg = tpl.message.replace(/\{nome\}/gi, firstName);
              await sendSmsForUser(supabaseAdmin, {
                user_id: tpl.user_id, to: c.phone!, message: msg,
              });
              await supabaseAdmin.from("clients").update({
                followup_status: "sent",
              }).eq("id", c.id);
              sent++;
            } catch (e) {
              errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        return Response.json({ ok: true, queued, sent, errors: errors.slice(0, 10) });
      },
      GET: async () => Response.json({ ok: true, hint: "POST para processar" }),
    },
  },
});
