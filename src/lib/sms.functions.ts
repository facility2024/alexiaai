import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const sendSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { to: string; message: string; provider?: string }) =>
    z
      .object({
        to: z.string().min(8).max(20),
        message: z.string().min(1).max(480),
        provider: z.string().max(64).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const base = supabase
      .from("sms_credentials")
      .select("provider, api_key, api_secret, sender_id, base_url, updated_at");
    const { data: creds, error } = data.provider
      ? await base.eq("provider", data.provider).maybeSingle()
      : await base.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!creds) throw new Error("Nenhuma credencial SMS configurada em /sms");

    const digits = data.to.replace(/\D/g, "");
    const toE164 = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
    const toBare = toE164.replace("+", "");
    const from = creds.sender_id ?? "";

    if (creds.provider === "twilio") {
      const auth = btoa(`${creds.api_key}:${creds.api_secret ?? ""}`);
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.api_key}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: toE164, From: from, Body: data.message }),
        },
      );
      if (!res.ok) throw new Error(`Twilio: ${(await res.text()).slice(0, 300)}`);
      return { ok: true };
    }

    if (creds.provider === "zenvia") {
      const res = await fetch("https://api.zenvia.com/v2/channels/sms/messages", {
        method: "POST",
        headers: {
          "X-API-TOKEN": creds.api_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: toBare,
          contents: [{ type: "text", text: data.message }],
        }),
      });
      if (!res.ok) throw new Error(`Zenvia: ${(await res.text()).slice(0, 300)}`);
      return { ok: true };
    }

    if (creds.provider === "infobip") {
      const baseUrl = creds.base_url?.replace(/\/$/, "") ?? "";
      if (!baseUrl) throw new Error("Infobip: informe a Base URL em /sms");
      const res = await fetch(`${baseUrl}/sms/2/text/advanced`, {
        method: "POST",
        headers: {
          Authorization: `App ${creds.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { from, destinations: [{ to: toBare }], text: data.message },
          ],
        }),
      });
      if (!res.ok) throw new Error(`Infobip: ${(await res.text()).slice(0, 300)}`);
      return { ok: true };
    }

    if (creds.provider === "strong_expert") {
      const templateId = Number((creds.sender_id ?? "").trim());
      if (!templateId || Number.isNaN(templateId)) {
        throw new Error(
          "Strong Expert: informe o ID numérico do smsTemplate no campo 'Sender ID' em /sms",
        );
      }
      const baseUrl = (creds.base_url?.replace(/\/$/, "") || "https://api.strong.expert");
      const res = await fetch(`${baseUrl}/api/v1/campaign-sms`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: (data.message || `Campanha ${Date.now()}`).slice(0, 60),
          sendDate: new Date().toISOString(),
          typeSms: 1,
          hasInteraction: false,
          smsTemplateId: templateId,
          phones: [toBare],
          isIndividual: true,
        }),
      });
      if (!res.ok) {
        throw new Error(`Strong Expert: ${(await res.text()).slice(0, 300)}`);
      }
      return { ok: true };
    }

    if (creds.provider === "integrax") {
      const token = creds.api_key?.trim();
      if (!token) throw new Error("Integrax: informe o Token da API em /sms");
      const baseUrl = (creds.base_url?.replace(/\/$/, "") || "https://sms.aresfun.com");
      const res = await fetch(`${baseUrl}/v1/integration/${token}/send-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: [toBare],
          from: from || "29094",
          message: data.message,
        }),
      });
      if (!res.ok) throw new Error(`Integrax: ${(await res.text()).slice(0, 300)}`);
      return { ok: true };
    }

    throw new Error(`Provedor "${creds.provider}" ainda não suportado no envio`);
  });
