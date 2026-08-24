import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Copy, Webhook, CreditCard, Import, ExternalLink, KeyRound, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPaymentCredentials,
  upsertPaymentCredential,
  deletePaymentCredential,
} from "@/lib/payment-credentials.functions";

export const Route = createFileRoute("/_authenticated/integracoes")({
  head: () => ({ meta: [{ title: "Integrações — LexIA" }] }),
  component: IntegracoesPage,
});


function IntegracoesPage() {
  const [origin, setOrigin] = useState<string>(
    typeof window !== "undefined" ? window.location.origin : "",
  );
  // fallback caso rode em SSR
  if (!origin && typeof window !== "undefined") setOrigin(window.location.origin);

  const urls = [
    {
      id: "import",
      icon: Import,
      title: "Importação de dados (genérico)",
      description: "Sistemas de terceiros enviam leads/clientes/mensagens que viram cards no Kanban.",
      url: `${origin}/api/public/import-webhook`,
      method: "POST",
      auth: "Header: X-Signature (HMAC-SHA256 do body com IMPORT_WEBHOOK_SECRET)",
      example: `{
  "user_id": "SEU_USER_ID_UUID",
  "source": "meu-sistema",
  "type": "lead",  // ou "cliente", "caso", "mensagem"
  "data": {
    "name": "João Silva",
    "phone": "5511999999999",
    "description": "Chegou pelo Google Ads"
  }
}`,
    },
    {
      id: "asaas",
      icon: CreditCard,
      title: "Asaas (cobranças BR)",
      description: "Cole esta URL em Configurações → Integrações → Webhooks do Asaas. Token no header asaas-access-token.",
      url: `${origin}/api/public/asaas-webhook`,
      method: "POST",
      auth: "Header: asaas-access-token = valor do secret ASAAS_WEBHOOK_TOKEN",
      example: "Eventos: PAYMENT_CREATED, PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_REFUNDED",
    },
    {
      id: "mp",
      icon: CreditCard,
      title: "Mercado Pago",
      description: "Cole em Suas integrações → Webhooks. Assinatura verificada com MERCADOPAGO_WEBHOOK_SECRET.",
      url: `${origin}/api/public/mercadopago-webhook`,
      method: "POST",
      auth: "Headers: x-signature (ts + v1) e x-request-id — enviados pelo Mercado Pago",
      example: "Eventos: payment.created, payment.updated",
    },
  ];

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("URL copiada");
  }

  return (
    <div className="space-y-6 animate-fade-up" data-allow-copy>
      {/* header + urls block continues below */}
      <PaymentKeysPanelWrapper />

      <div className="border-b border-border/60 pb-6">
        <div className="text-[10px] uppercase tracking-[0.28em] text-accent">
          Webhooks · Automações
        </div>
        <h1 className="font-display italic text-5xl leading-[0.95] text-foreground mt-2">
          Integrações <span className="text-accent">& Webhooks</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          URLs prontas para colar nos painéis do Asaas, Mercado Pago ou em
          qualquer sistema que precise enviar dados pro seu CRM
          automaticamente.
        </p>
      </div>

      <div className="grid gap-4">
        {urls.map((w) => (
          <Card key={w.id} className="border-border/60">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-accent/10 p-2">
                    <w.icon className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{w.title}</CardTitle>
                    <CardDescription className="mt-1">{w.description}</CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="border-accent/30 text-accent">
                  {w.method}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all">
                  {w.url}
                </code>
                <Button size="sm" variant="outline" onClick={() => copy(w.url)}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                <strong className="text-foreground">Autenticação:</strong> {w.auth}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  Ver exemplo de payload
                </summary>
                <pre className="mt-2 rounded-md bg-muted p-3 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                  {w.example}
                </pre>
              </details>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-accent/30 bg-accent/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-4 w-4 text-accent" /> Como configurar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">1.</strong> Copie a URL do
            gateway desejado.
          </p>
          <p>
            <strong className="text-foreground">2.</strong> No painel do
            provedor (Asaas / Mercado Pago), cole a URL na seção de Webhooks.
          </p>
          <p>
            <strong className="text-foreground">3.</strong> Configure a
            autenticação usando o secret indicado — já geramos os valores
            automaticamente. Se precisar ver ou trocar, me peça.
          </p>
          <p className="pt-2">
            <a
              href="https://docs.asaas.com/docs/webhooks"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Docs Asaas <ExternalLink className="h-3 w-3" />
            </a>
            <span className="mx-3">·</span>
            <a
              href="https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              Docs Mercado Pago <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type GatewayConfig = {
  gateway: string;
  label: string;
  hint: string;
  placeholder: string;
  docs?: string;
  custom?: boolean;
};

const GATEWAYS: GatewayConfig[] = [
  {
    gateway: "asaas",
    label: "Asaas",
    hint: "API Key gerada em Configurações → Integrações → Chave de API.",
    placeholder: "$aact_...",
    docs: "https://docs.asaas.com/reference/autenticacao",
  },
  {
    gateway: "mercadopago",
    label: "Mercado Pago",
    hint: "Access Token de produção do seu app (Suas integrações → Credenciais).",
    placeholder: "APP_USR-...",
    docs: "https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/credentials",
  },
  {
    gateway: "stripe",
    label: "Stripe",
    hint: "Secret Key (sk_live_... ou sk_test_...).",
    placeholder: "sk_live_...",
    docs: "https://dashboard.stripe.com/apikeys",
  },
];

const BUILTIN_IDS = new Set(GATEWAYS.map((g) => g.gateway));

function PaymentKeysPanelWrapper() {
  const list = useServerFn(listPaymentCredentials);
  const upsert = useServerFn(upsertPaymentCredential);
  const remove = useServerFn(deletePaymentCredential);
  const qc = useQueryClient();

  const [addingCustom, setAddingCustom] = useState(false);
  const [customId, setCustomId] = useState("");
  const [customLabel, setCustomLabel] = useState("");

  const { data: creds = [], isLoading } = useQuery({
    queryKey: ["payment-credentials"],
    queryFn: () => list(),
  });

  const saveMut = useMutation({
    mutationFn: (input: Parameters<typeof upsertPaymentCredential>[0]["data"]) =>
      upsert({ data: input }),
    onSuccess: () => {
      toast.success("Chave salva");
      qc.invalidateQueries({ queryKey: ["payment-credentials"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const delMut = useMutation({
    mutationFn: (gateway: string) => remove({ data: { gateway } }),
    onSuccess: () => {
      toast.success("Chave removida");
      qc.invalidateQueries({ queryKey: ["payment-credentials"] });
    },
  });

  const customCreds = creds.filter((c) => !BUILTIN_IDS.has(c.gateway));

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-accent/10 p-2">
            <KeyRound className="h-5 w-5 text-accent" />
          </div>
          <div>
            <CardTitle className="text-lg">Chaves dos gateways de pagamento</CardTitle>
            <CardDescription className="mt-1">
              Salve aqui as API Keys/Access Tokens usados para gerar cobranças.
              Só você enxerga (protegido por RLS).
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <>
            {GATEWAYS.map((g) => {
              const existing = creds.find((c) => c.gateway === g.gateway);
              return (
                <GatewayKeyRow
                  key={g.gateway}
                  config={g}
                  existing={existing ?? undefined}
                  onSave={(payload) => saveMut.mutate(payload)}
                  onDelete={() => delMut.mutate(g.gateway)}
                  saving={saveMut.isPending}
                />
              );
            })}

            {customCreds.map((c) => (
              <GatewayKeyRow
                key={c.gateway}
                config={{
                  gateway: c.gateway,
                  label: c.display_name || c.gateway,
                  hint: "Gateway personalizado adicionado por você.",
                  placeholder: "API Key / Token",
                  custom: true,
                }}
                existing={c}
                onSave={(payload) => saveMut.mutate(payload)}
                onDelete={() => delMut.mutate(c.gateway)}
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
                      placeholder="Ex: PagSeguro, Cielo, PayPal..."
                      onChange={(e) => setCustomLabel(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Identificador (slug)</Label>
                    <Input
                      value={customId}
                      placeholder="ex: pagseguro"
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
                      if (BUILTIN_IDS.has(slug)) {
                        toast.error("Esse identificador já existe");
                        return;
                      }
                      saveMut.mutate(
                        {
                          gateway: slug,
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
                <p className="text-[11px] text-muted-foreground">
                  Depois de adicionar, preencha a API Key no card que aparece abaixo
                  e clique em Salvar.
                </p>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full border-dashed"
                onClick={() => setAddingCustom(true)}
              >
                + Adicionar outro gateway
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GatewayKeyRow({
  config,
  existing,
  onSave,
  onDelete,
  saving,
}: {
  config: GatewayConfig;
  existing?: { api_key: string | null; environment: string; display_name?: string | null };
  onSave: (input: {
    gateway: string;
    display_name?: string | null;
    api_key: string;
    environment: "production" | "sandbox";
  }) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(
    existing?.api_key && existing.api_key !== "PENDENTE" ? existing.api_key : "",
  );
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
      <div className="grid gap-2 md:grid-cols-[1fr_150px]">
        <div>
          <Label className="text-xs">API Key</Label>
          <Input
            type="password"
            value={value}
            placeholder={config.placeholder}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
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
          disabled={!value.trim() || saving}
          onClick={() =>
            onSave({
              gateway: config.gateway,
              display_name: existing?.display_name ?? (config.custom ? config.label : null),
              api_key: value.trim(),
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


