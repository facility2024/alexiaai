import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getMyOrgContext } from "@/lib/admin.functions";
import { uploadOperatorMedia } from "@/lib/media-upload.functions";
import {
  cancelWhatsappCampaign,
  createWhatsappCampaign,
  listWhatsappCampaignRecipients,
  listWhatsappCampaigns,
  pauseWhatsappCampaign,
  processWhatsappCampaignNext,
  startWhatsappCampaign,
} from "@/lib/whatsapp-campaigns.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/marketing-whatsapp")({
  head: () => ({ meta: [{ title: "Campanhas WhatsApp — LexIA" }] }),
  component: WhatsappCampaignsPage,
});

type CampaignRecipient = {
  phone: string;
  display_name: string;
  consent_confirmed: true;
  consent_source: "manual" | "spreadsheet";
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  running: "Em execução",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
  queued: "Na fila",
  sending: "Enviando",
  sent: "Enviada",
  failed: "Falhou",
  skipped: "Ignorada",
};

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("55")) digits = `55${digits}`;
  return /^55[1-9]{2}9?\d{8}$/.test(digits) ? digits : null;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function WhatsappCampaignsPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const driverRef = useRef(false);
  const contextFn = useServerFn(getMyOrgContext);
  const listFn = useServerFn(listWhatsappCampaigns);
  const listRecipientsFn = useServerFn(listWhatsappCampaignRecipients);
  const createFn = useServerFn(createWhatsappCampaign);
  const startFn = useServerFn(startWhatsappCampaign);
  const pauseFn = useServerFn(pauseWhatsappCampaign);
  const cancelFn = useServerFn(cancelWhatsappCampaign);
  const processFn = useServerFn(processWhatsappCampaignNext);
  const uploadFn = useServerFn(uploadOperatorMedia);

  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: ["my-org-context"],
    queryFn: () => contextFn(),
  });
  const canManage =
    context?.isOwner === true || (context?.active === true && context.role === "admin");
  const {
    data: campaigns = [],
    isLoading: campaignsLoading,
    refetch,
  } = useQuery({
    queryKey: ["whatsapp-campaigns"],
    queryFn: () => listFn(),
    enabled: canManage,
    refetchInterval: 5000,
  });

  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [manualPhones, setManualPhones] = useState("");
  const [spreadsheetRecipients, setSpreadsheetRecipients] = useState<CampaignRecipient[]>([]);
  const [spreadsheetSkipped, setSpreadsheetSkipped] = useState(0);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [delaySeconds, setDelaySeconds] = useState(30);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drivingId, setDrivingId] = useState<string | null>(null);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

  const recipientsQuery = useQuery({
    queryKey: ["whatsapp-campaign-recipients", expandedCampaign],
    queryFn: () => listRecipientsFn({ data: { campaign_id: expandedCampaign! } }),
    enabled: Boolean(expandedCampaign && canManage),
  });

  async function importSpreadsheet(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A planilha deve ter no máximo 5 MB.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("Use uma planilha .xlsx. Salve o arquivo nesse formato pelo Excel.");
      return;
    }
    try {
      const { default: ExcelJS } = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet || sheet.rowCount < 2) throw new Error("A planilha não tem linhas de contatos.");

      const headers = new Map<string, number>();
      sheet.getRow(1).eachCell((cell, column) => headers.set(normalizeHeader(cell.value), column));
      const phoneColumn = ["telefone", "phone", "celular", "whatsapp", "numero"]
        .map((key) => headers.get(key))
        .find(Boolean);
      const nameColumn = ["nome", "name", "contato"].map((key) => headers.get(key)).find(Boolean);
      const consentColumn = ["consentimento", "consent", "optin", "autorizado", "autorizacao"]
        .map((key) => headers.get(key))
        .find(Boolean);
      if (!phoneColumn || !consentColumn) {
        throw new Error("A primeira linha precisa ter colunas telefone e consentimento.");
      }

      const parsed: CampaignRecipient[] = [];
      let skipped = 0;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const phone = normalizePhone(
          String(row.getCell(phoneColumn).text ?? row.getCell(phoneColumn).value ?? ""),
        );
        const consent = normalizeHeader(
          row.getCell(consentColumn).text ?? row.getCell(consentColumn).value,
        );
        const hasConsent = [
          "sim",
          "yes",
          "true",
          "1",
          "optin",
          "autorizado",
          "consentido",
        ].includes(consent);
        if (!phone || !hasConsent) {
          skipped += 1;
          return;
        }
        parsed.push({
          phone,
          display_name: nameColumn
            ? String(row.getCell(nameColumn).text ?? row.getCell(nameColumn).value ?? "").trim()
            : "",
          consent_confirmed: true,
          consent_source: "spreadsheet",
        });
      });
      if (parsed.length > 200) throw new Error("O limite é 200 contatos por campanha.");
      setSpreadsheetRecipients(parsed);
      setSpreadsheetSkipped(skipped);
      toast.success(`${parsed.length} contatos válidos importados; ${skipped} linhas ignoradas.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao ler a planilha.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function uploadImage(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Escolha um arquivo de imagem.");
    if (file.size > 8 * 1024 * 1024) return toast.error("A imagem deve ter no máximo 8 MB.");
    setUploadingImage(true);
    try {
      const uploaded = await uploadFn({
        data: { filename: file.name, mime: file.type, base64: await fileToDataUrl(file) },
      });
      setMediaId(uploaded.mediaId);
      setImagePreview(URL.createObjectURL(file));
      toast.success("Imagem pronta para a campanha.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function runCampaign(campaignId: string) {
    if (driverRef.current) return;
    driverRef.current = true;
    setDrivingId(campaignId);
    try {
      for (;;) {
        const result = await processFn({ data: { campaign_id: campaignId } });
        await refetch();
        if (result.status === "sent" || result.status === "failed") continue;
        if (result.status === "waiting") {
          await sleep(Math.min(Math.max(result.wait_ms ?? 1000, 1000), 60_000));
          continue;
        }
        if (result.status === "busy") {
          await sleep(1500);
          continue;
        }
        if (result.status === "disconnected") {
          toast.error("WhatsApp desconectado. Reconecte e retome a campanha.");
        } else if (result.status === "daily_limit") {
          toast.warning("Limite diário de 50 tentativas atingido; campanha pausada.");
        } else if (result.status === "completed") {
          toast.success("Campanha concluída.");
        }
        break;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar campanha.");
    } finally {
      driverRef.current = false;
      setDrivingId(null);
      await refetch();
    }
  }

  async function handleCreate() {
    if (!consentConfirmed)
      return toast.error("Confirme que todos os destinatários autorizaram o contato.");
    const manualRecipients = manualPhones
      .split(/[\n,;]+/)
      .map((phone) => phone.trim())
      .filter(Boolean)
      .map((phone) => ({
        phone,
        display_name: "",
        consent_confirmed: true as const,
        consent_source: "manual" as const,
      }));
    const recipients = [...manualRecipients, ...spreadsheetRecipients];
    if (!recipients.length)
      return toast.error("Informe números ou importe uma planilha com consentimento.");
    if (recipients.length > 200) return toast.error("O limite é 200 contatos por campanha.");
    if (!message.trim()) return toast.error("Escreva a mensagem da campanha.");

    setCreating(true);
    try {
      const result = await createFn({
        data: {
          name: name.trim() || `Campanha ${new Date().toLocaleDateString("pt-BR")}`,
          message: message.trim(),
          media_id: mediaId,
          delay_seconds: delaySeconds,
          recipients,
        },
      });
      toast.success(
        `Rascunho criado com ${result.recipients} contatos${result.skippedOptOut ? `; ${result.skippedOptOut} opt-out(s) removido(s)` : ""}.`,
      );
      setName("");
      setMessage("");
      setManualPhones("");
      setSpreadsheetRecipients([]);
      setSpreadsheetSkipped(0);
      setConsentConfirmed(false);
      setMediaId(null);
      setImagePreview(null);
      await queryClient.invalidateQueries({ queryKey: ["whatsapp-campaigns"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a campanha.");
    } finally {
      setCreating(false);
    }
  }

  async function handleStart(campaignId: string) {
    try {
      await startFn({ data: { campaign_id: campaignId } });
      await refetch();
      void runCampaign(campaignId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar.");
    }
  }

  async function handlePause(campaignId: string) {
    try {
      await pauseFn({ data: { campaign_id: campaignId } });
      await refetch();
      toast.success("Campanha pausada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível pausar.");
    }
  }

  async function handleCancel(campaignId: string) {
    if (
      !confirm(
        "Cancelar esta campanha? Um envio já iniciado ainda pode terminar; os demais não serão processados.",
      )
    )
      return;
    try {
      await cancelFn({ data: { campaign_id: campaignId } });
      await refetch();
      toast.success("Campanha cancelada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar.");
    }
  }

  if (contextLoading)
    return <div className="p-6 text-sm text-muted-foreground">Carregando acesso...</div>;
  if (!canManage) {
    throw redirect({ to: "/dashboard" });
  }

  const manualCount = manualPhones.split(/[\n,;]+/).filter((phone) => phone.trim()).length;
  const totalDraftContacts = manualCount + spreadsheetRecipients.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8" data-allow-copy>
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-accent">
            <Megaphone className="h-4 w-4" /> Marketing · WhatsApp
          </div>
          <h1 className="font-display text-4xl text-foreground">Campanhas</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Envios sequenciais para contatos que autorizaram receber mensagens.
          </p>
        </div>
        <Badge variant="outline" className="gap-2 py-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Limite: 50 tentativas em 24 h
        </Badge>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Nova campanha</CardTitle>
            <CardDescription>
              Até 200 destinatários. A fila pode ser pausada e retomada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
              <div className="space-y-2">
                <Label htmlFor="campaign-name">Nome interno</Label>
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ex.: Aviso de atendimento"
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-delay">Intervalo (segundos)</Label>
                <Input
                  id="campaign-delay"
                  type="number"
                  min={30}
                  max={600}
                  step={5}
                  value={delaySeconds}
                  onChange={(event) =>
                    setDelaySeconds(Math.min(600, Math.max(30, Number(event.target.value) || 30)))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="campaign-message">Mensagem ou legenda</Label>
              <Textarea
                id="campaign-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={5}
                maxLength={3000}
                  placeholder="Use {{nome}} (nome completo) ou {{primeiro_nome}} para personalizar pela planilha. O aviso de descadastro é acrescentado automaticamente."
              />
              <div className="text-right text-xs text-muted-foreground">{message.length}/3000</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="manual-phones">Números manuais</Label>
                <Textarea
                  id="manual-phones"
                  value={manualPhones}
                  onChange={(event) => setManualPhones(event.target.value)}
                  rows={4}
                  placeholder="Um número por linha\n5511999999999"
                />
                <p className="text-xs text-muted-foreground">
                  Brasil: com ou sem DDI 55. {manualCount} informado(s).
                </p>
              </div>
              <div className="flex flex-col justify-between gap-3 rounded-md border border-dashed border-border p-3">
                <div>
                  <FileSpreadsheet className="mb-2 h-5 w-5 text-emerald-600" />
                  <p className="text-sm font-medium">Importar Excel</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Colunas obrigatórias: telefone e consentimento. Nome é opcional. Considere
                    apenas linhas com consentimento “sim”.
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importSpreadsheet(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" /> Selecionar .xlsx
                </Button>
                {spreadsheetRecipients.length > 0 && (
                  <p className="text-xs text-emerald-700">
                    {spreadsheetRecipients.length} importado(s), {spreadsheetSkipped} ignorado(s)
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Prévia da campanha"
                      className="h-14 w-14 rounded object-cover"
                    />
                  ) : (
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-sm font-medium">Imagem com legenda</p>
                    <p className="text-xs text-muted-foreground">
                      JPG, PNG ou outro formato de imagem; até 8 MB.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    id="campaign-image"
                    onChange={(event) => void uploadImage(event.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingImage}
                    onClick={() => document.getElementById("campaign-image")?.click()}
                  >
                    {uploadingImage ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-2 h-4 w-4" />
                    )}
                    {uploadingImage
                      ? "Enviando"
                      : imagePreview
                        ? "Trocar imagem"
                        : "Adicionar imagem"}
                  </Button>
                  {mediaId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover imagem"
                      title="Remover imagem"
                      onClick={() => {
                        setMediaId(null);
                        setImagePreview(null);
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(event) => setConsentConfirmed(event.target.checked)}
                className="mt-1"
              />
              <span>
                Confirmo que todos os destinatários autorizaram receber estas mensagens e que a
                lista não contém contatos que pediram descadastro. O rodapé “responda SAIR” será
                incluído.
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">
                {totalDraftContacts} contato(s) selecionado(s)
              </p>
              <Button
                onClick={handleCreate}
                disabled={
                  creating || uploadingImage || !consentConfirmed || totalDraftContacts === 0
                }
              >
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Salvar rascunho
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O intervalo apenas controla o ritmo; ele não garante que o WhatsApp não aplique
              restrições. Envie somente para quem autorizou o contato.
            </p>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Histórico e controle</h2>
              <p className="text-sm text-muted-foreground">
                A fila registra o estado de cada número.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Atualizar campanhas"
              title="Atualizar"
              onClick={() => void refetch()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {campaignsLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando campanhas...
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma campanha criada.
            </div>
          ) : (
            campaigns.map((campaign) => {
              const sent = campaign.counts.sent ?? 0;
              const total = campaign.total || 1;
              const counts = campaign.counts;
              const progress = Math.round(
                ((sent + (counts.failed ?? 0) + (counts.skipped ?? 0)) / total) * 100,
              );
              return (
                <Card key={campaign.id} className="overflow-hidden">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-medium">{campaign.name}</h3>
                          <Badge variant={campaign.status === "running" ? "default" : "outline"}>
                            {STATUS_LABELS[campaign.status] ?? campaign.status}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {campaign.message}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {campaign.status === "running" ? (
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Pausar campanha"
                            title="Pausar"
                            onClick={() => void handlePause(campaign.id)}
                          >
                            <Pause className="h-4 w-4" />
                          </Button>
                        ) : ["draft", "paused"].includes(campaign.status) ? (
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={
                              campaign.status === "paused" ? "Retomar campanha" : "Iniciar campanha"
                            }
                            title={campaign.status === "paused" ? "Retomar" : "Iniciar"}
                            onClick={() => void handleStart(campaign.id)}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                        ) : null}
                        {["draft", "running", "paused"].includes(campaign.status) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Cancelar campanha"
                            title="Cancelar"
                            onClick={() => void handleCancel(campaign.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <Progress value={progress} aria-label={`${progress}% enviado`} />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {sent}/{campaign.total} enviados · {counts.failed ?? 0} falhas ·{" "}
                        {counts.skipped ?? 0} ignorados
                      </span>
                      <button
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                        onClick={() =>
                          setExpandedCampaign(expandedCampaign === campaign.id ? null : campaign.id)
                        }
                      >
                        {expandedCampaign === campaign.id ? "Fechar log" : "Ver log"}
                      </button>
                    </div>
                    {campaign.status === "running" && drivingId !== campaign.id && (
                      <div className="flex items-center justify-between gap-2 rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                        <span>Envio pausado quando esta página foi fechada.</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void runCampaign(campaign.id)}
                        >
                          <Play className="mr-1 h-3 w-3" /> Retomar
                        </Button>
                      </div>
                    )}
                    {drivingId === campaign.id && (
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Envio sequencial em
                        andamento; esta página precisa ficar aberta.
                      </p>
                    )}
                    {expandedCampaign === campaign.id && (
                      <div className="max-h-64 overflow-auto border-t border-border pt-2">
                        {recipientsQuery.isLoading ? (
                          <p className="p-3 text-xs text-muted-foreground">Carregando log...</p>
                        ) : (
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="p-2 font-medium">Telefone</th>
                                <th className="p-2 font-medium">Estado</th>
                                <th className="p-2 font-medium">Detalhe</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(recipientsQuery.data ?? []).map((recipient) => (
                                <tr key={recipient.id} className="border-t border-border/60">
                                  <td className="p-2">
                                    {recipient.display_name ? `${recipient.display_name} · ` : ""}
                                    {recipient.phone}
                                  </td>
                                  <td className="p-2">
                                    {STATUS_LABELS[recipient.status] ?? recipient.status}
                                  </td>
                                  <td
                                    className="max-w-[200px] truncate p-2 text-muted-foreground"
                                    title={recipient.error_message ?? ""}
                                  >
                                    {recipient.error_message ??
                                      (recipient.sent_at
                                        ? new Date(recipient.sent_at).toLocaleString("pt-BR")
                                        : "—")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </section>
      </div>

      <div className="flex items-start gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p>
          Use a integração somente com consentimento e respeite pedidos de saída. O WhatsApp pode
          limitar ou suspender números; a cadência não elimina esse risco.
        </p>
      </div>
    </div>
  );
}
