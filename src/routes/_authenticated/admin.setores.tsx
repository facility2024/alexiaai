import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Building2, Plus, Trash2, Save, UserPlus, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listSectors,
  upsertSector,
  deleteSector,
  setSectorMember,
} from "@/lib/sectors.functions";
import { listTeam, getMyOrgContext } from "@/lib/admin.functions";
import lexiaLogo from "@/assets/lexia-logo.png";

export const Route = createFileRoute("/_authenticated/admin/setores")({
  head: () => ({ meta: [{ title: "Setores — LexIA" }] }),
  component: SectorsPage,
});

function SectorsPage() {
  const list = useServerFn(listSectors);
  const upsert = useServerFn(upsertSector);
  const del = useServerFn(deleteSector);
  const setMem = useServerFn(setSectorMember);
  const teamFn = useServerFn(listTeam);
  const ctxFn = useServerFn(getMyOrgContext);
  const qc = useQueryClient();

  const { data: ctx } = useQuery({ queryKey: ["my-org-context"], queryFn: () => ctxFn() });
  if (ctx && !ctx.isOwner) {
    throw redirect({ to: "/dashboard" });
  }

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [kws, setKws] = useState("");

  const { data: sectors = [] } = useQuery({ queryKey: ["sectors"], queryFn: () => list() });
  const { data: team = [] } = useQuery({ queryKey: ["team"], queryFn: () => teamFn() });

  const upMut = useMutation({
    mutationFn: (input: Parameters<typeof upsertSector>[0]["data"]) => upsert({ data: input }),
    onSuccess: () => {
      toast.success("Setor salvo");
      qc.invalidateQueries({ queryKey: ["sectors"] });
      setCreating(false);
      setName("");
      setDesc("");
      setKws("");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["sectors"] });
    },
  });

  const memMut = useMutation({
    mutationFn: (input: Parameters<typeof setSectorMember>[0]["data"]) =>
      setMem({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sectors"] });
    },
  });

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="border-b border-border/60 pb-6 flex items-center gap-4">
        <img src={lexiaLogo} alt="LexIA" className="h-12 w-12 object-contain" />
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-accent">Painel Admin</div>
          <h1 className="font-display italic text-5xl leading-[0.95] text-foreground mt-2">
            Setores & <span className="text-accent">Roteamento</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Cadastre os setores do escritório. As palavras-chave são usadas pelo agente de IA para transferir automaticamente cada conversa ao setor certo.
          </p>
        </div>
      </div>

      {creating ? (
        <Card className="border-accent/40 border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Novo setor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Trabalhista" />
            </div>
            <div>
              <Label className="text-xs">Descrição</Label>
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
            </div>
            <div>
              <Label className="text-xs">
                Palavras-chave (separadas por vírgula) — a IA usa para identificar o assunto
              </Label>
              <Input
                value={kws}
                onChange={(e) => setKws(e.target.value)}
                placeholder="rescisão, demissão, hora extra, salário"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button>
              <Button
                disabled={!name.trim() || upMut.isPending}
                onClick={() =>
                  upMut.mutate({
                    name: name.trim(),
                    description: desc.trim() || null,
                    keywords: kws.split(",").map((k) => k.trim()).filter(Boolean),
                  })
                }
              >
                <Save className="h-3.5 w-3.5 mr-1" /> Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> Novo setor
        </Button>
      )}

      {sectors.map((s) => (
        <Card key={s.id} className="border-border/60">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="rounded-lg p-2"
                  style={{ backgroundColor: `${s.color ?? "#8b5cf6"}20`, color: s.color ?? "#8b5cf6" }}
                >
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <CardDescription>{s.description || "—"}</CardDescription>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Remover setor "${s.name}"?`)) delMut.mutate(s.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Palavras-chave</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {s.keywords?.length ? (
                  s.keywords.map((k: string) => (
                    <Badge key={k} variant="outline" className="text-[10px]">
                      {k}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Sem palavras-chave</span>
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Responsáveis</Label>
              <div className="space-y-2">
                {team.map((m) => {
                  const asMember = s.members?.find((x) => x.user_id === m.member_id);
                  const isMember = Boolean(asMember);
                  const isLead = asMember?.is_lead === true;
                  return (
                    <div
                      key={m.member_id}
                      className="flex items-center justify-between text-sm rounded-md border border-border/40 p-2"
                    >
                      <div className="flex items-center gap-2">
                        <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{m.profile?.full_name || m.profile?.email || m.member_id}</span>
                        {isLead && (
                          <Badge variant="outline" className="border-amber-400/40 text-amber-400">
                            <Crown className="h-3 w-3 mr-1" /> Responsável principal
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {isMember ? (
                          <>
                            {!isLead && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  memMut.mutate({
                                    sector_id: s.id,
                                    user_id: m.member_id,
                                    is_lead: true,
                                  })
                                }
                              >
                                Marcar principal
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                memMut.mutate({
                                  sector_id: s.id,
                                  user_id: m.member_id,
                                  remove: true,
                                })
                              }
                            >
                              Remover
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              memMut.mutate({
                                sector_id: s.id,
                                user_id: m.member_id,
                                is_lead: false,
                              })
                            }
                          >
                            Adicionar
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {team.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Convide membros primeiro para poder atribuir setores.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
