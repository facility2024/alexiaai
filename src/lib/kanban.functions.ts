import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============== READ ==============
export const getKanbanBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [colsRes, cardsRes, tagsRes] = await Promise.all([
      supabase.from("kanban_columns").select("*").eq("user_id", userId).order("position"),
      supabase.from("kanban_cards").select("*").eq("user_id", userId).order("position"),
      supabase.from("kanban_tags").select("*").eq("user_id", userId).order("name"),
    ]);
    if (colsRes.error) throw new Error(colsRes.error.message);
    if (cardsRes.error) throw new Error(cardsRes.error.message);
    if (tagsRes.error) throw new Error(tagsRes.error.message);
    return {
      columns: colsRes.data ?? [],
      cards: cardsRes.data ?? [],
      tags: tagsRes.data ?? [],
    };
  });

export const getCardEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string }) => z.object({ cardId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: events, error } = await supabase
      .from("kanban_card_events")
      .select("*")
      .eq("user_id", userId)
      .eq("card_id", data.cardId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return events ?? [];
  });

// ============== CARDS ==============
export const upsertCardFromChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatId: string; contactName?: string }) =>
    z.object({ chatId: z.string().min(1), contactName: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("kanban_cards").select("id").eq("user_id", userId).eq("chat_id", data.chatId).maybeSingle();
    if (existing) return existing;
    const { data: firstCol } = await supabase
      .from("kanban_columns").select("id").eq("user_id", userId).order("position").limit(1).maybeSingle();
    if (!firstCol) throw new Error("Configure o Kanban primeiro");
    const { data: inserted, error } = await supabase.from("kanban_cards").insert({
      user_id: userId,
      chat_id: data.chatId,
      column_id: firstCol.id,
      contact_name: data.contactName ?? data.chatId,
      contact_phone: data.chatId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const moveCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string; toColumnId: string; actor?: string }) =>
    z.object({ cardId: z.string().uuid(), toColumnId: z.string().uuid(), actor: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: card } = await supabase
      .from("kanban_cards").select("column_id").eq("id", data.cardId).eq("user_id", userId).maybeSingle();
    if (!card) throw new Error("Card não encontrado");
    const { error } = await supabase
      .from("kanban_cards").update({ column_id: data.toColumnId }).eq("id", data.cardId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    await supabase.from("kanban_card_events").insert({
      user_id: userId, card_id: data.cardId, event_type: "moved",
      from_column_id: card.column_id, to_column_id: data.toColumnId,
      actor: data.actor ?? "user",
    });
    return { ok: true };
  });

export const toggleCardTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string; tagId: string }) =>
    z.object({ cardId: z.string().uuid(), tagId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: card } = await supabase
      .from("kanban_cards").select("tag_ids").eq("id", data.cardId).eq("user_id", userId).maybeSingle();
    if (!card) throw new Error("Card não encontrado");
    const current: string[] = card.tag_ids ?? [];
    const has = current.includes(data.tagId);
    const next = has ? current.filter((t) => t !== data.tagId) : [...current, data.tagId];
    const { error } = await supabase
      .from("kanban_cards").update({ tag_ids: next }).eq("id", data.cardId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    await supabase.from("kanban_card_events").insert({
      user_id: userId, card_id: data.cardId,
      event_type: has ? "tag_removed" : "tag_added",
      payload: { tag_id: data.tagId }, actor: "user",
    });
    return { ok: true };
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string }) => z.object({ cardId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("kanban_cards").delete().eq("id", data.cardId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== COLUMNS ==============
export const upsertColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string; name: string; color?: string; icon?: string;
    rule_prompt?: string; auto_action?: string; position?: number;
  }) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1),
    color: z.string().optional(),
    icon: z.string().optional(),
    rule_prompt: z.string().optional(),
    auto_action: z.string().optional(),
    position: z.number().int().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase.from("kanban_columns").update({
        name: data.name, color: data.color, icon: data.icon,
        rule_prompt: data.rule_prompt, auto_action: data.auto_action,
        ...(typeof data.position === "number" ? { position: data.position } : {}),
      }).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: last } = await supabase
      .from("kanban_columns").select("position").eq("user_id", userId)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: ins, error } = await supabase.from("kanban_columns").insert({
      user_id: userId,
      name: data.name,
      color: data.color ?? "#8b5cf6",
      icon: data.icon ?? "Circle",
      rule_prompt: data.rule_prompt,
      auto_action: data.auto_action,
      position: (last?.position ?? -1) + 1,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id };
  });

export const deleteColumn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { count } = await supabase
      .from("kanban_cards").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("column_id", data.id);
    if ((count ?? 0) > 0) throw new Error("Mova os cards antes de excluir esta coluna");
    const { error } = await supabase.from("kanban_columns").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== TAGS ==============
export const upsertTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; name: string; color?: string }) =>
    z.object({ id: z.string().uuid().optional(), name: z.string().min(1), color: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { error } = await supabase.from("kanban_tags")
        .update({ name: data.name, color: data.color }).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await supabase.from("kanban_tags").insert({
      user_id: userId, name: data.name, color: data.color ?? "#8b5cf6",
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: ins.id };
  });

export const deleteTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("kanban_tags").delete().eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== AGENTE IA ==============
export const runKanbanAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string }) => z.object({ cardId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveUserAi } = await import("@/lib/user-ai-provider.server");
    const ai = await resolveUserAi(supabaseAdmin, userId, {
      gatewayModel: "google/gemini-3-flash-preview",
      userOpenAiModel: "gpt-4o-mini",
    });

    const { data: card } = await supabase
      .from("kanban_cards").select("*").eq("id", data.cardId).eq("user_id", userId).maybeSingle();
    if (!card) throw new Error("Card não encontrado");

    const { data: cols } = await supabase
      .from("kanban_columns").select("id, name, rule_prompt, auto_action, position")
      .eq("user_id", userId).order("position");
    const { data: tags } = await supabase
      .from("kanban_tags").select("id, name").eq("user_id", userId);
    const { data: msgs } = await supabase
      .from("crm_messages").select("direction, sender, content, created_at")
      .eq("user_id", userId).eq("chat_id", card.chat_id)
      .order("created_at", { ascending: false }).limit(30);

    const transcript = (msgs ?? []).reverse().map(
      (m) => `[${m.direction === "inbound" ? "cliente" : m.sender}] ${m.content ?? ""}`,
    ).join("\n");
    const columnList = (cols ?? []).map(
      (c) => `- ${c.id} → "${c.name}"${c.rule_prompt ? `: ${c.rule_prompt}` : ""}`,
    ).join("\n");
    const tagList = (tags ?? []).map((t) => `- ${t.id} → "${t.name}"`).join("\n");
    const currentCol = (cols ?? []).find((c) => c.id === card.column_id);

    const system = `Você é um agente de CRM jurídico. Analise a conversa e decida se o lead deve mudar de coluna no Kanban ou receber uma tag.
Colunas disponíveis:
${columnList}
Tags disponíveis:
${tagList}
Coluna atual: "${currentCol?.name ?? "?"}"
Responda APENAS em JSON com o formato:
{"action":"move"|"tag"|"none","column_id":"uuid?","tag_id":"uuid?","reason":"texto curto em português"}`;

    const res = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [ai.authHeader]: ai.headerValue,
      },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Conversa recente:\n${transcript || "(sem mensagens)"}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`IA falhou (${res.status}): ${t.slice(0, 200)}`);
    }
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content ?? "{}";
    let decision: { action: string; column_id?: string; tag_id?: string; reason?: string };
    try { decision = JSON.parse(raw); } catch { decision = { action: "none", reason: "parse falhou" }; }

    if (decision.action === "move" && decision.column_id && decision.column_id !== card.column_id) {
      const { data: colOk } = await supabase
        .from("kanban_columns")
        .select("id")
        .eq("id", decision.column_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (!colOk) throw new Error("Coluna de destino inválida");
      await supabase.from("kanban_cards").update({ column_id: decision.column_id }).eq("id", card.id).eq("user_id", userId);
      await supabase.from("kanban_card_events").insert({
        user_id: userId, card_id: card.id, event_type: "moved",
        from_column_id: card.column_id, to_column_id: decision.column_id,
        actor: "ai", payload: { reason: decision.reason },
      });
    } else if (decision.action === "tag" && decision.tag_id) {
      const { data: tagOk } = await supabase.from("kanban_tags").select("id").eq("id", decision.tag_id).eq("user_id", userId).maybeSingle();
      if (!tagOk) throw new Error("Tag inválida");
      const current: string[] = card.tag_ids ?? [];
      if (!current.includes(decision.tag_id)) {
        await supabase.from("kanban_cards").update({ tag_ids: [...current, decision.tag_id] }).eq("id", card.id).eq("user_id", userId);
        await supabase.from("kanban_card_events").insert({
          user_id: userId, card_id: card.id, event_type: "tag_added",
          actor: "ai", payload: { tag_id: decision.tag_id, reason: decision.reason },
        });
      }
    } else {
      await supabase.from("kanban_card_events").insert({
        user_id: userId, card_id: card.id, event_type: "ai_decision",
        actor: "ai", payload: { decision },
      });
    }
    return decision;
  });

// ============== SYNC de chats do CRM que ainda não têm card ==============
export const syncCrmToKanban = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: chatRows } = await supabase
      .from("crm_messages").select("chat_id, created_at, content")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
    const seen = new Map<string, { last_at: string; last: string }>();
    for (const r of chatRows ?? []) {
      if (!seen.has(r.chat_id)) seen.set(r.chat_id, { last_at: r.created_at, last: r.content ?? "" });
    }
    if (seen.size === 0) return { created: 0 };
    const { data: existing } = await supabase
      .from("kanban_cards").select("chat_id").eq("user_id", userId);
    const have = new Set((existing ?? []).map((c) => c.chat_id));
    const toCreate = Array.from(seen.entries()).filter(([id]) => !have.has(id));
    if (!toCreate.length) return { created: 0 };
    const { data: firstCol } = await supabase
      .from("kanban_columns").select("id").eq("user_id", userId).order("position").limit(1).maybeSingle();
    if (!firstCol) throw new Error("Configure colunas primeiro");
    const rows = toCreate.map(([chat_id, meta]) => ({
      user_id: userId, chat_id, column_id: firstCol.id,
      contact_name: chat_id, contact_phone: chat_id,
      last_message_at: meta.last_at, summary: meta.last?.slice(0, 140),
    }));
    const { error } = await supabase.from("kanban_cards").insert(rows);
    if (error) throw new Error(error.message);
    return { created: rows.length };
  });

// ============== QUALIFICAÇÃO JURÍDICA (score, área, urgência, dossiê) ==============
export const qualifyCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string }) => z.object({ cardId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveUserAi } = await import("@/lib/user-ai-provider.server");
    const ai = await resolveUserAi(supabaseAdmin, userId, {
      gatewayModel: "google/gemini-3-flash-preview",
      userOpenAiModel: "gpt-4o-mini",
    });

    const { data: card } = await supabase
      .from("kanban_cards").select("*").eq("id", data.cardId).eq("user_id", userId).maybeSingle();
    if (!card) throw new Error("Card não encontrado");

    const { data: msgs } = await supabase
      .from("crm_messages").select("direction, sender, content, created_at")
      .eq("user_id", userId).eq("chat_id", card.chat_id)
      .order("created_at", { ascending: false }).limit(50);

    const ordered = (msgs ?? []).slice().reverse();
    const transcript = ordered.map(
      (m) => `[${new Date(m.created_at).toLocaleString("pt-BR")}] [${m.direction === "inbound" ? "cliente" : m.sender}] ${m.content ?? ""}`,
    ).join("\n");
    const lastClientMsg = (msgs ?? []).find((m) => m.direction === "inbound");

    const system = `Você é um assistente de triagem jurídica de um escritório de advocacia.
Analise a conversa (WhatsApp) e produza um dossiê estruturado.
Áreas possíveis: trabalhista, cível, família, previdenciário, criminal, consumidor, tributário, empresarial, outro.
Urgência: baixa, media, alta, urgente.
Score de viabilidade (0-100): quanto maior, maior a chance da causa ser viável e do lead fechar.
Ticket estimado: valor aproximado em reais (0 se desconhecido).

Retorne APENAS JSON válido no formato:
{
  "legal_area": "...",
  "urgency": "...",
  "viability_score": 0,
  "estimated_ticket": 0,
  "case_summary": "resumo em 2-3 frases",
  "case_facts": ["fato 1", "fato 2"],
  "case_timeline": [{"date": "AAAA-MM-DD ou 'aprox.'", "event": "..."}]
}`;

    const res = await fetch(`${ai.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [ai.authHeader]: ai.headerValue },
      body: JSON.stringify({
        model: ai.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Conversa:\n${transcript || "(sem mensagens)"}` },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`IA falhou (${res.status}): ${t.slice(0, 200)}`);
    }
    const body = await res.json();
    const raw = body?.choices?.[0]?.message?.content ?? "{}";
    let q: {
      legal_area?: string; urgency?: string; viability_score?: number;
      estimated_ticket?: number; case_summary?: string;
      case_facts?: string[]; case_timeline?: { date?: string; event?: string }[];
    } = {};
    try { q = JSON.parse(raw); } catch { /* ignore */ }

    const nowIso = new Date().toISOString();
    const update: {
      qualified_at: string; last_ai_analysis_at: string;
      legal_area?: string; urgency?: string;
      viability_score?: number; estimated_ticket?: number;
      summary?: string; case_facts?: unknown; case_timeline?: unknown;
      last_client_message_at?: string;
    } = { qualified_at: nowIso, last_ai_analysis_at: nowIso };
    const areas = ["trabalhista","cível","família","previdenciário","criminal","consumidor","tributário","empresarial","outro"];
    if (q.legal_area) {
      const a = String(q.legal_area).toLowerCase()
        .replace("civel","cível").replace("familia","família")
        .replace("previdenciario","previdenciário").replace("tributario","tributário");
      if (areas.includes(a)) update.legal_area = a;
    }
    if (q.urgency && ["baixa","media","alta","urgente"].includes(String(q.urgency))) update.urgency = q.urgency;
    if (typeof q.viability_score === "number") update.viability_score = Math.max(0, Math.min(100, Math.round(q.viability_score)));
    if (typeof q.estimated_ticket === "number" && q.estimated_ticket > 0) update.estimated_ticket = q.estimated_ticket;
    if (q.case_summary) update.summary = String(q.case_summary).slice(0, 500);
    if (Array.isArray(q.case_facts)) update.case_facts = q.case_facts.slice(0, 20);
    if (Array.isArray(q.case_timeline)) update.case_timeline = q.case_timeline.slice(0, 30);
    if (lastClientMsg) update.last_client_message_at = lastClientMsg.created_at;

    await supabase.from("kanban_cards").update(update as never).eq("id", card.id).eq("user_id", userId);

    // Aplica checklist da área jurídica detectada
    const areaFinal = update.legal_area as string | undefined;
    if (areaFinal) {
      const { data: templates } = await supabase
        .from("legal_area_templates").select("document_name, required, position")
        .eq("user_id", userId).eq("area", areaFinal).order("position");
      if (templates && templates.length) {
        const rows = templates.map((t) => ({
          user_id: userId, card_id: card.id,
          document_name: t.document_name, required: t.required, position: t.position,
        }));
        await supabase.from("kanban_card_documents")
          .upsert(rows, { onConflict: "card_id,document_name", ignoreDuplicates: true });
      }
    }

    await supabase.from("kanban_card_events").insert({
      user_id: userId, card_id: card.id, event_type: "qualified",
      actor: "ai", payload: JSON.parse(JSON.stringify(q)),
    });

    return { ok: true, ...q };
  });

// ============== CHECKLIST DE DOCUMENTOS ==============
export const getCardDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string }) => z.object({ cardId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("kanban_card_documents").select("*")
      .eq("user_id", userId).eq("card_id", data.cardId).order("position");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const toggleCardDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; received: boolean }) =>
    z.object({ id: z.string().uuid(), received: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("kanban_card_documents")
      .update({ received: data.received, received_at: data.received ? new Date().toISOString() : null })
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== LEADS ESFRIANDO (SLA) ==============
export const getCoolingCards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("kanban_cards")
      .select("id, contact_name, chat_id, column_id, last_client_message_at, sla_hours, urgency")
      .eq("user_id", userId)
      .not("last_client_message_at", "is", null);
    if (error) throw new Error(error.message);
    const now = Date.now();
    return (data ?? []).filter((c) => {
      if (!c.last_client_message_at) return false;
      const diffH = (now - new Date(c.last_client_message_at).getTime()) / 3_600_000;
      return diffH > (c.sla_hours ?? 24);
    });
  });
