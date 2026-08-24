import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Plano free da Autentique não permite HMAC/IP fixo.
// Validação: token compartilhado enviado como query param (?token=...).
export const Route = createFileRoute("/api/public/autentique-webhook")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const secret = process.env.AUTENTIQUE_WEBHOOK_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 500, headers: cors });
        }

        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        // comparação de tamanho constante simples
        if (token.length !== secret.length) {
          return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: cors });
        }
        let diff = 0;
        for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ secret.charCodeAt(i);
        if (diff !== 0) {
          return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: cors });
        }

        const raw = await request.text();
        let body: {
          event?: string;
          type?: string;
          document?: {
            id?: string;
            status?: string;
            files?: { signed?: string; original?: string };
          };
          signer?: {
            id?: string;
            email?: string;
            action?: string;
            viewed?: { at?: string };
            signed?: { at?: string };
            rejected?: { at?: string };
          };
        };
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response(JSON.stringify({ error: "bad_json" }), { status: 400, headers: cors });
        }

        const eventType = body.event ?? body.type ?? "unknown";
        const documentId = body.document?.id ?? null;
        const signerEmail = body.signer?.email ?? null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let contractId: string | null = null;
        if (documentId) {
          const { data: contract } = await supabaseAdmin
            .from("contracts")
            .select("id, status")
            .eq("autentique_document_id", documentId)
            .maybeSingle();
          contractId = contract?.id ?? null;
        }

        if (contractId) {
          await supabaseAdmin.from("contract_events").insert({
            contract_id: contractId,
            event_type: eventType,
            payload: body as never,
            signer_email: signerEmail,
          });
        }

        if (contractId && body.signer?.id) {
          const patch: {
            status?: string;
            viewed_at?: string;
            signed_at?: string;
          } = {};
          if (body.signer.viewed?.at) {
            patch.status = "viewed";
            patch.viewed_at = new Date(body.signer.viewed.at).toISOString();
          }
          if (body.signer.signed?.at) {
            patch.status = "signed";
            patch.signed_at = new Date(body.signer.signed.at).toISOString();
          }
          if (body.signer.rejected?.at) {
            patch.status = "rejected";
          }
          if (Object.keys(patch).length > 0) {
            await supabaseAdmin
              .from("contract_signers")
              .update(patch)
              .eq("contract_id", contractId)
              .eq("autentique_signer_id", body.signer.id);
          }
        }

        if (contractId) {
          const statusMap: Record<string, string> = {
            "document.signed": "signed",
            "document.finished": "signed",
            "document.rejected": "rejected",
            "document.expired": "expired",
            "document.deleted": "cancelled",
            "signature.accepted": "sent",
            "signature.rejected": "rejected",
            "documento.concluido": "signed",
            "documento.concluído": "signed",
            "documento.excluido": "cancelled",
            "documento.excluído": "cancelled",
          };
          const newStatus = statusMap[eventType];
          if (newStatus) {
            const patch: { status: string; signed_file_url?: string } = { status: newStatus };
            if (newStatus === "signed" && body.document?.files?.signed) {
              patch.signed_file_url = body.document.files.signed;
            }
            await supabaseAdmin.from("contracts").update(patch).eq("id", contractId);
          }
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      },
    },
  },
});
