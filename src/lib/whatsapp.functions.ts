import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getWapiError, loadWhatsappCreds, parseWapiConnection, WAPI_BASE } from "@/lib/whatsapp.server";

export const checkWhatsappStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token } = await loadWhatsappCreds(supabase, userId);

    const res = await fetch(
      `${WAPI_BASE}/instance/status-instance?instanceId=${encodeURIComponent(instance_id)}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      await supabase
        .from("wapi_config")
        .update({ status: "error", last_checked_at: new Date().toISOString() })
        .eq("user_id", userId);
      return { ok: false, status: "error", message: body?.message ?? `HTTP ${res.status}`, raw: body };
    }

    const { connected, phone, state } = parseWapiConnection(body);
    const status = connected ? "connected" : "disconnected";

    await supabase
      .from("wapi_config")
      .update({ status, phone_number: phone, last_checked_at: new Date().toISOString() })
      .eq("user_id", userId);

    return { ok: true, status, phone, providerStatus: state, raw: body };
  });

export const getWhatsappQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token } = await loadWhatsappCreds(supabase, userId);

    const headers = { Authorization: `Bearer ${api_token}` };
    const instanceQuery = `instanceId=${encodeURIComponent(instance_id)}`;

    const extractQr = (body: any): string | null => {
      const qr =
        body?.qrcode ?? body?.qrCode ?? body?.qr ?? body?.base64 ?? body?.image ??
        body?.data?.qrcode ?? body?.data?.qrCode ?? body?.data?.qr ??
        body?.data?.base64 ?? body?.data?.image ?? null;
      return typeof qr === "string" && qr.trim() ? qr : null;
    };

    const fetchQr = async () => {
      const res = await fetch(
        `${WAPI_BASE}/instance/qr-code?${instanceQuery}&image=disable`,
        { headers },
      );
      const body: any = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body, qr: extractQr(body) };
    };

    try {
      // 1) Verifica status atual. Se já conectado, não recria sessão.
      const st = await fetch(
        `${WAPI_BASE}/instance/status-instance?${instanceQuery}`,
        { headers },
      );
      const stBody: any = await st.json().catch(() => ({}));
      const { connected } = parseWapiConnection(stBody);
      if (connected) {
        await supabase
          .from("wapi_config")
          .update({ status: "connected", last_checked_at: new Date().toISOString() })
          .eq("user_id", userId);
        return {
          ok: false,
          code: "WHATSAPP_ALREADY_CONNECTED",
          message: "WhatsApp já está conectado. Desconecte antes de gerar um novo QR Code.",
        };
      }

      // 2) Tenta um QR já disponível (sessão em connecting).
      let attempt = await fetchQr();
      let lastBody: any = attempt.body;
      let lastStatus = attempt.status;
      if (attempt.qr) {
        await supabase
          .from("wapi_config")
          .update({ status: "connecting", last_checked_at: new Date().toISOString() })
          .eq("user_id", userId);
        return { ok: true, qr: attempt.qr };
      }

      // 3) Sessão sem QR: desconecta e aguarda confirmação.
      await fetch(`${WAPI_BASE}/instance/disconnect?${instanceQuery}`, { method: "GET", headers })
        .catch(() => null);
      await new Promise((r) => setTimeout(r, 1500));

      // 4) Polling do QR (até ~30s: 15 tentativas x 2s).
      for (let i = 0; i < 15; i += 1) {
        attempt = await fetchQr();
        lastBody = attempt.body;
        lastStatus = attempt.status;
        if (attempt.qr) {
          await supabase
            .from("wapi_config")
            .update({ status: "connecting", last_checked_at: new Date().toISOString() })
            .eq("user_id", userId);
          return { ok: true, qr: attempt.qr };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      return {
        ok: false,
        code: "WHATSAPP_QR_UNAVAILABLE",
        message: getWapiError(lastBody, lastStatus) ||
          "A W-API não retornou o QR Code a tempo. Tente novamente em alguns segundos.",
      };
    } catch (e: any) {
      return {
        ok: false,
        code: "WHATSAPP_SERVICE_UNAVAILABLE",
        message: e?.message ?? "Não foi possível acessar a W-API agora. Tente novamente em alguns segundos.",
      };
    }
  });

export const disconnectWhatsapp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token } = await loadWhatsappCreds(supabase, userId);
    const res = await fetch(
      `${WAPI_BASE}/instance/disconnect?instanceId=${encodeURIComponent(instance_id)}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
    );
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: getWapiError(body, res.status) };
    }
    await supabase
      .from("wapi_config")
      .update({ status: "disconnected", phone_number: null, last_checked_at: new Date().toISOString() })
      .eq("user_id", userId);
    return { ok: true };
  });

export const sendWhatsappMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { to: string; message: string }) => {
    if (!d?.to || !d?.message) throw new Error("to e message são obrigatórios");
    if (d.message.length > 4096) throw new Error("Mensagem muito longa");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token } = await loadWhatsappCreds(supabase, userId);

    // Preflight: garante que a instância está conectada antes de enviar.
    const st = await fetch(
      `${WAPI_BASE}/instance/status-instance?instanceId=${encodeURIComponent(instance_id)}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
    );
    const stBody: any = await st.json().catch(() => ({}));
    if (!st.ok) {
      return { ok: false, code: "WHATSAPP_STATUS_UNAVAILABLE", message: getWapiError(stBody, st.status) };
    }
    const { connected } = parseWapiConnection(stBody);
    if (!connected) {
      await supabase
        .from("wapi_config")
        .update({ status: "disconnected", last_checked_at: new Date().toISOString() })
        .eq("user_id", userId);
      return {
        ok: false,
        code: "WHATSAPP_DISCONNECTED",
        message: "WhatsApp desconectado. Escaneie o QR Code novamente.",
      };
    }

    const res = await fetch(
      `${WAPI_BASE}/message/send-text?instanceId=${encodeURIComponent(instance_id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${api_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: data.to, message: data.message, delayMessage: 1 }),
      },
    );
    const body: any = await res.json().catch(() => ({}));
    const messageId = body?.messageId ?? body?.id ?? body?.key?.id ?? null;
    const apiErr = body?.error || body?.success === false || String(body?.status ?? "").toLowerCase() === "error";
    if (!res.ok || apiErr) {
      return { ok: false, code: "WHATSAPP_SEND_FAILED", message: getWapiError(body, res.status) };
    }
    return { ok: true, messageId, raw: body };
  });

export const configureWapiWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { baseUrl?: string }) => d ?? {})
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token } = await loadWhatsappCreds(supabase, userId);
    const secret = process.env.WAPI_WEBHOOK_SECRET;
    if (!secret) throw new Error("WAPI_WEBHOOK_SECRET não configurado");

    // Resolve URL base: priorize env, depois override do usuário, depois domínio publicado / preview estável.
    const ENV_PUBLIC = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
    const PUBLISHED = "https://agentesjuridicos.lovable.app";
    const STABLE_PREVIEW = "https://project--2c01e5d5-35c1-4241-97c9-c9550f30905b.lovable.app";
    let base = (data?.baseUrl ?? "").trim().replace(/\/$/, "");
    if (!base || /id-preview--/i.test(base) || /localhost/i.test(base)) {
      base = ENV_PUBLIC || PUBLISHED || STABLE_PREVIEW;
    }
    const webhookUrl = `${base}/api/public/wapi-webhook?secret=${encodeURIComponent(secret)}`;

    // W-API: PUT /v1/webhook/update-webhook-received (mensagens recebidas)
    const res = await fetch(
      `${WAPI_BASE}/webhook/update-webhook-received?instanceId=${encodeURIComponent(instance_id)}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value: webhookUrl }),
      },
    );
    // Best-effort: registra também webhook de entrega (status de envio)
    try {
      await fetch(
        `${WAPI_BASE}/webhook/update-webhook-delivery?instanceId=${encodeURIComponent(instance_id)}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ value: webhookUrl }),
        },
      );
    } catch {}
    const body = await res.json().catch(() => ({}));
    await supabase.from("wapi_config").update({ webhook_url: webhookUrl }).eq("user_id", userId);
    const apiErr = body?.error || body?.success === false;
    if (!res.ok || apiErr) {
      const msg = body?.error?.message ?? body?.message ?? `HTTP ${res.status}`;
      return { ok: false, message: typeof msg === "string" ? msg : JSON.stringify(msg), webhookUrl };
    }
    return { ok: true, webhookUrl, raw: body };
  });

export const sendOperatorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatId: string; message: string }) => {
    if (!d?.chatId || !d?.message?.trim()) throw new Error("chatId e mensagem obrigatórios");
    if (d.message.length > 4096) throw new Error("Mensagem muito longa");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    let supabaseAdmin: any = context.supabase;
    try {
      const mod = await import("@/integrations/supabase/client.server");
      // trigger proxy → throws if service role env missing
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      mod.supabaseAdmin.rpc;
      supabaseAdmin = mod.supabaseAdmin;
    } catch (err) {
      console.warn("[sendOperatorMessage] service role indisponível, usando client autenticado:", (err as Error)?.message);
    }
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabaseAdmin, userId);

    let res: Response;
    try {
      res = await fetch(
        `${WAPI_BASE}/message/send-text?instanceId=${encodeURIComponent(instance_id)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ phone: data.chatId, message: data.message, delayMessage: 0 }),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (error: any) {
      return {
        ok: false,
        code: "WHATSAPP_UNAVAILABLE",
        message: error?.name === "TimeoutError"
          ? "O WhatsApp demorou para responder. Tente novamente."
          : "Não foi possível acessar o WhatsApp agora.",
      };
    }
    const responseText = await res.text();
    let body: any = {};
    try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { message: responseText }; }
    const messageId = body?.messageId ?? body?.id ?? body?.key?.id ?? null;
    const apiErr = body?.error || body?.success === false;
    const success = res.ok && !apiErr;

    if (!success) {
      return { ok: false, code: "WHATSAPP_SEND_FAILED", message: getWapiError(body, res.status) };
    }

    const { error: insertError } = await supabaseAdmin.from("crm_messages").insert({
      user_id: owner_id, chat_id: data.chatId,
      direction: "outbound", sender: "operator",
      message_type: "text", content: data.message,
      wapi_message_id: messageId,
      status: "sent",
      raw: { ...body, messageId },
    });
    if (insertError) {
      console.error("[sendOperatorMessage] message persistence failed", insertError.message);
      return {
        ok: false,
        code: "MESSAGE_PERSISTENCE_FAILED",
        message: "A mensagem foi enviada, mas não pôde ser salva no CRM. Atualize a conversa.",
      };
    }

    // (auto-pausa removida: bot só é pausado quando o admin clicar no botão)

    return { ok: true, messageId };
  });

/** Envia mídia (imagem/vídeo/áudio/documento) via W-API.
 *  Prefere `mediaId` (Bunny). Cai em `storagePath` (bucket legado) quando fornecido. */
export const sendOperatorMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    chatId: string;
    mediaId?: string;
    storagePath?: string;
    mime: string;
    filename: string;
    caption?: string;
  }) => {
    if (!d?.chatId || !d?.mime || !d?.filename) {
      throw new Error("chatId, mime e filename são obrigatórios");
    }
    if (!d.mediaId && !d.storagePath) {
      throw new Error("mediaId ou storagePath é obrigatório");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    let supabaseAdmin: any = context.supabase;
    try {
      const mod = await import("@/integrations/supabase/client.server");
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      mod.supabaseAdmin.rpc;
      supabaseAdmin = mod.supabaseAdmin;
    } catch (err) {
      console.warn("[sendOperatorMedia] service role indisponível, usando client autenticado:", (err as Error)?.message);
    }
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabaseAdmin, userId);

    // Gera URL pública assinada que a W-API pode baixar.
    let mediaUrl = "";
    let resolvedMime = data.mime.toLowerCase();
    if (data.mediaId) {
      const { data: asset, error: assetErr } = await supabaseAdmin
        .from("media_assets")
        .select("storage_path, status, mime")
        .eq("id", data.mediaId)
        .maybeSingle();
      if (assetErr || !asset?.storage_path || asset.status !== "ready") {
        return { ok: false, code: "MEDIA_URL_FAILED", message: assetErr?.message ?? "Mídia indisponível" };
      }
      // Prioriza o mime REAL salvo em media_assets (detectado por magic bytes
      // no upload). O mime vindo do cliente pode estar errado.
      const mimeLower = ((asset.mime as string | null) || data.mime || "").toLowerCase();
      resolvedMime = mimeLower;
      const kindTop = mimeLower.split("/")[0];

      // Usa sempre a rota pública do próprio app. A W-API processa o envio de
      // mídia de forma assíncrona e URLs assinadas diretamente pelo CDN podem
      // ser aceitas no POST, mas falhar depois sem entregar a mensagem.
      const secret = process.env.WAPI_WEBHOOK_SECRET;
      if (secret) {
        const { sha256Hex } = await import("@/lib/bunny.server");
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const sig = await sha256Hex(`${secret}:${data.mediaId}:${exp}`);
        const ENV_PUBLIC = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
        const base = ENV_PUBLIC || "https://agentesjuridicos.lovable.app";
        let ext = "bin";
        if (kindTop === "image") ext = mimeLower === "image/png" ? "png" : "jpg";
        else if (kindTop === "video") ext = "mp4";
        else if (kindTop === "audio") ext = mimeLower.includes("mpeg") ? "mp3" : "ogg";
        else if (mimeLower === "application/pdf") ext = "pdf";
        mediaUrl = `${base}/api/public/media/${encodeURIComponent(data.mediaId)}.${ext}?exp=${exp}&sig=${sig}`;
      } else {
        // Fallback isolado: se o ambiente ainda não tiver recarregado o secret
        // do webhook, entrega a mesma mídia por uma URL temporária do CDN.
        // Assim o envio não é bloqueado por uma configuração sem relação com o upload.
        const { bunnySignedUrl } = await import("@/lib/bunny.server");
        try {
          mediaUrl = await bunnySignedUrl(asset.storage_path, { ttlSeconds: 3600 });
        } catch (error: any) {
          return {
            ok: false,
            code: "MEDIA_URL_FAILED",
            message: error?.message ?? "Falha ao gerar URL temporária da mídia",
          };
        }
      }

    } else {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from("crm-media")
        .createSignedUrl(data.storagePath!, 3600);
      if (signErr || !signed?.signedUrl) {
        return { ok: false, code: "MEDIA_URL_FAILED", message: signErr?.message ?? "Falha ao gerar URL da mídia" };
      }
      mediaUrl = signed.signedUrl;
    }


    const kind = resolvedMime.split("/")[0];
    const messageType = kind === "image" || kind === "video" || kind === "audio"
      ? kind
      : "document";
    let endpoint = "send-document";
    let field = "document";
    if (kind === "image") { endpoint = "send-image"; field = "image"; }
    else if (kind === "video") { endpoint = "send-video"; field = "video"; }
    else if (kind === "audio") { endpoint = "send-audio"; field = "audio"; }

    const payload: Record<string, any> = {
      phone: data.chatId,
      [field]: mediaUrl,
      caption: data.caption ?? "",
      fileName: data.filename,
      delayMessage: 0,
    };

    let res: Response;
    try {
      res = await fetch(
        `${WAPI_BASE}/message/${endpoint}?instanceId=${encodeURIComponent(instance_id)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error: any) {
      return {
        ok: false,
        code: "WHATSAPP_UNAVAILABLE",
        message: error?.name === "TimeoutError"
          ? "O WhatsApp demorou para responder ao envio de mídia."
          : "Não foi possível acessar o WhatsApp agora.",
      };
    }
    const responseText = await res.text();
    let body: any = {};
    try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = { message: responseText }; }
    const messageId = body?.messageId ?? body?.id ?? body?.key?.id ?? null;
    const apiErr = body?.error || body?.success === false;
    if (!res.ok || apiErr) {
      console.error("[sendOperatorMedia] W-API rejeitou envio", {
        status: res.status,
        endpoint,
        mediaUrl,
        body,
      });
      return { ok: false, code: "WHATSAPP_SEND_FAILED", message: getWapiError(body, res.status) };
    }

    const { error: insertError } = await supabaseAdmin.from("crm_messages").insert({
      user_id: owner_id,
      chat_id: data.chatId,
      direction: "outbound",
      sender: "operator",
      message_type: messageType,
      content: data.caption ?? null,
      media_id: data.mediaId ?? null,
      storage_path: data.storagePath ?? null,
      mime: resolvedMime,
      filename: data.filename,
      wapi_message_id: messageId,
      status: "sent",
      raw: { ...body, messageId },
    });
    if (insertError) {
      console.error("[sendOperatorMedia] persistence failed", insertError.message);
      return {
        ok: false,
        code: "MESSAGE_PERSISTENCE_FAILED",
        message: "A mídia foi enviada, mas não pôde ser salva no CRM. Atualize a conversa.",
      };
    }

    // (auto-pausa removida: bot só é pausado quando o admin clicar no botão)


    return { ok: true, messageId };
  });

export const listWhatsappContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token } = await loadWhatsappCreds(supabase, userId);
    const { listWapiContacts, listWapiChats } = await import("@/lib/wapi.server");
    // Tenta contatos primeiro, depois chats como fallback
    const res = await listWapiContacts(instance_id, api_token);
    if (res.ok && Array.isArray(res.body)) {
      return { ok: true, contacts: res.body.slice(0, 200) };
    }
    if (res.ok && res.body?.contacts) {
      return { ok: true, contacts: res.body.contacts.slice(0, 200) };
    }
    // Fallback: lista chats (cada chat tem id + pushName)
    const chatsRes = await listWapiChats(instance_id, api_token);
    if (chatsRes.ok) {
      const arr = Array.isArray(chatsRes.body) ? chatsRes.body : chatsRes.body?.chats ?? chatsRes.body?.data ?? [];
      const contacts = (arr as any[]).slice(0, 200).map((c: any) => ({
        id: c.id ?? c.jid ?? c.phone ?? c.chatId ?? "",
        name: c.name ?? c.pushName ?? c.notify ?? c.formattedName ?? c.id ?? "",
        phone: (c.phone ?? c.id ?? "").toString().replace(/\D/g, ""),
      })).filter((c) => c.phone);
      return { ok: true, contacts };
    }
    return { ok: false, contacts: [], error: res.body?.message ?? "Falha ao listar contatos" };
  });
