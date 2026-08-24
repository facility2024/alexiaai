import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Send, UserCheck, FileText } from "lucide-react";
import {
  eduardoSendDraftToClient,
  eduardoMarkClientApproved,
  eduardoHandoffToHuman,
  getEduardoReview,
} from "@/lib/contracts.functions";

// Rota ISOLADA — não altera contratos.$id nem outras telas.
export const Route = createFileRoute("/_authenticated/eduardo/$contractId")({
  head: () => ({ meta: [{ title: "Eduardo — Fluxo do Contrato" }] }),
  component: EduardoFlow,
});

type ReviewData = Awaited<ReturnType<typeof getEduardoReview>>;

function EduardoFlow() {
  const { contractId } = Route.useParams();
  const navigate = useNavigate();
  const load = useServerFn(getEduardoReview);
  const send = useServerFn(eduardoSendDraftToClient);
  const approve = useServerFn(eduardoMarkClientApproved);
  const handoff = useServerFn(eduardoHandoffToHuman);

  const [state, setState] = useState<ReviewData | null>(null);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const r = await load({ data: { contract_id: contractId } });
    setState(r);
  };
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [contractId]);

  const review = state?.review;
  const contract = state?.contract;
  const client = state?.client;

  const step = review?.status ?? "pending";

  return (
    <div className="max-w-3xl mx-auto space-y-8 py-6">
      <header className="space-y-2">
        <span className="text-[10px] uppercase tracking-[0.28em] text-accent">Agente · Eduardo</span>
        <h1 className="font-display text-3xl leading-tight">Fluxo do contrato</h1>
        <p className="text-sm text-muted-foreground">
          Envia o rascunho pelo WhatsApp, aguarda o "OK" do cliente e transfere para atendimento humano.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-accent" />
            {contract?.title ?? "Contrato"}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1 text-muted-foreground">
          <div>Cliente: <b className="text-foreground">{client?.full_name ?? "—"}</b></div>
          <div>WhatsApp: <b className="text-foreground">{client?.phone ?? "—"}</b></div>
          <div>Score de auditoria: <b className="text-foreground">{contract?.integrity_score ?? "—"}</b></div>
          <div>Etapa atual: <b className="text-foreground">{stepLabel(step)}</b></div>
        </CardContent>
      </Card>

      {/* 1. Envio */}
      <StepCard
        n={1}
        title="Enviar rascunho ao cliente"
        done={!!review?.draft_sent_at}
        doneLabel={review?.draft_sent_at ? `Enviado em ${new Date(review.draft_sent_at).toLocaleString("pt-BR")}` : undefined}
      >
        <Textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="(Opcional) mensagem personalizada. Se vazio, Eduardo usa um texto padrão."
          rows={3}
        />
        <Button
          disabled={busy !== null}
          onClick={async () => {
            setBusy("send");
            try {
              await send({ data: { contract_id: contractId, custom_message: msg || undefined } });
              toast.success("Rascunho enviado pelo WhatsApp.");
              setMsg("");
              await refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Falha ao enviar.");
            } finally { setBusy(null); }
          }}
        >
          <Send className="h-4 w-4 mr-2" />
          {busy === "send" ? "Enviando…" : review?.draft_sent_at ? "Reenviar" : "Enviar rascunho"}
        </Button>
      </StepCard>

      {/* 2. Aprovação */}
      <StepCard
        n={2}
        title="Confirmar o OK do cliente"
        done={!!review?.approved_at}
        doneLabel={review?.approved_at ? `Aprovado em ${new Date(review.approved_at).toLocaleString("pt-BR")}` : undefined}
      >
        <p className="text-xs text-muted-foreground">
          Quando o cliente responder confirmando o rascunho, marque aqui para liberar a transferência.
        </p>
        <Button
          variant="secondary"
          disabled={busy !== null || !review?.draft_sent_at || !!review?.approved_at}
          onClick={async () => {
            setBusy("approve");
            try {
              await approve({ data: { contract_id: contractId } });
              toast.success("Aprovação registrada.");
              await refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Falha.");
            } finally { setBusy(null); }
          }}
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          {busy === "approve" ? "Salvando…" : "Cliente aprovou"}
        </Button>
      </StepCard>

      {/* 3. Handoff */}
      <StepCard
        n={3}
        title="Transferir para atendente humano"
        done={!!review?.handed_off_at}
        doneLabel={review?.handed_off_at ? `Transferido em ${new Date(review.handed_off_at).toLocaleString("pt-BR")}` : undefined}
      >
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="(Opcional) nota para o atendente humano."
          rows={2}
        />
        <div className="flex gap-2">
          <Button
            disabled={busy !== null || !review?.approved_at || !!review?.handed_off_at}
            onClick={async () => {
              setBusy("handoff");
              try {
                await handoff({ data: { contract_id: contractId, note: note || undefined } });
                toast.success("Transferido para humano. IA do card foi desligada.");
                await refresh();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Falha.");
              } finally { setBusy(null); }
            }}
          >
            <UserCheck className="h-4 w-4 mr-2" />
            {busy === "handoff" ? "Transferindo…" : "Transferir para humano"}
          </Button>
          <Button variant="ghost" onClick={() => navigate({ to: "/contratos/$id", params: { id: contractId } })}>
            Abrir contrato
          </Button>
        </div>
      </StepCard>
    </div>
  );
}

function stepLabel(s: string) {
  return { pending: "Aguardando envio", sent: "Rascunho enviado", approved: "Cliente aprovou", handed_off: "Transferido para humano" }[s] ?? s;
}

function StepCard({
  n, title, done, doneLabel, children,
}: {
  n: number; title: string; done: boolean; doneLabel?: string; children: React.ReactNode;
}) {
  return (
    <Card className={done ? "border-green-500/30 bg-green-500/5" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-3 text-base font-normal">
          <span className={`h-7 w-7 shrink-0 rounded-full inline-flex items-center justify-center text-xs font-semibold ${done ? "bg-green-500 text-white" : "bg-accent/10 text-accent"}`}>
            {done ? "✓" : n}
          </span>
          <span className="flex-1">{title}</span>
          {doneLabel && <span className="text-[11px] font-normal text-muted-foreground">{doneLabel}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
