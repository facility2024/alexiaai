// Fonte única de verdade: módulos do menu → permissões.
// Usado pelo sidebar (exibição) e pelo guard de rotas em
// src/routes/_authenticated/route.tsx (bloqueio por URL) para garantir que
// o que o admin libera no painel é exatamente o que o colaborador acessa.

export type PermKey =
  | "can_view_all_chats"
  | "can_edit_kanban"
  | "can_manage_clients"
  | "can_manage_cases"
  | "can_send_billing"
  | "can_configure_ai"
  | "can_access_knowledge"
  | "can_manage_sectors"
  | "can_export"
  | "can_manage_contracts"
  | "can_access_agenda"
  | "can_access_whatsapp"
  | "can_access_guide"
  | "can_manage_campaigns";

/** Chaves que vivem em user_permissions.extra (JSONB) — sem coluna própria. */
export const EXTRA_PERM_KEYS: readonly PermKey[] = [
  "can_access_agenda",
  "can_access_whatsapp",
  "can_access_guide",
  "can_manage_campaigns",
];

/** Chaves com coluna própria em user_permissions (inclui can_manage_contracts). */
export const COLUMN_PERM_KEYS: readonly PermKey[] = [
  "can_view_all_chats",
  "can_edit_kanban",
  "can_manage_clients",
  "can_manage_cases",
  "can_send_billing",
  "can_configure_ai",
  "can_access_knowledge",
  "can_manage_sectors",
  "can_export",
  "can_manage_contracts",
];

/** Rótulos exibidos nos painéis admin (Equipe & Permissões e Convites). */
export const PERM_LABELS: Record<PermKey, string> = {
  can_view_all_chats: "Atendimento (caixa de entrada)",
  can_edit_kanban: "Kanban (pipeline)",
  can_manage_clients: "Leads (clientes)",
  can_access_agenda: "Agenda",
  can_manage_cases: "Captação de casos",
  can_send_billing: "Marketing (SMS e cobranças)",
  can_manage_contracts: "Gestão de contratos",
  can_access_knowledge: "Base de conhecimento",
  can_configure_ai: "IA (treinamento e configurações)",
  can_access_whatsapp: "WhatsApp (integração)",
  can_access_guide: "Guia de uso",
  can_manage_sectors: "Gerenciar setores",
  can_export: "Exportar dados",
  can_manage_campaigns: "Campanhas WhatsApp (envio em massa)",
};

/**
 * Permissões padrão de um NOVO convite — os 7 módulos de acesso inicial
 * (Atendimento, Kanban, Leads, Agenda, Marketing, Contratos, Captação) ficam
 * ligados; os demais continuam sob controle específico do admin.
 */
export const DEFAULT_INVITE_PERMS: Record<string, boolean> = {
  can_view_all_chats: true,
  can_edit_kanban: true,
  can_manage_clients: true,
  can_manage_cases: true,
  can_access_agenda: true,
  can_send_billing: true,
  can_manage_contracts: true,
  can_access_knowledge: true,
  can_access_whatsapp: true,
  can_access_guide: true,
};

type ModuleAccess = "perm" | "admin_only" | "role_admin";

type Module = { url: string; access: ModuleAccess; key?: PermKey };

/** Ordem = prioridade do redirecionamento para o "primeiro módulo liberado". */
export const MODULES: Module[] = [
  { url: "/dashboard", access: "admin_only" },
  { url: "/admin", access: "admin_only" },
  { url: "/crm", access: "perm", key: "can_view_all_chats" },
  { url: "/kanban", access: "perm", key: "can_edit_kanban" },
  { url: "/clientes", access: "perm", key: "can_manage_clients" },
  { url: "/agendamentos", access: "perm", key: "can_access_agenda" },
  { url: "/casos", access: "perm", key: "can_manage_cases" },
  { url: "/sms", access: "perm", key: "can_send_billing" },
  { url: "/sms-followup", access: "perm", key: "can_send_billing" },
  { url: "/marketing-whatsapp", access: "perm", key: "can_manage_campaigns" },
  { url: "/contratos", access: "perm", key: "can_manage_contracts" },
  { url: "/eduardo", access: "perm", key: "can_manage_contracts" },
  { url: "/base-conhecimento", access: "perm", key: "can_access_knowledge" },
  { url: "/treinamento-ia", access: "perm", key: "can_configure_ai" },
  { url: "/personalidade-ia", access: "perm", key: "can_configure_ai" },
  { url: "/configuracoes", access: "perm", key: "can_configure_ai" },
  { url: "/integracoes", access: "perm", key: "can_configure_ai" },
  { url: "/whatsapp", access: "perm", key: "can_access_whatsapp" },
  { url: "/guia", access: "perm", key: "can_access_guide" },
];

function matchModule(pathname: string): Module | undefined {
  return MODULES.find((m) => pathname === m.url || pathname.startsWith(`${m.url}/`));
}

/**
 * Valor de uma permissão numa linha de user_permissions (ou null).
 * - coluna: usa o valor explícito da linha;
 * - chave extra (JSONB): usa `extra[key]`, senão o valor plano da linha;
 * - linha ausente: `undefined` (chamador aplica o default).
 */
export function getPermValue(
  perms: Record<string, unknown> | null | undefined,
  key: PermKey,
): boolean | undefined {
  if (!perms) return undefined;
  if (EXTRA_PERM_KEYS.includes(key)) {
    const extra = perms.extra as Record<string, unknown> | null | undefined;
    const v = extra?.[key];
    if (typeof v === "boolean") return v;
    const flat = perms[key];
    return typeof flat === "boolean" ? flat : undefined;
  }
  const v = perms[key];
  return typeof v === "boolean" ? v : undefined;
}

/**
 * Defaults aplicados quando o usuário NÃO tem linha em user_permissions
 * (legado). Se a linha existe, vale o valor gravado — false significa false.
 * Espelha os defaults de coluna do banco + os 7 módulos iniciais da equipe.
 */
const PERM_DEFAULTS: Record<PermKey, boolean> = {
  can_view_all_chats: true,
  can_edit_kanban: true,
  can_manage_clients: true,
  can_manage_cases: true,
  can_send_billing: true,
  can_configure_ai: false,
  can_access_knowledge: true,
  can_manage_sectors: false,
  can_export: false,
  can_manage_contracts: true,
  can_access_agenda: true,
  can_access_whatsapp: true,
  can_access_guide: true,
  can_manage_campaigns: false,
};

/**
 * Linha completa para semear user_permissions de um membro que ainda não tem
 * registro — evita que o primeiro toggle crie uma linha com defaults de
 * coluna do banco (view_all=false etc.) e apague módulos liberados.
 */
export function seedPermissionValues(): Record<string, boolean> {
  return { ...PERM_DEFAULTS };
}

export type LicenseInfo = {
  companyName: string;
  /** active = vigente; scheduled/expired/deleted bloqueiam tudo. */
  state: "active" | "scheduled" | "expired" | "deleted";
  startsAt: string;
  endsAt: string | null;
  /** Chaves PermKey → false = módulo NÃO liberado na licença. Ausente = liberado. */
  features: Record<string, boolean>;
};

export type OrgCtx = {
  isOwner: boolean;
  active: boolean;
  role: string;
  permissions: Record<string, unknown> | null;
  /** Presente apenas em workspaces criados pelo painel de licenças (SaaS). */
  license?: LicenseInfo | null;
  profile?: {
    full_name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
    max_members?: number | null;
    is_platform_admin?: boolean;
  } | null;
};

/** Módulo liberado na licença do workspace? Ausente = liberado. */
function licenseAllows(lic: LicenseInfo, key: PermKey): boolean {
  return lic.features?.[key] !== false;
}

/** Pode acessar `pathname`? Fonte única usada por sidebar E guard de rotas. */
export function canAccess(pathname: string, ctx: OrgCtx | null | undefined): boolean {
  if (!ctx) return false;
  const lic = ctx.license ?? null;
  // Licença fora da vigência bloqueia qualquer rota (a tela de bloqueio
  // é renderizada pelo layout em src/routes/_authenticated/route.tsx).
  if (lic && lic.state !== "active") return false;

  const mod = matchModule(pathname);

  // Workspace SEM licença (painel oficial): comportamento histórico, intacto.
  if (!lic) {
    if (ctx.isOwner) return true;
    if (!mod) return true; // rota fora do módulo conhecido não é bloqueada
    if (mod.access === "admin_only") return false;
    if (mod.access === "role_admin") return ctx.active === true && ctx.role === "admin";
    if (!ctx.active) return false; // pendente de aprovação: nada liberado
    const key = mod.key!;
    const value = getPermValue(ctx.permissions, key);
    return value ?? PERM_DEFAULTS[key];
  }

  // Workspace COM licença: o owner NÃO passa livre nos módulos — vale a
  // liberação marcada na licença. /admin* continua para ele gerir a própria equipe.
  if (!mod) return true;
  if (mod.access === "admin_only") return ctx.isOwner;
  if (mod.access === "role_admin") {
    const roleOk = ctx.isOwner || (ctx.active === true && ctx.role === "admin");
    return roleOk && licenseAllows(lic, "can_send_billing");
  }
  if (!ctx.isOwner && !ctx.active) return false;
  const key = mod.key!;
  if (!licenseAllows(lic, key)) return false;
  if (ctx.isOwner) return true;
  const value = getPermValue(ctx.permissions, key);
  return value ?? PERM_DEFAULTS[key];
}

/** Primeiro módulo permitido — alvo de redirecionamento pós-login/bloqueio. */
export function firstAllowedUrl(ctx: OrgCtx | null | undefined): string | null {
  if (!ctx) return null;
  for (const mod of MODULES) {
    if (canAccess(mod.url, ctx)) return mod.url;
  }
  return null;
}
