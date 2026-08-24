import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Calendar, ExternalLink, CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useServerFn } from "@tanstack/react-start";
import { sendWhatsappMessage } from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/agendamentos")({
  head: () => ({ meta: [{ title: "Agendamentos — LexIA" }] }),
  component: AgendamentosPage,
});

const GOOGLE_CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";

type Appt = {
  id: string;
  case_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  notes: string | null;
  meeting_link: string | null;
  google_event_id: string | null;
  google_event_link: string | null;
};

type CaseOpt = { id: string; case_type: string | null; client_id: string };
type ClientOpt = { id: string; full_name: string | null; phone: string | null };
type Contact = { chat_id: string; contact_name: string | null; contact_phone: string | null };
type Label = { id: string; name: string; color: string };

function AgendamentosPage() {
  const [items, setItems] = useState<Appt[]>([]);
  const [cases, setCases] = useState<CaseOpt[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [chatLabels, setChatLabels] = useState<Record<string, string[]>>({});
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerToken, setProviderToken] = useState<string | null>(null);
  const [lastCreatedLink, setLastCreatedLink] = useState<string | null>(null);
  const [form, setForm] = useState({
    case_id: "", scheduled_at: "", duration_minutes: 60, notes: "", meeting_link: "", title: "",
    case_description: "",
    send_whatsapp: false, whatsapp_phone: "", whatsapp_chat_id: "",
  });
  const sendWpp = useServerFn(sendWhatsappMessage);

  async function load() {
    setLoading(true);
    const [a, cs, cl, kc, lb, la, sess] = await Promise.all([
      supabase.from("appointments").select("id,case_id,scheduled_at,duration_minutes,status,notes,meeting_link,google_event_id,google_event_link").order("scheduled_at", { ascending: true }),
      supabase.from("cases").select("id,case_type,client_id").order("created_at", { ascending: false }),
      supabase.from("clients").select("id,full_name,phone"),
      supabase.from("kanban_cards").select("chat_id,contact_name,contact_phone").order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase.from("chat_labels").select("id,name,color").order("name"),
      supabase.from("chat_label_assignments").select("chat_id,label_id"),
      supabase.auth.getSession(),
    ]);
    if (a.error) toast.error(a.error.message); else setItems((a.data ?? []) as unknown as Appt[]);
    if (cs.data) setCases(cs.data as unknown as CaseOpt[]);
    if (cl.data) setClients(cl.data as unknown as ClientOpt[]);
    if (kc.data) {
      const seen = new Set<string>();
      const unique = (kc.data as unknown as Contact[]).filter((c) => {
        if (!c.chat_id || seen.has(c.chat_id)) return false;
        seen.add(c.chat_id);
        return true;
      });
      setContacts(unique);
    }
    if (lb.data) setLabels(lb.data as unknown as Label[]);
    if (la.data) {
      const map: Record<string, string[]> = {};
      for (const row of la.data as { chat_id: string; label_id: string }[]) {
        (map[row.chat_id] ??= []).push(row.label_id);
      }
      setChatLabels(map);
    }
    const storedToken = (() => {
      try { return localStorage.getItem("google_provider_token"); } catch { return null; }
    })();
    setProviderToken(sess.data.session?.provider_token ?? storedToken);
    setLoading(false);
  }

  const filteredContacts = labelFilter === "all"
    ? contacts
    : contacts.filter((c) => chatLabels[c.chat_id]?.includes(labelFilter));


  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s?.provider_token) {
        setProviderToken(s.provider_token);
        try {
          localStorage.setItem("google_provider_token", s.provider_token);
          localStorage.setItem("google_provider_token_at", String(Date.now()));
        } catch { /* ignore */ }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function connectGoogleCalendar() {
    try { localStorage.setItem("post_auth_redirect", "/agendamentos"); } catch { /* ignore */ }
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth/callback",
      extraParams: {
        scope: `openid email profile ${GOOGLE_CAL_SCOPE}`,
        access_type: "offline",
        prompt: "consent",
      },
    });
    if (result.error) toast.error("Falha ao conectar Google: " + (result.error as Error).message);
  }


  async function createGoogleEvent(token: string, description?: string): Promise<{ id: string; htmlLink: string; hangoutLink?: string } | null> {
    const start = new Date(form.scheduled_at);
    const end = new Date(start.getTime() + (Number(form.duration_minutes) || 60) * 60000);
    const body: Record<string, unknown> = {
      summary: form.title || `Agendamento — Caso ${form.case_id.slice(0, 8)}`,
      description: description || form.notes || undefined,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
    if (!form.meeting_link) {
      body.conferenceData = {
        createRequest: {
          requestId: `lexia-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      if (res.status === 401) {
        toast.error("Sessão Google expirada. Clique em 'Conectar Google Calendar' novamente.");
        setProviderToken(null);
      } else {
        toast.error("Erro no Google Calendar: " + err);
      }
      return null;
    }
    const data = await res.json();
    return { id: data.id, htmlLink: data.htmlLink, hangoutLink: data.hangoutLink };
  }

  function selectCase(caseId: string) {
    const c = cases.find((x) => x.id === caseId);
    const cli = c ? clients.find((cl) => cl.id === c.client_id) : null;
    setForm((f) => ({ ...f, case_id: caseId, whatsapp_phone: f.whatsapp_phone || (cli?.phone ?? "") }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.case_id || !form.scheduled_at) { toast.error("Caso e data são obrigatórios"); return; }
    if (!providerToken) { toast.error("Conecte o Google Calendar primeiro"); return; }
    setSaving(true);
    setLastCreatedLink(null);

    const fullNotes = [form.case_description, form.notes].filter(Boolean).join("\n\n");

    const ev = await createGoogleEvent(providerToken, fullNotes);
    if (!ev) { setSaving(false); return; }

    const meetLink = form.meeting_link || ev.hangoutLink || "";
    if (ev.hangoutLink && !form.meeting_link) {
      setForm((f) => ({ ...f, meeting_link: ev.hangoutLink! }));
    }

    const { error } = await supabase.from("appointments").insert({
      case_id: form.case_id,
      scheduled_at: new Date(form.scheduled_at).toISOString(),
      duration_minutes: Number(form.duration_minutes) || 60,
      notes: fullNotes || null,
      meeting_link: meetLink || null,
      status: "scheduled",
      google_event_id: ev.id,
      google_event_link: ev.htmlLink,
    });
    if (error) { setSaving(false); return toast.error(error.message); }

    const phone = (form.whatsapp_phone || "").replace(/\D/g, "");
    if (form.send_whatsapp && phone) {
      try {
        const when = new Date(form.scheduled_at).toLocaleString("pt-BR");
        const msg = `📅 Agendamento confirmado\n${form.title || "Reunião"}\n🕒 ${when}\n🔗 ${ev.htmlLink}${meetLink ? `\nReunião: ${meetLink}` : ""}`;
        const result = await sendWpp({ data: { to: phone, message: msg } });
        if (result.ok) toast.success("WhatsApp adicionado à fila de envio");
        else toast.error("Falha ao enviar WhatsApp: " + result.message);
      } catch (err: any) {
        toast.error("Falha ao enviar WhatsApp: " + err.message);
      }
    }

    setSaving(false);
    setLastCreatedLink(ev.htmlLink);
    toast.success("Agenda criada no Google Calendar");
    load();
  }

  function resetForm() {
    setForm({
      case_id: "", scheduled_at: "", duration_minutes: 60, notes: "", meeting_link: "", title: "",
      case_description: "",
      send_whatsapp: false, whatsapp_phone: "", whatsapp_chat_id: "",
    });
    setLabelFilter("all");
    setLastCreatedLink(null);
  }




  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agendamentos</h1>
          <p className="text-sm text-muted-foreground">Reuniões e prazos.</p>
        </div>
        <div className="flex items-center gap-2">
          {providerToken ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-1 text-xs text-green-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> Google Calendar conectado
            </span>
          ) : (
            <Button variant="outline" size="sm" onClick={connectGoogleCalendar}>
              <Calendar className="mr-2 h-4 w-4" /> Conectar Google Calendar
            </Button>
          )}
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Novo</Button></DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Novo agendamento</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <Label>Título do evento</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Reunião com cliente" />
                </div>
                <div className="space-y-1">
                  <Label>Caso</Label>
                  <Select value={form.case_id} onValueChange={selectCase}>
                    <SelectTrigger><SelectValue placeholder="Selecione um caso..." /></SelectTrigger>
                    <SelectContent>
                      {cases.map((c) => {
                        const cli = clients.find((x) => x.id === c.client_id);
                        return (
                          <SelectItem key={c.id} value={c.id}>
                            {cli?.full_name ?? "Cliente"} — {c.case_type ?? "Caso"}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Descrição do caso</Label>
                  <Textarea
                    value={form.case_description}
                    onChange={(e) => setForm({ ...form, case_description: e.target.value })}
                    rows={3}
                    placeholder="Descreva o caso, contexto, pretensão, prazos..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Data e hora</Label>
                    <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Duração (min)</Label>
                    <Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Link da reunião</Label>
                  <Input value={form.meeting_link} onChange={(e) => setForm({ ...form, meeting_link: e.target.value })} placeholder="https://meet..." />
                </div>
                <div className="space-y-1">
                  <Label>Anotações</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>

                <div className="rounded-md border border-border/60 p-3 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={form.send_whatsapp}
                      onCheckedChange={(v) => setForm({ ...form, send_whatsapp: v === true })}
                    />
                    <span className="text-sm inline-flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" /> Enviar link por WhatsApp
                    </span>
                  </label>
                  {form.send_whatsapp && (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Filtrar por etiqueta</Label>
                        <Select value={labelFilter} onValueChange={setLabelFilter}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todas etiquetas</SelectItem>
                            {labels.map((l) => (
                              <SelectItem key={l.id} value={l.id}>
                                <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: l.color }} />
                                {l.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Contato do WhatsApp</Label>
                        <Select
                          value={form.whatsapp_chat_id}
                          onValueChange={(v) => {
                            const c = contacts.find((x) => x.chat_id === v);
                            setForm((f) => ({ ...f, whatsapp_chat_id: v, whatsapp_phone: c?.contact_phone || v }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={filteredContacts.length ? "Selecione um contato..." : "Nenhum contato"} />
                          </SelectTrigger>
                          <SelectContent>
                            {filteredContacts.map((c) => (
                              <SelectItem key={c.chat_id} value={c.chat_id}>
                                {c.contact_name || c.contact_phone || c.chat_id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Input
                        value={form.whatsapp_phone}
                        onChange={(e) => setForm({ ...form, whatsapp_phone: e.target.value })}
                        placeholder="Ou digite: 5511999999999"
                      />
                    </div>
                  )}
                </div>

                {lastCreatedLink && (
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 space-y-2">
                    <p className="text-sm font-medium text-green-500 inline-flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" /> Agenda criada no Google Calendar
                    </p>
                    <a
                      href={lastCreatedLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary underline break-all"
                    >
                      <ExternalLink className="h-3 w-3" /> {lastCreatedLink}
                    </a>
                  </div>
                )}

                {!providerToken && (
                  <p className="text-xs text-muted-foreground">
                    Conecte o Google Calendar (botão acima) para criar a agenda.
                  </p>
                )}
                <DialogFooter className="gap-2">
                  {lastCreatedLink && (
                    <Button type="button" variant="outline" onClick={resetForm}>Novo</Button>
                  )}
                  <Button type="submit" disabled={saving || !providerToken || !!lastCreatedLink}>
                    {saving ? "Criando..." : "Criar agenda"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Próximos</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>
            : (
            <div className="space-y-2">
              {items.map((a) => (
                <div key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">Caso {a.case_id.slice(0, 8)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.scheduled_at).toLocaleString("pt-BR")} · {a.duration_minutes} min · {a.status}
                    </div>
                    {a.notes && <p className="mt-1 text-sm text-muted-foreground">{a.notes}</p>}
                    <div className="mt-1 flex flex-wrap gap-3">
                      {a.meeting_link && <a href={a.meeting_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">Link da reunião</a>}
                      {a.google_event_link && (
                        <a href={a.google_event_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
                          <ExternalLink className="h-3 w-3" /> Abrir no Google Calendar
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
