// Nomes e funções dos agentes de IA — fonte única de verdade.
// Usado no painel de Configurações e no CRM para exibir quem respondeu.

export type AgentKey = "whatsapp" | "triagem" | "analise" | "documentos" | "contratos";

export const AGENTS: Array<{
  key: AgentKey;
  name: string;       // Nome do agente exibido no chat
  role: string;       // Cargo/função curta
  desc: string;       // Descrição no painel
  avatar: string;     // URL da foto do agente
}> = [
  {
    key: "whatsapp",
    name: "Sofia",
    role: "Atendimento WhatsApp",
    desc: "Recepciona o cliente no WhatsApp, responde dúvidas iniciais e mantém o tom cordial da conversa.",
    avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/SOFIA.jpg",
  },
  {
    key: "triagem",
    name: "Marina",
    role: "Agente de Triagem",
    desc: "Faz a entrevista inicial, coleta dados do caso e identifica a área jurídica.",
    avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/MARINA.jpg",
  },
  {
    key: "analise",
    name: "Rafael",
    role: "Agente de Análise",
    desc: "Analisa o caso, sugere estratégia jurídica e próximos passos.",
    avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/RAFAEL.jpg",
  },
  {
    key: "documentos",
    name: "Bruno",
    role: "Agente de Documentos",
    desc: "Lista documentos necessários, auxilia na coleta e organiza os arquivos do processo.",
    avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/BRUNO.jpg",
  },
  {
    key: "contratos",
    name: "Eduardo",
    role: "Agente de Contratos",
    desc: "Gera contratos a partir de templates, preenche variáveis do cliente/caso, roda a auditoria de IA e deixa o contrato pronto para o advogado enviar via Autentique.",
    avatar: "https://t3.ftcdn.net/jpg/02/83/12/96/240_F_283129653_iDQrlBEDpYWbKyDIUotS0Dy8ngUwQBaz.jpg",
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
  return sender;
}
