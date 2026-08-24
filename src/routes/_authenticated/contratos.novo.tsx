import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listTemplates, createContractDraft } from "@/lib/contracts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/contratos/novo")({
  head: () => ({ meta: [{ title: "Novo contrato — LexIA" }] }),
  component: NovoContratoPage,
});

const AUTO_VARS = new Set([
  "cliente.nome", "cliente.cpf", "cliente.email", "cliente.telefone",
  "cliente.endereco", "cliente.cidade", "cliente.estado",
  "agente.nome", "agente.email", "hoje",
]);

function NovoContratoPage() {
  const navigate = useNavigate();
  const listTpls = useServerFn(listTemplates);
  const createFn = useServerFn(createContractDraft);

  const { data: templates } = useQuery({ queryKey: ["contract-templates"], queryFn: () => listTpls() });
  const { data: clients } = useQuery({
    queryKey: ["clients-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, full_name, cpf").order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [clientId, setClientId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const selectedTpl = useMemo(() => templates?.find((t) => t.id === templateId), [templates, templateId]);
  const manualVars = useMemo(() => {
    if (!selectedTpl) return [];
    const raw = (selectedTpl.variables as unknown as string[]) ?? [];
    return raw.filter((v) => !AUTO_VARS.has(v));
  }, [selectedTpl]);

  async function handleCreate() {
    if (!clientId || !templateId) { toast.error("Selecione cliente e template"); return; }
    setSaving(true);
    try {
      const row = await createFn({ data: {
        client_id: clientId,
        template_id: templateId,
        title: title || undefined,
        payment_method: paymentMethod || undefined,
        values,
      } });
      toast.success("Rascunho criado");
      navigate({ to: "/contratos/$id", params: { id: (row as { id: string }).id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link to="/contratos"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Link></Button>
        <h1 className="text-2xl font-semibold">Novo contrato</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Dados do contrato</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Cliente</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
              <SelectContent>
                {(clients ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name ?? "(sem nome)"} {c.cpf ? `• ${c.cpf}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Selecione o template" /></SelectTrigger>
              <SelectContent>
                {(templates ?? []).filter((t) => t.active).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Título (opcional — usa nome do template)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Forma de pagamento</Label>
            <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Ex.: PIX à vista, boleto 3x…" />
          </div>

          {manualVars.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Variáveis do template</Label>
              {manualVars.map((v) => (
                <div key={v}>
                  <Label className="text-xs text-muted-foreground">{`{{${v}}}`}</Label>
                  <Input value={values[v] ?? ""} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          <Button onClick={handleCreate} disabled={saving} className="w-full">
            {saving ? "Criando…" : "Criar rascunho"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
