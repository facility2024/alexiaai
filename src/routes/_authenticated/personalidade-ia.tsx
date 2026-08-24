import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AGENTS, type AgentKey } from "@/lib/agents";

export const Route = createFileRoute("/_authenticated/personalidade-ia")({
  head: () => ({ meta: [{ title: "Personalidade da IA — LexIA" }] }),
  component: PersonalityPage,
});

type Personality = {
  persona: string;
  tone: string;
  rules: string;
  use_knowledge_base: boolean;
  max_chars_per_chunk: number;
  typing_delay_ms: number;
};

const defaultsFor = (key: AgentKey): Personality => {
  const a = AGENTS.find((x) => x.key === key)!;
  return {
    persona: `${a.name}, ${a.role.toLowerCase()}. ${a.desc}`,
    tone: "Profissional, acolhedor, direto.",
    rules: "Responda apenas com base na sua base de conhecimento. Se não souber, diga com honestidade e ofereça encaminhar para um atendente humano. Nunca dê conselhos jurídicos definitivos.",
    use_knowledge_base: true,
    max_chars_per_chunk: 250,
    typing_delay_ms: 2000,
  };
};

function PersonalityPage() {
  const [activeAgent, setActiveAgent] = useState<AgentKey>("whatsapp");
  const [form, setForm] = useState<Personality>(defaultsFor("whatsapp"));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("ai_personality")
        .select("persona,tone,rules,use_knowledge_base,max_chars_per_chunk,typing_delay_ms")
        .eq("agent_key", activeAgent)
        .maybeSingle();
      if (cancelled) return;
      const d = defaultsFor(activeAgent);
      setForm({
        persona: data?.persona ?? d.persona,
        tone: data?.tone ?? d.tone,
        rules: data?.rules ?? d.rules,
        use_knowledge_base: data?.use_knowledge_base ?? d.use_knowledge_base,
        max_chars_per_chunk: data?.max_chars_per_chunk ?? d.max_chars_per_chunk,
        typing_delay_ms: data?.typing_delay_ms ?? d.typing_delay_ms,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [activeAgent]);

  async function handleSave() {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setSaving(false); return; }
    const { error } = await supabase.from("ai_personality").upsert(
      { user_id: u.user.id, agent_key: activeAgent, ...form } as any,
      { onConflict: "user_id,agent_key" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Personalidade de ${AGENTS.find((a) => a.key === activeAgent)?.name} salva`);
  }

  const activeInfo = AGENTS.find((a) => a.key === activeAgent)!;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Personalidade da IA</h1>
        <p className="text-sm text-muted-foreground">
          Defina a personalidade de cada agente separadamente para evitar conflitos.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {AGENTS.map((a) => (
          <Button
            key={a.key}
            size="sm"
            variant={a.key === activeAgent ? "default" : "outline"}
            onClick={() => setActiveAgent(a.key)}
          >
            {a.name} — {a.role}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2"><Bot className="h-5 w-5 text-accent" /><CardTitle>{activeInfo.name}</CardTitle></div>
            <CardDescription>{activeInfo.desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Persona</Label>
              <Textarea rows={3} value={form.persona} onChange={(e) => setForm({ ...form, persona: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Tom de voz</Label>
              <Input value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Regras e limites</Label>
              <Textarea rows={4} value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Caracteres por mensagem</Label>
                <Input type="number" min={80} max={1000}
                  value={form.max_chars_per_chunk}
                  onChange={(e) => setForm({ ...form, max_chars_per_chunk: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">A IA quebra a resposta em pedaços desse tamanho.</p>
              </div>
              <div className="space-y-1">
                <Label>Delay "digitando…" (segundos)</Label>
                <Input type="number" min={0.5} max={30} step={0.5}
                  value={form.typing_delay_ms / 1000}
                  onChange={(e) => setForm({ ...form, typing_delay_ms: Number(e.target.value) * 1000 })} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-medium text-sm">Usar base de conhecimento</div>
                <p className="text-xs text-muted-foreground">Este agente consulta apenas os artigos atribuídos a ele.</p>
              </div>
              <Switch checked={form.use_knowledge_base}
                onCheckedChange={(v) => setForm({ ...form, use_knowledge_base: v })} />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
