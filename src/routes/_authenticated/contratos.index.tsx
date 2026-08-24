import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileSignature, Plus, Sparkles } from "lucide-react";
import { listContracts } from "@/lib/contracts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/contratos/")({
  head: () => ({ meta: [{ title: "Contratos — LexIA" }] }),
  component: ContratosPage,
});

const statusColors: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-700",
  review: "bg-amber-500/15 text-amber-700",
  ready: "bg-blue-500/15 text-blue-700",
  sent: "bg-purple-500/15 text-purple-700",
  viewed: "bg-cyan-500/15 text-cyan-700",
  signed: "bg-emerald-500/15 text-emerald-700",
  rejected: "bg-red-500/15 text-red-700",
  expired: "bg-red-500/15 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
};

const statusLabel: Record<string, string> = {
  draft: "Rascunho",
  review: "Revisar IA",
  ready: "Pronto para envio",
  sent: "Enviado",
  viewed: "Visualizado",
  signed: "Assinado",
  rejected: "Rejeitado",
  expired: "Expirado",
  cancelled: "Cancelado",
};

function ContratosPage() {
  const listFn = useServerFn(listContracts);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => listFn(),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileSignature className="h-6 w-6 text-accent" /> Contratos
          </h1>
          <p className="text-sm text-muted-foreground">Gestão de contratos com auditoria IA + assinatura via Autentique.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/contratos/templates"><Sparkles className="h-4 w-4 mr-1" /> Templates</Link>
          </Button>
          <Button asChild>
            <Link to="/contratos/novo"><Plus className="h-4 w-4 mr-1" /> Novo contrato</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Todos os contratos</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : !data || data.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileSignature className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>Nenhum contrato ainda. Crie um template primeiro, depois emita um contrato.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Score IA</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">{c.contract_code ?? "—"}</TableCell>
                    <TableCell>{c.title ?? "(sem título)"}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[c.status] ?? "bg-muted"}>{statusLabel[c.status] ?? c.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {c.integrity_score != null ? (
                        <span className={c.integrity_score >= 80 ? "text-emerald-600" : "text-amber-600"}>
                          {c.integrity_score}/100
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/contratos/$id" params={{ id: c.id }}>Abrir</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="mt-2 text-right">
            <Button size="sm" variant="ghost" onClick={() => refetch()}>Atualizar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
