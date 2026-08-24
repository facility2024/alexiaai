import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getKanbanBoard, upsertColumn, deleteColumn, upsertTag, deleteTag,
} from "@/lib/kanban.functions";

export const Route = createFileRoute("/_authenticated/kanban/configuracoes")({
  head: () => ({ meta: [{ title: "Configurar Kanban — LexIA" }] }),
  component: KanbanConfigPage,
});

type Column = { id: string; name: string; color: string; icon: string; rule_prompt: string | null; auto_action: string | null; position: number };
type Tag = { id: string; name: string; color: string };

function KanbanConfigPage() {
  const fnGet = useServerFn(getKanbanBoard);
  const fnUpCol = useServerFn(upsertColumn);
  const fnDelCol = useServerFn(deleteColumn);
  const fnUpTag = useServerFn(upsertTag);
  const fnDelTag = useServerFn(deleteTag);

  const [cols, setCols] = useState<Column[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [newCol, setNewCol] = useState({ name: "", color: "#8b5cf6", rule_prompt: "", auto_action: "" });
  const [newTag, setNewTag] = useState({ name: "", color: "#8b5cf6" });

  async function load() {
    const r = await fnGet().catch((e) => { toast.error(e.message); return null; });
    if (r) { setCols(r.columns as Column[]); setTags(r.tags as Tag[]); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function saveCol(c: Column) {
    await fnUpCol({ data: { id: c.id, name: c.name, color: c.color, icon: c.icon, rule_prompt: c.rule_prompt ?? undefined, auto_action: c.auto_action ?? undefined } })
      .then(() => toast.success("Coluna salva"))
      .catch((e) => toast.error(e.message));
  }
  async function addCol() {
    if (!newCol.name.trim()) return;
    await fnUpCol({ data: { name: newCol.name, color: newCol.color, rule_prompt: newCol.rule_prompt || undefined, auto_action: newCol.auto_action || undefined } })
      .then(() => { setNewCol({ name: "", color: "#8b5cf6", rule_prompt: "", auto_action: "" }); load(); })
      .catch((e) => toast.error(e.message));
  }
  async function addTag() {
    if (!newTag.name.trim()) return;
    await fnUpTag({ data: { name: newTag.name, color: newTag.color } })
      .then(() => { setNewTag({ name: "", color: "#8b5cf6" }); load(); })
      .catch((e) => toast.error(e.message));
  }

  return (
    <div className="space-y-8 animate-fade-up max-w-4xl">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3">
          <Link to="/kanban"><ArrowLeft className="h-4 w-4 mr-2" /> Voltar ao quadro</Link>
        </Button>
        <div className="text-[10px] uppercase tracking-[0.28em] text-accent">Kanban · Configuração</div>
        <h1 className="font-display italic text-5xl text-foreground mt-2">Regras & Etiquetas</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xl">
          Descreva em linguagem natural quando o agente deve mover um lead para cada etapa. Ele lê a conversa do WhatsApp e decide.
        </p>
      </div>

      {/* Colunas */}
      <section className="space-y-4">
        <h2 className="font-display italic text-2xl text-foreground">Colunas</h2>
        {cols.map((c) => (
          <div key={c.id} className="glass rounded-xl border border-border/40 p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_120px_140px]">
              <div>
                <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Nome</Label>
                <Input value={c.name} onChange={(e) => setCols((p) => p.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cor</Label>
                <Input type="color" value={c.color} onChange={(e) => setCols((p) => p.map((x) => x.id === c.id ? { ...x, color: e.target.value } : x))} />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ação auto</Label>
                <Input value={c.auto_action ?? ""} placeholder="opcional" onChange={(e) => setCols((p) => p.map((x) => x.id === c.id ? { ...x, auto_action: e.target.value } : x))} />
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Regra para o agente (quando mover pra cá)
              </Label>
              <Textarea
                rows={2}
                value={c.rule_prompt ?? ""}
                placeholder="ex: quando o cliente demonstrar interesse claro no serviço"
                onChange={(e) => setCols((p) => p.map((x) => x.id === c.id ? { ...x, rule_prompt: e.target.value } : x))}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveCol(c)} className="bg-gold-gradient text-primary-foreground">
                <Save className="h-3.5 w-3.5 mr-2" /> Salvar
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive"
                onClick={async () => {
                  if (!confirm("Excluir coluna? (precisa estar vazia)")) return;
                  await fnDelCol({ data: { id: c.id } }).then(load).catch((e) => toast.error(e.message));
                }}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
              </Button>
            </div>
          </div>
        ))}

        {/* Nova coluna */}
        <div className="rounded-xl border border-dashed border-accent/30 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-accent">Nova coluna</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_140px]">
            <Input placeholder="Nome" value={newCol.name} onChange={(e) => setNewCol((p) => ({ ...p, name: e.target.value }))} />
            <Input type="color" value={newCol.color} onChange={(e) => setNewCol((p) => ({ ...p, color: e.target.value }))} />
            <Input placeholder="Ação auto" value={newCol.auto_action} onChange={(e) => setNewCol((p) => ({ ...p, auto_action: e.target.value }))} />
          </div>
          <Textarea rows={2} placeholder="Regra do agente" value={newCol.rule_prompt} onChange={(e) => setNewCol((p) => ({ ...p, rule_prompt: e.target.value }))} />
          <Button onClick={addCol} className="bg-gold-gradient text-primary-foreground"><Plus className="h-3.5 w-3.5 mr-2" /> Adicionar coluna</Button>
        </div>
      </section>

      {/* Tags */}
      <section className="space-y-4">
        <h2 className="font-display italic text-2xl text-foreground">Etiquetas</h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <div key={t.id}
              className="flex items-center gap-2 rounded-full border px-3 py-1"
              style={{ borderColor: `${t.color}55`, color: t.color, background: `${t.color}10` }}>
              <span className="text-xs">{t.name}</span>
              <button onClick={async () => {
                await fnDelTag({ data: { id: t.id } }).then(load).catch((e) => toast.error(e.message));
              }} className="opacity-60 hover:opacity-100">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-accent/30 p-4 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[160px]">
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Nome</Label>
            <Input value={newTag.name} onChange={(e) => setNewTag((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cor</Label>
            <Input type="color" value={newTag.color} onChange={(e) => setNewTag((p) => ({ ...p, color: e.target.value }))} />
          </div>
          <Button onClick={addTag} className="bg-gold-gradient text-primary-foreground"><Plus className="h-3.5 w-3.5 mr-2" /> Adicionar tag</Button>
        </div>
      </section>
    </div>
  );
}
