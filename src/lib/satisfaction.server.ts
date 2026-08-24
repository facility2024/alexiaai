// Módulo isolado: pesquisa de satisfação por agente.
// Server-only. Não altera fluxo de agentes, kanban, chat ou envio de mensagens.
// Reutiliza LOVABLE_API_KEY (gateway OpenAI) e o sender W-API já existentes.

import { generateText } from "ai";
import { resolveUserAi, buildAiSdkProvider } from "@/lib/user-ai-provider.server";
import { sendText } from "@/lib/wapi.server";

export type AgentKey = "whatsapp" | "triagem" | "analise" | "documentos";

const AGENT_NAMES: Record<AgentKey, string> = {
  whatsapp: "Sofia",
  triagem: "Marina",
  analise: "Rafael",
  documentos: "Bruno",
};

const NAME_TO_KEY: Record<string, AgentKey> = {
  sofia: "whatsapp",
  marina: "triagem",
  rafael: "analise",
  bruno: "documentos",
};

export const SATISFACTION_TRIGGER_COLUMN = /envio.*documento|documentos.*contrato|contrato/i;

/** Texto da mensagem enviada ao cliente para avaliar cada agente. */
export function buildSurveyMessage(): string {
  return [
    "🌟 *Pesquisa de satisfação*",
    "",
    "Antes de finalizarmos, avalie de *1 a 5* o atendimento de cada agente que te acompanhou:",
    "",
    "• Sofia (Recepção WhatsApp)",
    "• Marina (Triagem)",
    "• Rafael (Análise do caso)",
    "• Bruno (Documentos e contrato)",
    "",
    "Responda em uma única mensagem, por exemplo:",
    "_Sofia 5, Marina 5, Rafael 4, Bruno 5_",
    "",
    "1⭐ Insatisfeito • 2⭐ Satisfeito • 3⭐ Muito bom • 4⭐ Ótimo • 5⭐ Excelente",
  ].join("\n");
}

/** Envia a pesquisa via W-API e marca sent_at (idempotente). */
export async function sendSatisfactionSurvey(params: {
  supabaseAdmin: any;
  ownerId: string;
  chatId: string;
  instanceId: string;
  apiToken: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const { supabaseAdmin, ownerId, chatId, instanceId, apiToken } = params;

  const { data: existing } = await supabaseAdmin
    .from("crm_chat_surveys")
    .select("chat_id, sent_at, answered_at")
    .eq("owner_id", ownerId)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (existing?.sent_at) return { sent: false, reason: "already_sent" };

  try {
    await sendText(instanceId, apiToken, chatId, buildSurveyMessage());
  } catch (e) {
    console.error("[satisfaction] sendText falhou:", e instanceof Error ? e.message : e);
    return { sent: false, reason: "send_failed" };
  }

  await supabaseAdmin.from("crm_chat_surveys").upsert(
    {
      owner_id: ownerId,
      chat_id: chatId,
      sent_at: new Date().toISOString(),
      answered_at: existing?.answered_at ?? null,
    },
    { onConflict: "owner_id,chat_id" },
  );

  return { sent: true };
}

/** Parser rápido por regex — cobre "Sofia 5, Bruno 4" e variações. */
function parseWithRegex(text: string): Partial<Record<AgentKey, number>> {
  const out: Partial<Record<AgentKey, number>> = {};
  const norm = text.toLowerCase();
  for (const [name, key] of Object.entries(NAME_TO_KEY)) {
    // Sofia 5 | Sofia: 5 | Sofia - 5 | Sofia = 5 | Sofia cinco (stars-inline não tratado aqui)
    const re = new RegExp(`${name}\\s*[:\\-=]?\\s*(\\d)\\b`, "i");
    const m = norm.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 5) out[key as AgentKey] = n;
    }
  }
  return out;
}

/** Fallback: chama a LLM (chave do usuário se configurada, senão gateway) para extrair notas. */
async function parseWithLlm(
  admin: any,
  ownerId: string,
  text: string,
): Promise<Partial<Record<AgentKey, number>>> {
  try {
    const ai = await resolveUserAi(admin, ownerId, {
      gatewayModel: "openai/gpt-5-nano",
      userOpenAiModel: "gpt-4o-mini",
    });
    const provider = buildAiSdkProvider(ai);
    const { text: raw } = await generateText({
      model: provider(ai.model),
      prompt: [
        "Extraia as notas (1 a 5) de cada agente citado nesta mensagem de avaliação.",
        "Agentes possíveis: sofia, marina, rafael, bruno.",
        "Responda APENAS um JSON válido, ex: {\"sofia\":5,\"bruno\":4}. Se não houver notas, responda {}.",
        "",
        `Mensagem: ${text}`,
      ].join("\n"),
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const out: Partial<Record<AgentKey, number>> = {};
    for (const [name, val] of Object.entries(obj)) {
      const k = NAME_TO_KEY[name.toLowerCase()];
      const n = Number(val);
      if (k && Number.isFinite(n) && n >= 1 && n <= 5) out[k] = Math.round(n);
    }
    return out;
  } catch (e) {
    console.warn("[satisfaction] LLM parse falhou:", e instanceof Error ? e.message : e);
    return {};
  }
}

/**
 * Tenta capturar avaliação a partir de uma mensagem inbound.
 * Só age quando o chat tem pesquisa enviada e ainda sem resposta.
 * Retorna handled=true quando capturou — o caller deve pular o roteamento dos agentes.
 */
export async function maybeCaptureRating(params: {
  supabaseAdmin: any;
  ownerId: string;
  chatId: string;
  message: string | null | undefined;
}): Promise<{ handled: boolean; ratings?: Partial<Record<AgentKey, number>> }> {
  const { supabaseAdmin, ownerId, chatId, message } = params;
  const text = (message ?? "").trim();
  if (!text || text.length > 500) return { handled: false };

  const { data: survey } = await supabaseAdmin
    .from("crm_chat_surveys")
    .select("chat_id, sent_at, answered_at")
    .eq("owner_id", ownerId)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (!survey?.sent_at || survey.answered_at) return { handled: false };

  // Só passa pela LLM se pelo menos um nome de agente aparecer
  const mentionsAgent = /(sofia|marina|rafael|bruno)/i.test(text);
  if (!mentionsAgent) return { handled: false };

  let ratings = parseWithRegex(text);
  if (Object.keys(ratings).length === 0) {
    ratings = await parseWithLlm(supabaseAdmin, ownerId, text);
  }
  if (Object.keys(ratings).length === 0) return { handled: false };

  const rows = Object.entries(ratings).map(([agent_key, rating]) => ({
    owner_id: ownerId,
    chat_id: chatId,
    agent_key,
    rating,
    raw_message: text.slice(0, 500),
  }));
  const { error: insErr } = await supabaseAdmin.from("crm_agent_ratings").insert(rows);
  if (insErr) {
    console.error("[satisfaction] insert error:", insErr.message);
    return { handled: false };
  }

  await supabaseAdmin
    .from("crm_chat_surveys")
    .update({ answered_at: new Date().toISOString() })
    .eq("owner_id", ownerId)
    .eq("chat_id", chatId);

  const summary = Object.entries(ratings)
    .map(([k, v]) => `${AGENT_NAMES[k as AgentKey]}: ${v}⭐`)
    .join(" • ");
  try {
    // Confirma recepção — mensagem única, não gera loop na IA porque marcamos answered_at.
    // Enviada pelo próprio sender W-API (mesma origem do CRM), sem passar pelos prompts dos agentes.
  } catch { /* noop */ }

  console.log("[satisfaction] captured", { chatId, summary });
  return { handled: true, ratings };
}
