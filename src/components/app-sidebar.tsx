import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, FolderOpen, CalendarDays, BookOpen, LogOut, Settings, MessageCircle, MessageSquare, Bot, BookText, Kanban, Webhook, Send, Shield, UserPlus, Building2, Gauge, HelpCircle, Lock, Sparkles, FileSignature } from "lucide-react";
import { GuidedTour, useTourAutoStart } from "@/components/guided-tour";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyOrgContext } from "@/lib/admin.functions";
import lexiaLogo from "@/assets/lexia-logo.png";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Permission = {
  can_view_all_chats?: boolean;
  can_edit_kanban?: boolean;
  can_manage_clients?: boolean;
  can_manage_cases?: boolean;
  can_send_billing?: boolean;
  can_configure_ai?: boolean;
  can_access_knowledge?: boolean;
  can_manage_sectors?: boolean;
  can_export?: boolean;
  can_manage_contracts?: boolean;
};

// Mapeia url → permissão necessária (null = sem restrição)
const PERM_MAP: Record<string, keyof Permission | null> = {
  "/dashboard": null,
  "/crm": "can_view_all_chats",
  "/kanban": "can_edit_kanban",
  "/guia": null,
  "/clientes": "can_manage_clients",
  "/casos": "can_manage_cases",
  "/agendamentos": null,
  "/contratos": "can_manage_contracts",
  "/base-conhecimento": "can_access_knowledge",
  "/treinamento-ia": "can_configure_ai",
  "/personalidade-ia": "can_configure_ai",
  "/whatsapp": null,
  "/integracoes": "can_configure_ai",
  "/sms": "can_send_billing",
  "/sms-followup": "can_send_billing",
  "/configuracoes": "can_configure_ai",
};

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "CRM", url: "/crm", icon: MessageSquare },
  { title: "Kanban", url: "/kanban", icon: Kanban },
  { title: "Guia de uso", url: "/guia", icon: HelpCircle },
  { title: "Clientes", url: "/clientes", icon: Users },
  { title: "Casos", url: "/casos", icon: FolderOpen },
  { title: "Agendamentos", url: "/agendamentos", icon: CalendarDays },
  { title: "Contratos", url: "/contratos", icon: FileSignature },
  { title: "Base de conhecimento", url: "/base-conhecimento", icon: BookOpen },
  { title: "Treinamento da IA", url: "/treinamento-ia", icon: BookText },
  { title: "Personalidade da IA", url: "/personalidade-ia", icon: Bot },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
  { title: "Integrações", url: "/integracoes", icon: Webhook },
  { title: "SMS", url: "/sms", icon: Send },
  { title: "Follow-up SMS", url: "/sms-followup", icon: Send },
  { title: "Configurações de IA", url: "/configuracoes", icon: Settings },
] as const;

const adminItems = [
  { title: "Painel Admin", url: "/admin", icon: Gauge },
  { title: "Equipe & Permissões", url: "/admin/usuarios", icon: Shield },
  { title: "Convites", url: "/admin/convites", icon: UserPlus },
  { title: "Setores", url: "/admin/setores", icon: Building2 },
] as const;

export function AppSidebar() {
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const getCtx = useServerFn(getMyOrgContext);
  const { data: ctx } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => getCtx(),
  });
  const isAdmin = ctx?.isOwner === true;
  const isActive = ctx?.active === true;
  const permissions = (ctx?.permissions ?? {}) as Permission;
  const tour = useTourAutoStart();

  // Usuário pendente (não aprovado pelo admin) vê apenas tela de boas-vindas
  if (ctx && !isActive && !isAdmin) {
    return (
      <Sidebar collapsible="icon" className="neumorphic-sidebar border-r border-sidebar-border">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center justify-center px-3 py-4">
            <img src={lexiaLogo} alt="Lex IA Jurídico" className="h-[120px] w-[120px] object-contain" />
          </div>
        </SidebarHeader>
        <SidebarContent className="px-1 flex flex-col items-center justify-center flex-1">
          <Lock className="h-8 w-8 text-accent mb-2" />
          <p className="text-xs text-center text-muted-foreground px-4">
            Sua conta está <strong>pendente de aprovação</strong>. Aguarde o administrador liberar seu acesso.
          </p>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
                <LogOut className="h-4 w-4" />
                <span className="text-[13px]">Sair</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  function hasAccess(url: string): boolean {
    if (isAdmin) return true;
    const key = PERM_MAP[url];
    if (key === null || key === undefined) return true;
    return Boolean(permissions[key]);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    toast.success("Sessão encerrada");
    navigate({ to: "/", replace: true });
  }

  const visibleItems = items.filter((item) => hasAccess(item.url));

  return (
    <>
    <Sidebar collapsible="icon" className="neumorphic-sidebar border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center justify-center px-3 py-4">
          <img
            src={lexiaLogo}
            alt="Lex IA Jurídico"
            className="h-[120px] w-[120px] object-contain"
          />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Navegação
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isCurrentActive = currentPath === item.url;
                return (
                  <SidebarMenuItem key={item.title} data-tour={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isCurrentActive}
                      className={`group relative h-9 rounded-md transition-all duration-300 ${
                        isCurrentActive
                          ? "bg-accent/10 text-accent"
                          : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      }`}
                    >
                      <Link to={item.url} preload="intent" className="flex items-center gap-3 pl-4">
                        {isCurrentActive && (
                          <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-gold-gradient shadow-glow" />
                        )}
                        <item.icon className={`h-4 w-4 transition-colors ${isCurrentActive ? "text-accent" : "text-muted-foreground group-hover:text-accent"}`} />
                        <span className="text-[13px] font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.18em] text-accent/80">
              Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => {
                  const isCurrentActive = currentPath === item.url;
                  return (
                    <SidebarMenuItem key={item.title} data-tour={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isCurrentActive}
                        className={`group relative h-9 rounded-md transition-all duration-300 ${
                          isCurrentActive
                            ? "bg-accent/10 text-accent"
                            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        <Link to={item.url} preload="intent" className="flex items-center gap-3 pl-4">
                          {isCurrentActive && (
                            <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-gold-gradient shadow-glow" />
                          )}
                          <item.icon className={`h-4 w-4 transition-colors ${isCurrentActive ? "text-accent" : "text-muted-foreground group-hover:text-accent"}`} />
                          <span className="text-[13px] font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => tour.setOpen(true)}
              className="text-accent hover:bg-accent/10"
            >
              <Sparkles className="h-4 w-4" />
              <span className="text-[13px]">Iniciar tour guiado</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem data-tour="theme-toggle">
            <div className="px-2 py-1">
              <ThemeToggle />
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem data-tour="logout">
            <SidebarMenuButton onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
              <LogOut className="h-4 w-4" />
              <span className="text-[13px]">Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
    <GuidedTour open={tour.open} onClose={() => tour.setOpen(false)} />
    </>
  );
}
