import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getMyOrgContext } from "@/lib/admin.functions";
import { canAccess, firstAllowedUrl, type OrgCtx } from "@/lib/access";
import lexiaLogo from "@/assets/lexia-logo.png";

// Cache curto do contexto de acesso — o guard roda a cada navegação e não
// pode disparar um server fn carregado (getMyOrgContext roda uma RPC) todo hop.
let orgCtxCache: { data: OrgCtx; ts: number } | null = null;

async function getCachedOrgContext(): Promise<OrgCtx | null> {
  if (orgCtxCache && Date.now() - orgCtxCache.ts < 10_000) return orgCtxCache.data;
  try {
    const data = (await getMyOrgContext()) as OrgCtx;
    orgCtxCache = { data, ts: Date.now() };
    return data;
  } catch {
    // Falha de rede não bloqueia a navegação — o layout mostra erro/refetch.
    return orgCtxCache?.data ?? null;
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });

    // Autorização real por URL (não esconder só o menu): se o módulo não está
    // liberado no painel de permissões, redireciona para o primeiro liberado.
    const ctx = await getCachedOrgContext();
    if (ctx && ctx.active !== true && ctx.isOwner !== true) {
      // Pendente de aprovação: o layout renderiza a tela de espera.
    } else if (ctx && !canAccess(location.pathname, ctx)) {
      const target = firstAllowedUrl(ctx);
      if (target && target !== location.pathname) throw redirect({ to: target });
    }
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function PendingApprovalScreen({ email, name }: { email: string; name: string }) {
  const initials = (name || email || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <img src={lexiaLogo} alt="LexIA" className="h-20 w-20 object-contain mb-6" />
      <div className="w-full max-w-md border border-border/60 rounded-xl bg-card p-6 space-y-5">
        <div className="flex flex-col items-center gap-3">
          <Avatar className="h-16 w-16 border-2 border-accent">
            <AvatarFallback className="bg-accent/20 text-accent text-xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="text-center">
            <p className="text-accent text-lg font-display italic">Olá, {name || email}!</p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3">
          <Clock className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-500/90">
            <p className="font-medium">Aguardando liberação do administrador</p>
            <p className="text-xs mt-1 text-yellow-500/70">
              Seu acesso foi registrado. Assim que o admin aprovar pelo painel, esta tela libera
              automaticamente.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Verificando liberação...
        </div>
        <Button variant="outline" className="w-full" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-2" /> Sair
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedLayout() {
  const ctxFn = useServerFn(getMyOrgContext);
  const qc = useQueryClient();
  const {
    data: ctx,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => ctxFn(),
    // Pendente: poll rápido para detectar aprovação. Ativo: fallback lento
    // caso o realtime de user_permissions não esteja publicado.
    refetchInterval: (q) =>
      q.state.data && !q.state.data.isOwner && !q.state.data.active ? 8000 : 30000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let permChannel: ReturnType<typeof supabase.channel> | undefined;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (cancelled || !u.user) return;
      const uid = u.user.id;
      channel = supabase
        .channel(`assignments-${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "chat_assignments",
            filter: `assigned_to=eq.${uid}`,
          },
          (payload: any) => {
            const chat = payload.new?.chat_id ?? payload.old?.chat_id ?? "";
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              toast.success("Novo atendimento atribuído a você", {
                description: chat,
                action: {
                  label: "Abrir CRM",
                  onClick: () => {
                    window.location.href = "/crm";
                  },
                },
              });
            }
          },
        )
        .subscribe();
      // Alterações de permissão feitas pelo admin refletem no menu/páginas
      // do colaborador sem precisar de refresh manual.
      permChannel = supabase
        .channel(`perms-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_permissions", filter: `user_id=eq.${uid}` },
          () => {
            orgCtxCache = null;
            void qc.invalidateQueries({ queryKey: ["my-org-context"] });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      if (permChannel) supabase.removeChannel(permChannel);
    };
  }, [qc]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (isError) {
    const message =
      error instanceof Error ? error.message : "Não foi possível carregar seu acesso.";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-lg font-semibold text-foreground">Falha ao carregar o painel</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => refetch()}>Tentar novamente</Button>
            <Button
              variant="outline"
              onClick={() => supabase.auth.signOut().then(() => navigateToAuth())}
            >
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (ctx && !ctx.isOwner && !ctx.active) {
    return (
      <PendingApprovalScreen email={ctx.profile?.email ?? ""} name={ctx.profile?.full_name ?? ""} />
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <header
            className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur sm:px-4"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <SidebarTrigger className="text-muted-foreground transition-colors hover:text-accent" />
              <div className="hidden h-4 w-px bg-border sm:block" />
              <span className="hidden truncate text-xs font-medium text-muted-foreground sm:inline">
                LexIA <span className="px-1.5 text-border">/</span> Central de operação
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="text-[11px] font-medium text-muted-foreground">Ao vivo</span>
            </div>
          </header>
          <main
            className="flex-1 animate-fade-up p-3 sm:p-4 lg:p-5"
            style={{
              paddingLeft: "max(1rem, env(safe-area-inset-left))",
              paddingRight: "max(1rem, env(safe-area-inset-right))",
              paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function navigateToAuth() {
  window.location.href = "/";
}
