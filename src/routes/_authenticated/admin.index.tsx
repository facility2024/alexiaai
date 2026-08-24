import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Gauge, MessageSquare, Pause, Shuffle, Users, Building2 } from "lucide-react";
import { getMyOrgContext, getAdminMetrics } from "@/lib/admin.functions";
import lexiaLogo from "@/assets/lexia-logo.png";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Painel Admin — LexIA" }] }),
  component: AdminHome,
});

function Metric({ icon: Icon, label, value, hint }: { icon: any; label: string; value: number | string; hint?: string }) {
  return (
    <Card className="p-4 border-border/60 bg-card/60 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-accent" />
        {label}
      </div>
      <p className="mt-2 font-display text-3xl text-foreground">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}

function AdminHome() {
  const ctxFn = useServerFn(getMyOrgContext);
  const metricsFn = useServerFn(getAdminMetrics);
  const { data: ctx } = useQuery({ queryKey: ["my-org-context"], queryFn: () => ctxFn() });
  const isAdmin = ctx?.isOwner === true;
  const { data: m } = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: () => metricsFn(),
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  if (ctx && !isAdmin) {
    throw redirect({ to: "/dashboard" });
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      <div className="flex items-center gap-4">
        <img src={lexiaLogo} alt="LexIA" className="h-12 w-12 object-contain" />
        <div>
          <span className="text-[10px] uppercase tracking-[0.24em] text-accent">Admin</span>
          <h1 className="font-display text-3xl text-foreground">Painel de gestão</h1>
          <p className="text-sm text-muted-foreground">Visão geral da operação do CRM em tempo real.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric icon={MessageSquare} label="Mensagens 24h" value={m?.msgsToday ?? "—"} />
        <Metric icon={Gauge} label="Atendimentos" value={m?.activeChats ?? "—"} hint="Total atribuídos" />
        <Metric icon={Pause} label="Chats pausados" value={m?.pausedChats ?? "—"} />
        <Metric icon={Shuffle} label="Transferências 24h" value={m?.transfers24h ?? "—"} />
        <Metric icon={Users} label="Equipe" value={m?.teamSize ?? "—"} hint="Membros ativos" />
      </div>

      <Card className="p-5 border-border/60 bg-card/60 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <Building2 className="h-3.5 w-3.5 text-accent" /> Distribuição por setor
        </div>
        {m?.bySector?.length ? (
          <ul className="mt-3 space-y-2">
            {m.bySector.map((s) => (
              <li key={s.name} className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2">
                <span className="text-sm text-foreground">{s.name}</span>
                <span className="text-xs text-accent">{s.count} conversa{s.count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhuma conversa roteada a setores ainda.</p>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Link to="/admin/usuarios" className="rounded-lg border border-border/60 bg-card/40 p-4 hover:border-accent/40 transition">
          <p className="text-sm font-medium text-foreground">Equipe & Permissões</p>
          <p className="mt-1 text-xs text-muted-foreground">Gerenciar acessos por usuário</p>
        </Link>
        <Link to="/admin/convites" className="rounded-lg border border-border/60 bg-card/40 p-4 hover:border-accent/40 transition">
          <p className="text-sm font-medium text-foreground">Convites</p>
          <p className="mt-1 text-xs text-muted-foreground">Compartilhar links de acesso</p>
        </Link>
        <Link to="/admin/setores" className="rounded-lg border border-border/60 bg-card/40 p-4 hover:border-accent/40 transition">
          <p className="text-sm font-medium text-foreground">Setores</p>
          <p className="mt-1 text-xs text-muted-foreground">Roteamento automático por assunto</p>
        </Link>
      </div>
    </div>
  );
}
