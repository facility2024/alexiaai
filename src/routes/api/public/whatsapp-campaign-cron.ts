// Cron público: (1) ativa campanhas WhatsApp "scheduled" cujo horário já chegou,
// (2) dirige as campanhas em execução (claim RPC protege contra duplo-envio;
//    o intervalo entre envios e o limite de 50/dia são aplicados no banco).
// Chamado por pg_cron a cada minuto. Sem autenticação: não aceita entrada do chamador.
import { createFileRoute } from "@tanstack/react-router";
import { processCampaignNext } from "@/lib/whatsapp-campaign-send";
import { filterBlockedLicenseOwners } from "@/lib/license-check";

export const Route = createFileRoute("/api/public/whatsapp-campaign-cron")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();

        const { data: due, error: dueError } = await supabaseAdmin
          .from("whatsapp_campaigns")
          .select("id, owner_id")
          .eq("status", "scheduled")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at")
          .limit(5);
        if (dueError) return Response.json({ ok: false, error: dueError.message }, { status: 500 });

        // Licenças SaaS: campanhas de empresas com licença bloqueada
        // (vencida/não iniciada/desativada) não ativam nem disparam envios.
        // cast: rows tipados por types.ts desatualizado (whatsapp_campaigns ausente)
        const blockedOwners = await filterBlockedLicenseOwners(
          supabaseAdmin,
          (due ?? []).map((c: any) => c.owner_id),
        );

        const activated: string[] = [];
        for (const campaign of due ?? []) {
          if (blockedOwners.has((campaign as any).owner_id)) continue;
          const { data: started, error: startError } = await supabaseAdmin
            .from("whatsapp_campaigns")
            .update({ status: "running", started_at: new Date().toISOString(), completed_at: null })
            .eq("id", campaign.id)
            .eq("status", "scheduled")
            .select("id")
            .maybeSingle();
          if (startError) {
            // 23505: dono já tem outra campanha em execução — tenta no próximo minuto.
            if (startError.code !== "23505")
              console.error("[wapi-campaign-cron]", startError.message);
            continue;
          }
          if (started) activated.push(started.id);
        }

        const { data: running, error: runningError } = await supabaseAdmin
          .from("whatsapp_campaigns")
          .select("id, owner_id")
          .eq("status", "running")
          .limit(10);
        if (runningError)
          return Response.json({ ok: false, error: runningError.message }, { status: 500 });
        for (const owner of await filterBlockedLicenseOwners(
          supabaseAdmin,
          (running ?? []).map((c: any) => c.owner_id),
        )) {
          blockedOwners.add(owner);
        }

        const driven: { id: string; status: string }[] = [];
        for (const campaign of running ?? []) {
          if (blockedOwners.has((campaign as any).owner_id)) continue;
          const deadline = Date.now() + 45_000;
          let result = { status: "unknown" } as { status: string };
          for (let i = 0; i < 10; i += 1) {
            result = await processCampaignNext(supabaseAdmin, {
              ownerId: campaign.owner_id,
              campaignId: campaign.id,
              credsUserId: campaign.owner_id,
            });
            if (result.status === "sent" || result.status === "failed") {
              if (Date.now() >= deadline) break;
              continue;
            }
            break;
          }
          driven.push({ id: campaign.id, status: result.status });
        }

        return Response.json({ ok: true, activated: activated.length, driven });
      },
      GET: async () => Response.json({ ok: true, hint: "POST para processar" }),
    },
  },
});
