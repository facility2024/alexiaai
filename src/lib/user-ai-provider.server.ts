// Helper isolado: resolve qual chave/base_url/modelo usar para chamadas de IA.
// Se o usuário tem chave própria salva em `ai_settings` (qualquer agent_key),
// usa a chave dele (OpenAI / provider custom). Caso contrário, faz fallback
// silencioso para LOVABLE_API_KEY via gateway Lovable (comportamento atual).
// Server-only. Não altera nenhum fluxo existente — apenas troca a origem da chave.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type ResolvedAi = {
  apiKey: string;
  baseUrl: string;
  model: string;
  isGateway: boolean; // true = usando LOVABLE_API_KEY (fallback)
  authHeader: "Lovable-API-Key" | "Authorization";
  headerValue: string;
};

const OPENAI_DEFAULT_CHAT_MODEL = "gpt-4o-mini";

/**
 * Busca a primeira `ai_settings` do usuário com api_key preenchida.
 * Não escolhe agent_key específico — pega qualquer uma para reaproveitar
 * a chave (a mesma OpenAI serve para todos os agentes).
 */
export async function resolveUserAi(
  admin: SupabaseClient,
  userId: string,
  opts: {
    /** Modelo a usar quando cair no fallback do gateway Lovable. */
    gatewayModel: string;
    /**
     * Modelo a usar quando o usuário tem chave própria OpenAI.
     * Se omitido, tenta o `model` salvo em ai_settings; se esse for um id
     * de gateway (com barra, ex.: "openai/gpt-5-mini"), usa fallback OpenAI.
     */
    userOpenAiModel?: string;
  },
): Promise<ResolvedAi> {
  let candidate: {
    provider: string | null;
    model: string | null;
    api_key: string | null;
    base_url: string | null;
    openai_key: string | null;
  } | null = null;

  try {
    const { data: rows } = await admin
      .from("ai_settings")
      .select("provider,model,api_key,base_url,openai_key")
      .eq("user_id", userId);
    candidate = (rows ?? []).find(
      (r: { api_key?: string | null; openai_key?: string | null }) =>
        (r.api_key ?? r.openai_key ?? "").trim().length > 0,
    ) ?? null;
  } catch {
    candidate = null;
  }

  if (candidate) {
    const rawKey = ((candidate.api_key ?? candidate.openai_key) ?? "").trim();
    if (rawKey) {
      const provider = (candidate.provider ?? "openai").toLowerCase();
      const baseUrl =
        candidate.base_url?.trim() ||
        (provider === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai"
          : "https://api.openai.com/v1");

      // Escolha do modelo:
      // 1) se caller passou userOpenAiModel, respeita
      // 2) senão usa candidate.model se NÃO for id de gateway (com "/")
      // 3) senão fallback gpt-4o-mini
      let model = opts.userOpenAiModel?.trim() || "";
      if (!model) {
        const saved = (candidate.model ?? "").trim();
        model = saved && !saved.includes("/") ? saved : OPENAI_DEFAULT_CHAT_MODEL;
      }

      return {
        apiKey: rawKey,
        baseUrl,
        model,
        isGateway: false,
        authHeader: "Authorization",
        headerValue: `Bearer ${rawKey}`,
      };
    }
  }

  const gwKey = process.env.LOVABLE_API_KEY;
  if (!gwKey) {
    throw new Error(
      "Nenhuma chave de IA disponível: configure sua chave em Configurações → IA ou provisione LOVABLE_API_KEY.",
    );
  }
  return {
    apiKey: gwKey,
    baseUrl: "https://ai.gateway.lovable.dev/v1",
    model: opts.gatewayModel,
    isGateway: true,
    authHeader: "Lovable-API-Key",
    headerValue: gwKey,
  };
}

/** Constrói um provider AI SDK a partir de ResolvedAi (usado por client-extract e satisfaction). */
export function buildAiSdkProvider(resolved: ResolvedAi) {
  const isOpenAiDirect =
    !resolved.isGateway && resolved.baseUrl.includes("openai.com");
  return createOpenAICompatible({
    name: "userai",
    baseURL: resolved.baseUrl,
    // Structured outputs strict: OpenAI direto e gateway Lovable suportam.
    supportsStructuredOutputs: resolved.isGateway || isOpenAiDirect,
    headers: resolved.isGateway
      ? {
          "Lovable-API-Key": resolved.apiKey,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        }
      : { Authorization: `Bearer ${resolved.apiKey}` },
  });
}
