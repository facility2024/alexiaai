// Nomes e funções dos agentes de IA — fonte única de verdade.
// Usado no painel de Configurações e no CRM para exibir quem responde.
//
// Modo agente único (pedido do usuário, 25/11/2026): existe UM agente só —
// Eduardo N — e ele responde todas as conversas. As chaves legadas
// (triagem/analise/documentos/contratos) permanecem no tipo AgentKey porque
// colunas do kanban/BD ainda as referenciam, mas não geram agentes na UI.

export type AgentKey = "whatsapp" | "triagem" | "analise" | "documentos" | "contratos";

export const AGENTS: Array<{
  key: AgentKey;
  name: string; // Nome do agente exibido no chat
  role: string; // Cargo/função curta
  desc: string; // Descrição no painel
  avatar: string; // URL da foto do agente
}> = [
  {
    key: "whatsapp",
    name: "Eduardo N",
    role: "Atendimento",
    desc: "Agente único de atendimento no WhatsApp — conversa com o cliente, tira dúvidas e move o lead no funil.",
    avatar:
      "https://t3.ftcdn.net/jpg/02/83/12/96/240_F_283129653_iDQrlBEDpYWbKyDIUotS0Dy8ngUwQBaz.jpg",
  },
];

const BY_KEY: Record<string, (typeof AGENTS)[number]> = Object.fromEntries(
  AGENTS.map((a) => [a.key, a]),
);

/** Retorna o nome amigável do agente para exibir no chat. */
export function agentDisplayName(sender: string | null | undefined): string {
  if (!sender) return "Bot";
  const s = sender.toLowerCase();
  if (s === "operator" || s === "humano") return "Atendente";
  if (s === "client" || s === "cliente") return "Cliente";
  if (BY_KEY[s]) return BY_KEY[s].name;
  if (s === "bot") return BY_KEY.whatsapp.name; // legado: mensagens antigas sem agent_key
  // Chaves legadas de outros agentes (mensagens antigas) → agente único atual.
  if (s === "triagem" || s === "analise" || s === "documentos" || s === "contratos") {
    return BY_KEY.whatsapp.name;
  }
  return sender;
}
