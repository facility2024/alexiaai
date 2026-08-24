import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, BookOpen, Trash2, Users, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { AGENTS, type AgentKey } from "@/lib/agents";

export const Route = createFileRoute("/_authenticated/base-conhecimento")({
  head: () => ({ meta: [{ title: "Base de conhecimento — LexIA" }] }),
  component: KBPage,
});

type KB = {
  id: string;
  title: string;
  content: string;
  category: string | null;
  agent_keys: string[] | null;
  created_at: string;
};

const AGENT_LABEL: Record<string, string> = Object.fromEntries(
  AGENTS.map((a) => [a.key, `${a.name} · ${a.role}`]),
);

function agentBadgeName(key: string): string {
  const a = AGENTS.find((x) => x.key === key);
  return a ? a.name : key;
}

function KBPage() {
  const [items, setItems] = useState<KB[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "global" | AgentKey>("all");
  const [form, setForm] = useState<{
    title: string; content: string; category: string; agent_keys: AgentKey[];
  }>({ title: "", content: "", category: "", agent_keys: [] });

  function resetForm() {
    setForm({ title: "", content: "", category: "", agent_keys: [] });
    setEditingId(null);
  }

  function startEdit(it: KB) {
    setEditingId(it.id);
    setForm({
      title: it.title,
      content: it.content,
      category: it.category ?? "",
      agent_keys: (it.agent_keys ?? []) as AgentKey[],
    });
    setOpen(true);
  }

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("knowledge_base")
      .select("id,title,content,category,agent_keys,created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setItems((data ?? []) as KB[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "global") return items.filter((it) => !it.agent_keys || it.agent_keys.length === 0);
    return items.filter((it) => (it.agent_keys ?? []).includes(filter));
  }, [items, filter]);

  function toggleAgent(k: AgentKey) {
    setForm((f) => ({
      ...f,
      agent_keys: f.agent_keys.includes(k)
        ? f.agent_keys.filter((x) => x !== k)
        : [...f.agent_keys, k],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    let error;
    if (editingId) {
      ({ error } = await supabase.from("knowledge_base").update({
        title: form.title,
        content: form.content,
        category: form.category || null,
        agent_keys: form.agent_keys,
      } as never).eq("id", editingId));
    } else {
      const { data: userRes } = await supabase.auth.getUser();
      ({ error } = await supabase.from("knowledge_base").insert({
        title: form.title,
        content: form.content,
        category: form.category || null,
        agent_keys: form.agent_keys,
        created_by: userRes.user?.id,
      } as never));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Artigo atualizado" : "Artigo adicionado");
    resetForm();
    setOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("knowledge_base").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido");
    load();
  }

  const chips: Array<{ id: "all" | "global" | AgentKey; label: string }> = [
    { id: "all", label: "Todos" },
    { id: "global", label: "Global (todos os agentes)" },
    ...AGENTS.map((a) => ({ id: a.key, label: a.name })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Base de conhecimento</h1>
          <p className="text-sm text-muted-foreground">
            Material consultado pelos agentes de IA. Vincule cada artigo aos agentes que devem usá-lo — deixe vazio para valer para todos.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild><Button onClick={() => resetForm()}><Plus className="mr-2 h-4 w-4" />Novo artigo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId ? "Editar artigo" : "Novo artigo"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label>Título</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label>Categoria</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Trabalhista, Cível..." />
              </div>
              <div className="space-y-1">
                <Label>Conteúdo</Label>
                <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={8} required />
              </div>
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4 text-accent" />
                  Disponível para quais agentes?
                </div>
                <p className="text-xs text-muted-foreground">
                  Se nenhum for marcado, o artigo é <strong>global</strong> e todos os agentes usam.
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {AGENTS.map((a) => (
                    <label key={a.key} className="flex items-start gap-2 rounded-md border border-border/40 p-2 cursor-pointer hover:border-accent/60">
                      <Checkbox
                        checked={form.agent_keys.includes(a.key)}
                        onCheckedChange={() => toggleAgent(a.key)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium">{a.name}</div>
                        <div className="text-xs text-muted-foreground">{a.role}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`rounded-full px-3 py-1 text-xs transition border ${
              filter === c.id
                ? "bg-accent text-accent-foreground border-accent"
                : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Carregando...</p>
        : filtered.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum artigo neste filtro.</p>
        : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((it) => {
            const keys = it.agent_keys ?? [];
            const isGlobal = keys.length === 0;
            return (
              <Card key={it.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-accent" />
                    <CardTitle className="text-sm">{it.title}</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(it)} title="Editar">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(it.id)} title="Excluir">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {it.category && <div className="mb-1 text-xs text-muted-foreground">{it.category}</div>}
                  <p className="line-clamp-4 text-sm text-muted-foreground">{it.content}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {isGlobal ? (
                      <Badge variant="secondary" className="text-[10px]">Global · todos os agentes</Badge>
                    ) : (
                      keys.map((k) => (
                        <Badge key={k} variant="outline" className="text-[10px]" title={AGENT_LABEL[k] ?? k}>
                          {agentBadgeName(k)}
                        </Badge>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
