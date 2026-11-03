import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock } from "lucide-react";

const LION_IMG = "https://COCONUDIMUDIAL.b-cdn.net/AGENCIA%20FACILITY/INICAL%20LEAO.jpg";

type Search = { mode?: "signin" | "signup" };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: s.mode === "signup" ? "signup" : "signin",
  }),
  head: () => ({
    meta: [
      { title: "CRM Alxeia-AI" },
      { name: "description", content: "Acesse o painel CRM Alxeia-AI." },
    ],
  }),
  component: AuthPage,
});

function friendlyAuthError(message: string): string {
  if (message.includes("email_provider_disabled")) {
    return "Cadastro/login por e-mail está temporariamente desativado no projeto.";
  }
  if (message.includes("email_not_confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }
  if (message.includes("invalid_credentials")) {
    return "E-mail ou senha incorretos.";
  }
  return message;
}

function AuthPage() {
  const navigate = useNavigate();
  const { mode } = Route.useSearch();
  const isSignup = mode === "signup";
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/dashboard" });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("As senhas não coincidem.");
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    if (data.session) {
      toast.success("Conta criada! Bem-vindo.");
      navigate({ to: "/dashboard" });
    } else {
      toast.success("Conta criada! Confirme seu e-mail para entrar.");
      navigate({ to: "/auth", search: { mode: "signin" } });
    }
  }

  async function handleForgotPassword() {
    if (!email) return toast.error("Informe seu e-mail no campo acima primeiro.");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) return toast.error(friendlyAuthError(error.message));
    toast.success("Se existir uma conta, enviamos um link de recuperação para o seu e-mail.");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a] text-white lg:flex-row">
      {/* Left panel — lion image */}
      <div className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:min-h-dvh">
        <img src={LION_IMG} alt="Lion" className="h-full w-full object-cover object-center" />
      </div>

      {/* Right panel — login/cadastro form */}
      <main className="flex w-full flex-col items-center justify-center px-6 py-12 sm:px-10 lg:w-1/2 lg:min-h-dvh">
        <div className="w-full max-w-sm">
          <h2 className="mb-1 font-display text-sm font-medium tracking-wide text-emerald-400 uppercase">
            CRM Alxeia-AI
          </h2>
          <h1 className="mb-2 font-display text-3xl font-bold text-white">
            {isSignup ? "Criar conta" : "Bem vindo!"}
          </h1>
          <p className="mb-8 text-sm text-neutral-400">
            {isSignup
              ? "Preencha seus dados para começar."
              : "Discricão e velocidade em cada transação, faça login."}
          </p>

          <form onSubmit={isSignup ? handleSignUp : handleSignIn} className="space-y-4">
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                id="auth-email"
                type="email"
                required
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                id="auth-password"
                type="password"
                required
                minLength={6}
                placeholder="Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>
            {isSignup && (
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                <Input
                  id="auth-confirm"
                  type="password"
                  required
                  minLength={6}
                  placeholder="Confirmar senha"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
                />
              </div>
            )}

            {!isSignup && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="text-xs text-emerald-400 hover:underline disabled:opacity-50"
                >
                  Esqueceu sua senha?
                </button>
              </div>
            )}

            <Button
              type="submit"
              className="h-12 w-full rounded-lg bg-emerald-400 text-sm font-semibold text-black hover:bg-emerald-500 transition-colors"
              disabled={loading}
            >
              {loading ? "Aguarde..." : isSignup ? "Criar conta" : "Entrar"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-neutral-500">
            {isSignup ? "Já tem uma conta? " : "Novo na plataforma? "}
            <Link
              to="/auth"
              search={{ mode: isSignup ? "signin" : "signup" }}
              className="text-emerald-400 hover:underline"
            >
              {isSignup ? "Entrar" : "Crie sua conta"}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
