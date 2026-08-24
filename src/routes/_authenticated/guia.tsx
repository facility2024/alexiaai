import { createFileRoute } from "@tanstack/react-router";
import {
  Kanban,
  Users,
  MessageSquare,
  Bot,
  UserCheck,
  FileUp,
  ScanSearch,
  FileSignature,
  CheckCircle2,
  Sparkles,
  Video,
  Inbox,
  ArrowRight,
  Pause,
  Play,
  Tag,
  UserPlus,
  Building2,
  ShieldCheck,
  Lightbulb,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/guia")({
  head: () => ({
    meta: [
      { title: "Guia de uso — LexIA" },
      { name: "description", content: "Passo a passo completo do Kanban e dos agentes humanos e de IA no LexIA." },
    ],
  }),
  component: GuiaPage,
});

/* ---------------- Dados ---------------- */

const kanbanSteps = [
  {
    icon: Inbox,
    color: "#a78bfa",
    name: "Primeiro Atendimento",
    who: "Agente IA",
    what: "Novo lead chega pelo WhatsApp. A IA cumprimenta, coleta nome, telefone e o motivo do contato.",
    tip: "Se o cliente não responder em 24h, o card fica marcado com etiqueta amarela para o humano dar follow-up.",
  },
  {
    icon: Sparkles,
    color: "#8b5cf6",
    name: "Interesse",
    who: "Agente IA",
    what: "Cliente demonstrou interesse. A IA explica o serviço, tira dúvidas iniciais e qualifica o caso.",
    tip: "A IA identifica o assunto (trabalhista, cível, família…) e sugere o setor certo.",
  },
  {
    icon: Video,
    color: "#7c3aed",
    name: "Call / Meet",
    who: "Agente IA + Humano",
    what: "IA propõe agendar uma reunião. Ao confirmar horário, cria o agendamento e avisa o especialista.",
    tip: "O card aparece automaticamente na agenda do responsável do setor.",
  },
  {
    icon: UserCheck,
    color: "#6d28d9",
    name: "Falar com Especialista",
    who: "Humano",
    what: "Especialista humano assume a conversa. A IA fica em pausa nesse chat até você reativar.",
    tip: "Use o botão “Pausar IA” no chat. O selo dourado no nome mostra que você é o responsável.",
  },
  {
    icon: FileUp,
    color: "#5b21b6",
    name: "Envio de Documentos",
    who: "Agente IA",
    what: "IA solicita os documentos do checklist do setor e recebe pelo WhatsApp automaticamente.",
    tip: "O checklist é configurado em Configurações → Documentos por área.",
  },
  {
    icon: ScanSearch,
    color: "#4c1d95",
    name: "Análise IA",
    who: "Agente IA",
    what: "IA analisa cada documento, marca o que atende e o que falta, e sugere próximos passos.",
    tip: "Se algo estiver ilegível ou faltando, ela pede reenvio de forma educada.",
  },
  {
    icon: FileSignature,
    color: "#8b5cf6",
    name: "Contrato",
    who: "Humano",
    what: "Jurídico finaliza o contrato e envia pelo WhatsApp para assinatura.",
    tip: "Aqui a IA fica só como suporte — quem fala é o advogado.",
  },
  {
    icon: CheckCircle2,
    color: "#22c55e",
    name: "Fechado",
    who: "Humano",
    what: "Cliente assinado e onboardado. O caso vira um projeto ativo.",
    tip: "Cards fechados alimentam o dashboard de conversão do painel Admin.",
  },
];

const iaAgents = [
  {
    icon: MessageSquare,
    title: "Agente de Triagem",
    desc: "Faz o primeiro contato, coleta dados básicos e classifica o assunto do chat.",
  },
  {
    icon: Building2,
    title: "Agente de Roteamento",
    desc: "Identifica o setor certo (trabalhista, cível, família…) e transfere para o responsável cadastrado.",
  },
  {
    icon: FileUp,
    title: "Agente Documental",
    desc: "Solicita, recebe e organiza documentos conforme o checklist da área.",
  },
  {
    icon: ScanSearch,
    title: "Agente Analista",
    desc: "Lê os documentos, valida contra o checklist e destaca pendências.",
  },
];

const humanoActions = [
  { icon: Pause, label: "Pausar IA nesta conversa", desc: "Assume o chat manualmente sem que a IA responda." },
  { icon: Play, label: "Retomar IA", desc: "Devolve o atendimento para os agentes automatizados." },
  { icon: UserCheck, label: "Assumir chat", desc: "Marca a conversa como sua — só você recebe as próximas mensagens." },
  { icon: ArrowRight, label: "Transferir para setor", desc: "Envia o chat para outro setor ou colega da equipe." },
  { icon: Tag, label: "Aplicar etiqueta", desc: "Marca o cliente com um selo colorido (VIP, urgente, cliente novo…)." },
];

/* ---------------- UI ---------------- */

function GuiaPage() {
  return (
    <div className="space-y-10 animate-fade-up pb-16">
      {/* Header */}
      <header className="border-b border-border/60 pb-8">
        <div className="text-[10px] uppercase tracking-[0.28em] text-accent">Guia interativo</div>
        <h1 className="font-display italic text-5xl md:text-6xl leading-[0.95] text-foreground mt-2">
          Como usar o <span className="text-accent">Kanban</span> e os agentes
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Um passo a passo visual de cada coluna do Kanban, o que a IA faz sozinha e onde você — humano — entra em cena.
        </p>
      </header>

      {/* Legenda */}
      <section className="grid gap-3 sm:grid-cols-3">
        <LegendCard color="#8b5cf6" icon={Bot} label="Agente IA" desc="Ação automática dos agentes." />
        <LegendCard color="#c9a84c" icon={UserCheck} label="Humano" desc="Você ou um colega assume." />
        <LegendCard color="#22c55e" icon={Sparkles} label="IA + Humano" desc="Trabalham juntos no mesmo card." />
      </section>

      {/* Fluxo Kanban */}
      <section>
        <div className="mb-6 flex items-center gap-3">
          <Kanban className="h-6 w-6 text-accent" />
          <h2 className="font-display italic text-3xl text-foreground">O fluxo Kanban, coluna por coluna</h2>
        </div>

        <ol className="relative border-l-2 border-border/40 pl-8 space-y-6">
          {kanbanSteps.map((s, i) => (
            <li key={s.name} className="relative">
              <span
                className="absolute -left-[42px] flex h-10 w-10 items-center justify-center rounded-full ring-4 ring-background"
                style={{ background: s.color }}
              >
                <s.icon className="h-5 w-5 text-white" />
              </span>

              <Card className="border-border/60 bg-card/60 backdrop-blur">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-lg text-foreground flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono">{String(i + 1).padStart(2, "0")}</span>
                      {s.name}
                    </CardTitle>
                    <Badge
                      variant="outline"
                      className={
                        s.who === "Humano"
                          ? "border-amber-400/50 text-amber-400"
                          : s.who === "Agente IA"
                          ? "border-violet-400/50 text-violet-300"
                          : "border-emerald-400/50 text-emerald-400"
                      }
                    >
                      {s.who}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-foreground/90">{s.what}</p>
                  <div className="flex items-start gap-2 rounded-md border border-accent/20 bg-accent/5 p-2.5">
                    <Lightbulb className="h-4 w-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">{s.tip}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Agentes IA */}
      <section>
        <div className="mb-6 flex items-center gap-3">
          <Bot className="h-6 w-6 text-accent" />
          <h2 className="font-display italic text-3xl text-foreground">Os agentes de IA</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {iaAgents.map((a) => (
            <Card key={a.title} className="border-border/60 bg-card/60">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <a.icon className="h-5 w-5 text-accent" />
                  </div>
                  <CardTitle className="text-base">{a.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{a.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Ações humanas */}
      <section>
        <div className="mb-6 flex items-center gap-3">
          <UserCheck className="h-6 w-6 text-accent" />
          <h2 className="font-display italic text-3xl text-foreground">O que você — humano — pode fazer</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {humanoActions.map((a) => (
            <div
              key={a.label}
              className="rounded-lg border border-border/60 bg-card/40 p-4 hover:border-accent/40 transition"
            >
              <div className="flex items-center gap-2 mb-2">
                <a.icon className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium text-foreground">{a.label}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Admin */}
      <section>
        <div className="mb-6 flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-accent" />
          <h2 className="font-display italic text-3xl text-foreground">Para o Admin</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <AdminCard icon={UserPlus} title="Convites por link" desc="Gere links amigáveis, escolha papel, permissões e setores. Copiou → mandou → pronto." />
          <AdminCard icon={Building2} title="Setores" desc="Cadastre setores com palavras-chave. A IA usa isso para rotear automaticamente." />
          <AdminCard icon={Users} title="Equipe e permissões" desc="Controle quem vê todos os chats, quem edita o Kanban, quem envia cobranças." />
        </div>
      </section>

      {/* Dicas rápidas */}
      <section>
        <Card className="border-accent/30 bg-gradient-to-br from-accent/5 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Lightbulb className="h-5 w-5 text-accent" /> Dicas rápidas
            </CardTitle>
            <CardDescription>Boas práticas para tirar o máximo do LexIA no dia a dia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-foreground/90">
            <p>• <strong className="text-accent">Selo dourado</strong> ao lado do nome do cliente = você é o atendente humano designado.</p>
            <p>• <strong className="text-accent">Selo colorido (verificado)</strong> = etiqueta aplicada, estilo Facebook.</p>
            <p>• <strong className="text-accent">Pausar IA global</strong> só o admin faz — usa em manutenção ou treinamento.</p>
            <p>• Arraste cards no Kanban para mudar de fase sem abrir o chat.</p>
            <p>• Todo movimento do card fica registrado no histórico (auditoria).</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function LegendCard({
  color,
  icon: Icon,
  label,
  desc,
}: {
  color: string;
  icon: typeof Bot;
  label: string;
  desc: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 flex items-start gap-3">
      <div
        className="h-9 w-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: color }}
      >
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function AdminCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Bot;
  title: string;
  desc: string;
}) {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-accent" />
          </div>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}
