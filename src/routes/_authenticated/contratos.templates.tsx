import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ArrowLeft, Plus, Copy, Save, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listTemplates, upsertTemplate, duplicateTemplate, toggleTemplate } from "@/lib/contracts.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { TemplateEditor } from "@/components/template-editor";

export const Route = createFileRoute("/_authenticated/contratos/templates")({
  head: () => ({ meta: [{ title: "Templates de contrato — LexIA" }] }),
  component: TemplatesPage,
});

const DEFAULT_BODY = `<h1>{{titulo}}</h1>
<p>Contratante: <strong>{{cliente.nome}}</strong>, CPF {{cliente.cpf}}, residente em {{cliente.endereco}}.</p>
<p>Contratado: <strong>{{agente.nome}}</strong>.</p>
<h2>Objeto</h2>
<p>Prestação de serviços jurídicos referentes a {{objeto}}.</p>
<h2>Honorários</h2>
<p>O valor total é de R$ {{valor}}, pagos via {{forma_pagamento}}.</p>
<p>{{cliente.cidade}}, {{hoje}}.</p>`;

function TemplatesPage() {
  const listFn = useServerFn(listTemplates);
  const upsertFn = useServerFn(upsertTemplate);
  const dupFn = useServerFn(duplicateTemplate);
  const toggleFn = useServerFn(toggleTemplate);

  const { data, isLoading, refetch } = useQuery({ queryKey: ["contract-templates"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id?: string; name: string; description: string; body_html: string; active: boolean; source_pdf_path?: string | null }>({
    name: "", description: "", body_html: DEFAULT_BODY, active: true,
  });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function openNew() {
    setEditing({ name: "", description: "", body_html: DEFAULT_BODY, active: true });
    setOpen(true);
  }
  function openEdit(t: { id: string; name: string; description: string | null; body_html: string; active: boolean; source_pdf_path?: string | null }) {
    setEditing({ id: t.id, name: t.name, description: t.description ?? "", body_html: t.body_html, active: t.active, source_pdf_path: t.source_pdf_path ?? null });
    setOpen(true);
  }

  async function handlePdfImport(file: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Envie um arquivo PDF");
      return;
    }
    setImporting(true);
    try {
      const { pdfFileToHtml } = await import("@/lib/pdf-to-html");
      const html = await pdfFileToHtml(file);

      // Upload isolado no bucket contract-templates/<user>/<ts>-<nome>.pdf
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      let uploadedPath: string | null = null;
      if (uid) {
        const path = `${uid}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("contract-templates").upload(path, file, { upsert: false });
        if (!upErr) uploadedPath = path;
      }

      setEditing((prev) => ({
        ...prev,
        body_html: html || prev.body_html,
        source_pdf_path: uploadedPath ?? prev.source_pdf_path ?? null,
        name: prev.name || file.name.replace(/\.pdf$/i, ""),
      }));
      toast.success("PDF importado — revise o conteúdo antes de salvar");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar PDF");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!editing.name.trim()) { toast.error("Nome obrigatório"); return; }
    setSaving(true);
    try {
      const vars = Array.from(new Set(Array.from(editing.body_html.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)).map((m) => m[1])));
      await upsertFn({ data: {
        id: editing.id,
        name: editing.name,
        description: editing.description,
        body_html: editing.body_html,
        variables: vars,
        active: editing.active,
        source_pdf_path: editing.source_pdf_path ?? null,
      } });
      toast.success("Template salvo");
      setOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/contratos"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
        <h1 className="text-2xl font-semibold">Templates de contrato</h1>
        <div className="ml-auto">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Novo template</Button></DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editing.id ? "Editar template" : "Novo template"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Nome</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Ex.: Contrato de honorários — trabalhista" />
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </div>

                <div className="flex items-center justify-between gap-2 border border-dashed border-border rounded-md p-3 bg-muted/20">
                  <div className="text-xs text-muted-foreground">
                    Importe um PDF existente para começar. O conteúdo é extraído e vira base editável.
                  </div>
                  <div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handlePdfImport(f);
                      }}
                    />
                    <Button type="button" size="sm" variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
                      {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                      {importing ? "Importando…" : "Enviar PDF"}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Corpo do contrato</Label>
                  <TemplateEditor
                    value={editing.body_html}
                    onChange={(html) => setEditing((prev) => ({ ...prev, body_html: html }))}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use o botão <strong>Variável</strong> para inserir campos como <code>{`{{cliente.nome}}`}</code>. Qualquer variável nova vira campo no formulário de emissão.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
                  <Label>Ativo</Label>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleSave} disabled={saving}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? <p className="text-muted-foreground text-sm">Carregando…</p> : (
        <div className="grid gap-3 md:grid-cols-2">
          {(data ?? []).map((t) => (
            <Card key={t.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{t.name}</CardTitle>
                  {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
                </div>
                <Switch checked={t.active} onCheckedChange={async (v) => { await toggleFn({ data: { id: t.id, active: v } }); refetch(); }} />
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(t)}>Editar</Button>
                <Button size="sm" variant="ghost" onClick={async () => { await dupFn({ data: { id: t.id } }); refetch(); toast.success("Template duplicado"); }}>
                  <Copy className="h-4 w-4 mr-1" /> Duplicar
                </Button>
              </CardContent>
            </Card>
          ))}
          {(!data || data.length === 0) && (
            <p className="text-muted-foreground text-sm col-span-2">Nenhum template ainda. Crie o primeiro.</p>
          )}
        </div>
      )}
    </div>
  );
}
