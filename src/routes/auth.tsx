import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import lionImg from "@/assets/lion.png";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Lock } from "lucide-react";

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

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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
    if (error) return toast.error(error.message);
    toast.success("Bem-vindo de volta!");
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a] text-white lg:flex-row">
      {/* Left panel — lion image + tagline */}
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden lg:min-h-screen">
        <img
          src={lionImg}
          alt="Lion"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-80"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <p className="relative z-10 mt-auto mb-16 px-6 text-center font-display text-xl font-semibold tracking-widest text-white/90 uppercase sm:text-2xl">
          Seja líder no seu seguimento
        </p>
      </div>

      {/* Right panel — login form */}
      <main className="flex flex-col items-center justify-center px-6 py-12 sm:px-10 lg:w-[480px] lg:min-h-screen">
        <div className="w-full max-w-sm">
          <h2 className="mb-1 font-display text-sm font-medium tracking-wide text-emerald-400 uppercase">
            CRM Alxeia-AI
          </h2>

          <h1 className="mb-2 font-display text-3xl font-bold text-white">Bem vindo!</h1>
          <p className="mb-8 text-sm text-neutral-400">
            Discricão e velocidade em cada transação, faça login.
          </p>

          <form onSubmit={handleSignIn} className="space-y-4">
            {/* Email */}
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                id="signin-email"
                type="email"
                required
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
              <Input
                id="signin-password"
                type="password"
                required
                placeholder="Senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
              />
            </div>

            <div className="text-right">
              <button type="button" className="text-xs text-emerald-400 hover:underline">
                Esqueceu sua senha?
              </button>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="h-12 w-full rounded-lg bg-emerald-400 text-sm font-semibold text-black hover:bg-emerald-500 transition-colors"
              disabled={loading}
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-neutral-500">
            Novo na plataforma?{" "}
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="text-emerald-400 hover:underline"
            >
              Crie sua conta
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
