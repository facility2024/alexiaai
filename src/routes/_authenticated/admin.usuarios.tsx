import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Shield, Trash2, CheckCircle, UserCog, Users, Ban, Check, X, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import lexiaLogo from "@/assets/lexia-logo.png";
import {
  listTeam,
  updateMemberPermissions,
  updateMemberRole,
  removeMember,
  approveMember,
  deactivateMember,
  setMaxMembers,
  getMyOrgContext,
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  deleteAccessRequest,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Equipe & Permissões — LexIA" }] }),
  component: TeamPage,
});

const PERM_LABELS: Record<string, string> = {
  can_view_all_chats: "Ver todos os chats",
  can_edit_kanban: "Editar Kanban",
  can_manage_clients: "Gerenciar clientes",
  can_manage_cases: "Gerenciar casos",
  can_send_billing: "Enviar cobranças",
  can_configure_ai: "Configurar IA",
  can_access_knowledge: "Base de conhecimento",
  can_manage_sectors: "Gerenciar setores",
  can_export: "Exportar dados",
};

const ROLES = ["admin", "manager", "specialist", "agent"] as const;
type Role = (typeof ROLES)[number];

function TeamPage() {
  const list = useServerFn(listTeam);
  const upsert = useServerFn(updateMemberPermissions);
  const setRole = useServerFn(updateMemberRole);
  const remove = useServerFn(removeMember);
  const approve = useServerFn(approveMember);
  const deactivate = useServerFn(deactivateMember);
  const setLimit = useServerFn(setMaxMembers);
  const ctxFn = useServerFn(getMyOrgContext);
  const listReqs = useServerFn(listAccessRequests);
  const approveReq = useServerFn(approveAccessRequest);
  const rejectReq = useServerFn(rejectAccessRequest);
  const deleteReq = useServerFn(deleteAccessRequest);
  const qc = useQueryClient();
  const [editEmail, setEditEmail] = useState<Record<string, string>>({});

  const { data: ctx } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => ctxFn(),
  });
  if (ctx && !ctx.isOwner) {
    throw redirect({ to: "/dashboard" });
  }
  const currentLimit = (ctx?.profile as { max_members?: number } | undefined)?.max_members ?? 5;
  const [limitInput, setLimitInput] = useState<number | null>(null);

  const { data: team = [], isLoading } = useQuery({
    queryKey: ["team"],
    queryFn: () => list(),
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const permMut = useMutation({
    mutationFn: (input: Parameters<typeof updateMemberPermissions>[0]["data"]) =>
      upsert({ data: input }),
    onSuccess: () => {
      toast.success("Permissões atualizadas");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const roleMut = useMutation({
    mutationFn: (input: { user_id: string; role: Role }) => setRole({ data: input }),
    onSuccess: () => {
      toast.success("Papel alterado");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });

  const rmMut = useMutation({
    mutationFn: (user_id: string) => remove({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Membro excluído permanentemente");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });

  const approveMut = useMutation({
    mutationFn: (user_id: string) => approve({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Acesso liberado!");
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["my-org-context"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const deactivateMut = useMutation({
    mutationFn: (user_id: string) => deactivate({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Acesso desativado");
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const limitMut = useMutation({
    mutationFn: (max_members: number) => setLimit({ data: { max_members } }),
    onSuccess: () => {
      toast.success("Limite atualizado");
      setLimitInput(null);
      qc.invalidateQueries({ queryKey: ["my-org-context"] });
    },
  });

  const { data: accessRequests = [] } = useQuery({
    queryKey: ["invite-access-requests"],
    queryFn: () => listReqs(),
    refetchInterval: 10000,
  });

  const approveReqMut = useMutation({
    mutationFn: (v: { id: string; email?: string | null }) => approveReq({ data: v }),
    onSuccess: (r) => {
      toast.success(
        r.released
          ? "Acesso liberado! O usuário já pode entrar no sistema."
          : r.invited
            ? `Convite enviado para ${r.email}. Assim que aceitar o e-mail, ele entra liberado automaticamente.`
            : `Aprovado! Peça para o usuário voltar ao link do convite e criar a senha com ${r.email}${r.inviteError ? ` (${r.inviteError})` : ""}.`,
      );
      qc.invalidateQueries({ queryKey: ["invite-access-requests"] });
      qc.invalidateQueries({ queryKey: ["invites"] });
      qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const rejectReqMut = useMutation({
    mutationFn: (id: string) => rejectReq({ data: { id } }),
    onSuccess: () => {
      toast.success("Solicitação rejeitada");
      qc.invalidateQueries({ queryKey: ["invite-access-requests"] });
    },
  });
  const deleteReqMut = useMutation({
    mutationFn: (id: string) => deleteReq({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invite-access-requests"] }),
  });

  const activeCount = team.filter((m) => m.active).length;
  const pendingCount = team.filter((m) => !m.active).length;
  const pendingReqs = accessRequests.filter((r) => r.status === "pending");

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="border-b border-border/60 pb-6 flex items-center gap-4">
        <img src={lexiaLogo} alt="LexIA" className="h-12 w-12 object-contain" />
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-accent">Painel Admin</div>
          <h1 className="font-display italic text-5xl leading-[0.95] text-foreground mt-2">
            Equipe & <span className="text-accent">Permissões</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Controle o que cada pessoa do escritório pode ver e mexer.
          </p>
        </div>
      </div>

      {/* Configuração de limite */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" /> Limite de usuários
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{activeCount}</strong> ativos de{" "}
              <strong className="text-foreground">{currentLimit}</strong> permitidos{" "}
              {pendingCount > 0 && <span className="text-yellow-500">({pendingCount} pendentes)</span>}
            </p>
            <div className="flex items-center gap-2 ml-auto">
              <Input
                type="number"
                min={1}
                max={500}
                className="w-20"
                placeholder={String(currentLimit)}
                value={limitInput ?? ""}
                onChange={(e) => setLimitInput(Number(e.target.value) || null)}
              />
              <Button
                size="sm"
                disabled={!limitInput || limitMut.isPending}
                onClick={() => limitInput && limitMut.mutate(limitInput)}
              >
                Salvar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Solicitações de acesso pendentes */}
      {pendingReqs.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-5 w-5 text-amber-500" /> Solicitações de acesso
              <Badge variant="outline" className="border-amber-500/40 text-amber-500 ml-1">
                {pendingReqs.length} pendente{pendingReqs.length > 1 ? "s" : ""}
              </Badge>
            </CardTitle>
            <CardDescription>
              Pedidos vindos dos links de convite. Depois de aprovar, a pessoa volta ao mesmo link do convite para criar a senha e entrar liberada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingReqs.map((r) => {
              const emailValue = editEmail[r.id] ?? r.email ?? "";
              return (
                <div key={r.id} className="rounded-lg border border-border/60 p-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-[160px]">
                    <div className="text-sm font-medium">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <Input
                    type="email"
                    value={emailValue}
                    onChange={(e) => setEditEmail((s) => ({ ...s, [r.id]: e.target.value }))}
                    placeholder="e-mail para cadastro"
                    className="h-8 text-xs flex-1 min-w-[220px]"
                  />
                  <div className="flex gap-2 ml-auto">
                    <Button
                      size="sm"
                      onClick={() => approveReqMut.mutate({ id: r.id, email: emailValue.trim() || null })}
                      disabled={approveReqMut.isPending}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" /> Aprovar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectReqMut.mutate(r.id)}>
                      <X className="h-3.5 w-3.5 mr-1" /> Rejeitar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteReqMut.mutate(r.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}



      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : team.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum membro ainda. Vá em <strong>Convites</strong> para gerar um link.
          </CardContent>
        </Card>
      ) : (
        team.map((m) => {
          const initials = (m.profile?.full_name || m.profile?.email || "?")
            .split(" ")
            .slice(0, 2)
            .map((s) => s[0])
            .join("")
            .toUpperCase();
          return (
            <Card key={m.id} className="border-border/60">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border border-accent/30">
                      <AvatarImage src={m.profile?.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-accent/20 text-accent text-sm">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-base">
                        {m.profile?.full_name || m.profile?.email || m.member_id}
                      </CardTitle>
                      <CardDescription>{m.profile?.email}</CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={(e) => roleMut.mutate({ user_id: m.member_id, role: e.target.value as Role })}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {m.active ? (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                        Ativo
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-yellow-500/40 text-yellow-500">
                        Pendente
                      </Badge>
                    )}
                    {m.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("Desativar o acesso deste usuário? Ele verá a tela de aguardando liberação até você reativar.")) {
                            deactivateMut.mutate(m.member_id);
                          }
                        }}
                        disabled={deactivateMut.isPending}
                      >
                        <Ban className="h-3.5 w-3.5 mr-1" /> Desativar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => approveMut.mutate(m.member_id)}
                        disabled={approveMut.isPending}
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Ativar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Excluir este membro permanentemente?")) rmMut.mutate(m.member_id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(PERM_LABELS).map(([key, label]) => {
                    const value = Boolean(
                      (m.permissions as Record<string, unknown> | null)?.[key],
                    );
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <Switch
                          checked={value}
                          onCheckedChange={(v) =>
                            permMut.mutate({
                              user_id: m.member_id,
                              permissions: { [key]: v },
                            })
                          }
                        />
                        <Label className="text-xs cursor-pointer">{label}</Label>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
