import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  listClientFollowups, createClientFollowup, cancelClientFollowup,
} from "@/lib/client-followups.functions";
import { validateSmsText } from "@/lib/phone-br";

type Followup = {
  id: string;
  title: string | null;
  message: string;
  phone: string;
  scheduled_at: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  provider: string | null;
  created_at: string;
};

export function FollowupsDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
}) {
  const { open, onOpenChange, clientId, clientName, clientPhone } = props;
  const fnList = useServerFn(listClientFollowups);
  const fnCreate = useServerFn(createClientFollowup);
  const fnCancel = useServerFn(cancelClientFollowup);

  const [rows, setRows] = useState<Followup[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = (await fnList({ data: { client_id: clientId } })) as Followup[];
      setRows(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (open) { reload(); setTitle(""); setMsg(""); setDate(""); setTime(""); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clientId]);

  const check = validateSmsText(msg);

  async function submit() {
    if (!clientPhone) return toast.error("Cliente sem telefone cadastrado");
    if (!check.ok) return toast.error(check.error!);
    if (!date || !time) return toast.error("Informe data e hora");
    const iso = new Date(`${date}T${time}:00`).toISOString();
    setSaving(true);
    try {
      await fnCreate({ data: {
        client_id: clientId, title: title || null, message: msg.trim(),
        phone: clientPhone, scheduled_at: iso,
      } });
      toast.success("Follow-up agendado");
      setTitle(""); setMsg(""); setDate(""); setTime("");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao agendar");
    } finally { setSaving(false); }
  }

  async function cancel(id: string) {
    try { await fnCancel({ data: { id } }); reload(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha"); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Follow-up SMS — {clientName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 border rounded-md p-3">
          <div className="text-sm font-medium">Novo follow-up</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Título (opcional)</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Data</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Hora</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Mensagem (máx. 160)</Label>
            <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} />
            <div className={`text-[11px] text-right ${check.ok ? "text-muted-foreground" : "text-destructive"}`}>
              {check.ok ? `${msg.length}/160` : check.error}
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={saving || !check.ok || !date || !time} onClick={submit}>
              {saving ? "Agendando..." : "Agendar SMS"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Histórico</div>
          {loading ? <p className="text-xs text-muted-foreground">Carregando...</p>
            : rows.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum follow-up.</p>
            : rows.map((r) => (
              <div key={r.id} className="border rounded-md p-2 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                      {r.status}
                    </Badge>
                    {r.title && <span className="font-medium truncate">{r.title}</span>}
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.scheduled_at).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div className="text-xs mt-1 whitespace-pre-wrap break-words">{r.message}</div>
                  {r.error && <div className="text-xs text-destructive mt-1">Erro: {r.error}</div>}
                  {r.sent_at && <div className="text-[11px] text-muted-foreground mt-1">
                    Enviado {new Date(r.sent_at).toLocaleString("pt-BR")} · {r.provider ?? ""}
                  </div>}
                </div>
                {r.status === "pending" && (
                  <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancelar</Button>
                )}
              </div>
            ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
