import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Send, Save, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listSmsCredentials,
  upsertSmsCredential,
  deleteSmsCredential,
} from "@/lib/sms-credentials.functions";

export const Route = createFileRoute("/_authenticated/sms")({
  head: () => ({ meta: [{ title: "SMS — LexIA" }] }),
  component: SmsPage,
});

type ProviderConfig = {
  provider: string;
  label: string;
  hint: string;
  docs?: string;
  custom?: boolean;
};

const PROVIDERS: ProviderConfig[] = [
  {
    provider: "twilio",
    label: "Twilio",
    hint: "Account SID no campo API Key e Auth Token no API Secret.",
    docs: "https://www.twilio.com/console",
  },
  {
    provider: "zenvia",
    label: "Zenvia",
    hint: "API Token gerado em Integrações → API.",
    docs: "https://app.zenvia.com/home/api",
  },
  {
    provider: "totalvoice",
    label: "TotalVoice / Zapper",
    hint: "Access Token da conta.",
  },
  {
    provider: "infobip",
    label: "Infobip",
    hint: "API Key + Base URL (ex: https://xxxxx.api.infobip.com).",
    docs: "https://portal.infobip.com/settings/accounts/api-keys",
  },
  {
    provider: "strong_expert",
    label: "Strong Expert",
    hint: "API Key = Bearer Token da conta. Sender ID = ID numérico do smsTemplate. Base URL opcional (default https://api.strong.expert).",
    docs: "https://strong-expert.apidocumentation.com/reference",
  },
  {
    provider: "integrax",
    label: "Integrax (aresfun)",
    hint: "API Key = TOKEN da URL (/v1/integration/{TOKEN}/send-sms). Sender ID = remetente 'from' (ex: 29094). Base URL opcional (default https://sms.aresfun.com).",
    docs: "https://www.integrax.app/dashboard/external/docs",
  },
];

const BUILTIN = new Set(PROVIDERS.map((p) => p.provider));

function SmsPage() {
  const list = useServerFn(listSmsCredentials);
  const upsert = useServerFn(upsertSmsCredential);
  const remove = useServerFn(deleteSmsCredential);
  const qc = useQueryClient();

  const [addingCustom, setAddingCustom] = useState(false);
  const [customId, setCustomId] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  const { data: creds = [], isLoading } = useQuery({
    queryKey: ["sms-credentials"],
    queryFn: () => list(),
  });

  const saveMut = useMutation({
    mutationFn: (input: Parameters<typeof upsertSmsCredential>[0]["data"]) =>
      upsert({ data: input }),
    onSuccess: () => {
      toast.success("Chave SMS salva");
      qc.invalidateQueries({ queryKey: ["sms-credentials"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const delMut = useMutation({
    mutationFn: (provider: string) => remove({ data: { provider } }),
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["sms-credentials"] });
    },
  });

  const customCreds = creds.filter((c) => !BUILTIN.has(c.provider));

  return (
    <div className="space-y-6 animate-fade-up" data-allow-copy>
      <div className="border-b border-border/60 pb-6">
        <div className="text-[10px] uppercase tracking-[0.28em] text-accent">
          Envio de SMS
        </div>
        <h1 className="font-display italic text-5xl leading-[0.95] text-foreground mt-2">
          Chaves de <span className="text-accent">SMS</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Configure as credenciais de qualquer gateway de SMS (Twilio, Zenvia,
          Infobip, TotalVoice ou outro). Só você enxerga (protegido por RLS).
        </p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-accent/10 p-2">
              <Send className="h-5 w-5 text-accent" />
            </div>
            <div>
              <CardTitle className="text-lg">Provedores de SMS</CardTitle>
              <CardDescription className="mt-1">
                Salve API Key, Secret e Sender ID de cada serviço.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : (
            <>
              {PROVIDERS.map((p) => {
                const existing = creds.find((c) => c.provider === p.provider);
                return (
                  <SmsRow
                    key={p.provider}
                    config={p}
                    existing={existing ?? undefined}
                    onSave={(payload) => saveMut.mutate(payload)}
                    onDelete={() => delMut.mutate(p.provider)}
                    saving={saveMut.isPending}
                  />
                );
              })}

              {customCreds.map((c) => (
                <SmsRow
                  key={c.provider}
                  config={{
                    provider: c.provider,
                    label: c.display_name || c.provider,
                    hint: "Provedor personalizado.",
                    custom: true,
                  }}
                  existing={c}
                  onSave={(payload) => saveMut.mutate(payload)}
                  onDelete={() => delMut.mutate(c.provider)}
                  saving={saveMut.isPending}
                />
              ))}

              {addingCustom ? (
                <div className="rounded-lg border border-dashed border-accent/40 p-4 space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <Label className="text-xs">Nome amigável</Label>
                      <Input
                        value={customLabel}
                        placeholder="Ex: SMSDev, MessageBird..."
                        onChange={(e) => setCustomLabel(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Identificador (slug)</Label>
                      <Input
                        value={customId}
                        placeholder="ex: smsdev"
                        onChange={(e) =>
                          setCustomId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
                        }
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => setAddingCustom(false)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      disabled={!customId.trim() || !customLabel.trim() || saveMut.isPending}
                      onClick={() => {
                        const slug = customId.trim().toLowerCase();
                        if (BUILTIN.has(slug)) {
                          toast.error("Esse identificador já existe");
                          return;
                        }
                        saveMut.mutate(
                          {
                            provider: slug,
                            display_name: customLabel.trim(),
                            api_key: "PENDENTE",
                            environment: "production",
                            extra: {},
                          },
                          {
                            onSuccess: () => {
                              setAddingCustom(false);
                              setCustomId("");
                              setCustomLabel("");
                            },
                          },
                        );
                      }}
                    >
                      Adicionar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-dashed"
                  onClick={() => setAddingCustom(true)}
                >
                  + Adicionar outro provedor de SMS
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SmsRow({
  config,
  existing,
  onSave,
  onDelete,
  saving,
}: {
  config: ProviderConfig;
  existing?: {
    api_key: string | null;
    api_secret: string | null;
    sender_id: string | null;
    base_url: string | null;
    environment: string;
    display_name?: string | null;
  };
  onSave: (input: {
    provider: string;
    display_name?: string | null;
    api_key: string;
    api_secret?: string | null;
    sender_id?: string | null;
    base_url?: string | null;
    environment: "production" | "sandbox";
  }) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [apiKey, setApiKey] = useState(
    existing?.api_key && existing.api_key !== "PENDENTE" ? existing.api_key : "",
  );
  const [apiSecret, setApiSecret] = useState(existing?.api_secret ?? "");
  const [senderId, setSenderId] = useState(existing?.sender_id ?? "");
  const [baseUrl, setBaseUrl] = useState(existing?.base_url ?? "");
  const [env, setEnv] = useState<"production" | "sandbox">(
    (existing?.environment as "production" | "sandbox") ?? "production",
  );
  const isSet = Boolean(existing?.api_key && existing.api_key !== "PENDENTE");

  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{config.label}</span>
            {config.custom && (
              <Badge variant="outline" className="border-accent/40 text-accent">
                Personalizado
              </Badge>
            )}
            {isSet ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                Configurado
              </Badge>
            ) : (
              <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
                Vazio
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{config.hint}</p>
        </div>
        {config.docs && (
          <a
            href={config.docs}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline inline-flex items-center gap-1"
          >
            Onde pegar <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <Label className="text-xs">API Key / Token</Label>
          <Input
            type="password"
            value={apiKey}
            placeholder="API Key"
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label className="text-xs">API Secret (opcional)</Label>
          <Input
            type="password"
            value={apiSecret}
            placeholder="Secret / Auth Token"
            onChange={(e) => setApiSecret(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label className="text-xs">Sender ID / Remetente</Label>
          <Input
            value={senderId}
            placeholder="Ex: +5511999999999 ou MinhaEmpresa"
            onChange={(e) => setSenderId(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Base URL (opcional)</Label>
          <Input
            value={baseUrl}
            placeholder="Ex: https://api.infobip.com"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">Ambiente</Label>
          <select
            value={env}
            onChange={(e) => setEnv(e.target.value as "production" | "sandbox")}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="production">Produção</option>
            <option value="sandbox">Sandbox</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        {(isSet || config.custom) && (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Remover
          </Button>
        )}
        <Button
          size="sm"
          disabled={!apiKey.trim() || saving}
          onClick={() =>
            onSave({
              provider: config.provider,
              display_name: existing?.display_name ?? (config.custom ? config.label : null),
              api_key: apiKey.trim(),
              api_secret: apiSecret.trim() || null,
              sender_id: senderId.trim() || null,
              base_url: baseUrl.trim() || null,
              environment: env,
            })
          }
        >
          <Save className="h-3.5 w-3.5 mr-1" /> Salvar
        </Button>
      </div>
    </div>
  );
}
