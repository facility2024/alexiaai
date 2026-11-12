import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getWapiError, loadWhatsappCreds, parseWapiConnection, WAPI_BASE } from "@/lib/whatsapp.server";
import { getPermValue } from "@/lib/access";

/** Ativa a wapi_config do DONO do workspace (a instância do painel de
 *  atendimento) — membros atribuídos nunca têm instância própria. */
async function updateWapiConfig(ownerId: string, patch: Record<string, unknown>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // any: patch genérico + colunas novas fora do types.ts gerado
  await (supabaseAdmin as any).from("wapi_config").update(patch).eq("user_id", ownerId);
}

export const checkWhatsappStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabase, userId);

    const res = await fetch(
      `${WAPI_BASE}/instance/status-instance?instanceId=${encodeURIComponent(instance_id)}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      await updateWapiConfig(owner_id, {
        status: "error",
        last_checked_at: new Date().toISOString(),
      });
      return { ok: false, status: "error", message: body?.message ?? `HTTP ${res.status}`, raw: body };
    }

    const { connected, phone, state } = parseWapiConnection(body);
    const status = connected ? "connected" : "disconnected";

    await updateWapiConfig(owner_id, {
      status,
      phone_number: phone,
      last_checked_at: new Date().toISOString(),
    });

    return { ok: true, status, phone, providerStatus: state, raw: body };
  });

export const getWhatsappQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabase, userId);

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
        await updateWapiConfig(owner_id, {
          status: "connected",
          last_checked_at: new Date().toISOString(),
        });
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
          await updateWapiConfig(owner_id, {
            status: "connecting",
            last_checked_at: new Date().toISOString(),
          });
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
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabase, userId);
    const res = await fetch(
      `${WAPI_BASE}/instance/disconnect?instanceId=${encodeURIComponent(instance_id)}`,
      { headers: { Authorization: `Bearer ${api_token}` } },
    );
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: getWapiError(body, res.status) };
    }
    await updateWapiConfig(owner_id, {
      status: "disconnected",
      phone_number: null,
      last_checked_at: new Date().toISOString(),
    });
    return { ok: true };
  });

export const removeWhatsappConfigFromCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { data: orgOwner, error: ownerError } = await context.supabase.rpc("get_org_owner", {
      _user_id: userId,
    });
    if (ownerError) throw new Error(ownerError.message);

    const ownerId = (orgOwner as string | null) ?? userId;
    if (ownerId !== userId) {
      const { data: membership, error: membershipError } = await context.supabase
        .from("org_members")
        .select("role, active")
        .eq("owner_id", ownerId)
        .eq("member_id", userId)
        .maybeSingle();
      if (membershipError) throw new Error(membershipError.message);
      if (!membership?.active || membership.role !== "admin") {
        throw new Error("Somente o proprietário ou administrador da organização pode remover a conexão.");
      }
    }

    let db = context.supabase;
    if (ownerId !== userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      db = supabaseAdmin;
    }

    const { error } = await db.from("wapi_config").delete().eq("user_id", ownerId);
    if (error) throw new Error(error.message);
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
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabase, userId);

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
      await updateWapiConfig(owner_id, {
        status: "disconnected",
        last_checked_at: new Date().toISOString(),
      });
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
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { instance_id, api_token, owner_id } = await loadWhatsappCreds(supabase, userId);
    const secret = process.env.WAPI_WEBHOOK_SECRET;
    if (!secret) throw new Error("WAPI_WEBHOOK_SECRET não configurado");

    const { getPublicAppUrl } = await import("@/lib/config.server");
    const base = getPublicAppUrl();
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
    await updateWapiConfig(owner_id, { webhook_url: webhookUrl });
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
    const { assertChatAccess } = await import("@/lib/chat-access.server");
    await assertChatAccess(supabaseAdmin, userId, owner_id, data.chatId);

    // Assinatura do colaborador: "*Nome*" (negrito no WhatsApp) acima da
    // mensagem. LIGADA por padrão; o interruptor "sign_messages" nas
    // permissões do colaborador desliga (false) — ausente = ligada.
    let outText = data.message;
    try {
      const { data: permRow } = await supabaseAdmin
        .from("user_permissions")
        .select("extra")
        .eq("owner_id", owner_id)
        .eq("user_id", userId)
        .maybeSingle();
      if ((permRow as any)?.extra?.sign_messages !== false) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("full_name, email")
          .eq("id", userId)
          .maybeSingle();
        const raw = String((prof as any)?.full_name ?? "").trim();
        const email = String((prof as any)?.email ?? "").trim();
        // `full_name` pode conter o e-mail (cadastro sem nome): usa só o
        // trecho antes do "@"; sem nome, usa o prefixo do e-mail.
        const local = (s: string) => (s.includes("@") ? s.split("@")[0]! : s);
        const name = local(raw) || local(email);
        if (name) outText = `*${name}*\n${data.message}`;
      }
    } catch {
      // assinatura é best-effort: nunca bloqueia o envio
    }

    let res: Response;
    try {
      res = await fetch(
        `${WAPI_BASE}/message/send-text?instanceId=${encodeURIComponent(instance_id)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${api_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ phone: data.chatId, message: outText, delayMessage: 0 }),
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
      message_type: "text", content: outText,
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
    const { assertChatAccess } = await import("@/lib/chat-access.server");
    await assertChatAccess(supabaseAdmin, userId, owner_id, data.chatId);

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

      // Prioriza URL direta do Bunny CDN (mais rápido — W-API baixa direto).
      // Fallback: rota pública do app (proxy) se Bunny não estiver configurado.
      const { bunnySignedUrl } = await import("@/lib/bunny.server");
      try {
        mediaUrl = await bunnySignedUrl(asset.storage_path, { ttlSeconds: 3600 });
      } catch {
        const secret = process.env.WAPI_WEBHOOK_SECRET;
        if (secret) {
          const { sha256Hex } = await import("@/lib/bunny.server");
          const exp = Math.floor(Date.now() / 1000) + 3600;
          const sig = await sha256Hex(`${secret}:${data.mediaId}:${exp}`);
          const { getPublicAppUrl } = await import("@/lib/config.server");
          const base = getPublicAppUrl();
          let ext = "bin";
          if (kindTop === "image") ext = mimeLower === "image/png" ? "png" : "jpg";
          else if (kindTop === "video") ext = "mp4";
          else if (kindTop === "audio") ext = mimeLower.includes("mpeg") ? "mp3" : "ogg";
          else if (mimeLower === "application/pdf") ext = "pdf";
          mediaUrl = `${base}/api/public/media/${encodeURIComponent(data.mediaId)}.${ext}?exp=${exp}&sig=${sig}`;
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

// ---------------------------------------------------------------------------
// Configuração do painel (tela /whatsapp) — SEMPRE na instância do dono do
// workspace. Membros atribuídos gerenciam a MESMA conexão do painel de
// atendimento; ninguém cria instância própria (isso quebrava envio e
// transferência de atendimento). Mesma regra vale para o painel de licenças:
// cada empresa (dono) tem UMA instância compartilhada pela equipe.
// ---------------------------------------------------------------------------

async function resolvePanelOwner(context: {
  userId: string;
  supabase: any;
}): Promise<string> {
  const { data: resolvedOwner, error } = await context.supabase.rpc("get_org_owner", {
    _user_id: context.userId,
  });
  if (error) throw new Error(error.message);
  return typeof resolvedOwner === "string" ? resolvedOwner : context.userId;
}

async function assertWhatsappPanelAccess(
  userId: string,
  ownerId: string,
  userClient: any,
): Promise<void> {
  if (ownerId === userId) return;
  const { data: perm, error } = await userClient
    .from("user_permissions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const allowed = getPermValue(perm as Record<string, unknown>, "can_access_whatsapp") ?? true;
  if (!allowed) throw new Error("Sem permissão para gerenciar o WhatsApp do painel.");
}

export const getWhatsappPanelConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ownerId = await resolvePanelOwner(context as any);
    await assertWhatsappPanelAccess(context.userId, ownerId, context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wapi, error: wapiErr } = await supabaseAdmin
      .from("wapi_config")
      .select("instance_id, api_token, phone_number, status, webhook_url, reply_in_groups")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (wapiErr) throw new Error(wapiErr.message);
    const { data: ai, error: aiErr } = await supabaseAdmin
      .from("ai_settings")
      .select("provider, model, openai_key, gemini_key, inworld_key")
      .eq("user_id", ownerId)
      .eq("agent_key", "whatsapp")
      .maybeSingle();
    if (aiErr) throw new Error(aiErr.message);
    return { wapi: wapi ?? null, ai: ai ?? null };
  });

export const saveWhatsappCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { instance_id: string; api_token: string }) => {
    if (!d?.instance_id?.trim() || !d?.api_token?.trim())
      throw new Error("Instance ID e Token obrigatórios");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ownerId = await resolvePanelOwner(context as any);
    await assertWhatsappPanelAccess(context.userId, ownerId, context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("wapi_config").upsert(
      {
        user_id: ownerId,
        instance_id: data.instance_id.trim(),
        api_token: data.api_token.trim(),
      } as any,
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveWhatsappReplyInGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reply_in_groups: boolean }) => {
    if (typeof d?.reply_in_groups !== "boolean") throw new Error("reply_in_groups obrigatório");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ownerId = await resolvePanelOwner(context as any);
    await assertWhatsappPanelAccess(context.userId, ownerId, context.supabase);
    await updateWapiConfig(ownerId, { reply_in_groups: data.reply_in_groups });
    return { ok: true };
  });

export const saveWhatsappAiKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    provider: string;
    model: string;
    openai_key?: string;
    gemini_key?: string;
    inworld_key?: string;
  }) => {
    if (!d?.provider || !d?.model) throw new Error("provider e model obrigatórios");
    return d;
  })
  .handler(async ({ data, context }) => {
    const ownerId = await resolvePanelOwner(context as any);
    await assertWhatsappPanelAccess(context.userId, ownerId, context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("ai_settings").upsert(
      {
        user_id: ownerId,
        agent_key: "whatsapp",
        provider: data.provider,
        model: data.model,
        openai_key: data.openai_key?.trim() || null,
        gemini_key: data.gemini_key?.trim() || null,
        inworld_key: data.inworld_key?.trim() || null,
      } as any,
      { onConflict: "user_id,agent_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
