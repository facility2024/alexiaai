import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Mail, Phone, MessageSquareText, Pencil, CalendarClock, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sendSms } from "@/lib/sms.functions";
import { FollowupsDialog } from "@/components/clients/followups-dialog";

export const Route = createFileRoute("/_authenticated/clientes")({
  head: () => ({ meta: [{ title: "Clientes — LexIA" }] }),
  component: ClientesPage,
});

type Client = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  cpf: string | null;
  birth_date: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  interest_level: string | null;
  is_complete: boolean | null;
  created_at: string;
};

const EMPTY_FORM = {
  full_name: "", email: "", phone: "", cpf: "",
  birth_date: "", address_street: "", address_number: "", address_complement: "",
  neighborhood: "", city: "", state: "", zip: "",
};

function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const fnSendSms = useServerFn(sendSms);
  const [smsTarget, setSmsTarget] = useState<Client | null>(null);
  const [smsText, setSmsText] = useState("");
  const [sending, setSending] = useState(false);
  const [followupsFor, setFollowupsFor] = useState<Client | null>(null);

  async function load() {
    setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }
    const { data: orgOwner } = await supabase.rpc("get_org_owner" as any, { _user_id: uid });
    const ownerId = (orgOwner as string) ?? uid;
    const { data, error } = await (supabase as any)
      .from("clients")
      .select("id, full_name, email, phone, cpf, birth_date, address_street, address_number, address_complement, neighborhood, city, state, zip, interest_level, is_complete, created_at")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setClients((data ?? []) as unknown as Client[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(c: Client) {
    const label = c.full_name || c.phone || c.cpf || "este cliente";
    if (!confirm(`Excluir ${label}? Esta ação não pode ser desfeita e libera o telefone/CPF para novos cadastros.`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Cliente excluído");
    setClients((prev) => prev.filter((x) => x.id !== c.id));
  }


  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
  }

  function openEdit(c: Client) {
    setEditingId(c.id);
    setForm({
      full_name: c.full_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      cpf: c.cpf ?? "",
      birth_date: c.birth_date ?? "",
      address_street: c.address_street ?? "",
      address_number: c.address_number ?? "",
      address_complement: c.address_complement ?? "",
      neighborhood: c.neighborhood ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      zip: c.zip ?? "",
    });
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    const { data: orgOwner } = uid ? await supabase.rpc("get_org_owner" as any, { _user_id: uid }) : { data: null };
    const ownerId = (orgOwner as string) ?? uid ?? null;
    const basePayload: any = {
      full_name: form.full_name,
      email: form.email || null,
      phone: form.phone || null,
      cpf: form.cpf || null,
      birth_date: form.birth_date || null,
      address_street: form.address_street || null,
      address_number: form.address_number || null,
      address_complement: form.address_complement || null,
      neighborhood: form.neighborhood || null,
      city: form.city || null,
      state: form.state ? form.state.toUpperCase().slice(0, 2) : null,
      zip: form.zip ? form.zip.replace(/\D/g, "") || null : null,
      ...(ownerId ? { owner_id: ownerId } : {}),
    };
    const { error } = editingId
      ? await (supabase as any).from("clients").update(basePayload).eq("id", editingId)
      : await (supabase as any).from("clients").insert(basePayload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editingId ? "Cliente atualizado" : "Cliente criado");
    resetForm();
    setOpen(false);
    load();
  }

  function openSms(c: Client) {
    setSmsTarget(c);
    const firstName = (c.full_name ?? "").trim().split(/\s+/)[0] ?? "";
    setSmsText(
      `Olá ${firstName}! Aqui é do escritório LexIA. ` +
      `Podemos continuar seu atendimento? Responda por aqui.`,
    );
  }

  async function handleSendSms() {
    if (!smsTarget?.phone) return toast.error("Cliente sem telefone");
    if (!smsText.trim()) return;
    setSending(true);
    try {
      await fnSendSms({ data: { to: smsTarget.phone, message: smsText.trim() } });
      toast.success("SMS enviado");
      setSmsTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
          <p className="text-sm text-muted-foreground">Cadastro de clientes do escritório.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/sms-followup"><FileText className="mr-2 h-4 w-4" />Criar template</Link>
          </Button>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild>
              <Button onClick={() => resetForm()}><Plus className="mr-2 h-4 w-4" />Novo cliente</Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editingId ? "Editar cliente" : "Novo cliente"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label>Nome completo</Label>
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Telefone</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>CPF</Label>
                  <Input value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Data de nascimento</Label>
                  <Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
                </div>
              </div>

              <div className="pt-2 border-t">
                <div className="text-sm font-medium mb-2">Endereço</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label>Rua</Label>
                    <Input value={form.address_street} onChange={(e) => setForm({ ...form, address_street: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Número</Label>
                    <Input value={form.address_number} onChange={(e) => setForm({ ...form, address_number: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="space-y-1">
                    <Label>Complemento</Label>
                    <Input value={form.address_complement} onChange={(e) => setForm({ ...form, address_complement: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Bairro</Label>
                    <Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div className="space-y-1">
                    <Label>Cidade</Label>
                    <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>UF</Label>
                    <Input maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="space-y-1">
                    <Label>CEP</Label>
                    <Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} />
                  </div>
                </div>
              </div>

              <DialogFooter><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
            </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Lista</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : clients.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado ainda.</p>
            : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>Interesse</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.full_name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</div>}
                      {c.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{c.cpf ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {c.interest_level ? (
                        <span className="capitalize">{c.interest_level.replace(/_/g, " ")}</span>
                      ) : "—"}
                      {c.is_complete && <span className="ml-1 text-[10px] text-primary">● completo</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(c)}
                          title="Editar cliente"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {c.phone && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openSms(c)}
                            title="Enviar SMS"
                          >
                            <MessageSquareText className="h-4 w-4 text-accent" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setFollowupsFor(c)}
                          title="Follow-up SMS"
                        >
                          <CalendarClock className="h-4 w-4 text-primary" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(c)}
                          title="Excluir cliente"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>

                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!smsTarget} onOpenChange={(o) => !o && setSmsTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar SMS para {smsTarget?.full_name ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Destino: <span className="text-foreground">{smsTarget?.phone}</span>
            </div>
            <Textarea
              rows={4}
              maxLength={300}
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              placeholder="Mensagem curta de SMS..."
            />
            <div className="text-[11px] text-muted-foreground text-right">
              {smsText.length}/300
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSmsTarget(null)}>Cancelar</Button>
            <Button disabled={sending || !smsText.trim()} onClick={handleSendSms}>
              {sending ? "Enviando..." : "Enviar SMS"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {followupsFor && (
        <FollowupsDialog
          open={!!followupsFor}
          onOpenChange={(o) => !o && setFollowupsFor(null)}
          clientId={followupsFor.id}
          clientName={followupsFor.full_name ?? "Cliente"}
          clientPhone={followupsFor.phone}
        />
      )}
    </div>
  );
}
