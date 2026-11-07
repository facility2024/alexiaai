import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock, Eye, EyeOff, ArrowRight, ChartNoAxesCombined } from "lucide-react";

const BG_IMG =
  "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/Login%20CRM%20ALXELAI%20com%20Dashboard%20Neon.png";

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
  const [showPassword, setShowPassword] = useState(false);

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

  const inputClass =
    "h-[69px] rounded-xl border border-[#1A3F77] bg-[#061838] pl-12 pr-4 text-base text-white placeholder:text-[#5B6B8C] shadow-none focus-visible:border-[#2B8FFF] focus-visible:ring-0";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#010618] text-white">
      {/* Caixa com aspecto da imagem — garante alinhamento do card sobre o card da arte */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ width: "min(100%, calc(100dvh * 1672 / 941))", aspectRatio: "1672 / 941" }}
      >
        <img
          src={BG_IMG}
          alt=""
          aria-hidden
          className="hidden h-full w-full object-cover lg:block"
        />

        {/* Card funcional — cobre o card embutido na imagem no desktop */}
        <div className="absolute left-1/2 top-1/2 flex w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 lg:left-[63.5%] lg:top-[11.8%] lg:h-[76.4%] lg:w-[35%] lg:translate-x-0 lg:translate-y-0">
          <div className="m-auto flex w-full max-h-[94dvh] flex-col overflow-y-auto rounded-[28px] border border-[#1E70E0]/60 border-t-[#5CE1DF]/40 bg-[linear-gradient(180deg,#041233_0%,#010A22_100%)] p-8 shadow-[0_0_60px_rgba(23,80,171,0.5)] lg:h-full lg:max-h-none lg:px-11 lg:py-9">
            <div className="m-auto w-full text-center">
              {/* Logo */}
              <div className="mb-7 flex items-center justify-center gap-3">
                <ChartNoAxesCombined className="h-11 w-11 text-[#2E8FFF]" strokeWidth={2.25} />
                <div className="text-left leading-none">
                  <div className="text-sm font-bold tracking-[0.18em] text-white">CRM</div>
                  <div className="text-[27px] font-extrabold tracking-wide text-white">
                    ALXELAI
                  </div>
                </div>
              </div>

              <h1 className="text-[40px] font-extrabold leading-tight text-white">
                {isSignup ? "Criar conta" : "Bem-vindo!"}
              </h1>
              <p className="mx-auto mb-7 mt-2 max-w-[24rem] text-base leading-snug text-[#A9ADB6]">
                {isSignup
                  ? "Preencha seus dados para começar."
                  : "Disciplina e velocidade em cada transação, faça login."}
              </p>

              <form onSubmit={isSignup ? handleSignUp : handleSignIn} className="space-y-4 text-left">
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7A8AAC]" />
                  <Input
                    id="auth-email"
                    type="email"
                    required
                    placeholder="E-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7A8AAC]" />
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    placeholder="Senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass + " pr-12"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8FA3C4] hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>

                {isSignup && (
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7A8AAC]" />
                    <Input
                      id="auth-confirm"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={6}
                      placeholder="Confirmar senha"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className={inputClass + " pr-12"}
                    />
                  </div>
                )}

                {!isSignup && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={loading}
                      className="text-sm font-medium text-[#0BAEF5] hover:underline disabled:opacity-50"
                    >
                      Esqueceu sua senha?
                    </button>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-[69px] w-full gap-3 rounded-[26px] bg-[linear-gradient(90deg,#0099FD_0%,#034AFE_50%,#0088FD_100%)] text-[17px] font-semibold text-white shadow-[0_10px_28px_rgba(3,74,254,0.35)] hover:brightness-110"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#034AFE]">
                    <ArrowRight className="h-5 w-5" />
                  </span>
                  {loading ? "Aguarde..." : isSignup ? "Criar conta" : "Entrar"}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-[#8D9AB8]">
                {isSignup ? "Já tem uma conta? " : "Novo na plataforma? "}
                <Link
                  to="/auth"
                  search={{ mode: isSignup ? "signin" : "signup" }}
                  className="font-medium text-[#0B9DF2] underline underline-offset-2 hover:text-[#38BDF8]"
                >
                  {isSignup ? "Entrar" : "Crie sua conta"}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
