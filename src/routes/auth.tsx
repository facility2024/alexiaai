import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import lexiaLogo from "@/assets/lexia-logo.png";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


type Search = { mode?: "signin" | "signup" };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: s.mode === "signup" ? "signup" : "signin",
  }),
  head: () => ({
    meta: [
      { title: "Entrar — LexIA" },
      { name: "description", content: "Acesse o painel LexIA do seu escritório." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
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
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-sidebar via-background to-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(600px circle at 20% 20%, oklch(0.78 0.13 82 / 0.10), transparent 60%), radial-gradient(500px circle at 80% 80%, oklch(0.78 0.13 82 / 0.06), transparent 60%)",
          }}
        />
        <Link to="/" className="relative flex items-center gap-3 animate-fade-up">
          <img src={lexiaLogo} alt="LexIA" width={200} height={200} className="h-[200px] w-[200px] object-contain" />
          <div className="leading-tight">
            <div className="font-display text-2xl tracking-tight text-foreground">LexIA</div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Escritório Virtual
            </div>
          </div>
        </Link>

        <div className="relative space-y-6 animate-fade-up" style={{ animationDelay: "120ms" }}>
          <span className="text-[10px] uppercase tracking-[0.28em] text-accent">
            Painel · Acesso
          </span>
          <h2 className="font-display text-6xl leading-[0.95] text-foreground">
            Precisão editorial<br />
            para <span className="italic text-accent">a advocacia</span> moderna.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Atendimento automatizado, triagem inteligente e produção documental — orquestrados em
            uma interface pensada como um manuscrito raro.
          </p>
          <div className="divider-gold max-w-[180px]" />
        </div>

        <p className="relative text-[10px] uppercase tracking-[0.24em] text-muted-foreground/60 animate-fade-up" style={{ animationDelay: "240ms" }}>
          © LexIA · Criado pela FacilitySoftware
        </p>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-md animate-fade-up" style={{ animationDelay: "80ms" }}>
          <Link to="/" className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <img src={lexiaLogo} alt="LexIA" className="h-9 w-9 object-contain" />
            <span className="font-display text-xl">LexIA</span>
          </Link>

          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 backdrop-blur-sm shadow-elegant">
            <div className="mb-6 space-y-2">
              <span className="text-[10px] uppercase tracking-[0.24em] text-accent">
                Bem-vindo
              </span>
              <h1 className="font-display text-3xl leading-tight text-foreground">
                Entre no meu escritório virtual.
              </h1>
              <p className="text-xs text-muted-foreground">
                Área restrita ao administrador. Usuários convidados devem acessar pelo link de convite recebido.
              </p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-4 pt-2">
              <div className="space-y-1.5 animate-fade-up" style={{ animationDelay: "40ms" }}>
                <Label htmlFor="signin-email" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">E-mail</Label>
                <Input id="signin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-background/60" />
              </div>
              <div className="space-y-1.5 animate-fade-up" style={{ animationDelay: "80ms" }}>
                <Label htmlFor="signin-password" className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Senha</Label>
                <Input id="signin-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-background/60" />
              </div>
              <Button type="submit" className="w-full bg-gold-gradient text-primary-foreground shadow-glow hover:opacity-90 transition-all animate-fade-up" style={{ animationDelay: "120ms" }} disabled={loading}>
                {loading ? "Entrando..." : "Entrar"}
              </Button>
              <p className="pt-2 text-center text-[11px] text-muted-foreground">
                Recebeu um convite? Acesse pelo link enviado por e-mail.
              </p>
            </form>

          </div>
        </div>
      </main>
    </div>
  );
}
