import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  FolderOpen,
  CalendarDays,
  BookOpen,
  LogOut,
  Settings,
  MessageCircle,
  MessageSquare,
  Bot,
  BookText,
  Kanban,
  Webhook,
  Send,
  Shield,
  UserPlus,
  Building2,
  Gauge,
  HelpCircle,
  Lock,
  Sparkles,
  FileSignature,
  ChevronDown,
  Headset,
  Megaphone,
  BriefcaseBusiness,
  Target,
} from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

const primaryItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Pipeline", url: "/kanban", icon: Kanban },
  { title: "Leads", url: "/clientes", icon: Users },
  { title: "Agenda", url: "/agendamentos", icon: CalendarDays },
] as const;

const menuGroups = [
  {
    title: "Atendimentos",
    icon: Headset,
    items: [{ title: "Caixa de entrada", url: "/crm", icon: MessageSquare }],
  },
  {
    title: "Automação & IA",
    icon: Bot,
    items: [
      { title: "Base de conhecimento", url: "/base-conhecimento", icon: BookOpen },
      { title: "Treinamento da IA", url: "/treinamento-ia", icon: BookText },
      { title: "Personalidade da IA", url: "/personalidade-ia", icon: Bot },
      { title: "Configurações de IA", url: "/configuracoes", icon: Settings },
    ],
  },
  {
    title: "Captação",
    icon: Target,
    items: [{ title: "Casos", url: "/casos", icon: FolderOpen }],
  },
  {
    title: "Marketing",
    icon: Megaphone,
    items: [
      { title: "SMS", url: "/sms", icon: Send },
      { title: "Follow-up SMS", url: "/sms-followup", icon: Send },
    ],
  },
  {
    title: "Gestão",
    icon: BriefcaseBusiness,
    items: [{ title: "Contratos", url: "/contratos", icon: FileSignature }],
  },
  {
    title: "Configurações",
    icon: Settings,
    items: [
      { title: "WhatsApp", url: "/whatsapp", icon: MessageCircle },
      { title: "Integrações", url: "/integracoes", icon: Webhook },
      { title: "Guia de uso", url: "/guia", icon: HelpCircle },
    ],
  },
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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      menuGroups.map((group) => [
        group.title,
        group.items.some((item) => item.url === currentPath),
      ]),
    ),
  );
  const getCtx = useServerFn(getMyOrgContext);
  const { data: ctx } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => getCtx(),
  });
  const isAdmin = ctx?.isOwner === true;
  const isActive = ctx?.active === true;
  const permissions = (ctx?.permissions ?? {}) as Permission;
  const tour = useTourAutoStart();

  useEffect(() => {
    const activeGroup = menuGroups.find((group) =>
      group.items.some(
        (item) => currentPath === item.url || currentPath.startsWith(`${item.url}/`),
      ),
    );
    if (activeGroup) setOpenGroups((groups) => ({ ...groups, [activeGroup.title]: true }));
  }, [currentPath]);

  // Usuário pendente (não aprovado pelo admin) vê apenas tela de boas-vindas
  if (ctx && !isActive && !isAdmin) {
    return (
      <Sidebar
        collapsible="icon"
        className="operations-sidebar [--sidebar-width:13rem] [--sidebar-width-icon:3.5rem] border-r border-sidebar-border"
      >
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-4">
            <img src={lexiaLogo} alt="LexIA" className="h-9 w-9 shrink-0 object-contain" />
            <span className="text-sm font-semibold tracking-normal text-sidebar-foreground">
              LexIA
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-1 flex flex-col items-center justify-center flex-1">
          <Lock className="h-8 w-8 text-accent mb-2" />
          <p className="text-xs text-center text-muted-foreground px-4">
            Sua conta está <strong>pendente de aprovação</strong>. Aguarde o administrador liberar
            seu acesso.
          </p>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={handleLogout}
                className="text-muted-foreground hover:text-destructive"
              >
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
      <Sidebar
        collapsible="icon"
        className="operations-sidebar [--sidebar-width:13rem] [--sidebar-width-icon:3.5rem] border-r border-sidebar-border"
      >
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-4">
            <img
              src={lexiaLogo}
              alt="Lex IA Jurídico"
              className="h-9 w-9 shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-normal text-sidebar-foreground">
                LexIA
              </p>
              <p className="text-[10px] text-muted-foreground">Central de operação</p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2 py-3">
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/70">
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {primaryItems.map((item) => {
                  const isCurrentActive = currentPath === item.url;
                  return (
                    <SidebarMenuItem key={item.title} data-tour={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={isCurrentActive}
                        className={`group relative h-9 rounded-md transition-colors ${
                          isCurrentActive
                            ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
                            : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        }`}
                      >
                        <Link
                          to={item.url}
                          preload="intent"
                          className="flex items-center gap-3 px-3"
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className="text-[13px] font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {menuGroups.map((group) => {
            const visibleGroupItems = group.items.filter((item) => hasAccess(item.url));
            if (visibleGroupItems.length === 0) return null;
            const isOpen = openGroups[group.title] ?? false;
            const hasActiveItem = visibleGroupItems.some((item) => currentPath === item.url);
            return (
              <Collapsible
                key={group.title}
                open={isOpen}
                onOpenChange={(open) =>
                  setOpenGroups((groups) => ({ ...groups, [group.title]: open }))
                }
                className="group/collapsible"
              >
                <SidebarGroup className="py-0">
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            className={`h-9 rounded-md px-3 text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${hasActiveItem ? "text-sidebar-primary" : ""}`}
                          >
                            <group.icon className="h-4 w-4 shrink-0" />
                            <span className="text-[12px] font-semibold">{group.title}</span>
                            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenu className="ml-3 mt-1 border-l border-sidebar-border pl-2">
                            {visibleGroupItems.map((item) => {
                              const isCurrentActive = currentPath === item.url;
                              return (
                                <SidebarMenuItem key={item.url} data-tour={item.url}>
                                  <SidebarMenuButton
                                    asChild
                                    isActive={isCurrentActive}
                                    className={`h-8 rounded-md px-2.5 ${isCurrentActive ? "bg-sidebar-accent text-sidebar-primary" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                                  >
                                    <Link
                                      to={item.url}
                                      preload="intent"
                                      className="flex items-center gap-2.5"
                                    >
                                      <item.icon className="h-3.5 w-3.5 shrink-0" />
                                      <span className="truncate text-xs font-medium">
                                        {item.title}
                                      </span>
                                    </Link>
                                  </SidebarMenuButton>
                                </SidebarMenuItem>
                              );
                            })}
                          </SidebarMenu>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </Collapsible>
            );
          })}
          {isAdmin && (
            <SidebarGroup>
              <SidebarGroupLabel className="px-3 text-[10px] font-semibold uppercase tracking-normal text-muted-foreground/70">
                Administração
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
                          className={`group relative h-9 rounded-md transition-colors ${
                            isCurrentActive
                              ? "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground"
                              : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          }`}
                        >
                          <Link
                            to={item.url}
                            preload="intent"
                            className="flex items-center gap-3 px-3"
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
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
        <SidebarFooter className="border-t border-sidebar-border px-2 py-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => tour.setOpen(true)}
                className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-primary"
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
              <SidebarMenuButton
                onClick={handleLogout}
                className="text-muted-foreground hover:text-destructive"
              >
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
