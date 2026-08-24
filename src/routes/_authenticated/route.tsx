import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Clock, LogOut, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getMyOrgContext } from "@/lib/admin.functions";
import lexiaLogo from "@/assets/lexia-logo.png";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function PendingApprovalScreen({ email, name }: { email: string; name: string }) {
  const initials = (name || email || "?").split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase();
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
              Seu acesso foi registrado. Assim que o admin aprovar pelo painel, esta tela libera automaticamente.
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
  const { data: ctx, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => ctxFn(),
    refetchInterval: (q) => (q.state.data && !q.state.data.isOwner && !q.state.data.active ? 8000 : false),
    refetchOnWindowFocus: true,
    retry: 1,
  });

  useEffect(() => {
    let cancelled = false;
    let channel: any;
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
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Não foi possível carregar seu acesso.";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
          <h1 className="mt-3 text-lg font-semibold text-foreground">Falha ao carregar o painel</h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={() => refetch()}>Tentar novamente</Button>
            <Button variant="outline" onClick={() => supabase.auth.signOut().then(() => navigateToAuth())}>
              Sair
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (ctx && !ctx.isOwner && !ctx.active) {
    return (
      <PendingApprovalScreen
        email={ctx.profile?.email ?? ""}
        name={ctx.profile?.full_name ?? ""}
      />
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <header
            className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 glass px-3 sm:px-4"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <SidebarTrigger className="text-muted-foreground hover:text-accent transition-colors" />
              <div className="hidden h-4 w-px bg-border sm:block" />
              <span className="hidden truncate text-[11px] uppercase tracking-[0.24em] text-muted-foreground sm:inline">
                Painel · LexIA
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <span className="h-2 w-2 rounded-full bg-accent shadow-glow" />
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:text-[11px]">
                Ao vivo
              </span>
            </div>
          </header>
          <main
            className="flex-1 animate-fade-up p-4 sm:p-6 lg:p-8"
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
