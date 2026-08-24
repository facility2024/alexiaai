import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Loader2, Clock, CheckCircle, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  acceptInvite,
  completeApprovedAccess,
  findAccessRequestByToken,
  getAccessRequestStatus,
  getMyOrgContext,
  getInvitePublic,
  startInviteAccess,
} from "@/lib/admin.functions";
import lexiaLogo from "@/assets/lexia-logo.png";

export const Route = createFileRoute("/convite/$token")({
  head: () => ({ meta: [{ title: "Aceitar convite — LexIA" }] }),
  component: InviteAcceptPage,
});

type Status =
  | "checking"
  | "invalid"
  | "form"
  | "sending"
  | "accepting"
  | "pending"
  | "approved"
  | "creating"
  | "done"
  | "error";

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const accept = useServerFn(acceptInvite);
  const ctxFn = useServerFn(getMyOrgContext);
  const invitePublic = useServerFn(getInvitePublic);
  const startAccess = useServerFn(startInviteAccess);
  const requestStatus = useServerFn(getAccessRequestStatus);
  const findRequest = useServerFn(findAccessRequestByToken);
  const completeAccess = useServerFn(completeApprovedAccess);

  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string>("");
  const [invite, setInvite] = useState<{ email: string; role: string; inviter_name: string } | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ full_name?: string | null; email?: string | null } | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(120);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Se já está logado, aceita direto.
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;

      if (userData.user) {
        setStatus("accepting");
        try {
          const existingCtx = await ctxFn();
          if (cancelled) return;
          setProfile(existingCtx.profile);
          if (!existingCtx.isOwner) {
            if (existingCtx.active) {
              toast.success("Acesso liberado!");
              setStatus("done");
              setTimeout(() => navigate({ to: "/crm" }), 800);
            } else {
              setStatus("pending");
            }
            return;
          }

          const res = await accept({ data: { token } });
          if (cancelled) return;
          const ctx = await ctxFn();
          setProfile(ctx.profile);
          if (res.pending) {
            setStatus("pending");
          } else {
            toast.success("Convite aceito!");
            setStatus("done");
            setTimeout(() => navigate({ to: "/crm" }), 800);
          }
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "Erro ao aceitar convite");
          setStatus("error");
        }
        return;
      }

      // Não logado: busca dados do convite para exibir formulário.
      try {
        const inv = await invitePublic({ data: { token } });
        if (cancelled) return;
        if (!inv.valid) {
          setError(
            inv.reason === "expired"
              ? "Este convite expirou."
              : inv.reason === "used"
                ? "Este convite já foi utilizado."
                : inv.reason === "revoked"
                  ? "Este convite foi revogado."
                  : "Convite não encontrado.",
          );
          setStatus("invalid");
          return;
        }
        setInvite({ email: inv.email, role: inv.role, inviter_name: inv.inviter_name });
        setEmail(inv.email);
        sessionStorage.setItem("pending_invite", token);

        // Se já existe uma solicitação para este token/e-mail, reabre no estado correto.
        try {
          const existing = await findRequest({
            data: { token, email: inv.email || null },
          });
          if (!cancelled && existing.found) {
            setRequestId(existing.id);
            setFullName((current) => current || existing.full_name || "");
            setEmail((current) => current || existing.email || "");
            if (existing.rejected) {
              setError("Sua solicitação foi rejeitada pelo administrador.");
              setStatus("error");
              return;
            }
            if (existing.approved) {
              setStatus("approved");
              return;
            }
            setStatus("pending");
            return;
          }
        } catch {
          // Sem solicitação anterior — segue com o formulário padrão.
        }

        setStatus("form");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Erro ao carregar convite");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, accept, navigate, ctxFn, invitePublic, findRequest]);

  useEffect(() => {
    if (status !== "pending") {
      setWaitSeconds(120);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setWaitSeconds(Math.max(0, 120 - elapsed));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== "pending") return;
    let cancelled = false;
    const checkAccess = async () => {
      try {
        if (requestId) {
          const req = await requestStatus({ data: { id: requestId } });
          if (cancelled) return;
          if (req.found && req.rejected) {
            setError("Sua solicitação foi rejeitada pelo administrador.");
            setStatus("error");
            return;
          }
          if (req.found && req.approved) {
            setFullName((current) => current || req.full_name || "");
            setEmail((current) => current || req.email || "");
            setStatus("approved");
            toast.success("Acesso aprovado! Crie sua senha para entrar.");
            return;
          }
          return;
        }

        const ctx = await ctxFn();
        if (cancelled) return;
        setProfile(ctx.profile);
        if (!ctx.isOwner && ctx.active) {
          toast.success("Acesso liberado pelo administrador!");
          setStatus("done");
          setTimeout(() => navigate({ to: "/crm" }), 800);
        }
      } catch {
        // Mantém a tela de espera enquanto a sessão termina de sincronizar.
      }
    };
    void checkAccess();
    const interval = window.setInterval(checkAccess, 4000);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 120000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [status, ctxFn, navigate, requestId, requestStatus]);

  const handleRequestAccess = async () => {
    if (!fullName.trim()) {
      toast.error("Informe seu nome");
      return;
    }
    const emailTrim = email.trim();
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      toast.error("Informe um e-mail válido");
      return;
    }
    setStatus("sending");
    try {
      const res = await startAccess({
        data: {
          token,
          full_name: fullName.trim(),
          email: email.trim() || null,
        },
      });
      setRequestId(res.request_id);
      if (res.rejected) {
        setError("Sua solicitação foi rejeitada pelo administrador.");
        setStatus("error");
        return;
      }
      if (res.approved) {
        toast.success("Acesso aprovado! Crie sua senha para entrar.");
        setStatus("approved");
        return;
      }
      toast.success("Solicitação enviada! Aguarde a liberação do administrador.");
      setStatus("pending");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao registrar solicitação");
      setStatus("error");
    }
  };

  const handleCompleteApprovedAccess = async () => {
    if (!requestId) {
      toast.error("Solicitação não encontrada. Abra o link do convite novamente.");
      return;
    }
    if (password.length < 8) {
      toast.error("A senha precisa ter pelo menos 8 caracteres");
      return;
    }
    setStatus("creating");
    try {
      let loginEmail = email.trim().toLowerCase();
      try {
        const result = await completeAccess({ data: { id: requestId, password } });
        loginEmail = result.email;
      } catch (serverError) {
        const message = serverError instanceof Error ? serverError.message : String(serverError);
        if (!message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
          throw serverError;
        }
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (signInError) {
        const { error: signUpError } = await supabase.auth.signUp({
          email: loginEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName || loginEmail },
          },
        });
        if (signUpError) throw signUpError;

        const { error: retrySignInError } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password,
        });
        if (retrySignInError) throw retrySignInError;
      }

      toast.success("Acesso liberado! Entrando no sistema...");
      setStatus("done");
      setTimeout(() => navigate({ to: "/crm" }), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao finalizar cadastro");
      setStatus("approved");
      toast.error(e instanceof Error ? e.message : "Erro ao finalizar cadastro");
    }
  };

  const initials = (profile?.full_name || profile?.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const displayName = profile?.full_name || profile?.email || "Usuário";
  const progress = Math.min(100, Math.max(0, ((120 - waitSeconds) / 120) * 100));

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <img src={lexiaLogo} alt="LexIA" className="h-20 w-20 object-contain mb-6" />
      <Card className="w-full max-w-md border-border/60">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-lg">
            <UserPlus className="h-5 w-5 text-accent" /> Convite para equipe
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "checking" && (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando convite...
            </p>
          )}

          {status === "form" && invite && (
            <>
              <p className="text-sm text-center">
                Você foi convidado por <strong className="text-accent">{invite.inviter_name}</strong> para
                entrar como <strong>{invite.role}</strong>.
              </p>
              <div className="space-y-2">
                <Label className="text-xs">Seu nome</Label>
                <Input
                  autoFocus
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Como você quer ser chamado"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Seu e-mail</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  disabled={!!invite.email}
                />
                <p className="text-[11px] text-muted-foreground">
                  Você usará este e-mail para se cadastrar em /auth após a aprovação do administrador.
                </p>
              </div>
              <Button className="w-full" onClick={handleRequestAccess}>
                Solicitar acesso
              </Button>
            </>
          )}

          {status === "sending" && (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
              <Loader2 className="h-4 w-4 animate-spin" /> Registrando solicitação no painel admin...
            </p>
          )}

          {status === "accepting" && (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
              <Loader2 className="h-4 w-4 animate-spin" /> Aplicando permissões...
            </p>
          )}

          {status === "pending" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <Avatar className="h-16 w-16 border-2 border-accent">
                <AvatarFallback className="bg-accent/20 text-accent text-xl">{initials}</AvatarFallback>
              </Avatar>
              <div className="text-center">
                <p className="text-accent text-lg font-display italic">Seja bem-vindo, {displayName}!</p>
                <p className="text-xs text-muted-foreground mt-1">Área de usuário do CRM LexIA</p>
              </div>
              <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 mt-2">
                <Clock className="h-5 w-5 text-yellow-500" />
                <p className="text-sm text-yellow-500/90">
                  Aguarde o administrador liberar seu acesso pelo painel admin.
                </p>
              </div>
              <div className="w-full space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-1000"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  {waitSeconds > 0
                    ? `Verificando liberação automaticamente por até ${waitSeconds}s.`
                    : "Tempo de espera concluído. Se o admin ativar depois, entre novamente no sistema."}
                </p>
              </div>
            </div>
          )}

          {status === "approved" && (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center gap-3 text-center">
                <CheckCircle className="h-9 w-9 text-emerald-500" />
                <div>
                  <p className="font-display text-xl italic text-accent">Acesso aprovado</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {email} já foi liberado. Defina sua senha para entrar agora.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Senha de acesso</Label>
                <Input
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <Button className="w-full" onClick={handleCompleteApprovedAccess}>
                <Lock className="h-4 w-4 mr-2" /> Liberar e entrar
              </Button>
            </div>
          )}

          {status === "creating" && (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2 justify-center w-full">
              <Loader2 className="h-4 w-4 animate-spin" /> Finalizando liberação...
            </p>
          )}

          {status === "done" && (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="h-8 w-8 text-emerald-500" />
              <p className="text-sm text-emerald-500">Pronto! Redirecionando para o CRM...</p>
            </div>
          )}

          {(status === "invalid" || status === "error") && (
            <>
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button variant="outline" className="w-full" onClick={() => navigate({ to: "/" })}>
                Voltar
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
