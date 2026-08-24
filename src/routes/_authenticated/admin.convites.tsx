import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Copy, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  createInvite, listInvites, revokeInvite, getMyOrgContext,
  listAccessRequests, approveAccessRequest, rejectAccessRequest, deleteAccessRequest,
} from "@/lib/admin.functions";
import { listSectors } from "@/lib/sectors.functions";
import lexiaLogo from "@/assets/lexia-logo.png";

export const Route = createFileRoute("/_authenticated/admin/convites")({
  head: () => ({ meta: [{ title: "Convites — LexIA" }] }),
  component: InvitesPage,
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

async function copyText(text: string) {
  try {
    if (navigator?.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
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

function InvitesPage() {
  const list = useServerFn(listInvites);
  const create = useServerFn(createInvite);
  const revoke = useServerFn(revokeInvite);
  const sectorsFn = useServerFn(listSectors);
  const ctxFn = useServerFn(getMyOrgContext);
  const listReqs = useServerFn(listAccessRequests);
  const approveReq = useServerFn(approveAccessRequest);
  const rejectReq = useServerFn(rejectAccessRequest);
  const deleteReq = useServerFn(deleteAccessRequest);
  const qc = useQueryClient();

  const { data: ctx } = useQuery({ queryKey: ["my-org-context"], queryFn: () => ctxFn() });
  if (ctx && !ctx.isOwner) {
    throw redirect({ to: "/dashboard" });
  }

  const [role, setRole] = useState<(typeof ROLES)[number]>("agent");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState(7);
  const [perms, setPerms] = useState<Record<string, boolean>>({
    can_edit_kanban: true,
    can_manage_clients: true,
    can_manage_cases: true,
    can_access_knowledge: true,
  });
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  const { data: invites = [] } = useQuery({ queryKey: ["invites"], queryFn: () => list() });
  const { data: sectors = [] } = useQuery({
    queryKey: ["sectors"],
    queryFn: () => sectorsFn(),
  });

  const createMut = useMutation({
    mutationFn: () =>
      create({
        data: {
          email: email.trim() || null,
          role,
          permissions: perms,
          sector_ids: selectedSectors,
          note: note.trim() || null,
          expires_in_days: days,
        },
      }),
    onSuccess: async (row) => {
      const url = `${window.location.origin}/convite/${row.slug ?? row.token}`;
      const ok = await copyText(url);
      toast.success(ok ? "Link criado e copiado!" : "Link criado (copie manualmente)");
      setEmail("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => revoke({ data: { id } }),
    onSuccess: () => {
      toast.success("Convite excluído");
      qc.invalidateQueries({ queryKey: ["invites"] });
    },
  });

  const { data: accessRequests = [] } = useQuery({
    queryKey: ["invite-access-requests"],
    queryFn: () => listReqs(),
    refetchInterval: 15000,
  });

  const [editEmail, setEditEmail] = useState<Record<string, string>>({});

  const approveMut = useMutation({
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
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectReq({ data: { id } }),
    onSuccess: () => {
      toast.success("Solicitação rejeitada");
      qc.invalidateQueries({ queryKey: ["invite-access-requests"] });
    },
  });
  const deleteReqMut = useMutation({
    mutationFn: (id: string) => deleteReq({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invite-access-requests"] });
    },
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="border-b border-border/60 pb-6 flex items-center gap-4">
        <img src={lexiaLogo} alt="LexIA" className="h-12 w-12 object-contain" />
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-accent">Painel Admin</div>
          <h1 className="font-display italic text-5xl leading-[0.95] text-foreground mt-2">
            Convites <span className="text-accent">por link</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Gere um link, escolha as permissões e os setores. Quem abrir informa o nome e aguarda sua ativação no painel admin.
          </p>
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-accent" /> Novo convite
          </CardTitle>
          <CardDescription>Configure e clique em Gerar link — não enviamos confirmação por e-mail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs">E-mail de identificação (opcional)</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Não envia e-mail" />
            </div>
            <div>
              <Label className="text-xs">Papel</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Validade (dias)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value) || 7)))}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Observação</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: Atendente do turno da tarde" />
          </div>

          <div>
            <Label className="text-xs mb-2 block">Permissões</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 rounded-lg border border-border/60 p-3">
              {Object.entries(PERM_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    checked={Boolean(perms[key])}
                    onCheckedChange={(v) => setPerms((p) => ({ ...p, [key]: v }))}
                  />
                  <Label className="text-xs cursor-pointer">{label}</Label>
                </div>
              ))}
            </div>
          </div>

          {sectors.length > 0 && (
            <div>
              <Label className="text-xs mb-2 block">Setores que a pessoa vai atender</Label>
              <div className="flex flex-wrap gap-2">
                {sectors.map((s) => {
                  const on = selectedSectors.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() =>
                        setSelectedSectors((cur) =>
                          on ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                        )
                      }
                      className={`text-xs px-3 py-1.5 rounded-full border transition ${
                        on
                          ? "bg-accent/20 text-accent border-accent"
                          : "border-border/60 text-muted-foreground hover:border-accent/40"
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button disabled={createMut.isPending} onClick={() => createMut.mutate()}>
              Gerar link
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Solicitações de acesso</CardTitle>
          <CardDescription>
            Pedidos vindos dos links de convite. Depois de aprovar, a pessoa volta ao mesmo link do convite para criar a senha e entrar liberada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {accessRequests.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma solicitação no momento.</p>
          )}
          {accessRequests.map((r) => {
            const emailValue = editEmail[r.id] ?? r.email ?? "";
            const isPending = r.status === "pending";
            return (
              <div key={r.id} className="rounded-lg border border-border/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <strong className="text-sm">{r.full_name}</strong>
                    <Badge
                      variant="outline"
                      className={
                        r.status === "pending"
                          ? "border-amber-500/40 text-amber-500"
                          : r.status === "approved"
                            ? "border-emerald-500/40 text-emerald-500"
                            : "border-muted-foreground/30 text-muted-foreground"
                      }
                    >
                      {r.status === "pending" ? "Pendente" : r.status === "approved" ? "Aprovado" : "Rejeitado"}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {isPending && (
                      <>
                        <Button
                          size="sm"
                          onClick={() =>
                            approveMut.mutate({ id: r.id, email: emailValue.trim() || null })
                          }
                          disabled={approveMut.isPending}
                        >
                          <Check className="h-3.5 w-3.5 mr-1" /> Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rejectMut.mutate(r.id)}
                        >
                          <X className="h-3.5 w-3.5 mr-1" /> Rejeitar
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteReqMut.mutate(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs w-16">E-mail</Label>
                  <Input
                    type="email"
                    value={emailValue}
                    onChange={(e) =>
                      setEditEmail((s) => ({ ...s, [r.id]: e.target.value }))
                    }
                    placeholder="e-mail para cadastro"
                    disabled={!isPending}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>


      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Convites gerados</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {invites.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum convite ainda.</p>
          )}
          {invites.map((inv) => {
            const url = `${typeof window !== "undefined" ? window.location.origin : ""}/convite/${inv.slug ?? inv.token}`;
            const expired = new Date(inv.expires_at).getTime() < Date.now();
            const status = inv.used_at ? "Usado" : expired ? "Expirado" : "Ativo";
            return (
              <div key={inv.id} className="rounded-lg border border-border/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-accent/40 text-accent">
                      {inv.role}
                    </Badge>
                    <span className="text-muted-foreground">{inv.email || "sem e-mail"}</span>
                    <Badge
                      variant="outline"
                      className={
                        status === "Ativo"
                          ? "border-emerald-500/40 text-emerald-500"
                          : "border-muted-foreground/30 text-muted-foreground"
                      }
                    >
                      {status}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const ok = await copyText(url);
                        toast.success(ok ? "Copiado" : "Selecione o link e copie manualmente");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Excluir este convite permanentemente?")) delMut.mutate(inv.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <code className="text-[11px] font-mono block break-all bg-muted rounded px-2 py-1">
                  {url}
                </code>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
