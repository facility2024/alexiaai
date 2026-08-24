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
import { Trash2, Save, X } from "lucide-react";
import {
  listSmsTemplates, upsertSmsTemplate, deleteSmsTemplate,
} from "@/lib/sms-templates.functions";
import { validateSmsText } from "@/lib/phone-br";

export const Route = createFileRoute("/_authenticated/sms-followup")({
  head: () => ({ meta: [{ title: "Follow-up SMS — LexIA" }] }),
  component: Page,
});

type Tpl = {
  id: string; name: string; message: string;
  send_hour: number; send_minute: number;
  days_after_inactivity: number; active: boolean;
};

function Page() {
  const fnList = useServerFn(listSmsTemplates);
  const fnSave = useServerFn(upsertSmsTemplate);
  const fnDel = useServerFn(deleteSmsTemplate);

  const [rows, setRows] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Tpl>({
    id: "", name: "", message: "", send_hour: 10, send_minute: 0,
    days_after_inactivity: 1, active: false,
  });
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try { setRows((await fnList()) as Tpl[]); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  function edit(t: Tpl) { setForm({ ...t }); }
  function reset() {
    setForm({ id: "", name: "", message: "", send_hour: 10, send_minute: 0, days_after_inactivity: 1, active: false });
  }

  const check = validateSmsText(form.message);

  async function save() {
    if (!form.name.trim()) return toast.error("Informe o nome");
    if (!check.ok) return toast.error(check.error!);
    setSaving(true);
    try {
      await fnSave({ data: {
        id: form.id || null,
        name: form.name.trim(),
        message: form.message.trim(),
        send_hour: form.send_hour, send_minute: form.send_minute,
        days_after_inactivity: form.days_after_inactivity,
        active: form.active,
      } });
      toast.success("Template salvo");
      reset(); reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm("Excluir template?")) return;
    try { await fnDel({ data: { id } }); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
  }

  return (
    <div className="space-y-6" data-allow-copy>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-up SMS automático</h1>
          <p className="text-sm text-muted-foreground">
            Templates enviados automaticamente para clientes inativos há X dias cujo cadastro
            ainda não foi finalizado. Apenas um template ativo por vez.
          </p>
        </div>
        <Button asChild variant="ghost" size="icon" aria-label="Fechar">
          <Link to="/clientes"><X className="h-5 w-5" /></Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{form.id ? "Editar template" : "Novo template"}</CardTitle>
          <CardDescription>Máx. 160 caracteres. Sem emojis.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Nome</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          </div>
          <div className="space-y-1">
            <Label>Mensagem</Label>
            <Textarea rows={3} maxLength={200} value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })} />
            <div className={`text-[11px] text-right ${check.ok ? "text-muted-foreground" : "text-destructive"}`}>
              {check.ok ? `${form.message.length}/160` : check.error}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Dias de inatividade</Label>
              <Input type="number" min={0} max={30} value={form.days_after_inactivity}
                onChange={(e) => setForm({ ...form, days_after_inactivity: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>Hora</Label>
              <Input type="number" min={0} max={23} value={form.send_hour}
                onChange={(e) => setForm({ ...form, send_hour: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label>Minuto</Label>
              <Input type="number" min={0} max={59} value={form.send_minute}
                onChange={(e) => setForm({ ...form, send_minute: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            <Label>Ativo (desativa os outros)</Label>
          </div>
          <div className="flex justify-end gap-2">
            {form.id && <Button variant="ghost" onClick={reset}>Cancelar edição</Button>}
            <Button onClick={save} disabled={saving || !check.ok}>
              <Save className="h-4 w-4 mr-1" />{saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p>
            : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum template ainda.</p>
            : rows.map((t) => (
              <div key={t.id} className="border rounded-md p-3 mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {t.active && <Badge>ativo</Badge>}
                    <span className="text-xs text-muted-foreground">
                      após {t.days_after_inactivity}d · {String(t.send_hour).padStart(2, "0")}:{String(t.send_minute).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="text-xs mt-1 whitespace-pre-wrap">{t.message}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => edit(t)}>Editar</Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
