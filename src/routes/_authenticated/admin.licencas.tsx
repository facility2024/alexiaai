import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Plus,
  Copy,
  Trash2,
  Pencil,
  RefreshCw,
  Power,
  Building2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
  regenerateCompanyInvite,
} from "@/lib/licenses.functions";
import { getMyOrgContext } from "@/lib/admin.functions";
import { PERM_LABELS, type PermKey } from "@/lib/access";

// Gestão de licenças SaaS — visível somente ao administrador da plataforma
// (profiles.is_platform_admin). Empresas criadas aqui nunca misturam com o
// painel oficial: cada uma vira um workspace isolado com credenciais próprias.

export const Route = createFileRoute("/_authenticated/admin/licencas")({
  head: () => ({ meta: [{ title: "Licenças — LexIA" }] }),
  component: LicensesPage,
});

type CompanyRow = {
  id: string;
  company_name: string;
  invited_email: string;
  owner_user_id: string | null;
  owner_email?: string | null;
  owner_name?: string | null;
  starts_at: string;
  ends_at: string | null;
  features: Record<string, boolean>;
  max_members: number;
  status: "active" | "deleted";
  state: "active" | "scheduled" | "expired" | "deleted" | "pending";
  invite_token: string;
  invite_slug: string | null;
  invite_used_at: string | null;
};

const ALL_FEATURES = Object.keys(PERM_LABELS) as PermKey[];

function defaultFeatures(): Record<string, boolean> {
  return Object.fromEntries(ALL_FEATURES.map((k) => [k, true]));
}

const STATE_BADGE: Record<CompanyRow["state"], { label: string; className: string }> = {
  active: { label: "Ativa", className: "border-emerald-500/40 text-emerald-500" },
  scheduled: { label: "Agendada", className: "border-yellow-500/40 text-yellow-500" },
  expired: { label: "Vencida", className: "border-destructive/40 text-destructive" },
  pending: { label: "Aguardando cadastro", className: "border-amber-500/40 text-amber-500" },
  deleted: { label: "Desativada", className: "border-border text-muted-foreground" },
};

function inviteUrl(row: CompanyRow): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/convite-empresa/${row.invite_slug ?? row.invite_token}`;
}

async function copyText(text: string) {
  try {
    if (navigator?.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback abaixo
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function LicensesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getCtx = useServerFn(getMyOrgContext);
  const list = useServerFn(listCompanies);
  const create = useServerFn(createCompany);
  const update = useServerFn(updateCompany);
  const remove = useServerFn(deleteCompany);
  const reinvite = useServerFn(regenerateCompanyInvite);

  const { data: ctx, isLoading: ctxLoading } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => getCtx(),
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["license-companies"],
    queryFn: () => list(),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState("");
  const [maxMembers, setMaxMembers] = useState(5);
  const [features, setFeatures] = useState<Record<string, boolean>>(defaultFeatures);
  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null);

  useEffect(() => {
    if (!ctxLoading && ctx && ctx.profile?.is_platform_admin !== true) {
      navigate({ to: "/admin", replace: true });
    }
  }, [ctxLoading, ctx, navigate]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["license-companies"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        company_name: companyName.trim(),
        invited_email: invitedEmail.trim().toLowerCase(),
        starts_at: `${startsAt}T00:00:00`,
        ends_at: endsAt ? `${endsAt}T23:59:59` : null,
        features,
        max_members: Number(maxMembers) || 5,
      };
      return editingId
        ? update({ data: { id: editingId, ...payload } })
        : create({ data: payload });
    },
    onSuccess: () => {
      toast.success(editingId ? "Empresa atualizada" : "Empresa criada");
      resetForm();
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Empresa desativada (dados preservados)");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: (row: CompanyRow) =>
      update({ data: { id: row.id, status: row.status === "deleted" ? "active" : "deleted" } }),
    onSuccess: () => {
      toast.success("Status atualizado");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reinviteMutation = useMutation({
    mutationFn: (id: string) => reinvite({ data: { id } }),
    onSuccess: async (res) => {
      const row = (rows ?? []).find((r: CompanyRow) => r.invite_token === res.invite_token);
      const url = `${window.location.origin}/convite-empresa/${res.invite_slug ?? res.invite_token}`;
      await copyText(url);
      toast.success("Novo link gerado e copiado");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetForm() {
    setEditingId(null);
    setCompanyName("");
    setInvitedEmail("");
    setStartsAt(new Date().toISOString().slice(0, 10));
    setEndsAt("");
    setMaxMembers(5);
    setFeatures(defaultFeatures());
  }

  function startEdit(row: CompanyRow) {
    setEditingId(row.id);
    setCompanyName(row.company_name);
    setInvitedEmail(row.invited_email);
    setStartsAt(row.starts_at.slice(0, 10));
    setEndsAt(row.ends_at ? row.ends_at.slice(0, 10) : "");
    setMaxMembers(row.max_members ?? 5);
    setFeatures({ ...defaultFeatures(), ...(row.features ?? {}) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (ctxLoading || !ctx) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }
  if (ctx.profile?.is_platform_admin !== true) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <KeyRound className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Licenças de empresas</h1>
          <p className="text-sm text-muted-foreground">
            Crie empresas com acesso liberado por módulo e período de validade. Cada empresa usa
            credenciais próprias (WAPI e agentes de IA) e não mistura com o painel oficial.
          </p>
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">
            {editingId ? "Editar empresa" : "Nova empresa"}
          </CardTitle>
          <CardDescription>
            Ao criar, um link de convite é gerado para o dono concluir o cadastro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="company_name">Nome da empresa</Label>
              <Input
                id="company_name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex.: Escritório João"
                required
                minLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invited_email">E-mail do dono</Label>
              <Input
                id="invited_email"
                type="email"
                value={invitedEmail}
                onChange={(e) => setInvitedEmail(e.target.value)}
                placeholder="joao@empresa.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="starts_at">Início da licença</Label>
              <Input
                id="starts_at"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ends_at">Fim da licença (opcional)</Label>
              <Input
                id="ends_at"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_members">Limite de membros</Label>
              <Input
                id="max_members"
                type="number"
                min={1}
                max={200}
                value={maxMembers}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
              />
            </div>

            <div className="sm:col-span-2 space-y-3">
              <div className="flex items-center justify-between">
                <Label>Módulos liberados</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFeatures(defaultFeatures())}
                  >
                    Marcar todos
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFeatures(Object.fromEntries(ALL_FEATURES.map((k) => [k, false])))
                    }
                  >
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ALL_FEATURES.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2"
                  >
                    <span className="text-xs text-foreground">{PERM_LABELS[key]}</span>
                    <Switch
                      checked={features[key] !== false}
                      onCheckedChange={(v) => setFeatures((f) => ({ ...f, [key]: v === true }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {editingId ? "Salvar alterações" : "Criar empresa"}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Empresas</CardTitle>
          <CardDescription>
            {isLoading ? "Carregando..." : `${(rows ?? []).length} empresa(s) cadastrada(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(rows ?? []).map((row: CompanyRow) => {
            const badge = STATE_BADGE[row.state] ?? STATE_BADGE.deleted;
            const linked = row.owner_user_id != null;
            return (
              <div
                key={row.id}
                className="rounded-lg border border-border/60 p-4 flex flex-wrap items-center gap-3"
              >
                <Building2 className="h-5 w-5 text-accent shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground truncate">{row.company_name}</span>
                    <Badge variant="outline" className={badge.className}>
                      {badge.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {linked ? row.owner_email : row.invited_email} ·{" "}
                    {new Date(row.starts_at).toLocaleDateString("pt-BR")}
                    {row.ends_at
                      ? ` → ${new Date(row.ends_at).toLocaleDateString("pt-BR")}`
                      : " → sem prazo"}{" "}
                    · {row.max_members} membros
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const ok = await copyText(inviteUrl(row));
                      toast[ok ? "success" : "error"](
                        ok ? "Link de convite copiado" : "Não foi possível copiar",
                      );
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copiar link
                  </Button>
                  {!linked && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => reinviteMutation.mutate(row.id)}
                      disabled={reinviteMutation.isPending}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" /> Reemitir
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => startEdit(row)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => toggleStatusMutation.mutate(row)}
                    disabled={toggleStatusMutation.isPending}
                  >
                    <Power className="h-3.5 w-3.5 mr-1" />
                    {row.status === "deleted" ? "Reativar" : "Desativar"}
                  </Button>
                  {row.status !== "deleted" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Excluir
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!isLoading && (rows ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma empresa criada ainda. Use o formulário acima para liberar o CRM para um novo
              cliente.
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              A empresa {deleteTarget?.company_name} será desativada e o acesso bloqueado. Os dados
              (mensagens, clientes, contratos etc.) são preservados e podem ser reativados depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
