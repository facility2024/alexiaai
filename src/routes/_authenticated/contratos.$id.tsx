import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Sparkles, Send, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  getContract, runContractAudit, sendContractToAutentique, cancelContract, resendContract,
  listContractReminders,
} from "@/lib/contracts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/contratos/$id")({
  head: () => ({ meta: [{ title: "Contrato — LexIA" }] }),
  component: ContratoDetalhePage,
});

type Issue = { severity: string; area: string; message: string };
type IntegrityReport = { score?: number; summary?: string; issues?: Issue[]; missing_variables?: string[] };

function ContratoDetalhePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const getFn = useServerFn(getContract);
  const auditFn = useServerFn(runContractAudit);
  const sendFn = useServerFn(sendContractToAutentique);
  const cancelFn = useServerFn(cancelContract);
  const resendFn = useServerFn(resendContract);

  const remindersFn = useServerFn(listContractReminders);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["contract", id],
    queryFn: () => getFn({ data: { id } }),
  });

  const { data: reminders } = useQuery({
    queryKey: ["contract-reminders", id],
    queryFn: () => remindersFn({ data: { contract_id: id } }),
  });

  const [busy, setBusy] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");

  if (isLoading || !data) return <div className="p-6 text-muted-foreground">Carregando…</div>;

  const contract = data as unknown as {
    id: string; contract_code: string | null; title: string | null; status: string;
    integrity_score: number | null; integrity_report: IntegrityReport | null;
    autentique_document_id: string | null;
    contract_signers?: Array<{ name: string; email: string; status: string; signing_url: string | null; signed_at: string | null }>;
    contract_events?: Array<{ event_type: string; created_at: string }>;
  };
  const report = contract.integrity_report;

  async function withBusy(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setBusy(false); }
  }

  const canSend = contract.status === "ready" && (contract.integrity_score ?? 0) >= 80;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/contratos"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
        <div>
          <div className="text-xs font-mono text-muted-foreground">{contract.contract_code}</div>
          <h1 className="text-2xl font-semibold">{contract.title ?? "Contrato"}</h1>
        </div>
        <Badge className="ml-auto">{contract.status}</Badge>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /> Auditoria IA</CardTitle>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => withBusy(() => auditFn({ data: { id } }), "Auditoria concluída")}>
            Rodar auditoria
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {contract.integrity_score == null ? (
            <p className="text-sm text-muted-foreground">Ainda não auditado. Score mínimo para envio: 80.</p>
          ) : (
            <>
              <div className={`text-2xl font-bold ${contract.integrity_score >= 80 ? "text-emerald-600" : "text-amber-600"}`}>
                {contract.integrity_score}/100
              </div>
              {report?.summary && <p className="text-sm">{report.summary}</p>}
              {report?.missing_variables && report.missing_variables.length > 0 && (
                <div className="text-xs text-red-600">
                  Variáveis pendentes: {report.missing_variables.join(", ")}
                </div>
              )}
              {report?.issues && report.issues.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {report.issues.map((iss, i) => (
                    <li key={i} className="flex gap-2">
                      <Badge variant={iss.severity === "high" ? "destructive" : "outline"}>{iss.severity}</Badge>
                      <span><strong>{iss.area}:</strong> {iss.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {!contract.autentique_document_id && (
        <Card>
          <CardHeader><CardTitle>Enviar para assinatura</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              O contrato precisa estar auditado com score ≥ 80. A Autentique envia o e-mail de assinatura.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Nome do signatário</Label>
                <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
              </div>
            </div>
            <Button
              disabled={busy || !canSend || !signerEmail}
              onClick={() => withBusy(
                () => sendFn({ data: { id, signers: [{ email: signerEmail, name: signerName || undefined }] } }),
                "Enviado para assinatura",
              )}
            >
              <Send className="h-4 w-4 mr-1" /> Enviar
            </Button>
            {!canSend && (
              <p className="text-xs text-amber-600">Rode a auditoria e atinja score ≥ 80 antes de enviar.</p>
            )}
          </CardContent>
        </Card>
      )}

      {contract.autentique_document_id && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Signatários</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => withBusy(() => resendFn({ data: { id } }), "Reenviado")}>
                <RefreshCw className="h-4 w-4 mr-1" /> Reenviar pendentes
              </Button>
              {contract.status !== "signed" && contract.status !== "cancelled" && (
                <Button size="sm" variant="destructive" disabled={busy} onClick={async () => {
                  if (!confirm("Cancelar este contrato?")) return;
                  await withBusy(() => cancelFn({ data: { id } }), "Contrato cancelado");
                  navigate({ to: "/contratos" });
                }}>
                  <XCircle className="h-4 w-4 mr-1" /> Cancelar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {(contract.contract_signers ?? []).map((s, i) => (
                <li key={i} className="flex items-center justify-between border-b pb-2 text-sm">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{s.status}</Badge>
                    {s.signing_url && (
                      <a href={s.signing_url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">link</a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Histórico de eventos</CardTitle></CardHeader>
        <CardContent>
          {(contract.contract_events ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem eventos ainda.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {contract.contract_events!.map((ev, i) => (
                <li key={i}>{new Date(ev.created_at).toLocaleString("pt-BR")} — {ev.event_type}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Lembretes automáticos</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-2">
            Cron a cada 15 min reenvia via Autentique em 24h / 48h / 72h após o envio, enquanto pendente.
          </p>
          {(!reminders || reminders.length === 0) ? (
            <p className="text-xs text-muted-foreground">Nenhum lembrete enviado ainda.</p>
          ) : (
            <ul className="space-y-1 text-xs font-mono">
              {reminders.map((r) => (
                <li key={r.id}>
                  {new Date(r.sent_at).toLocaleString("pt-BR")} — nível {r.level} ({[null, "24h", "48h", "72h"][r.level] ?? "?"})
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
