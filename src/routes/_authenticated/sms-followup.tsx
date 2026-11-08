import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Save, X, Loader2, CalendarClock, MessageSquareText } from "lucide-react";
import {
  listSmsTemplates,
  upsertSmsTemplate,
  deleteSmsTemplate,
} from "@/lib/sms-templates.functions";
import { sendSms } from "@/lib/sms.functions";
import {
  createClientFollowup,
  listPhoneFollowups,
  cancelClientFollowup,
} from "@/lib/client-followups.functions";
import { supabase } from "@/integrations/supabase/client";
import { validateSmsText } from "@/lib/phone-br";

export const Route = createFileRoute("/_authenticated/sms-followup")({
  head: () => ({ meta: [{ title: "Follow-up SMS — LexIA" }] }),
  component: Page,
});

type Tpl = {
  id: string;
  name: string;
  message: string;
  send_hour: number;
  send_minute: number;
  days_after_inactivity: number;
  active: boolean;
};

function Page() {
  const fnList = useServerFn(listSmsTemplates);
  const fnSave = useServerFn(upsertSmsTemplate);
  const fnDel = useServerFn(deleteSmsTemplate);
  const fnSend = useServerFn(sendSms);
  const fnFollow = useServerFn(createClientFollowup);
  const fnPending = useServerFn(listPhoneFollowups);
  const fnCancel = useServerFn(cancelClientFollowup);

  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Tpl>({
    id: "",
    name: "",
    message: "",
    send_hour: 10,
    send_minute: 0,
    days_after_inactivity: 1,
    active: false,
  });
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      setRows((await fnList()) as Tpl[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
  }, []);

  function edit(t: Tpl) {
    setForm({ ...t });
  }
  function reset() {
    setForm({
      id: "",
      name: "",
      message: "",
      send_hour: 10,
      send_minute: 0,
      days_after_inactivity: 1,
      active: false,
    });
  }

  const check = validateSmsText(form.message);

  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<
    { id: string; full_name: string | null; phone: string }[]
  >([]);
  const [leadPick, setLeadPick] = useState<{ id: string; full_name: string; phone: string } | null>(
    null,
  );
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [sendText, setSendText] = useState("");
  const [sendWhen, setSendWhen] = useState("");
  const [sending, setSending] = useState(false);
  const [pendings, setPendings] = useState<{ id: string; message: string; scheduled_at: string }[]>(
    [],
  );

  useEffect(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const p = (n: number) => String(n).padStart(2, "0");
    setSendWhen(
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`,
    );
  }, []);

  useEffect(() => {
    if (leadQuery.trim().length < 2) {
      setLeadResults([]);
      return;
    }
    const q = leadQuery.trim().replace(/[%_]/g, "");
    const t = setTimeout(() => {
      void supabase
        .from("clients")
        .select("id, full_name, phone")
        .ilike("full_name", `%${q}%`)
        .not("phone", "is", null)
        .order("full_name")
        .limit(8)
        .then(({ data }) => {
          setLeadResults((data as typeof leadResults) ?? []);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [leadQuery]);

  function loadPendings(phone: string) {
    void fnPending({ data: { phone: phone.replace(/\D/g, "") } })
      .then((rows) => setPendings((rows as typeof pendings) ?? []))
      .catch(() => undefined);
  }

  function pickLead(c: { id: string; full_name: string | null; phone: string }) {
    setLeadPick({ id: c.id, full_name: c.full_name ?? c.phone, phone: c.phone });
    setLeadQuery("");
    setLeadResults([]);
    if (!sendText.trim() && form.message.trim()) setSendText(form.message.trim());
    loadPendings(c.phone);
  }

  function clearLead() {
    setLeadPick(null);
    setPendings([]);
  }

  async function cancelPending(id: string) {
    try {
      await fnCancel({ data: { id } });
      setPendings((p) => p.filter((x) => x.id !== id));
      toast.info("Follow-up cancelado");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar follow-up");
    }
  }

  async function handleSendToLead() {
    if (!leadPick) return toast.error("Escolha um lead na busca");
    if (!sendText.trim()) return toast.error("Escreva a mensagem");
    const phone = leadPick.phone.replace(/\D/g, "");
    if (phone.length < 8) return toast.error("Telefone do lead inválido");
    setSending(true);
    try {
      if (sendMode === "schedule") {
        if (!sendWhen) return toast.error("Escolha a data e hora do follow-up");
        const when = new Date(sendWhen);
        if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now())
          return toast.error("Data/hora inválida ou no passado");
        if (sendText.trim().length > 160) return toast.error("Follow-up: máximo 160 caracteres");
        await fnFollow({
          data: {
            client_id: leadPick.id,
            phone,
            message: sendText.trim(),
            scheduled_at: when.toISOString(),
            title: "Follow-up tela SMS",
          },
        });
        toast.success(`Follow-up agendado para ${when.toLocaleString("pt-BR")}`);
        setSendText("");
        loadPendings(leadPick.phone);
        return;
      }
      await fnSend({ data: { to: phone, message: sendText.trim() } });
      toast.success(`SMS enviado para ${leadPick.full_name}`);
      setSendText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar SMS");
    } finally {
      setSending(false);
    }
  }

  async function save() {
    if (!form.name.trim()) return toast.error("Informe o nome");
    if (!check.ok) return toast.error(check.error!);
    setSaving(true);
    try {
      await fnSave({
        data: {
          id: form.id || null,
          name: form.name.trim(),
          message: form.message.trim(),
          send_hour: form.send_hour,
          send_minute: form.send_minute,
          days_after_inactivity: form.days_after_inactivity,
          active: form.active,
        },
      });
      toast.success("Template salvo");
      reset();
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir template?")) return;
    try {
      await fnDel({ data: { id } });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  return (
    <div className="space-y-6" data-allow-copy>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-up SMS automático</h1>
          <p className="text-sm text-muted-foreground">
            Templates enviados automaticamente para clientes inativos há X dias cujo cadastro ainda
            não foi finalizado. Apenas um template ativo por vez.
          </p>
        </div>
        <Button asChild variant="ghost" size="icon" aria-label="Fechar">
          <Link to="/clientes">
            <X className="h-5 w-5" />
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {form.id ? "Editar template" : "Novo template"}
          </CardTitle>
          <CardDescription>Máx. 160 caracteres. Sem emojis.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={80}
            />
          </div>
          <div className="space-y-1">
            <Label>Mensagem</Label>
            <Textarea
              rows={3}
              maxLength={200}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
            <div
              className={`text-[11px] text-right ${check.ok ? "text-muted-foreground" : "text-destructive"}`}
            >
              {check.ok ? `${form.message.length}/160` : check.error}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Dias de inatividade</Label>
              <Input
                type="number"
                min={0}
                max={30}
                value={form.days_after_inactivity}
                onChange={(e) =>
                  setForm({ ...form, days_after_inactivity: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Hora</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={form.send_hour}
                onChange={(e) => setForm({ ...form, send_hour: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label>Minuto</Label>
              <Input
                type="number"
                min={0}
                max={59}
                value={form.send_minute}
                onChange={(e) => setForm({ ...form, send_minute: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.active}
              onCheckedChange={(v) => setForm({ ...form, active: v })}
            />
            <Label>Ativo (desativa os outros)</Label>
          </div>
          <div className="flex justify-end gap-2">
            {form.id && (
              <Button variant="ghost" onClick={reset}>
                Cancelar edição
              </Button>
            )}
            <Button onClick={save} disabled={saving || !check.ok}>
              <Save className="h-4 w-4 mr-1" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enviar ou agendar para um lead</CardTitle>
          <CardDescription>
            Digite o nome do lead, escolha na lista — nome e telefone são preenchidos
            automaticamente. Usa o provedor SMS configurado em /sms.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Input
              value={leadQuery}
              onChange={(e) => setLeadQuery(e.target.value)}
              placeholder="Buscar lead pelo nome…"
              autoComplete="off"
              disabled={!!leadPick}
            />
            {leadResults.length > 0 && !leadPick && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border/60 bg-popover shadow-lg">
                {leadResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-accent/10"
                    onClick={() => pickLead(c)}
                  >
                    <span className="truncate text-foreground">{c.full_name ?? "(sem nome)"}</span>
                    <span className="shrink-0 text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
            {leadPick && (
              <div className="mt-1 flex items-center justify-between rounded border border-accent/40 bg-accent/5 px-2 py-1.5 text-xs">
                <span className="truncate">
                  Lead: <span className="text-foreground">{leadPick.full_name}</span> ·{" "}
                  {leadPick.phone}
                </span>
                <button
                  type="button"
                  className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={clearLead}
                >
                  trocar
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-1 rounded-md border border-border/60 p-1">
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1.5 text-xs transition ${
                sendMode === "now"
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSendMode("now")}
            >
              Enviar agora
            </button>
            <button
              type="button"
              className={`flex-1 rounded px-2 py-1.5 text-xs transition ${
                sendMode === "schedule"
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSendMode("schedule")}
            >
              Agendar follow-up
            </button>
          </div>
          {sendMode === "schedule" && (
            <div className="space-y-1">
              <Label htmlFor="lead-when">Disparar em</Label>
              <Input
                id="lead-when"
                type="datetime-local"
                value={sendWhen}
                onChange={(e) => setSendWhen(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Máx. 160 caracteres, sem emoji. Enviado automaticamente pelo cron.
              </p>
            </div>
          )}
          <Textarea
            rows={3}
            maxLength={sendMode === "schedule" ? 160 : 300}
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
            placeholder="Mensagem curta de SMS…"
          />
          <div className="text-[11px] text-right text-muted-foreground">
            {sendText.length}/{sendMode === "schedule" ? 160 : 300}
          </div>
          {leadPick && pendings.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Follow-ups agendados deste lead
              </p>
              {pendings.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1.5 text-xs"
                >
                  <span className="truncate text-muted-foreground">
                    {new Date(f.scheduled_at).toLocaleString("pt-BR")} — {f.message}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-destructive hover:underline"
                    onClick={() => cancelPending(f.id)}
                  >
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button disabled={sending || !sendText.trim() || !leadPick} onClick={handleSendToLead}>
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {sendMode === "schedule" ? "Agendando…" : "Enviando…"}
                </>
              ) : sendMode === "schedule" ? (
                <>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Agendar follow-up
                </>
              ) : (
                <>
                  <MessageSquareText className="mr-2 h-4 w-4" />
                  Enviar SMS
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Templates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum template ainda.</p>
          ) : (
            rows.map((t) => (
              <div
                key={t.id}
                className="border rounded-md p-3 mb-2 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.active && <Badge>ativo</Badge>}
                    <span className="text-xs text-muted-foreground">
                      após {t.days_after_inactivity}d · {String(t.send_hour).padStart(2, "0")}:
                      {String(t.send_minute).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="text-xs mt-1 whitespace-pre-wrap">{t.message}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => edit(t)}>
                    Editar
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
