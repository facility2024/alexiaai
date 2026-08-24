import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações de IA — LexIA" }] }),
  component: ConfigPage,
});

import { AGENTS as AGENT_DEFS } from "@/lib/agents";

const AGENTS = AGENT_DEFS.map((a) => ({
  key: a.key,
  name: `${a.name} — ${a.role}`,
  desc: a.desc,
}));

const PROVIDERS = {
  google: {
    label: "Google Gemini",
    models: [
      { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (recomendado)" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ],
  },
  openai: {
    label: "OpenAI GPT",
    models: [
      { id: "openai/gpt-5", label: "GPT-5" },
      { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
      { id: "openai/gpt-5-nano", label: "GPT-5 Nano" },
      { id: "openai/gpt-5.4", label: "GPT-5.4" },
    ],
  },
} as const;

type AgentSettings = {
  provider: keyof typeof PROVIDERS;
  model: string;
  system_prompt: string;
  api_key: string;
  base_url: string;
};

const defaults: AgentSettings = {
  provider: "google",
  model: "google/gemini-3-flash-preview",
  system_prompt: "",
  api_key: "",
  base_url: "",
};

function ConfigPage() {
  const [settings, setSettings] = useState<Record<string, AgentSettings>>(
    () => Object.fromEntries(AGENTS.map((a) => [a.key, defaults])) as Record<string, AgentSettings>,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("agent_key,provider,model,system_prompt,api_key,base_url");
      if (error) toast.error(error.message);
      else if (data) {
        const next = { ...settings };
        for (const row of data) {
          next[row.agent_key] = {
            provider: (row.provider as keyof typeof PROVIDERS) ?? "google",
            model: row.model,
            system_prompt: row.system_prompt ?? "",
            api_key: (row as any).api_key ?? "",
            base_url: (row as any).base_url ?? "",
          };
        }
        setSettings(next);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(agentKey: string) {
    setSaving(agentKey);
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) { setSaving(null); return; }
    const s = settings[agentKey];
    const { error } = await supabase.from("ai_settings").upsert({
      user_id: userId,
      agent_key: agentKey,
      provider: s.provider,
      model: s.model,
      system_prompt: s.system_prompt || null,
      api_key: s.api_key.trim() || null,
      base_url: s.base_url.trim() || null,
    } as any, { onConflict: "user_id,agent_key" });
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success("Configuração salva");
  }

  function update(agentKey: string, patch: Partial<AgentSettings>) {
    setSettings((prev) => {
      const next = { ...prev[agentKey], ...patch };
      // Reset model when provider changes
      if (patch.provider && patch.provider !== prev[agentKey].provider) {
        next.model = PROVIDERS[patch.provider].models[0].id;
      }
      return { ...prev, [agentKey]: next };
    });
  }

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configurações de IA</h1>
        <p className="text-sm text-muted-foreground">
          Escolha qual modelo de IA cada agente vai usar. Disponíveis via Lovable AI: Google Gemini e OpenAI GPT.
        </p>
      </div>
      <Card className="border-accent/40 bg-accent/5">
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <strong className="text-foreground">Chave da IA:</strong> a LexIA usa o Lovable AI Gateway, com chave gerenciada automaticamente pela plataforma. Você não precisa colar nenhuma API key — apenas escolha o modelo desejado abaixo. O consumo é descontado dos créditos do workspace.
        </CardContent>
      </Card>

      {AGENTS.map((agent) => {
        const s = settings[agent.key];
        const providerCfg = PROVIDERS[s.provider];
        return (
          <Card key={agent.key}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-accent" />
                <CardTitle>{agent.name}</CardTitle>
              </div>
              <CardDescription>{agent.desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Provedor</Label>
                  <Select value={s.provider} onValueChange={(v) => update(agent.key, { provider: v as keyof typeof PROVIDERS })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PROVIDERS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Modelo</Label>
                  <Select value={s.model} onValueChange={(v) => update(agent.key, { model: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {providerCfg.models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Instruções do sistema (opcional)</Label>
                <Textarea
                  rows={4}
                  value={s.system_prompt}
                  onChange={(e) => update(agent.key, { system_prompt: e.target.value })}
                  placeholder="Ex: Você é um assistente jurídico especializado em..."
                />
              </div>
              <details className="rounded-md border border-border bg-muted/30 p-3">
                <summary className="cursor-pointer text-sm font-medium">Usar minha própria chave de API (BYOK)</summary>
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Se preenchida, a IA usará esta chave em vez da chave gerenciada pela plataforma. O custo passa a ser do seu provedor (OpenAI, Anthropic, etc.).
                  </p>
                  <div className="space-y-1">
                    <Label>API Key</Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      value={s.api_key}
                      onChange={(e) => update(agent.key, { api_key: e.target.value })}
                      placeholder="sk-..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Base URL (opcional)</Label>
                    <Input
                      value={s.base_url}
                      onChange={(e) => update(agent.key, { base_url: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                </div>
              </details>
              <div className="flex justify-end">
                <Button onClick={() => handleSave(agent.key)} disabled={saving === agent.key}>
                  <Save className="mr-2 h-4 w-4" />
                  {saving === agent.key ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
