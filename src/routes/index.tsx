import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import "@/styles/sphere.css";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LexIA — Atendimento Jurídico com IA Multiagentes" },
      {
        name: "description",
        content:
          "Plataforma de IA para escritórios de advocacia: triagem, análise preliminar, coleta documental e agendamento automatizados por agentes especializados.",
      },
      { property: "og:title", content: "LexIA — Atendimento Jurídico com IA Multiagentes" },
      {
        property: "og:description",
        content:
          "Plataforma de IA para escritórios de advocacia: triagem, análise preliminar, coleta documental e agendamento automatizados por agentes especializados.",
      },
    ],
  }),
  component: Landing,
});

const LOGO_URL =
  "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/ChatGPT%20Image%209%20de%20jul.%20de%202026%2C%2005_08_29.png";

const AGENTS = [
  { name: "Bruno", url: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/BRUNO.jpg" },
  { name: "Marina", url: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/MARINA.jpg" },
  { name: "Rafael", url: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/RAFAEL.jpg" },
  { name: "Sofia", url: "https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/SOFIA.jpg" },
  {
    name: "Eduardo",
    url: "https://t3.ftcdn.net/jpg/02/83/12/96/240_F_283129653_iDQrlBEDpYWbKyDIUotS0Dy8ngUwQBaz.jpg",
  },
];

// 12 planos × 36 raios com dots posicionados no raio R.
const SPOKES = 36;
const PLANES = 12;
const HALF = SPOKES / 2;

function Sphere() {
  return (
    <div className="sphere-main">
      <div className="sphere-wrapper">
        {Array.from({ length: PLANES }).map((_, p) => (
          <div
            key={p}
            className="sphere-plane"
            style={{ transform: `rotateY(${(180 / PLANES) * p}deg)` }}
          >
            {Array.from({ length: SPOKES }).map((_, s) => {
              // Delay espelhado: spokes i e (SPOKES - i) compartilham o mesmo delay.
              const mirror = s <= HALF ? s : SPOKES - s;
              const delay = mirror / HALF;
              // Cor: base #f95 (hsl 28,100%,67%) girando o hue conforme o LESS spin().
              const hue = (28 + (360 / SPOKES) * mirror) % 360;
              return (
                <div
                  key={s}
                  className="sphere-spoke"
                  style={{ transform: `rotateZ(${(360 / SPOKES) * s}deg)` }}
                >
                  <div
                    className="sphere-dot"
                    style={{
                      animationDelay: `${delay}s`,
                      background: `hsl(${hue}, 100%, 67%)`,
                    }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}


function Landing() {
  const [showAuth, setShowAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

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
    <div
      className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2"
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {/* Lado esquerdo */}
      <section
        className="flex flex-col justify-center px-12 py-12 text-white"
        style={{
          background:
            "linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #6d28d9 100%)",
        }}
      >
        <img
          src={LOGO_URL}
          alt="LexIA"
          className="mx-auto mb-8 h-48 w-auto object-contain"
        />
        <h1 className="text-3xl font-semibold leading-tight tracking-tight">
          Atendimento jurídico automatizado, do primeiro contato à reunião.
        </h1>
        <p className="mt-6 text-base leading-relaxed opacity-80">
          Cinco agentes especializados trabalham em sequência — captação, análise
          preliminar e coleta documental — entregando ao advogado um caso pronto
          para reunião.
        </p>
        <div className="mt-8 flex items-start gap-5" style={{ perspective: "600px" }}>
          {AGENTS.map((a, i) => (
            <div key={a.name} className="flex flex-col items-center">
              <img
                src={a.url}
                alt={a.name}
                className="avatar-wave h-16 w-16 rounded-full object-cover ring-2 ring-white/30"
                style={{ animationDelay: `${i * 0.25}s` }}
              />
              <span className="mt-2 text-sm font-medium opacity-90">
                {a.name}
              </span>
            </div>
          ))}
        </div>
      </section>


      {/* Lado direito */}
      <section
        className="relative flex flex-col items-center justify-center overflow-hidden"
        style={{ background: "#0a0a0a" }}
      >
        <img
          src="https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/2030%20(1).jpg"
          alt=""
          aria-hidden="true"
          className="kenburns-frontal absolute inset-0 h-full w-full object-cover opacity-60"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.75) 100%)",
          }}
        />
        {!showAuth ? (
          <div className="relative z-10 flex h-full w-full flex-col items-center justify-center">
            <Sphere />
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              className="absolute bottom-16 rounded-full px-8 py-3 text-base font-semibold text-white shadow-lg transition-transform hover:scale-105"
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
              }}
            >
              Acessar agora
            </button>
          </div>
        ) : (
          <div className="relative z-10 w-full max-w-sm px-8 text-white">
            <p className="text-xs uppercase tracking-[0.28em]" style={{ color: "#a855f7" }}>
              Bem-vindo
            </p>
            <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-tight">
              Entre no meu escritório virtual.
            </h2>
            <p className="mt-3 text-sm opacity-70">
              Área restrita ao administrador. Usuários convidados devem acessar
              pelo link de convite recebido.
            </p>
            <form onSubmit={handleSignIn} className="mt-6 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-[0.2em] opacity-80">
                  E-mail
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.2em] opacity-80">
                  Senha
                </label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md py-2.5 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
                }}
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>
              <p className="pt-2 text-center text-xs opacity-70">
                Recebeu um convite? Acesse pelo link enviado por e-mail.
              </p>
              <button
                type="button"
                onClick={() => setShowAuth(false)}
                className="mx-auto block text-xs opacity-60 hover:opacity-100"
              >
                ← Voltar
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

