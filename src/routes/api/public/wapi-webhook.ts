import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { sendPresence, sendText, sendAudioUrl, chunkText, sleep, markAsRead } from "@/lib/wapi.server";
import { fishAudioSynthesize } from "@/lib/fish-audio.server";
import { extractMediaMeta, processPendingMediaRow, type MediaMeta } from "@/lib/wapi-media.server";

const MAX_BODY = 256 * 1024;
const MAX_TOTAL_DELAY_MS = 8000;

function timingSafeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function normalizePhone(p: any): string {
  return String(p ?? "")
    .replace(/@.*/, "")
    .replace(/:\d+$/, "")
    .replace(/\D/g, "");
}

function extractMessage(payload: any) {
  const instanceId =
    payload?.instanceId ?? payload?.instance_id ?? payload?.instance?.id ?? null;
  const msg = payload?.message ?? payload?.msg ?? payload;
  const fromMe = msg?.fromMe ?? msg?.from_me ?? msg?.key?.fromMe ?? payload?.fromMe ?? false;

  // O remoteJid identifica a conversa. Em grupos, sender.id identifica apenas
  // o participante e não pode ser usado como chat_id.
  const rawChat =
    msg?.key?.remoteJid ?? msg?.remoteJid ?? msg?.chat?.id ?? msg?.chatId ??
    payload?.key?.remoteJid ?? payload?.remoteJid ?? payload?.chat?.id ?? null;
  // Com o modo de privacidade atual do WhatsApp, remoteJid pode ser um @lid.
  // A W-API envia o telefone real nos campos alternativos.
  const rawChatAlt =
    msg?.key?.remoteJidAlt ?? msg?.remoteJidAlt ?? msg?.chat?.remoteJidAlt ??
    payload?.key?.remoteJidAlt ?? payload?.remoteJidAlt ?? payload?.chat?.remoteJidAlt ?? null;
  const rawSender =
    msg?.key?.senderPn ?? msg?.senderPn ?? msg?.participantPn ??
    payload?.key?.senderPn ?? payload?.senderPn ?? payload?.participantPn ??
    msg?.sender?.senderPn ?? msg?.sender?.pn ?? payload?.sender?.senderPn ?? payload?.sender?.pn ??
    msg?.from ?? msg?.phone ?? msg?.sender?.id ?? payload?.sender?.id ?? payload?.from ?? payload?.phone ?? null;
  const rawSenderAlt =
    msg?.key?.participantAlt ?? msg?.participantAlt ?? msg?.sender?.participantAlt ??
    payload?.key?.participantAlt ?? payload?.participantAlt ?? payload?.sender?.participantAlt ?? null;
  const rawChatStr = String(rawChat ?? "");
  const rawChatDigits = rawChatStr.replace(/@.*/, "").replace(/\D/g, "");
  // Detecta @lid: sufixo explícito OU número com mais de 15 dígitos (E.164 max
  // é 15; qualquer coisa maior é ID interno do WhatsApp).
  const chatIsLid = /@lid$/i.test(rawChatStr) || rawChatDigits.length > 15;
  const rawPhone = chatIsLid ? (rawChatAlt ?? rawSenderAlt ?? rawSender ?? rawChat) : (rawChat ?? rawChatAlt ?? rawSenderAlt ?? rawSender);
  const rawStr = rawChat != null ? String(rawChat) : (rawPhone != null ? String(rawPhone) : "");
  const isGroup =
    /@g\.us/i.test(rawStr) ||
    msg?.isGroup === true || msg?.isGroupMsg === true ||
    payload?.isGroup === true || payload?.isGroupMsg === true;
  const phoneSource = isGroup ? (rawSenderAlt ?? rawSender ?? rawPhone) : rawPhone;
  let phone = phoneSource ? normalizePhone(phoneSource) : null;
  // Se ainda ficou com pinta de @lid (>15 dígitos) e temos algum sender, tenta
  // extrair um telefone real de qualquer campo disponível.
  if (phone && phone.length > 15) {
    const candidates = [rawChatAlt, rawSenderAlt, rawSender]
      .map((v) => (v ? normalizePhone(v) : ""))
      .filter((d) => d && d.length >= 7 && d.length <= 15);
    if (candidates.length) phone = candidates[0];
  }

  // W-API v2 nested msgContent formats
  const mc = msg?.msgContent ?? payload?.msgContent ?? {};
  let text: string | null =
    msg?.text ?? msg?.body ?? msg?.message?.text ?? msg?.conversation ??
    mc?.conversation ??
    mc?.extendedTextMessage?.text ??
    mc?.encodedTextMessage?.text ??
    mc?.imageMessage?.caption ??
    mc?.videoMessage?.caption ??
    mc?.documentMessage?.caption ??
    mc?.buttonsResponseMessage?.selectedDisplayText ??
    mc?.listResponseMessage?.title ??
    mc?.reactionMessage?.text ??
    null;
  if (typeof text === "string") text = text.trim() || null;

  let type: string = msg?.type ?? msg?.messageType ?? "unknown";
  if (type === "unknown" || !type) {
    if (mc?.conversation || mc?.extendedTextMessage || mc?.encodedTextMessage) type = "text";
    else if (mc?.imageMessage) type = "image";
    else if (mc?.audioMessage) type = "audio";
    else if (mc?.videoMessage) type = "video";
    else if (mc?.documentMessage) type = "document";
    else if (mc?.stickerMessage) type = "sticker";
    else if (mc?.reactionMessage) type = "text"; // reação (emoji) tratada como texto
    else if (text) type = "text";
  }

  const wapiMessageId = msg?.messageId ?? msg?.key?.id ?? msg?.id ?? payload?.key?.id ?? payload?.messageId ?? null;
  return { instanceId, phone, rawChatId: rawStr, isGroup, text, type, fromMe, wapiMessageId };
}




function pickProviderModelFallback(provider: string, modelId: string): string {
  // Garante modelo compatível com o provider escolhido.
  const isGemini = /gemini/i.test(modelId);
  const isOpenAI = /^gpt|^o\d/i.test(modelId);
  if (provider === "openai" && !isOpenAI) return "gpt-4o-mini";
  if ((provider === "google" || provider === "gemini") && !isGemini) return "gemini-1.5-flash";
  return modelId;
}

export const Route = createFileRoute("/api/public/wapi-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1) Auth
        const expected = process.env.WAPI_WEBHOOK_SECRET;
        if (!expected) return new Response("Missing WAPI_WEBHOOK_SECRET", { status: 500 });
        const url = new URL(request.url);
        const provided = url.searchParams.get("secret") ?? request.headers.get("x-webhook-secret") ?? "";
        if (!timingSafeEq(provided, expected)) return new Response("Unauthorized", { status: 401 });

        // 2) Body
        const raw = await request.text();
        if (raw.length > MAX_BODY) return new Response("Payload too large", { status: 413 });
        let payload: any;
        try { payload = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

        const _extracted = extractMessage(payload);
        const { instanceId, phone, rawChatId, isGroup, type, fromMe, wapiMessageId } = _extracted;
        let text = _extracted.text;
        if (!instanceId || !phone) {
          console.warn("[wapi-webhook] payload sem identificação", {
            hasInstanceId: !!instanceId,
            hasPhone: !!phone,
            messageId: wapiMessageId,
          });
          return new Response("ok", { status: 200 });
        }

        // DEBUG: quando o rawChatId é @lid, logar payload completo para
        // descobrir onde a W-API envia o telefone real.
        if (/@lid$/i.test(String(rawChatId ?? "")) || /^\d{15,}$/.test(phone)) {
          console.log("[wapi-webhook][lid-debug] raw payload:", JSON.stringify(payload).slice(0, 4000));
        }

        // Ignora JIDs que não são conversas 1:1/grupo reais. @lid não é
        // descartado aqui: extractMessage tenta resolvê-lo pelo remoteJidAlt.
        // - @newsletter (canais)
        // - @broadcast / status@broadcast (listas de transmissão / status)
        const jidLower = String(rawChatId ?? "").toLowerCase();
        if (/@newsletter$|@broadcast$|status@broadcast/.test(jidLower)) {
          return new Response("ok", { status: 200 });
        }
        // Segurança extra: telefones reais têm 7–15 dígitos. Fora disso é lid/id interno.
        if (!isGroup && (phone.length < 7 || phone.length > 15)) {
          return new Response("ok", { status: 200 });
        }

        // 3) Lookup tenant
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: wapiCfg } = await supabaseAdmin
          .from("wapi_config")
          .select("user_id, instance_id, api_token, reply_in_groups")
          .eq("instance_id", instanceId)
          .maybeSingle();
        if (!wapiCfg) {
          console.warn("[wapi-webhook] instância não encontrada", { instanceId, messageId: wapiMessageId });
          return new Response("ok", { status: 200 });
        }
        const userId = (wapiCfg as any).user_id as string;
        const apiToken = (wapiCfg as any).api_token as string;
        const replyInGroups = Boolean((wapiCfg as any).reply_in_groups);
        // chat_id preserva sufixo @g.us para grupos, mantém só dígitos para 1:1
          const chatId = isGroup && rawChatId
            ? rawChatId.replace(/:\d+(?=@g\.us$)/i, "")
            : phone;

        // Marca a mensagem como lida no WhatsApp (dois tiques azuis)
        if (wapiMessageId) {
          markAsRead(instanceId, apiToken, chatId, wapiMessageId).catch(() => null);
        }

        // 4) Idempotent upsert: same wapi_message_id can be re-delivered by W-API
        //    while we are still processing media; a unique index keeps a single row
        //    so the retry can complete storage_path later instead of duplicating.
        const normalizedType = String(type ?? "").toLowerCase();
        const isMediaType = ["image", "audio", "video", "document", "sticker"].includes(normalizedType);
        const mediaMeta: MediaMeta | null = isMediaType ? extractMediaMeta(payload, wapiMessageId, phone) : null;
        if (isMediaType) {
          console.log("[wapi-webhook] media inbound", JSON.stringify({
            type: normalizedType, wapiMessageId, hasMeta: !!mediaMeta,
            hasMediaKey: !!mediaMeta?.mediaKey, hasDirectPath: !!mediaMeta?.directPath,
            mime: mediaMeta?.mimetype ?? null,
          }));
        }

        const messageType = normalizedType === "text"
          ? "text"
          : (normalizedType === "sticker"
              ? "image"
              : (["image","audio","video","document"].includes(normalizedType) ? normalizedType : "text"));

        // Look up existing row (if any) to preserve completed media on webhook retries.
        let existing: any = null;
        if (wapiMessageId) {
          const { data } = await supabaseAdmin
            .from("crm_messages")
            .select("id, media_status, storage_path, media_attempts, raw")
            .eq("user_id", userId)
            .eq("wapi_message_id", wapiMessageId)
            .eq("direction", fromMe ? "outbound" : "inbound")
            .maybeSingle();
          existing = data;
        }

        // If the row already exists and media is already completed, nothing to do.
        if (existing?.storage_path || existing?.media_status === "completed") {
          // fall through to AI logic gates below (we still may need to skip inbound-only flows)
        } else {
          const rawTrim: any = {
            messageId: wapiMessageId,
            from: phone,
            type,
            text: text ?? null,
            hasMedia: isMediaType,
          };
          if (isMediaType && mediaMeta) rawTrim.media_meta = mediaMeta;

          const insertPayload: any = {
            user_id: userId,
            chat_id: chatId,
            direction: fromMe ? "outbound" : "inbound",
            sender: fromMe ? "whatsapp" : "contact",
            message_type: messageType,
            content: text ?? null,
            wapi_message_id: wapiMessageId,
            raw: rawTrim,
            media_status: isMediaType ? "pending" : null,
            media_attempts: 0,
            media_next_retry_at: isMediaType ? new Date().toISOString() : null,
          };

          if (existing?.id) {
            await supabaseAdmin.from("crm_messages")
              .update(insertPayload)
              .eq("id", existing.id);
          } else if (wapiMessageId) {
            const { error: upErr } = await supabaseAdmin.from("crm_messages")
              .upsert(insertPayload, { onConflict: "user_id,direction,wapi_message_id" });
            if (upErr) {
              console.error("[wapi-webhook] message upsert error:", upErr.message);
              return new Response("Message persistence failed", { status: 500 });
            }
          } else {
            const { error: insErr } = await supabaseAdmin.from("crm_messages").insert(insertPayload);
            if (insErr) {
              console.error("[wapi-webhook] message insert error:", insErr.message);
              return new Response("Message persistence failed", { status: 500 });
            }
          }

          // Try to download media inline so it appears immediately when W-API is fast.
          // On failure the row stays pending and the every-minute cron reprocesses it.
          if (isMediaType && wapiMessageId) {
            const { data: row } = await supabaseAdmin
              .from("crm_messages")
              .select("id, user_id, chat_id, media_attempts, raw")
              .eq("user_id", userId)
              .eq("wapi_message_id", wapiMessageId)
              .eq("direction", fromMe ? "outbound" : "inbound")
              .maybeSingle();
            if (row) {
              try { await processPendingMediaRow(supabaseAdmin, row); }
              catch (e: any) { console.error("[wapi-webhook] inline media process error:", e?.message ?? e); }
            }
          }
        }


        // Mensagens fromMe (eco da própria IA, envio pelo CRM ou WhatsApp Web/celular)
        // são espelhadas no CRM mas nunca devem acionar a IA. NÃO pausam o bot —
        // só o admin clicando no botão de pausar pode desativar.
        if (fromMe) {
          console.log("[ai-diag] stop=fromMe", { chatId, userId });
          return new Response("ok", { status: 200 });
        }

        // 5b) Grupo com resposta desativada: registra mas não aciona IA.
        if (isGroup && !replyInGroups) {
          console.log("[ai-diag] stop=group-disabled", { chatId, userId });
          return new Response("ok", { status: 200 });
        }

        // [SATISFACTION] Captura de avaliação — isolado, não altera fluxos.
        // Só age se houver pesquisa enviada e ainda sem resposta para este chat.
        // Quando captura, marca answered_at e retorna — impede qualquer agente
        // de responder à mensagem de avaliação.
        try {
          const { maybeCaptureRating } = await import("@/lib/satisfaction.server");
          const cap = await maybeCaptureRating({
            supabaseAdmin,
            ownerId: userId,
            chatId,
            message: text,
          });
          if (cap.handled) {
            console.log("[ai-diag] stop=satisfaction-captured", { chatId, userId });
            return new Response("ok", { status: 200 });
          }
        } catch (e) {
          console.warn("[satisfaction] capture skipped:", e instanceof Error ? e.message : e);
        }

        const lower = (text ?? "").trim().toLowerCase();

        // 6) Commands
        if (lower === "#iniciar" || lower === "#reiniciar") {
          // Reset completo para testes: remove pausa, conversa, mensagens e
          // volta o card do kanban para a primeira coluna.
          await supabaseAdmin.from("crm_paused_chats").delete().eq("user_id", userId).eq("chat_id", chatId);
          await supabaseAdmin.from("flow_conversations").delete().eq("user_id", userId).eq("chat_id", chatId);
          await supabaseAdmin.from("chat_assignments").delete().eq("owner_id", userId).eq("chat_id", chatId);
          await supabaseAdmin.from("crm_messages").delete().eq("user_id", userId).eq("chat_id", chatId);
          const { data: cols } = await supabaseAdmin
            .from("kanban_columns").select("id, position")
            .eq("user_id", userId).order("position").limit(1);
          const firstColId = (cols ?? [])[0]?.id as string | undefined;
          // Remove eventuais cards duplicados; mantém apenas o mais antigo e reseta.
          const { data: existingCards } = await supabaseAdmin
            .from("kanban_cards").select("id")
            .eq("user_id", userId).eq("chat_id", chatId)
            .order("created_at", { ascending: true });
          const cards = existingCards ?? [];
          if (cards.length > 1) {
            const idsToDelete = cards.slice(1).map((c: any) => c.id);
            await supabaseAdmin.from("kanban_cards").delete().in("id", idsToDelete);
          }
          if (cards[0] && firstColId) {
            await supabaseAdmin.from("kanban_cards")
              .update({ column_id: firstColId, summary: null, updated_at: new Date().toISOString() })
              .eq("id", (cards[0] as any).id);
          }
          await sendText(instanceId, apiToken, chatId, "🔄 Atendimento reiniciado. Começando do zero pelo Primeiro Atendimento.");
          return new Response("ok", { status: 200 });
        }

        // 6b) Extração cadastral independente da resposta da IA.
        // Executa logo após persistir a mensagem inbound para não ser ignorada
        // quando o chat estiver pausado, atribuído a humano, responder por áudio
        // ou encerrar por qualquer gate abaixo.
        let clientExtractionAttempted = false;
        try {
          const inboundText = (text ?? "").toString();
          const inboundLower = inboundText.toLowerCase();
          const hasCpf = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(inboundText);
          const hasCep = /\b\d{5}-?\d{3}\b/.test(inboundText);
          const hasBirth = /\b\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}\b/.test(inboundText)
            || /\bnasc/i.test(inboundText);
          const hasAddress = /\b(rua|av\.?|avenida|travessa|alameda|bairro|cidade)\b/i.test(inboundText);
          const contentSignal = hasCpf || hasCep || (hasBirth && hasAddress);
          const clientConfirmed = /(correto|confirmo|confere|est[aá]\s+(certo|correto)|t[aá]\s+certo|atualizad[oa]|recebid[oa]|isso\s+mesmo|perfeito|\bsim\b|\bblz\b|ok(ay)?\s*(!|\.)?$|pode\s+seguir)/.test(inboundLower);

          const { count: inboundCount } = await supabaseAdmin
            .from("crm_messages")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId).eq("chat_id", chatId)
            .eq("direction", "inbound");
          const n = inboundCount ?? 0;
          const countSignal = n === 3 || (n > 3 && n % 5 === 0);

          if (contentSignal || clientConfirmed || countSignal) {
            clientExtractionAttempted = true;
            const { runExtractClientFromChat } = await import("@/lib/client-extract.server");
            const res = await runExtractClientFromChat(supabaseAdmin, userId, chatId);
            console.log("[extract] inbound resultado:", JSON.stringify(res));
          }
        } catch (e) {
          console.warn("[extract] inbound falhou:", e instanceof Error ? e.message : e);
        }

        // 7a) IA global desligada pelo admin? Não responde, mas registra a msg.
        const { data: aiGlobal } = await supabaseAdmin
          .from("ai_global_state").select("active").eq("owner_id", userId).maybeSingle();
        if (aiGlobal && aiGlobal.active === false) {
          console.log("[ai-diag] stop=ai-global-off", { chatId, userId });
          return new Response("ok", { status: 200 });
        }

        // 7b) Paused (por operador ou usuário)?
        const { data: paused } = await supabaseAdmin
          .from("crm_paused_chats").select("paused_by")
          .eq("user_id", userId).eq("chat_id", chatId).maybeSingle();
        if (paused) {
          console.log("[ai-diag] stop=paused", { chatId, userId, paused_by: paused.paused_by });
          return new Response("ok", { status: 200 });
        }

        // 7c) Atribuída a um humano diferente do dono? IA não responde.
        const { data: assignment } = await supabaseAdmin
          .from("chat_assignments").select("assigned_to")
          .eq("owner_id", userId).eq("chat_id", chatId).maybeSingle();
        if (assignment && assignment.assigned_to && assignment.assigned_to !== userId) {
          console.log("[ai-diag] stop=assigned-to-human", { chatId, userId, assigned_to: assignment.assigned_to });
          return new Response("ok", { status: 200 });
        }


        // 7d) Sem atribuição — tenta rotear pelo assunto via keywords de setores
        if (!assignment) {
          const { data: msgHistory } = await supabaseAdmin
            .from("crm_messages").select("content").eq("user_id", userId).eq("chat_id", chatId)
            .order("created_at").limit(10);
          const combined = (msgHistory ?? []).map((m: { content: string | null }) => (m.content ?? "").toLowerCase()).join(" ");
          const { data: sectors } = await supabaseAdmin
            .from("sectors").select("id, keywords").eq("owner_id", userId).eq("active", true);
          let best: { id: string; score: number } | null = null;
          for (const s of (sectors ?? []) as { id: string; keywords: string[] }[]) {
            const score = (s.keywords ?? []).reduce(
              (acc: number, kw: string) => acc + (combined.includes(kw.toLowerCase()) ? 1 : 0),
              0,
            );
            if (score > 0 && (!best || score > best.score)) best = { id: s.id, score };
          }
          if (best) {
            const { data: lead } = await supabaseAdmin
              .from("sector_members").select("user_id").eq("sector_id", best.id).eq("is_lead", true).maybeSingle();
            await supabaseAdmin.from("chat_assignments").upsert(
              {
                owner_id: userId, chat_id: chatId,
                assigned_to: lead?.user_id ?? null, sector_id: best.id, assigned_by: "ai",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "owner_id,chat_id" },
            );
            await supabaseAdmin.from("chat_transfer_log").insert({
              owner_id: userId, chat_id: chatId, to_user: lead?.user_id ?? null,
              sector_id: best.id, actor: userId, reason: "ai-auto-route",
            });
            // Se rotearmos pra um humano lead, a IA para de responder.
            if (lead?.user_id) {
              console.log("[ai-diag] stop=auto-routed-to-lead", { chatId, userId, sector_id: best.id, lead: lead.user_id });
              return new Response("ok", { status: 200 });
            }
          }
        }

        // 8) Lock + processing protegido por try/finally
        const lockId = crypto.randomUUID();
        let lockAcquired = false;
        try {
          const now = Date.now();
          const { data: existing } = await supabaseAdmin
            .from("flow_conversations")
            .select("id, session_variables")
            .eq("user_id", userId).eq("chat_id", chatId).maybeSingle();

          if (existing) {
            const vars = ((existing as any).session_variables ?? {}) as any;
            const lockTs = Number(vars.__processing_lock_ts ?? 0);
            if (vars.__processing_lock_id && now - lockTs < 90_000) {
              return new Response("ok", { status: 200 });
            }
            await supabaseAdmin.from("flow_conversations").update({
              session_variables: { ...vars, __processing_lock_id: lockId, __processing_lock_ts: now },
              last_activity_at: new Date().toISOString(),
            }).eq("id", (existing as any).id);
            // Verificação pós-update para evitar corrida: se outro webhook sobrescreveu o lock, aborta
            await new Promise((r) => setTimeout(r, 80));
            const { data: verify } = await supabaseAdmin
              .from("flow_conversations")
              .select("session_variables")
              .eq("id", (existing as any).id)
              .maybeSingle();
            if ((verify as any)?.session_variables?.__processing_lock_id !== lockId) {
              return new Response("ok", { status: 200 });
            }
          } else {
            const { error: insErr } = await supabaseAdmin.from("flow_conversations").insert({
              user_id: userId, chat_id: chatId,
              session_variables: { __processing_lock_id: lockId, __processing_lock_ts: now },
            });
            if (insErr && insErr.code === "23505") {
              // Corrida: outro request criou a linha primeiro
              return new Response("ok", { status: 200 });
            }
            if (insErr) throw insErr;
          }
          lockAcquired = true;

          // 9) Não-texto: para imagens, seguimos com a IA usando visão (multimodal).
          // Outros tipos (áudio/vídeo/documento) continuam sem resposta automática.
          if (!text || type !== "text") {
            if (type === "image") {
              // Placeholder textual — a imagem real vai como image_url na msg atual.
              if (!text) text = "[imagem enviada pelo cliente]";
            } else {
              // Sticker / GIF: agradece em texto e não segue pra IA multimodal.
              const mc = (payload?.msg?.msgContent ?? payload?.msgContent ?? {}) as any;
              const isGif = normalizedType === "video" && Boolean(mc?.videoMessage?.gifPlayback);
              if (normalizedType === "sticker" || isGif) {
                const kind = isGif ? "gif" : "figurinha";
                await sendText(
                  instanceId, apiToken, chatId,
                  `Obrigado pelo ${kind}! 😊 Recebi aqui. Como posso te ajudar?`,
                );
                console.log("[ai-diag] stop=sticker-or-gif-thanked", { chatId, userId, type: normalizedType });
                return new Response("ok", { status: 200 });
              }
              console.log("[ai-diag] stop=non-text", { chatId, userId, type, isMediaType });
              if (!isMediaType) {
                await sendText(instanceId, apiToken, chatId, "Recebi aqui! 😊 Como posso te ajudar?");
              }
              return new Response("ok", { status: 200 });
            }
          }

          // Mensagem só com emojis (sem letras/números): agradece e não chama a IA.
          if (text && type === "text") {
            const stripped = text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, "");
            if (stripped.length === 0) {
              await sendText(
                instanceId, apiToken, chatId,
                "Obrigado pelo carinho! 😊 Recebi seus emojis. Se precisar de algo, é só me dizer.",
              );
              console.log("[ai-diag] stop=emoji-only-thanked", { chatId, userId });
              return new Response("ok", { status: 200 });
            }
          }


          // 10) Histórico (inclui media_id/mime para permitir visão nas imagens)
          const { data: history } = await supabaseAdmin
            .from("crm_messages")
            .select("direction, sender, content, media_id, mime, message_type")
            .eq("user_id", userId).eq("chat_id", chatId)
            .order("created_at", { ascending: false })
            .limit(20);
          const hist = (history ?? []).reverse();

          // Busca segura: se houver duplicatas históricas, pega a mais antiga
          // (evita cair no insert e criar um novo card).
          const { data: cardRows } = await supabaseAdmin
            .from("kanban_cards")
            .select("id, column_id, summary")
            .eq("user_id", userId).eq("chat_id", chatId)
            .order("created_at", { ascending: true })
            .limit(1);
          let cardRow: any = (cardRows ?? [])[0] ?? null;

          const { data: allKanbanCols } = await supabaseAdmin
            .from("kanban_columns")
            .select("id, name, position")
            .eq("user_id", userId)
            .order("position");

          // Garante que toda conversa recebida exista no Kanban.
          if (!cardRow && (allKanbanCols ?? []).length > 0) {
            const firstCol = (allKanbanCols ?? [])[0] as any;
            const { data: createdCard, error: createCardError } = await supabaseAdmin
              .from("kanban_cards")
              .insert({
                user_id: userId,
                chat_id: chatId,
                column_id: firstCol.id,
                contact_name: chatId,
                contact_phone: phone,
                summary: text?.slice(0, 500) ?? null,
                last_message_at: new Date().toISOString(),
                last_client_message_at: new Date().toISOString(),
              })
              .select("id, column_id, summary")
              .single();
            if (createCardError) {
              console.error("[wapi-webhook] kanban card create error:", createCardError.message);
            } else {
              cardRow = createdCard;
            }
          }

          let currentColumnName = "";
          let currentColumnPosition = 0;
          if (cardRow) {
            let currentCol = (allKanbanCols ?? []).find(
              (c: any) => c.id === (cardRow as any).column_id,
            ) as any;
            currentColumnName = (currentCol?.name ?? "").toLowerCase();
            currentColumnPosition = Number(currentCol?.position ?? 0);

            const clientText = text.toLowerCase();
            let explicitStage = "";
            if (/(falar com (um |uma )?(especialista|advogad[oa])|confirmo (a |o )?(reuni[ãa]o|hor[áa]rio|agendamento)|pode (chamar|passar) (o |a )?especialista)/.test(clientText)) {
              explicitStage = "especialista";
            } else if (
              /(pode (agendar|marcar)|vamos (agendar|marcar)|\b(sim|ok|beleza|fechado|combinado|confirmo)\b[^.!?]{0,40}(agendar|marcar|hor[áa]rio|reuni[ãa]o|\bcall\b|\bmeet\b|amanh[ãa]|hoje|segunda|ter[çc]a|quarta|quinta|sexta)|\b\d{1,2}[:h]\d{0,2}\b|(amanh[ãa]|hoje|segunda|ter[çc]a|quarta|quinta|sexta)[^.!?]{0,20}\b\d{1,2}\b)/.test(clientText)
            ) {
              explicitStage = "call";
            } else if (/(interesse|quero|preciso|gostaria|quanto (custa|é|fica)|valor|pre[çc]o|como funciona)/.test(clientText)) {
              explicitStage = "interesse";
            }

            const explicitTargetRe: Record<string, RegExp> = {
              interesse: /^interesse$/i,
              call: /call\/?meet|call|meet/i,
              especialista: /especialista/i,
            };
            const target = (allKanbanCols ?? []).find((c: any) =>
              explicitTargetRe[explicitStage]?.test(c.name),
            ) as any;

            // Avança no máximo 1 coluna por mensagem
            const shouldAdvance = target && Number(target.position) === currentColumnPosition + 1;

            // Resumo: em "Primeiro Atendimento", acumula mensagens do cliente
            // para o handoff humano. Fora dele, preserva o resumo capturado.
            const isPrimeiro = /primeiro atendimento/i.test(currentColumnName);
            let newSummary: string;
            if (isPrimeiro) {
              const inbound = (hist ?? [])
                .filter((h: any) => h.direction === "inbound" && h.content)
                .map((h: any) => String(h.content).trim())
                .filter(Boolean);
              if (!inbound.includes(text.trim())) inbound.push(text.trim());
              newSummary = inbound.join(" | ").slice(0, 500);
            } else {
              const existing = ((cardRow as any).summary ?? "").toString().trim();
              newSummary = existing || text.slice(0, 500);
            }

            const cardUpdate = {
              summary: newSummary,
              last_message_at: new Date().toISOString(),
              last_client_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...(shouldAdvance ? { column_id: target.id as string } : {}),
            };

            const { error: cardUpdateError } = await supabaseAdmin
              .from("kanban_cards")
              .update(cardUpdate)
              .eq("id", (cardRow as any).id);
            if (cardUpdateError) {
              console.error("[wapi-webhook] kanban card update error:", cardUpdateError.message);
            } else if (shouldAdvance) {
              const previousColumnId = (cardRow as any).column_id;
              const { error: eventError } = await supabaseAdmin.from("kanban_card_events").insert({
                user_id: userId,
                card_id: (cardRow as any).id,
                event_type: "moved",
                from_column_id: previousColumnId,
                to_column_id: target.id,
                actor: "ai",
                payload: { stage: explicitStage, source: "client_message" },
              });
              if (eventError) console.error("[wapi-webhook] kanban event error:", eventError.message);
              (cardRow as any).column_id = target.id;
              currentCol = target;
              currentColumnName = String(target.name).toLowerCase();
              currentColumnPosition = Number(target.position);

              // [SATISFACTION] Gatilho isolado: ao entrar em "Envio de Documentos" (ou similar
              // relacionado a documentos para contrato), dispara a pesquisa uma única vez.
              try {
                const { SATISFACTION_TRIGGER_COLUMN, sendSatisfactionSurvey } = await import("@/lib/satisfaction.server");
                if (SATISFACTION_TRIGGER_COLUMN.test(String(target.name))) {
                  void sendSatisfactionSurvey({
                    supabaseAdmin,
                    ownerId: userId,
                    chatId,
                    instanceId,
                    apiToken,
                  }).catch((e) => console.warn("[satisfaction] send failed:", e?.message ?? e));
                }
              } catch (e) {
                console.warn("[satisfaction] trigger skipped:", e instanceof Error ? e.message : e);
              }
            }
          }
          // Sofia (whatsapp) → Primeiro Atendimento
          // Marina (triagem) → Interesse
          // Rafael (analise) → Call/Meet
          // Bruno (documentos) → a partir de "Falar c/ Especialista" / envio de docs
          type AgentKey = "whatsapp" | "triagem" | "analise" | "documentos";
          let preferredAgent: AgentKey = "whatsapp";
          if (/especialista|documento|contrato|análise ia|analise ia/i.test(currentColumnName)) {
            preferredAgent = "documentos";
          } else if (/call|meet/i.test(currentColumnName)) {
            preferredAgent = "analise";
          } else if (/interesse/i.test(currentColumnName)) {
            preferredAgent = "triagem";
          }

          // 11) AI settings — tenta na ordem: preferido → cadeia de fallbacks
          const fallbackChain: AgentKey[] = [
            preferredAgent,
            ...(["whatsapp", "triagem", "analise", "documentos"] as AgentKey[]).filter(
              (a) => a !== preferredAgent,
            ),
          ];
          let aiCfgRow: any = null;
          let activeAgent: AgentKey = preferredAgent;
          for (const agent of fallbackChain) {
            const { data: cfg } = await supabaseAdmin
              .from("ai_settings")
              .select("provider,model,api_key,base_url,openai_key,gemini_key,inworld_key")
              .eq("user_id", userId)
              .eq("agent_key", agent)
              .maybeSingle();
            if (cfg && ((cfg as any).api_key || (cfg as any).openai_key || (cfg as any).gemini_key || (cfg as any).inworld_key)) {
              aiCfgRow = cfg;
              activeAgent = agent;
              break;
            }
            if (cfg) {
              // guarda como fallback se não tiver chave ainda (pode ser só config vazia)
              aiCfgRow = aiCfgRow ?? cfg;
            }
          }
          // Fallback extra: se nenhum agent específico tem chave, pega QUALQUER ai_settings com chave do usuário (sua OpenAI)
          if (!aiCfgRow || !((aiCfgRow as any).api_key || (aiCfgRow as any).openai_key || (aiCfgRow as any).gemini_key || (aiCfgRow as any).inworld_key)) {
            const { data: anyWithKey } = await supabaseAdmin
              .from("ai_settings")
              .select("provider,model,api_key,base_url,openai_key,gemini_key,inworld_key,agent_key")
              .eq("user_id", userId)
              .maybeSingle();
            // Tenta achar qualquer linha com chave preenchida
            if (anyWithKey && ((anyWithKey as any).api_key || (anyWithKey as any).openai_key || (anyWithKey as any).gemini_key)) {
              aiCfgRow = anyWithKey;
              if ((anyWithKey as any).agent_key) activeAgent = (anyWithKey as any).agent_key as AgentKey;
            } else {
              const { data: rows } = await supabaseAdmin
                .from("ai_settings")
                .select("provider,model,api_key,base_url,openai_key,gemini_key,inworld_key,agent_key")
                .eq("user_id", userId);
              const found = (rows ?? []).find(
                (r: any) => (r.api_key ?? r.openai_key ?? r.gemini_key ?? "").trim(),
              );
              if (found) {
                aiCfgRow = found;
                if (found.agent_key) activeAgent = found.agent_key as AgentKey;
              }
            }
          }


          // 11a) Personalidade do agente ativo (com fallback para qualquer persona salva)
          const { data: personalityRow } = await supabaseAdmin
            .from("ai_personality").select("*")
            .eq("user_id", userId).eq("agent_key", activeAgent).maybeSingle();
          let personaData: any = personalityRow;
          if (!personaData) {
            const { data: anyPersona } = await supabaseAdmin
              .from("ai_personality").select("*")
              .eq("user_id", userId).limit(1).maybeSingle();
            personaData = anyPersona;
          }
          const persona = (personaData as any) ?? {};
          const maxChars = Number(persona.max_chars_per_chunk ?? 250);
          const typingDelay = Number(persona.typing_delay_ms ?? 2000);

          // 11b) Base de conhecimento — apenas artigos do agente ativo ou globais
          let kbBlock = "";
          if (persona.use_knowledge_base !== false) {
            const { data: kbRows } = await supabaseAdmin
              .from("knowledge_base")
              .select("title,content,category,agent_keys")
              .eq("active", true)
              .limit(500);
            const kb = (kbRows ?? []).filter((r: any) => {
              const keys = r.agent_keys ?? [];
              return keys.length === 0 || keys.includes(activeAgent);
            });
            if (kb.length > 0) {
              kbBlock = kb
                .map((r: any) => `# ${r.title}${r.category ? ` (${r.category})` : ""}\n${r.content}`)
                .join("\n\n---\n\n");
            }
          }

          const systemParts = [
            persona.persona ? `Persona: ${persona.persona}` : "",
            persona.tone ? `Tom: ${persona.tone}` : "",
            persona.rules ? `Regras: ${persona.rules}` : "",
            "Responda em português brasileiro de forma natural, curta e contextual como em uma conversa de WhatsApp. NUNCA repita a mesma saudação ou resposta literal — analise o histórico e continue a conversa de forma coerente. Se o cliente repetir saudação, varie.",
            kbBlock
              ? `BASE DE CONHECIMENTO (única fonte de verdade deste agente). Responda SOMENTE com base no conteúdo abaixo. Se a resposta não estiver aqui, diga com honestidade que não tem essa informação e ofereça encaminhar para um atendente humano. NÃO invente e NÃO use conhecimento externo.\n\n${kbBlock}`
              : "IMPORTANTE: você não possui base de conhecimento cadastrada para este agente. Se o cliente perguntar algo específico, informe que não tem essa informação e ofereça encaminhar para um atendente humano. Não invente respostas.",
          ].filter(Boolean).join("\n\n");

          // Gera URL pública assinada para uma imagem armazenada no Bunny/media_assets.
          const buildSignedImageUrl = async (mediaId: string, mimeVal: string | null): Promise<string | null> => {
            const secret = process.env.WAPI_WEBHOOK_SECRET;
            if (!secret) return null;
            try {
              const { sha256Hex } = await import("@/lib/bunny.server");
              const exp = Math.floor(Date.now() / 1000) + 3600;
              const sig = await sha256Hex(`${secret}:${mediaId}:${exp}`);
              const ENV_PUBLIC = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
              const base = ENV_PUBLIC || "https://agentesjuridicos.lovable.app";
              const ext = (mimeVal ?? "").toLowerCase() === "image/png" ? "png" : "jpg";
              return `${base}/api/public/media/${encodeURIComponent(mediaId)}.${ext}?exp=${exp}&sig=${sig}`;
            } catch { return null; }
          };

          const messages: any[] = [];
          for (const h of hist) {
            const role = h.direction === "inbound" ? "user" : "assistant";
            const isImage = h.direction === "inbound"
              && h.media_id
              && typeof h.mime === "string"
              && h.mime.startsWith("image/");
            if (isImage) {
              const url = await buildSignedImageUrl(String(h.media_id), h.mime as string | null);
              if (url) {
                const parts: any[] = [
                  { type: "text", text: (h.content && h.content.trim()) || "[imagem enviada pelo cliente]" },
                  // Formato CoreMessage do AI SDK — o provider converte para
                  // o shape correto (OpenAI image_url / Gemini inline_data).
                  { type: "image", image: new URL(url) },
                ];
                messages.push({ role, content: parts });
                continue;
              }
            }
            if (h.content) messages.push({ role, content: h.content });
          }
          const aiCfg = aiCfgRow ?? {};
          const rawModelId: string = aiCfg.model ?? "openai/gpt-5-mini";
          const hasCustomKey = !!(((aiCfg as any).api_key ?? (aiCfg as any).openai_key ?? "").trim());
          // IDs "vendor/modelo" (ex: "openai/gpt-5-mini") são do Lovable Gateway,
          // mas se o usuário preencheu BYOK, usamos a chave dele direto em api.openai.com
          const isGatewayId = !hasCustomKey && /^(openai|google|anthropic|meta|mistralai)\//i.test(rawModelId);
          const provider = isGatewayId ? "lovable" : (aiCfg.provider ?? "lovable").toLowerCase();
          let modelId = isGatewayId ? rawModelId : pickProviderModelFallback(provider, rawModelId);

          // Normaliza modelo: "GPT-5 Mini" -> "gpt-5-mini" (OpenAI exige lowercase com hífen)
          const normalizeModel = (m: string) =>
            m
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "-")
              .replace(/_/g, "-");
          modelId = normalizeModel(modelId);
          // Fallback: GPT-5 ainda não existe na OpenAI — mapeia para 4o-mini
          if (/^gpt-5/i.test(modelId)) modelId = "gpt-4o-mini";

          // Log diagnóstico: ajuda a ver por que a chave não foi achada
          console.log("[ai-diag] aiCfgRow", {
            userId,
            activeAgent,
            provider,
            rawModelId,
            modelId,
            hasApiKey: !!(aiCfg as any)?.api_key,
            hasOpenaiKey: !!(aiCfg as any)?.openai_key,
            baseUrl: (aiCfg as any)?.base_url,
            isGatewayId,
          });

          let providerKey: string | null = null;
          let providerBaseUrl: string | null = null;
          let providerHeaders: Record<string, string> | null = null;

          if (!isGatewayId) {
            if (provider === "openai" || provider === "openai gpt" || provider.includes("openai")) {
              providerKey = (aiCfg.api_key ?? (aiCfg as any).openai_key)?.trim() || null;
              providerBaseUrl = (aiCfg.base_url ?? (aiCfg as any).base_url)?.trim() || "https://api.openai.com/v1";
              if (providerKey) providerHeaders = { Authorization: `Bearer ${providerKey}` };
            } else if (provider === "google" || provider === "gemini") {
              providerKey = (aiCfg.api_key ?? (aiCfg as any).gemini_key)?.trim() || null;
              providerBaseUrl = (aiCfg.base_url ?? (aiCfg as any).base_url)?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai";
              if (providerKey) providerHeaders = {
                Authorization: `Bearer ${providerKey}`,
                "x-goog-api-key": providerKey,
              };
            } else if (provider === "inworld") {
              providerKey = (aiCfg.api_key ?? (aiCfg as any).inworld_key)?.trim() || null;
              providerBaseUrl = (aiCfg.base_url ?? (aiCfg as any).base_url)?.trim() || null;
              if (providerKey) providerHeaders = { Authorization: `Bearer ${providerKey}` };
            } else if (provider === "custom" || aiCfg.api_key) {
              providerKey = (aiCfg.api_key ?? (aiCfg as any).api_key)?.trim() || null;
              providerBaseUrl = (aiCfg.base_url ?? (aiCfg as any).base_url)?.trim() || "https://api.openai.com/v1";
              if (providerKey) providerHeaders = { Authorization: `Bearer ${providerKey}` };
            }
          }
          // Último recurso: se ainda não achou chave mas o usuário tem qualquer chave salva, usa ela direto (evita "Configuração indisponível")
          if (!providerKey) {
            console.log("[ai-diag] no providerKey, tentando resolveUserAi fallback", { userId, provider, modelId });
            try {
              const { resolveUserAi } = await import("@/lib/user-ai-provider.server");
              const resolved = await resolveUserAi(supabaseAdmin, userId, {
                gatewayModel: "gpt-4o-mini",
                userOpenAiModel: modelId,
              });
              console.log("[ai-diag] resolveUserAi result", { isGateway: resolved.isGateway, model: resolved.model, hasKey: !!resolved.apiKey });
              if (!resolved.isGateway) {
                providerKey = resolved.apiKey;
                providerBaseUrl = resolved.baseUrl;
                modelId = resolved.model;
                providerHeaders = { [resolved.authHeader]: resolved.headerValue } as Record<string, string>;
                console.log("[ai-diag] fallback usando chave do sistema", { providerKeyPrefix: providerKey.slice(0, 8), baseUrl: providerBaseUrl, modelId });
              } else {
                console.log("[ai-diag] resolveUserAi caiu no gateway (sem chave própria)");
              }
            } catch (e: any) {
              console.log("[ai-diag] resolveUserAi erro", e?.message);
            }
          }


          let gateway: any;
          if (providerKey && providerBaseUrl && providerHeaders) {
            const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
            gateway = createOpenAICompatible({
              name: provider,
              baseURL: providerBaseUrl,
              headers: providerHeaders,
            });
          } else {
            const lovableKey = process.env.LOVABLE_API_KEY;
            if (!lovableKey) {
              console.error("[ai-diag] stop=no-lovable-key", { chatId, userId, activeAgent });
              await sendText(instanceId, apiToken, chatId, "Configuração de IA indisponível no momento.");
              return new Response("ok", { status: 200 });
            }
            gateway = createLovableAiGatewayProvider(lovableKey);
          }

          console.log("[ai-diag] calling-model", {
            chatId, userId, activeAgent, provider, modelId,
            using: providerKey ? "custom-key" : "lovable-gateway",
            kb: Boolean(kbBlock), personaLoaded: Boolean(personalityRow),
          });

          let reply = "";
          try {
            const r = await generateText({
              model: gateway(modelId),
              system: systemParts,
              messages: messages as any,
              temperature: 0.85,
            });
            reply = (r.text ?? "").trim();
            console.log("[ai-diag] model-ok", { chatId, userId, activeAgent, replyLen: reply.length });
          } catch (err: any) {
            console.error("[ai-diag] model-error", {
              chatId, userId, activeAgent, provider, modelId,
              status: err?.statusCode ?? err?.status,
              message: String(err?.message ?? err).slice(0, 300),
            });
            reply = "";
          }

          if (!reply) {
            console.log("[ai-diag] stop=empty-reply", { chatId, userId, activeAgent });
            await sendText(instanceId, apiToken, chatId, "Desculpe, não consegui gerar uma resposta agora. Tente de novo em instantes.");
            return new Response("ok", { status: 200 });
          }


          // 12) Envia como áudio quando:
          //   (a) a IA marcou a resposta com [audio] no início, OU
          //   (b) o usuário pediu áudio explicitamente na mensagem recebida.
          const userAskedAudio = !!(text && /\b(a[uú]dio|manda(r)?\s+(um\s+)?a[uú]dio|em\s+a[uú]dio|responde\s+em\s+a[uú]dio|fala|voz)\b/i.test(text));
          const audioTagMatch = reply.match(/^\s*\[audio\]\s*/i);
          if (audioTagMatch || userAskedAudio) {
            const spoken = (audioTagMatch ? reply.slice(audioTagMatch[0].length) : reply).trim();
            await sendPresence(instanceId, apiToken, chatId, "recording");
            // Voz específica por agente (envs opcionais); cai no default global se ausente.
            // Sanitiza: aceita URL do fish.audio, "modelId - nome", ou hex puro.
            // Prioriza o primeiro token hex de 24+ chars; caso não haja, usa o último
            // segmento da URL removendo caracteres inválidos ([^A-Za-z0-9_-]).
            const cleanVoiceId = (v?: string) => {
              if (!v) return undefined;
              const trimmed = v.trim();
              const hex = trimmed.match(/[A-Fa-f0-9]{24,}/)?.[0];
              if (hex) return hex;
              const last = trimmed.split(/[\s/?#]+/).filter(Boolean).pop() ?? "";
              const cleaned = last.replace(/[^A-Za-z0-9_-]/g, "");
              return cleaned.length >= 1 && cleaned.length <= 128 ? cleaned : undefined;
            };
            const perAgentVoice: Record<string, string | undefined> = {
              whatsapp: cleanVoiceId(process.env.FISH_AUDIO_VOICE_WHATSAPP),
              triagem: cleanVoiceId(process.env.FISH_AUDIO_VOICE_TRIAGEM),
              analise: cleanVoiceId(process.env.FISH_AUDIO_VOICE_ANALISE),
              documentos: cleanVoiceId(process.env.FISH_AUDIO_VOICE_DOCUMENTOS),
            };
            const voiceId = perAgentVoice[activeAgent] || cleanVoiceId(process.env.FISH_AUDIO_VOICE_ID);
            console.log("[ai-diag] tts-voice", { activeAgent, voiceId: voiceId ?? "(default)" });
            const tts = await fishAudioSynthesize(spoken, { referenceId: voiceId });
            if (tts.ok) {
              // Upload MP3 → bucket crm-media → proxy assinado cuja URL termina
              // literalmente em .mp3 (validação obrigatória da W-API).
              const path = `tts/${userId}/${crypto.randomUUID()}.mp3`;
              const { error: upErr } = await supabaseAdmin.storage
                .from("crm-media")
                .upload(path, tts.mp3, { contentType: "audio/mpeg", upsert: false });
              if (!upErr) {
                const secret = process.env.WAPI_WEBHOOK_SECRET;
                if (secret) {
                  const { sha256Hex } = await import("@/lib/bunny.server");
                  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
                  const payload = Buffer.from(`${expiresAt}:${path}`, "utf8").toString("base64url");
                  const signature = await sha256Hex(`${secret}:${payload}`);
                  const publicBase = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "")
                    || "https://agentesjuridicos.lovable.app";
                  const audioUrl = `${publicBase}/api/public/tts/${payload}.${signature}.mp3`;
                  const sr = await sendAudioUrl(instanceId, apiToken, chatId, audioUrl);
                  const wapiErr = (sr.body as any)?.error || ((sr.body as any)?.success === false);
                  await supabaseAdmin.from("crm_messages").insert({
                    user_id: userId, chat_id: chatId,
                    direction: "outbound", sender: activeAgent,
                    message_type: "audio", content: spoken,
                    storage_path: path, mime: "audio/mpeg",
                    wapi_message_id: (sr.body as any)?.messageId ?? null,
                    status: sr.ok && !wapiErr ? "sent" : "error",
                    raw: sr.body,
                  });
                  if (sr.ok && !wapiErr) {
                    console.log("[ai-diag] audio-sent", { chatId, userId, activeAgent, chars: spoken.length });
                    // pula envio de texto
                    reply = "";
                  } else {
                    console.error("[ai-diag] audio-send-failed", { chatId, userId, body: sr.body });
                    reply = spoken; // fallback: envia como texto
                  }
                } else {
                  console.error("[ai-diag] audio-url-failed", "WAPI_WEBHOOK_SECRET ausente");
                  reply = spoken;
                }
              } else {
                console.error("[ai-diag] audio-upload-failed", upErr.message);
                reply = spoken;
              }
            } else {
              console.error("[ai-diag] fish-audio-failed", tts.error);
              reply = spoken; // fallback: envia como texto
            }
          }

          // 12b) Chunk + envio com presença (texto)
          if (reply) {
            const chunks = chunkText(reply, maxChars);
            let totalDelay = 0;
            for (const chunk of chunks) {
              await sendPresence(instanceId, apiToken, chatId, "composing");
              const target = Math.min(typingDelay, Math.max(600, chunk.length * 35));
              const delay = Math.max(0, Math.min(target, MAX_TOTAL_DELAY_MS - totalDelay));
              if (delay > 0) await sleep(delay);
              totalDelay += delay;

              const sr = await sendText(instanceId, apiToken, chatId, chunk);
              const wapiErr = (sr.body as any)?.error || ((sr.body as any)?.success === false);
              await supabaseAdmin.from("crm_messages").insert({
                user_id: userId, chat_id: chatId,
                direction: "outbound",
                // Identifica qual agente respondeu (whatsapp/triagem/…) para exibir o nome no CRM
                sender: activeAgent,
                message_type: "text", content: chunk,
                wapi_message_id: (sr.body as any)?.messageId ?? null,
                status: sr.ok && !wapiErr ? "sent" : "error",
                raw: sr.body,
              });
            }

            // 12c) Extração automática de dados do cliente.
            // Awaited para garantir que o Worker não termine antes do insert.
            try {
              const inboundText = (text ?? "").toString();
              const inboundLower = inboundText.toLowerCase();
              const replyLower = (reply ?? "").toLowerCase();
               const hasCpf = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(inboundText);
              const hasCep = /\b\d{5}-?\d{3}\b/.test(inboundText);
              const hasBirth = /\b\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}\b/.test(inboundText)
                || /\bnasc/i.test(inboundText);
              const hasAddress = /\b(rua|av\.?|avenida|travessa|alameda|bairro|cidade)\b/i.test(inboundText);
              const contentSignal = hasCpf || hasCep || (hasBirth && hasAddress);
              // Confirmações explícitas do cliente ("correto", "confirmo", "está certo"…)
               const clientConfirmed = /(correto|confirmo|confere|est[aá]\s+(certo|correto)|t[aá]\s+certo|atualizad[oa]|recebid[oa]|isso\s+mesmo|perfeito|\bsim\b|\bblz\b|ok(ay)?\s*(!|\.)?$|pode\s+seguir)/.test(inboundLower);
              const agentConfirmed = /(dados\s+(conferidos|confirmados|completos)|cadastro\s+(conferido|confirmado|completo)|encaminh(ado|ei)|transfer[ií])/.test(replyLower);

              const { count: inboundCount } = await supabaseAdmin
                .from("crm_messages")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId).eq("chat_id", chatId)
                .eq("direction", "inbound");
              const n = inboundCount ?? 0;
              const countSignal = n === 3 || (n > 3 && n % 5 === 0);

               if (!clientExtractionAttempted && (contentSignal || clientConfirmed || agentConfirmed || countSignal)) {
                const { runExtractClientFromChat } = await import("@/lib/client-extract.server");
                try {
                  const res = await runExtractClientFromChat(supabaseAdmin, userId, chatId);
                  console.log("[extract] resultado:", JSON.stringify(res));
                } catch (e) {
                  console.warn("[extract] falhou:", e instanceof Error ? e.message : e);
                }
              }
            } catch (e) {
              console.warn("[extract] guard falhou:", e instanceof Error ? e.message : e);
            }
          }

          // 12.1) Handoff declarado pelo próprio agente na resposta
          // Ex.: Marina escreve "Encaminhei para o Rafael" → precisamos mover
          // o card para a próxima coluna, mesmo que o cliente não tenha pedido.
          if (cardRow) {
            try {
              const r = reply.toLowerCase();
              let handoffStage = "";
              if (/(especialista|advogad[oa]|bruno)\b/.test(r) && /(encaminh|transfer|passar|repassar|chamar)/.test(r)) {
                handoffStage = "especialista";
              } else if (/\brafael\b/.test(r) && /(encaminh|transfer|passar|repassar|chamar)/.test(r)) {
                handoffStage = "call";
              } else if (/\bmarina\b/.test(r) && /(encaminh|transfer|passar|repassar|chamar)/.test(r)) {
                handoffStage = "interesse";
              }
              if (handoffStage) {
                const handoffRe: Record<string, RegExp> = {
                  interesse: /^interesse$/i,
                  call: /call\/?meet|call|meet/i,
                  especialista: /especialista/i,
                };
                const target = (allKanbanCols ?? []).find((c: any) =>
                  handoffRe[handoffStage].test(c.name),
                ) as any;
                if (target && Number(target.position) === currentColumnPosition + 1) {
                  const previousColumnId = (cardRow as any).column_id;
                  await supabaseAdmin
                    .from("kanban_cards")
                    .update({ column_id: target.id, updated_at: new Date().toISOString() })
                    .eq("id", (cardRow as any).id);
                  await supabaseAdmin.from("kanban_card_events").insert({
                    user_id: userId,
                    card_id: (cardRow as any).id,
                    event_type: "moved",
                    from_column_id: previousColumnId,
                    to_column_id: target.id,
                    actor: "ai",
                    payload: { stage: handoffStage, source: "agent_handoff", agent: activeAgent },
                  });
                  (cardRow as any).column_id = target.id;
                  currentColumnName = String(target.name).toLowerCase();
                  currentColumnPosition = Number(target.position);
                }
              }
            } catch (e: any) {
              console.error("[wapi-webhook] agent handoff error:", e?.message ?? e);
            }
          }

          // 13) Classificador de estágio → move card no kanban (só avança, nunca volta)
          if (cardRow) {
            try {
              // Só mensagens do cliente podem promover o estágio. Uma oferta do agente
              // (ex.: "vamos agendar?") não significa que o cliente aceitou agendar.
              const recent = hist
                .filter((h: any) => h.direction === "inbound")
                .slice(-6)
                .map((h: any) => `Cliente: ${(h.content ?? "").slice(0, 300)}`)
                .join("\n") + `\nCliente: ${text}`;

              const clsSystem =
                 "Você classifica somente a intenção explicitamente demonstrada pelo CLIENTE em uma conversa jurídica. " +
                "Responda APENAS UMA palavra, sem pontuação, sem explicação: primeiro, interesse, call ou especialista.\n" +
                "- primeiro: só cumprimentos/perguntas iniciais, sem interesse claro\n" +
                "- interesse: cliente demonstrou interesse, pediu detalhes, disse 'quero', 'tenho interesse'\n" +
                "- call: cliente aceitou/pediu marcar reunião, call, consulta, horário, agendamento\n" +
                "- especialista: reunião já confirmada, hora de humano assumir";

              const cls = await generateText({
                model: gateway(modelId),
                system: clsSystem,
                messages: [{ role: "user", content: recent }] as any,
              });
              const rawCls = (cls.text ?? "").toLowerCase();
              // Extrai a primeira palavra-chave válida da resposta do LLM (tolera pontuação/frases)
              let stage =
                rawCls.match(/\b(especialista|call|meet|interesse|primeiro)\b/)?.[1] ?? "";
              if (stage === "meet") stage = "call";

              // Fallback heurístico baseado na última mensagem do cliente
              if (!stage) {
                const t = text.toLowerCase();
                if (/\b(especialista|advogad[oa])\b/.test(t)) stage = "especialista";
                else if (/(agendar|marcar|marcamos|hor[áa]rio|reuni[ãa]o|\bcall\b|\bmeet\b|consulta|amanh[ãa]|\bhoje\b|segunda|ter[çc]a|quarta|quinta|sexta)/.test(t)) stage = "call";
                else if (/(interesse|quero|preciso|gostaria|quanto (custa|é|fica)|valor|pre[çc]o|como funciona)/.test(t)) stage = "interesse";
              }
              console.log("[wapi-webhook] stage classifier:", { rawCls: rawCls.slice(0, 120), stage, currentColumnName });

              const stageToColName: Record<string, RegExp> = {
                primeiro: /primeiro atendimento/i,
                interesse: /^interesse$/i,
                call: /call\/?meet|call|meet/i,
                especialista: /especialista/i,
              };
              const targetRe = stageToColName[stage];
              if (targetRe) {
                const { data: allCols } = await supabaseAdmin
                  .from("kanban_columns")
                  .select("id, name, position")
                  .eq("user_id", userId);
                const target = (allCols ?? []).find((c: any) => targetRe.test(c.name));
                if (target && (target as any).position === currentColumnPosition + 1) {
                  await supabaseAdmin
                    .from("kanban_cards")
                    .update({ column_id: (target as any).id, updated_at: new Date().toISOString() })
                    .eq("id", (cardRow as any).id);
                  await supabaseAdmin.from("kanban_card_events").insert({
                    user_id: userId,
                    card_id: (cardRow as any).id,
                    event_type: "moved",
                    from_column_id: (cardRow as any).column_id,
                    to_column_id: (target as any).id,
                    actor: "ai",
                    payload: { stage, agent: activeAgent },
                  });
                }
              }
            } catch (e: any) {
              console.error("[wapi-webhook] stage classifier error:", e?.message ?? e);
            }
          }

          return new Response("ok", { status: 200 });

        } catch (e: any) {
          console.error("[wapi-webhook] error:", e?.message ?? e);
          return new Response("ok", { status: 200 });
        } finally {
          if (lockAcquired) {
            try {
              const { data: row } = await supabaseAdmin
                .from("flow_conversations").select("id, session_variables")
                .eq("user_id", userId).eq("chat_id", chatId).maybeSingle();
              if (row) {
                const vars = ((row as any).session_variables ?? {}) as any;
                if (vars.__processing_lock_id === lockId) {
                  delete vars.__processing_lock_id;
                  delete vars.__processing_lock_ts;
                  await supabaseAdmin.from("flow_conversations").update({ session_variables: vars }).eq("id", (row as any).id);
                }
              }
            } catch (e) {
              console.error("[wapi-webhook] lock release error:", e);
            }
          }
        }
      },
      GET: async () => new Response("ok"),
    },
  },
});
