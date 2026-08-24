import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/casos")({
  head: () => ({ meta: [{ title: "Casos — LexIA" }] }),
  component: CasosPage,
});

type CaseStatus = "triage" | "analysis" | "scheduling" | "scheduled" | "closed" | "cancelled";

type Case = {
  id: string;
  case_type: string | null;
  classification: string | null;
  summary: string | null;
  status: CaseStatus;
  current_agent: string;
  client_id: string;
  created_at: string;
};

type ClientOpt = { id: string; full_name: string | null };

const statusColors: Record<CaseStatus, string> = {
  triage: "bg-blue-500/15 text-blue-700",
  analysis: "bg-amber-500/15 text-amber-700",
  scheduling: "bg-purple-500/15 text-purple-700",
  scheduled: "bg-emerald-500/15 text-emerald-700",
  closed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-500/15 text-red-700",
};

const statusLabel: Record<CaseStatus, string> = {
  triage: "Triagem", analysis: "Análise", scheduling: "Agendamento",
  scheduled: "Agendado", closed: "Encerrado", cancelled: "Cancelado",
};

function CasosPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    case_type: "", classification: "", summary: "", client_id: "", status: "triage" as CaseStatus,
  });

  async function load() {
    setLoading(true);
    const [c, cl] = await Promise.all([
      supabase.from("cases").select("id,case_type,classification,summary,status,current_agent,client_id,created_at").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,full_name").order("full_name"),
    ]);
    if (c.error) toast.error(c.error.message); else setCases((c.data ?? []) as unknown as Case[]);
    if (cl.data) setClients(cl.data as unknown as ClientOpt[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) { toast.error("Selecione um cliente"); return; }
    setSaving(true);
    const { error } = await supabase.from("cases").insert({
      client_id: form.client_id,
      case_type: form.case_type || null,
      classification: form.classification || null,
      summary: form.summary || null,
      status: form.status,
      current_agent: "agent_1",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Caso criado");
    setForm({ case_type: "", classification: "", summary: "", client_id: "", status: "triage" });
    setOpen(false);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Casos</h1>
          <p className="text-sm text-muted-foreground">Acompanhe os casos em andamento.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo caso</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo caso</DialogTitle><DialogDescription>Cadastre um novo caso vinculado a um cliente.</DialogDescription></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label>Cliente</Label>
                <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name ?? c.id}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Input value={form.case_type} onChange={(e) => setForm({ ...form, case_type: e.target.value })} placeholder="Trabalhista..." />
                </div>
                <div className="space-y-1">
                  <Label>Classificação</Label>
                  <Input value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as CaseStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(statusLabel) as CaseStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Descrição do caso</Label>
                <Textarea value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={5} placeholder="Descreva o caso: fatos, partes envolvidas, pretensão, prazos..." />
              </div>
              <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Lista</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : cases.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum caso cadastrado.</p>
            : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.case_type ?? "—"}</TableCell>
                    <TableCell>{c.classification ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={statusColors[c.status]}>{statusLabel[c.status]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
