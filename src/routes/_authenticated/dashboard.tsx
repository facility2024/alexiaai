import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Users, FolderOpen, CalendarDays, FileText, ArrowUpRight, UserCheck, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AiGlobalToggle } from "@/components/ai-global-toggle";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — LexIA" }] }),
  component: Dashboard,
});

// Paleta isolada para os cartões de "Cadastros realizados em atendimento"
const CADASTRO_PALETTE = [
  { bg: "#fef1e0", fg: "#3b2e2a", sub: "#7a5a3a", avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/SOFIA.jpg", name: "Sofia" },
  { bg: "#f6e6ce", fg: "#3b2e2a", sub: "#7a5a3a", avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/MARINA.jpg", name: "Marina" },
  { bg: "#3b2e2a", fg: "#fef1e0", sub: "#f6e6ce", avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/RAFAEL.jpg", name: "Rafael" },
  { bg: "#3f0632", fg: "#fef1e0", sub: "#f6e6ce", avatar: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/BRUNO.jpg", name: "Bruno" },
  { bg: "#5a3a1f", fg: "#fef1e0", sub: "#f6e6ce", avatar: "https://t3.ftcdn.net/jpg/02/83/12/96/240_F_283129653_iDQrlBEDpYWbKyDIUotS0Dy8ngUwQBaz.jpg", name: "Eduardo" },
] as const;

type RecentCadastro = {
  id: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  agent_name: string | null;
};

function Dashboard() {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ clients: 0, cases: 0, appointments: 0, documents: 0 });
  const [loading, setLoading] = useState(true);
  const [recentCadastros, setRecentCadastros] = useState<RecentCadastro[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadCounts = async () => {
      const now = new Date();
      const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const [clients, cases, appointments, documents, knowledgeDocuments] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("cases").select("id", { count: "exact", head: true }).not("status", "in", "(closed,cancelled)"),
        supabase.from("appointments").select("id", { count: "exact", head: true })
          .gte("scheduled_at", now.toISOString()).lte("scheduled_at", inSevenDays.toISOString()),
        supabase.from("documents").select("id", { count: "exact", head: true }),
        supabase.from("knowledge_base_documents").select("id", { count: "exact", head: true }),
      ]);
      if (cancelled) return;
      setCounts({
        clients: clients.count ?? 0,
        cases: cases.count ?? 0,
        appointments: appointments.count ?? 0,
        documents: (documents.count ?? 0) + (knowledgeDocuments.count ?? 0),
      });
      setLoading(false);
    };

    void loadCounts();
    const channel = supabase.channel(`dashboard-stats-${user?.id ?? "current"}`);
    for (const table of ["clients", "cases", "appointments", "documents", "knowledge_base_documents"] as const) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => void loadCounts());
    }
    channel.subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ISOLADO: carrega últimos cadastros e tenta descobrir o agente responsável
  // via crm_messages (chat_id == telefone do cliente). Não altera lógica existente.
  useEffect(() => {
    let cancelled = false;
    const loadRecent = async () => {
      const { data: clientsData } = await supabase
        .from("clients")
        .select("id, full_name, phone, created_at")
        .order("created_at", { ascending: false });
      if (cancelled || !clientsData) return;

      const phones = clientsData.map((c) => c.phone).filter(Boolean) as string[];
      const agentMap = new Map<string, string>();
      if (phones.length) {
        const { data: msgs } = await supabase
          .from("crm_messages")
          .select("chat_id, user_id")
          .in("chat_id", phones);
        if (msgs?.length) {
          const userIds = Array.from(new Set(msgs.map((m) => m.user_id)));
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", userIds);
          const profMap = new Map(
            (profs ?? []).map((p) => [p.id as string, (p.full_name || p.email || "Agente") as string]),
          );
          for (const m of msgs) {
            if (!agentMap.has(m.chat_id)) {
              agentMap.set(m.chat_id, profMap.get(m.user_id as string) || "Agente IA");
            }
          }
        }
      }
      setRecentCadastros(
        clientsData.map((c) => ({
          id: c.id,
          full_name: c.full_name,
          phone: c.phone,
          created_at: c.created_at,
          agent_name: c.phone ? agentMap.get(c.phone) ?? "Agente IA" : "Agente IA",
        })),
      );
    };
    void loadRecent();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ISOLADO: satisfação dos agentes — última nota por agente, com realtime.
  type RatingRow = { agent_key: string; rating: number; created_at: string };
  const [ratings, setRatings] = useState<RatingRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    const loadRatings = async () => {
      const { data } = await supabase
        .from("crm_agent_ratings")
        .select("agent_key, rating, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled && data) setRatings(data as RatingRow[]);
    };
    void loadRatings();
    const ch = supabase
      .channel(`dashboard-ratings-${user?.id ?? "current"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_agent_ratings" }, () => void loadRatings())
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [user?.id]);

  const latestByAgent = useMemo(() => {
    const map = new Map<string, RatingRow>();
    for (const r of ratings) if (!map.has(r.agent_key)) map.set(r.agent_key, r);
    return map;
  }, [ratings]);


  const stats = [
    { label: "Clientes ativos", value: counts.clients, icon: Users, hint: "base total" },
    { label: "Casos em curso", value: counts.cases, icon: FolderOpen, hint: "operação" },
    { label: "Agendamentos", value: counts.appointments, icon: CalendarDays, hint: "próximos 7 dias" },
    { label: "Documentos", value: counts.documents, icon: FileText, hint: "no acervo" },
  ];
  const firstName =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
    (user?.user_metadata?.name as string | undefined)?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "";
  return (
    <div className="space-y-10">
      {/* Hero editorial */}
      <header
        className="animate-fade-up space-y-3"
        style={{ animationDelay: "0ms" }}
      >
        <span className="text-[10px] uppercase tracking-[0.28em] text-accent">
          Painel · Visão geral
        </span>
        <h1 className="font-display leading-[0.95] text-foreground text-[clamp(2rem,7vw,3.75rem)]">
          Bem-vindo{firstName ? " " : ""}
          <span className="italic text-accent break-words">{firstName}</span> ao seu escritório virtual.
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          Acompanhe atendimentos automatizados, agenda e produção documental em um único
          painel — pensado com precisão editorial e clareza absoluta.
        </p>
        <div className="divider-gold mt-6 max-w-xs" />
      </header>

      <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <AiGlobalToggle />
      </div>

      {/* Bento assimétrico */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, hint }, i) => (
          <Card
            key={label}
            className={`hover-lift group relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-sm animate-fade-up ${
              i === 0 ? "lg:col-span-2 lg:row-span-1" : ""
            }`}
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="space-y-1">
                <CardTitle className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {label}
                </CardTitle>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
                  {hint}
                </p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/8 ring-1 ring-accent/20 transition-all duration-300 group-hover:bg-accent/15 group-hover:ring-accent/40">
                <Icon className="h-4 w-4 text-accent" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="font-display text-5xl tabular-nums leading-none text-foreground">
                {loading ? "—" : value}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Cadastros realizados em atendimento — bloco isolado, paleta dedicada */}
      <style>{`
        @keyframes cadastro-laser {
          0% { transform: translateX(-100%); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateX(100%); opacity: 0; }
        }
        @keyframes cadastro-float {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50% { transform: translateY(-6px) rotate(1deg); }
        }
      `}</style>
      <section className="animate-fade-up space-y-4" style={{ animationDelay: "420ms" }}>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.28em] text-accent">Atendimento · Registros</span>
            <h2 className="font-display text-2xl leading-tight text-foreground">Cadastros realizados em atendimento</h2>
          </div>
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Total {CADASTRO_PALETTE.length}</span>
        </div>

        {(() => {
          // Cards fixos: exibem sempre os 5 agentes para o cliente visualizar
          // a equipe. Não depende de dados reais de cadastro.
          const items = CADASTRO_PALETTE.map((p, idx) => ({
            id: `fixed-${p.name}`,
            full_name: p.name,
            phone: null as string | null,
            created_at: new Date().toISOString(),
            agent_name: p.name,
            _paletteIndex: idx,
          }));

          return (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 max-h-[640px] overflow-y-auto pr-1">

            {items.map((c, i) => {
              const p = CADASTRO_PALETTE[c._paletteIndex];


              return (
                <div
                  key={c.id}
                  className="relative overflow-hidden rounded-xl p-5 transition-transform duration-300 hover:-translate-y-2 hover:-translate-x-0.5"
                  style={{
                    backgroundColor: p.bg,
                    color: p.fg,
                    transform: "translateY(-4px)",
                    boxShadow:
                      "0 18px 40px -18px rgba(0,0,0,0.55), 0 6px 14px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.22em] opacity-70">Cliente</div>
                      <div className="mt-1 truncate font-display text-lg leading-tight">
                        {c.full_name || c.phone || "Sem nome"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <div
                        className="flex items-center justify-center overflow-hidden rounded-full ring-2"
                        style={{
                          width: 70,
                          height: 70,
                          backgroundColor: "rgba(255,255,255,0.12)",
                          boxShadow: "0 10px 24px -8px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.15)",
                          borderColor: "rgba(255,255,255,0.35)",
                          animation: `cadastro-float 4.5s ease-in-out ${i * 0.3}s infinite`,
                          willChange: "transform",
                        }}
                      >
                        <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-[0.18em]"
                        style={{ color: p.fg }}
                      >
                        {p.name}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: p.sub }}>Agente responsável</div>
                    <div className="truncate text-sm font-medium">{c.agent_name}</div>
                  </div>

                  <div className="mt-3 text-[11px] tabular-nums" style={{ color: p.sub }}>
                    {new Date(c.created_at).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", year: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </div>

                  {/* Laser neon branco gelo no rodapé */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
                    <div
                      className="h-full w-1/3"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent 0%, rgba(240,255,255,0.15) 20%, #f0ffff 50%, rgba(240,255,255,0.15) 80%, transparent 100%)",
                        boxShadow: "0 0 12px #f0ffff, 0 0 24px rgba(200,240,255,0.7)",
                        animation: `cadastro-laser 3.2s linear ${i * 0.4}s infinite`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          );
        })()}
      </section>

      {/* Satisfação do Atendimento — bloco isolado, realtime */}
      <section className="animate-fade-up space-y-4" style={{ animationDelay: "450ms" }}>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-[10px] uppercase tracking-[0.28em] text-accent">Qualidade · Avaliações</span>
            <h2 className="font-display text-2xl leading-tight text-foreground">Satisfação do Atendimento</h2>
          </div>
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Total de avaliações {ratings.length}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {CADASTRO_PALETTE.map((p, i) => {
            const agentKey = ["whatsapp", "triagem", "analise", "documentos", "contratos"][i];
            const row = latestByAgent.get(agentKey);
            const stars = row?.rating ?? 0;
            // Paleta dedicada para os cards de satisfação (ciclo entre laranja e âmbar)
            const RATING_PALETTE = [
              { bg: "#e87624", fg: "#fff7ec", sub: "rgba(255,247,236,0.78)", ring: "rgba(255,255,255,0.5)" },
              { bg: "#e8a726", fg: "#3b2410", sub: "rgba(59,36,16,0.72)",   ring: "rgba(59,36,16,0.35)" },
              { bg: "#e87624", fg: "#fff7ec", sub: "rgba(255,247,236,0.78)", ring: "rgba(255,255,255,0.5)" },
              { bg: "#e8a726", fg: "#3b2410", sub: "rgba(59,36,16,0.72)",   ring: "rgba(59,36,16,0.35)" },
              { bg: "#e87624", fg: "#fff7ec", sub: "rgba(255,247,236,0.78)", ring: "rgba(255,255,255,0.5)" },
            ];
            const c = RATING_PALETTE[i];

            return (
              <div
                key={p.name}
                className="relative overflow-hidden rounded-xl p-5"
                style={{
                  backgroundColor: c.bg,
                  color: c.fg,
                  boxShadow:
                    "0 14px 32px -16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-2"
                    style={{
                      width: 52,
                      height: 52,
                      borderColor: c.ring,
                      backgroundColor: "rgba(255,255,255,0.15)",
                    }}
                  >
                    <img src={p.avatar} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: c.sub }}>
                      Agente
                    </div>
                    <div className="font-display text-lg leading-tight">{p.name}</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      className="h-5 w-5"
                      style={{
                        color: n <= stars ? "#f5c451" : c.ring,
                        fill: n <= stars ? "#f5c451" : "transparent",
                      }}
                    />
                  ))}
                  <span className="ml-2 text-xs tabular-nums" style={{ color: c.sub }}>
                    {stars ? `${stars}/5` : "—"}
                  </span>
                </div>
                <div className="mt-2 text-[11px] tabular-nums" style={{ color: c.sub }}>
                  {row
                    ? new Date(row.created_at).toLocaleString("pt-BR", {
                        day: "2-digit", month: "2-digit", year: "2-digit",
                        hour: "2-digit", minute: "2-digit",
                      })
                    : "Sem avaliações ainda"}
                </div>
              </div>
            );
          })}
        </div>
      </section>




      {/* Próximos passos */}
      <section
        className="animate-fade-up"
        style={{ animationDelay: "480ms" }}
      >
        <Card className="relative overflow-hidden border-accent/20 bg-card/40 backdrop-blur-sm">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/[0.04] via-transparent to-transparent" />
          <CardHeader className="relative">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-[0.24em] text-accent">
                  Próximo ato
                </span>
                <CardTitle className="font-display text-2xl font-normal tracking-tight">
                  Agentes de IA para triagem, análise e coleta documental.
                </CardTitle>
              </div>
              <ArrowUpRight className="h-5 w-5 shrink-0 text-accent transition-transform duration-300 group-hover:translate-x-1" />
            </div>
          </CardHeader>
          <CardContent className="relative">
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Parte 3 do roadmap traz orquestração completa dos agentes e o chat público de
              atendimento — com estética editorial coerente com todo o painel.
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
