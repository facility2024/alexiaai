// Helper server-only para envio de SMS a partir do cron (sem sessão do usuário).
// Reproduz a lógica de src/lib/sms.functions.ts, mas buscando credencial
// com service_role para o user_id (dono da conta) informado.

import type { SupabaseClient } from "@supabase/supabase-js";

type Creds = {
  provider: string;
  api_key: string;
  api_secret: string | null;
  sender_id: string | null;
  base_url: string | null;
};

export async function sendSmsForUser(
  admin: SupabaseClient,
  opts: { user_id: string; to: string; message: string },
): Promise<{ ok: true; provider: string }> {
  const { data: creds, error } = await admin
    .from("sms_credentials")
    .select("provider, api_key, api_secret, sender_id, base_url, updated_at")
    .eq("user_id", opts.user_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!creds) throw new Error("Sem credencial SMS configurada");

  const c = creds as Creds;
  const digits = opts.to.replace(/\D/g, "");
  const toE164 = digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
  const toBare = toE164.replace("+", "");
  const from = c.sender_id ?? "";
  const message = opts.message;

  if (c.provider === "twilio") {
    const auth = btoa(`${c.api_key}:${c.api_secret ?? ""}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${c.api_key}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: toE164, From: from, Body: message }),
      },
    );
    if (!res.ok) throw new Error(`Twilio: ${(await res.text()).slice(0, 300)}`);
    return { ok: true, provider: c.provider };
  }
  if (c.provider === "zenvia") {
    const res = await fetch("https://api.zenvia.com/v2/channels/sms/messages", {
      method: "POST",
      headers: { "X-API-TOKEN": c.api_key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: toBare, contents: [{ type: "text", text: message }] }),
    });
    if (!res.ok) throw new Error(`Zenvia: ${(await res.text()).slice(0, 300)}`);
    return { ok: true, provider: c.provider };
  }
  if (c.provider === "infobip") {
    const baseUrl = c.base_url?.replace(/\/$/, "") ?? "";
    if (!baseUrl) throw new Error("Infobip sem base URL");
    const res = await fetch(`${baseUrl}/sms/2/text/advanced`, {
      method: "POST",
      headers: { Authorization: `App ${c.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ from, destinations: [{ to: toBare }], text: message }] }),
    });
    if (!res.ok) throw new Error(`Infobip: ${(await res.text()).slice(0, 300)}`);
    return { ok: true, provider: c.provider };
  }
  if (c.provider === "strong_expert") {
    const templateId = Number((c.sender_id ?? "").trim());
    if (!templateId) throw new Error("Strong Expert sem template");
    const baseUrl = c.base_url?.replace(/\/$/, "") || "https://api.strong.expert";
    const res = await fetch(`${baseUrl}/api/v1/campaign-sms`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: (message || `FollowUp ${Date.now()}`).slice(0, 60),
        sendDate: new Date().toISOString(),
        typeSms: 1, hasInteraction: false, smsTemplateId: templateId,
        phones: [toBare], isIndividual: true,
      }),
    });
    if (!res.ok) throw new Error(`Strong Expert: ${(await res.text()).slice(0, 300)}`);
    return { ok: true, provider: c.provider };
  }
  if (c.provider === "integrax") {
    const token = c.api_key?.trim();
    const baseUrl = c.base_url?.replace(/\/$/, "") || "https://sms.aresfun.com";
    const res = await fetch(`${baseUrl}/v1/integration/${token}/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: [toBare], from: from || "29094", message }),
    });
    if (!res.ok) throw new Error(`Integrax: ${(await res.text()).slice(0, 300)}`);
    return { ok: true, provider: c.provider };
  }
  throw new Error(`Provedor "${c.provider}" não suportado`);
}
