import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageCircle, RefreshCw, QrCode, Save, ExternalLink, CheckCircle2, XCircle, Webhook, Bot, Copy, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { checkWhatsappStatus, getWhatsappQr, configureWapiWebhook, sendWhatsappMessage, disconnectWhatsapp } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp — LexIA" }] }),
  component: WhatsappPage,
});

type AiKeys = {
  provider: string;
  model: string;
  openai_key: string;
  gemini_key: string;
  inworld_key: string;
};

const PROVIDER_MODELS: Record<string, { label: string; models: { id: string; label: string }[] }> = {
  lovable: {
    label: "Lovable AI (gerenciado)",
    models: [
      { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (recomendado)" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
      { id: "openai/gpt-5", label: "GPT-5" },
    ],
  },
  openai: {
    label: "OpenAI (chave própria)",
    models: [
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4o", label: "gpt-4o" },
      { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
    ],
  },
  google: {
    label: "Google Gemini (chave própria)",
    models: [
      { id: "gemini-1.5-flash", label: "gemini-1.5-flash" },
      { id: "gemini-1.5-pro", label: "gemini-1.5-pro" },
      { id: "gemini-2.0-flash-exp", label: "gemini-2.0-flash-exp" },
    ],
  },
  inworld: {
    label: "Inworld AI (chave própria)",
    models: [{ id: "inworld-default", label: "Padrão Inworld" }],
  },
};

function WhatsappPage() {
  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [status, setStatus] = useState<string>("disconnected");
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [replyInGroups, setReplyInGroups] = useState(false);
  const [savingReplyGroups, setSavingReplyGroups] = useState(false);
  const [aiKeys, setAiKeys] = useState<AiKeys>({
    provider: "lovable",
    model: "google/gemini-3-flash-preview",
    openai_key: "",
    gemini_key: "",
    inworld_key: "",
  });
  const [savingAi, setSavingAi] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState("Teste de conexão LexIA ✅");
  const [sendingTest, setSendingTest] = useState(false);

  const fnStatus = useServerFn(checkWhatsappStatus);
  const fnQr = useServerFn(getWhatsappQr);
  const fnConfigureWebhook = useServerFn(configureWapiWebhook);
  const fnSendTest = useServerFn(sendWhatsappMessage);
  const fnDisconnect = useServerFn(disconnectWhatsapp);

  async function handleDisconnect() {
    if (!confirm("Desconectar a instância do WhatsApp?")) return;
    setDisconnecting(true);
    try {
      const r = await fnDisconnect();
      if (r.ok) {
        setStatus("disconnected");
        setPhone(null);
        setQr(null);
        toast.success("Instância desconectada");
      } else {
        toast.error(r.message ?? "Falha ao desconectar");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSendTest() {
    const phone = testPhone.replace(/\D/g, "");
    if (phone.length < 10) return toast.error("Informe o número com DDI+DDD (ex: 5511999999999)");
    if (!testMsg.trim()) return toast.error("Mensagem vazia");
    setSendingTest(true);
    try {
      const r = await fnSendTest({ data: { to: phone, message: testMsg.trim() } });
      if (r.ok) {
        toast.success("Mensagem adicionada à fila de envio!");
      } else {
        if (r.code === "WHATSAPP_DISCONNECTED") {
          setStatus("disconnected");
          await handleQr();
        }
        toast.error(r.message ?? "Falha ao enviar");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    } finally {
      setSendingTest(false);
    }
  }

  async function handleConfigureWebhook() {
    setConfiguring(true);
    try {
      // Sempre passa vazio para o server usar a URL publicada estável,
      // já que a URL de preview (id-preview--...) muda e a W-API não alcança.
      const r = await fnConfigureWebhook({ data: { baseUrl: "" } });
      if (r.ok) {
        setWebhookUrl(r.webhookUrl);
        toast.success("Webhook configurado na W-API (URL estável)");
      } else {
        setWebhookUrl(r.webhookUrl ?? null);
        toast.error(r.message ?? "Falha ao configurar webhook");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    } finally {
      setConfiguring(false);
    }
  }

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { setLoading(false); return; }
      const uid = u.user.id;
      const { data } = await supabase
        .from("wapi_config")
        .select("instance_id,api_token,phone_number,status,webhook_url,reply_in_groups")
        .eq("user_id", uid)
        .maybeSingle();
      if (data) {
        setInstanceId(data.instance_id ?? "");
        setApiToken(data.api_token ?? "");
        setPhone(data.phone_number ?? null);
        setStatus(data.status ?? "disconnected");
        setWebhookUrl((data as any).webhook_url ?? null);
        setReplyInGroups(Boolean((data as any).reply_in_groups));
      }
      const { data: ai } = await supabase
        .from("ai_settings")
        .select("provider,model,openai_key,gemini_key,inworld_key")
        .eq("user_id", uid)
        .eq("agent_key", "whatsapp")
        .maybeSingle();
      if (ai) {
        setAiKeys({
          provider: (ai as any).provider ?? "lovable",
          model: (ai as any).model ?? "google/gemini-3-flash-preview",
          openai_key: (ai as any).openai_key ?? "",
          gemini_key: (ai as any).gemini_key ?? "",
          inworld_key: (ai as any).inworld_key ?? "",
        });
      }
      setLoading(false);
    })();
  }, []);

  async function handleSaveAi() {
    setSavingAi(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSavingAi(false); return; }
    const { error } = await supabase.from("ai_settings").upsert({
      user_id: u.user.id,
      agent_key: "whatsapp",
      provider: aiKeys.provider,
      model: aiKeys.model,
      openai_key: aiKeys.openai_key.trim() || null,
      gemini_key: aiKeys.gemini_key.trim() || null,
      inworld_key: aiKeys.inworld_key.trim() || null,
    } as any, { onConflict: "user_id,agent_key" });
    setSavingAi(false);
    if (error) return toast.error(error.message);
    toast.success("Chaves de IA salvas");
  }

  function copyWebhook() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL copiada");
  }

  async function handleSave() {
    if (!instanceId.trim() || !apiToken.trim()) {
      return toast.error("Preencha Instance ID e Token");
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSaving(false); return; }
    const { error } = await supabase.from("wapi_config").upsert(
      {
        user_id: u.user.id,
        instance_id: instanceId.trim(),
        api_token: apiToken.trim(),
      },
      { onConflict: "user_id" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Credenciais salvas");
  }

  async function handleCheck() {
    setChecking(true);
    try {
      const r = await fnStatus();
      setStatus(r.status);
      setPhone(r.phone ?? null);
      if (r.ok) toast.success(`Status: ${r.status}${r.phone ? ` (${r.phone})` : ""}`);
      else toast.error(r.message ?? "Falha ao verificar");
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    } finally {
      setChecking(false);
    }
  }

  async function handleQr() {
    setQrLoading(true);
    setQr(null);
    try {
      const r = await fnQr();
      if (!r.ok) toast.error(r.message ?? "Falha ao obter QR Code");
      else if (r.qr) setQr(r.qr);
      else toast.info("QR Code não disponível (talvez já conectado)");
    } catch (e: any) {
      toast.error(e.message ?? "Erro");
    } finally {
      setQrLoading(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  const connected = status === "connected";

  return (
    <div className="space-y-8" data-allow-copy>
      <header className="animate-fade-up space-y-3">
        <span className="text-[10px] uppercase tracking-[0.28em] text-accent">
          Integração · Canal
        </span>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-gradient shadow-glow">
            <MessageCircle className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-5xl leading-none text-foreground">
              WhatsApp
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Conecte seu número via W-API para que os agentes de IA atendam seus clientes com fluidez editorial.
            </p>
          </div>
        </div>
        <div className="divider-gold mt-4 max-w-xs" />
      </header>



      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-accent" />
              <CardTitle>Conexão W-API</CardTitle>
            </div>
            <Badge
              className={`gap-1 border-transparent text-white ${connected ? "bg-emerald-600 hover:bg-emerald-600" : "bg-red-600 hover:bg-red-600"}`}
            >
              {connected ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {connected ? "conectado" : "desconectado"}
            </Badge>
          </div>
          <CardDescription>
            Gere a instância e o token em{" "}
            <a
              href="https://painel.w-api.app/app/instances"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              painel.w-api.app <ExternalLink className="h-3 w-3" />
            </a>
            {phone && <span className="ml-2">— número: <strong>{phone}</strong></span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Instance ID</Label>
              <Input
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
                placeholder="ex: 3D8A1F..."
              />
            </div>
            <div className="space-y-1">
              <Label>API Token</Label>
              <Input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Bearer token da instância"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
            <Button variant="outline" onClick={handleCheck} disabled={checking || !instanceId || !apiToken}>
              <RefreshCw className={`mr-2 h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              Verificar conexão
            </Button>
            <Button variant="outline" onClick={handleQr} disabled={qrLoading || !instanceId || !apiToken}>
              <QrCode className="mr-2 h-4 w-4" />
              {qrLoading ? "Gerando..." : "Mostrar QR Code"}
            </Button>
            <Button variant="secondary" onClick={handleConfigureWebhook} disabled={configuring || !instanceId || !apiToken}>
              <Webhook className="mr-2 h-4 w-4" />
              {configuring ? "Configurando..." : "Configurar webhook"}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnecting || !instanceId || !apiToken || !connected}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {disconnecting ? "Desconectando..." : "Desconectar instância"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/20 p-3">
            <div className="space-y-0.5">
              <Label htmlFor="reply-groups" className="text-sm">Responder em grupos</Label>
              <p className="text-xs text-muted-foreground">
                Quando desligado, a IA nunca responde em conversas de grupo (recomendado).
              </p>
            </div>
            <Switch
              id="reply-groups"
              checked={replyInGroups}
              disabled={savingReplyGroups}
              onCheckedChange={async (v) => {
                setReplyInGroups(v);
                setSavingReplyGroups(true);
                const { data: u } = await supabase.auth.getUser();
                if (!u.user) { setSavingReplyGroups(false); return; }
                const { error } = await supabase
                  .from("wapi_config")
                  .update({ reply_in_groups: v } as any)
                  .eq("user_id", u.user.id);
                setSavingReplyGroups(false);
                if (error) {
                  setReplyInGroups(!v);
                  toast.error(error.message);
                } else {
                  toast.success(v ? "IA responderá em grupos" : "IA não responderá em grupos");
                }
              }}
            />
          </div>

          {webhookUrl && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">URL do Webhook</strong>
                <Button size="sm" variant="ghost" onClick={copyWebhook}>
                  <Copy className="mr-1 h-3 w-3" /> Copiar
                </Button>
              </div>
              <div className="text-xs break-all font-mono">{webhookUrl}</div>
              <p className="text-xs text-muted-foreground">
                Configure em <strong>w-api → Webhooks → URL de recebimento</strong>
              </p>
            </div>
          )}

          {qr && (
            <div className="flex justify-center rounded-md border bg-muted/30 p-4">
              <img
                src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`}
                alt="QR Code WhatsApp"
                className="h-64 w-64"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-accent" />
            <CardTitle>Teste de envio</CardTitle>
          </div>
          <CardDescription>
            Envie uma mensagem de teste para confirmar que a instância está conectada e enviando.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Número (DDI+DDD, só dígitos)</Label>
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="5511999999999"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <Label>Mensagem</Label>
              <Input
                value={testMsg}
                onChange={(e) => setTestMsg(e.target.value)}
                maxLength={300}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSendTest} disabled={sendingTest || !instanceId || !apiToken}>
              <Send className="mr-2 h-4 w-4" />
              {sendingTest ? "Enviando..." : "Enviar mensagem de teste"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Dica: envie para o seu próprio WhatsApp. Se chegar, a instância está OK. Se não, verifique status / QR Code.
          </p>
        </CardContent>
      </Card>

      <Card>

        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-accent" />
            <CardTitle>Chaves de IA</CardTitle>
          </div>
          <CardDescription>
            Use a IA gerenciada pela plataforma (Lovable AI) ou cole sua própria chave de OpenAI, Gemini ou Inworld.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Provedor ativo</Label>
              <Select
                value={aiKeys.provider}
                onValueChange={(v) => {
                  const first = PROVIDER_MODELS[v].models[0].id;
                  setAiKeys({ ...aiKeys, provider: v, model: first });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROVIDER_MODELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Modelo</Label>
              <Select value={aiKeys.model} onValueChange={(v) => setAiKeys({ ...aiKeys, model: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_MODELS[aiKeys.provider].models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>OpenAI API Key</Label>
            <Input
              type="password"
              autoComplete="off"
              value={aiKeys.openai_key}
              onChange={(e) => setAiKeys({ ...aiKeys, openai_key: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div className="space-y-1">
            <Label>Gemini API Key</Label>
            <Input
              type="password"
              autoComplete="off"
              value={aiKeys.gemini_key}
              onChange={(e) => setAiKeys({ ...aiKeys, gemini_key: e.target.value })}
              placeholder="AIza..."
            />
          </div>
          <div className="space-y-1">
            <Label>Inworld API Key</Label>
            <Input
              type="password"
              autoComplete="off"
              value={aiKeys.inworld_key}
              onChange={(e) => setAiKeys({ ...aiKeys, inworld_key: e.target.value })}
              placeholder="Key..."
            />
            <p className="text-xs text-muted-foreground">Inworld é guardada para uso futuro (voz/avatar).</p>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveAi} disabled={savingAi}>
              <Save className="mr-2 h-4 w-4" />
              {savingAi ? "Salvando..." : "Salvar chaves"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como obter as credenciais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. Acesse <a className="underline" href="https://painel.w-api.app/app/instances" target="_blank" rel="noreferrer">painel.w-api.app/app/instances</a> e crie uma nova instância.</p>
          <p>2. Copie o <strong>Instance ID</strong> e o <strong>Token</strong> gerados.</p>
          <p>3. Cole nos campos acima e clique em <strong>Salvar</strong>.</p>
          <p>4. Clique em <strong>Mostrar QR Code</strong> e escaneie pelo WhatsApp do celular (Aparelhos conectados).</p>
          <p>5. Clique em <strong>Verificar conexão</strong> para confirmar.</p>
        </CardContent>
      </Card>
    </div>
  );
}
