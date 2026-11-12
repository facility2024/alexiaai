import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2, Lock, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { completeCompanyInvite, getCompanyInvitePublic } from "@/lib/licenses.functions";
import lexiaLogo from "@/assets/lexia-logo.png";

// Convite de EMPRESA (licença SaaS) — fluxo independente do convite de equipe
// (/convite/$token). Cria a conta do dono da empresa e o leva ao CRM dele.

export const Route = createFileRoute("/convite-empresa/$token")({
  head: () => ({ meta: [{ title: "Ativar empresa — LexIA" }] }),
  component: CompanyInvitePage,
});

type Status = "checking" | "invalid" | "form" | "creating" | "done" | "error";

function CompanyInvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const invitePublic = useServerFn(getCompanyInvitePublic);
  const complete = useServerFn(completeCompanyInvite);

  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string>("");
  const [invite, setInvite] = useState<{ company_name: string; invited_email: string } | null>(
    null,
  );
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const inv = await invitePublic({ data: { token } });
        if (cancelled) return;
        if (!inv.ok) {
          setError(inv.reason ?? "Convite não encontrado.");
          setStatus("invalid");
          return;
        }
        setInvite({ company_name: inv.company_name, invited_email: inv.invited_email });
        setStatus("form");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erro ao verificar o convite");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, invitePublic]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    if (password !== password2) {
      toast.error("As senhas não conferem");
      return;
    }
    setStatus("creating");
    try {
      const res = await complete({ data: { token, full_name: fullName.trim(), password } });
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: res.email,
        password,
      });
      if (signError) throw new Error(signError.message);
      toast.success("Empresa ativada! Bem-vindo.");
      setStatus("done");
      setTimeout(() => navigate({ to: "/crm" }), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao ativar a empresa");
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <img src={lexiaLogo} alt="LexIA" className="h-20 w-20 object-contain mb-6" />
      <Card className="w-full max-w-md border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5 text-accent" />
            Ativação de empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status === "checking" && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando convite...
            </div>
          )}

          {(status === "invalid" || status === "error") && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>
                Voltar ao início
              </Button>
            </div>
          )}

          {status === "done" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle className="h-10 w-10 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Tudo certo! Abrindo seu painel...</p>
            </div>
          )}

          {(status === "form" || status === "creating") && invite && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                <p className="text-sm font-medium text-foreground">{invite.company_name}</p>
                <p className="text-xs text-muted-foreground">{invite.invited_email}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="full_name">Seu nome</Label>
                <Input
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Nome completo"
                  required
                  minLength={2}
                  disabled={status === "creating"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="pl-9"
                    required
                    minLength={8}
                    disabled={status === "creating"}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password2">Confirmar senha</Label>
                <Input
                  id="password2"
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Repita a senha"
                  required
                  minLength={8}
                  disabled={status === "creating"}
                />
              </div>
              <Button type="submit" className="w-full" disabled={status === "creating"}>
                {status === "creating" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Ativando...
                  </>
                ) : (
                  "Ativar empresa"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
