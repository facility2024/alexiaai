import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, BookText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/treinamento-ia")({
  head: () => ({ meta: [{ title: "Treinamento da IA — LexIA" }] }),
  component: TrainingPage,
});

type Doc = { id: string; title: string; status: string; created_at: string };

function chunkContent(text: string, size = 1000): string[] {
  const out: string[] = [];
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > size) {
      if (cur) out.push(cur);
      cur = p.length > size ? p.slice(0, size) : p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function TrainingPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", content: "" });

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("knowledge_base_documents")
      .select("id,title,status,created_at")
      .order("created_at", { ascending: false });
    setDocs((data ?? []) as Doc[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSaving(false); return; }
    const { data: doc, error } = await supabase
      .from("knowledge_base_documents")
      .insert({ user_id: u.user.id, title: form.title, source_type: "text", status: "ready" })
      .select("id").single();
    if (error || !doc) { setSaving(false); return toast.error(error?.message ?? "Erro"); }
    const chunks = chunkContent(form.content);
    const rows = chunks.map((content, i) => ({
      user_id: u.user!.id, document_id: doc.id, content, chunk_index: i,
    }));
    const { error: e2 } = await supabase.from("knowledge_chunks").insert(rows);
    setSaving(false);
    if (e2) return toast.error(e2.message);
    toast.success(`Documento salvo (${chunks.length} trechos). Embeddings serão gerados quando configurar a IA.`);
    setForm({ title: "", content: "" });
    setOpen(false);
    load();
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("knowledge_base_documents").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido");
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treinamento da IA</h1>
          <p className="text-sm text-muted-foreground">
            Documentos que a IA consulta antes de responder (RAG).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo documento</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Novo documento</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label>Título</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="space-y-1">
                <Label>Conteúdo</Label>
                <Textarea rows={12} value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Cole o texto do documento. Será dividido automaticamente em trechos." required />
              </div>
              <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Os trechos são armazenados sem embeddings por enquanto. Para ativar a busca semântica completa (RAG), configure uma chave da OpenAI quando solicitarmos.
      </p>

      {loading ? <p className="text-sm text-muted-foreground">Carregando...</p>
        : docs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p>
        : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {docs.map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <BookText className="h-4 w-4 text-accent" />
                  <CardTitle className="text-sm">{d.title}</CardTitle>
                </div>
                <Button size="icon" variant="ghost" onClick={() => handleDelete(d.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{d.status}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
