import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, ShieldAlert } from "lucide-react";

const LION_IMG = "https://COCONUDIMUDIAL.b-cdn.net/AGENCIA%20FACILITY/INICAL%20LEAO.jpg";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "CRM Alxeia-AI — Recuperar senha" },
      { name: "description", content: "Defina uma nova senha." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  // "loading" → aguardando troca do código de recuperação; "ok" → sessão válida; "invalid" → link expirado
  const [status, setStatus] = useState<"loading" | "ok" | "invalid">("loading");

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setStatus("ok");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setStatus("ok");
    });

    const timer = setTimeout(() => {
      if (!cancelled) setStatus((s) => (s === "loading" ? "invalid" : s));
    }, 5000);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("As senhas não coincidem.");
    if (status !== "ok") return toast.error("Link inválido ou expirado. Peça um novo.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Senha alterada com sucesso! Faça login.");
    navigate({ to: "/auth", search: { mode: "signin" } });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#0a0a0a] text-white lg:flex-row">
      <div className="relative hidden overflow-hidden lg:flex lg:w-1/2 lg:min-h-dvh">
        <img src={LION_IMG} alt="Lion" className="h-full w-full object-cover object-center" />
      </div>

      <main className="flex w-full flex-col items-center justify-center px-6 py-12 sm:px-10 lg:w-1/2 lg:min-h-dvh">
        <div className="w-full max-w-sm">
          <h2 className="mb-1 font-display text-sm font-medium tracking-wide text-emerald-400 uppercase">
            CRM Alxeia-AI
          </h2>

          {status === "loading" && (
            <p className="mt-4 text-sm text-neutral-400">Validando link de recuperação...</p>
          )}

          {status === "invalid" && (
            <div className="mt-4 space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                <p className="text-sm text-neutral-300">
                  Este link é inválido ou expirado. Volte à página de login e peça um novo link
                  de recuperação.
                </p>
              </div>
              <Link
                to="/auth"
                search={{ mode: "signin" }}
                className="block h-12 rounded-lg bg-emerald-400 text-center text-sm font-semibold leading-[3rem] text-black hover:bg-emerald-500 transition-colors"
              >
                Voltar para o login
              </Link>
            </div>
          )}

          {status === "ok" && (
            <>
              <h1 className="mb-2 font-display text-3xl font-bold text-white">Nova senha</h1>
              <p className="mb-8 text-sm text-neutral-400">Defina uma senha para sua conta.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                  <Input
                    id="new-password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="Nova senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
                  />
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="Confirmar nova senha"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="h-12 rounded-lg border border-neutral-700 bg-neutral-900 pl-10 text-white placeholder-neutral-500 focus:border-emerald-500 focus:ring-emerald-500"
                  />
                </div>
                <Button
                  type="submit"
                  className="h-12 w-full rounded-lg bg-emerald-400 text-sm font-semibold text-black hover:bg-emerald-500 transition-colors"
                  disabled={loading}
                >
                  {loading ? "Salvando..." : "Salvar nova senha"}
                </Button>
              </form>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
