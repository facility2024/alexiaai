// Cron público: envia lembretes automáticos (24h/48h/72h) para signatários
// pendentes de contratos enviados via Autentique. Roda a cada 15 min.
// Autenticado por apikey (anon) no header pelo pg_cron.
import { createFileRoute } from "@tanstack/react-router";

const LEVELS: Array<{ level: 1 | 2 | 3; hours: number }> = [
  { level: 1, hours: 24 },
  { level: 2, hours: 48 },
  { level: 3, hours: 72 },
];

export const Route = createFileRoute("/api/public/contracts-reminders-cron")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { autentiqueResendSignatures } = await import("@/lib/autentique.server");

        const now = Date.now();
        let processed = 0;
        let reminded = 0;
        const errors: string[] = [];

        const { data: contracts, error } = await supabaseAdmin
          .from("contracts")
          .select("id, owner_id, autentique_document_id, sent_at, status, contract_signers(autentique_signer_id, status)")
          .eq("status", "sent")
          .not("autentique_document_id", "is", null)
          .not("sent_at", "is", null)
          .limit(500);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        for (const c of contracts ?? []) {
          processed++;
          const sentAt = c.sent_at ? new Date(c.sent_at).getTime() : 0;
          const ageHours = (now - sentAt) / (1000 * 60 * 60);

          // Nível máximo aplicável agora
          const applicable = LEVELS.filter((l) => ageHours >= l.hours);
          if (applicable.length === 0) continue;
          const target = applicable[applicable.length - 1];

          // Já enviou este nível?
          const { data: existing } = await supabaseAdmin
            .from("contract_reminders")
            .select("id")
            .eq("contract_id", c.id)
            .eq("level", target.level)
            .maybeSingle();
          if (existing) continue;

          const signers = ((c.contract_signers ?? []) as Array<{ autentique_signer_id: string | null; status: string }>);
          const pending = signers
            .filter((s) => s.status !== "signed" && !!s.autentique_signer_id)
            .map((s) => s.autentique_signer_id as string);
          if (pending.length === 0) continue;

          try {
            await autentiqueResendSignatures(c.autentique_document_id as string, pending);
            await supabaseAdmin.from("contract_reminders").insert({
              contract_id: c.id,
              level: target.level,
              channel: "email",
            });
            await supabaseAdmin.from("contract_events").insert({
              contract_id: c.id,
              event_type: "reminder_sent",
              payload: { level: target.level, hours: target.hours, signers: pending.length },
            });
            reminded++;
          } catch (e) {
            errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        return Response.json({ ok: true, processed, reminded, errors: errors.slice(0, 10) });
      },
      GET: async () => Response.json({ ok: true, hint: "POST para processar lembretes" }),
    },
  },
});
