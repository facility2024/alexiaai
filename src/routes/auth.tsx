import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ChartNoAxesCombined,
  Zap,
  ShieldCheck,
  House,
  Users,
  ShoppingCart,
  Settings,
  Bell,
  CircleQuestionMark,
  TrendingUp,
} from "lucide-react";
import "./auth.css";

type Search = { mode?: "signin" | "signup" };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: s.mode === "signup" ? "signup" : "signin",
  }),
  head: () => ({
    meta: [{ title: "Lexia-IA" }, { name: "description", content: "Acesse o painel Lexia-IA." }],
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

function LexiaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 56" className={className} aria-hidden>
      <defs>
        <linearGradient id="lxm-b" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#1565d8" />
          <stop offset="1" stopColor="#5ec0ff" />
        </linearGradient>
      </defs>
      <g fill="url(#lxm-b)">
        <rect x="1" y="36" width="11" height="18" rx="2.5" />
        <rect x="16" y="26" width="11" height="28" rx="2.5" />
        <rect x="31" y="15" width="11" height="39" rx="2.5" />
        <rect x="46" y="4" width="11" height="50" rx="2.5" />
      </g>
      <polyline
        points="3,45 20,32 33,38 57,9"
        fill="none"
        stroke="#eaf6ff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="43,9 58,9 58,24"
        fill="none"
        stroke="#eaf6ff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Dashboard() {
  const pts = [
    [42, 96],
    [90, 80],
    [138, 86],
    [186, 62],
    [234, 68],
    [282, 42],
    [322, 22],
  ];
  const years = ["2024", "2025", "2026", "2027", "2028", "2029", "2030"];
  return (
    <div className="dash">
      <div className="dash-top">
        <div className="dash-brand">
          <LexiaMark />
          <span>
            Lexia<em>-IA</em>
          </span>
        </div>
        <div className="dash-dots">
          <span>
            <Settings />
          </span>
          <span>
            <CircleQuestionMark />
          </span>
          <span>
            <Bell />
          </span>
        </div>
      </div>
      <div className="dash-body">
        <nav className="dash-side">
          <div className="item active">
            <House /> Dashboard
          </div>
          <div className="item">
            <Users /> Clientes
          </div>
          <div className="item">
            <ShoppingCart /> Vendas
          </div>
          <div className="item">
            <ChartNoAxesCombined /> Relatórios
          </div>
          <div className="item">
            <Settings /> Configurações
          </div>
        </nav>
        <main className="dash-main">
          <div className="kpis">
            <div className="kpi">
              <Users />
              <div>
                <div className="kpi-label">Clientes</div>
                <div className="kpi-value">12.580</div>
              </div>
            </div>
            <div className="kpi">
              <ShoppingCart />
              <div>
                <div className="kpi-label">Vendas</div>
                <div className="kpi-value">R$ 87.450</div>
              </div>
            </div>
            <div className="kpi kpi-green">
              <TrendingUp />
              <div>
                <div className="kpi-label">Crescimento</div>
                <div className="kpi-value">+24%</div>
              </div>
            </div>
          </div>
          <div className="chart">
            <svg viewBox="0 0 340 130">
              <defs>
                <linearGradient id="lx-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#2f9bff" />
                  <stop offset="1" stopColor="#7dd7ff" />
                </linearGradient>
              </defs>
              {[18, 46, 74, 102].map((y) => (
                <g key={y}>
                  <line
                    x1="30"
                    x2="332"
                    y1={y}
                    y2={y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="3 4"
                  />
                  <text x="24" y={y + 3} textAnchor="end" fontSize="9" fill="#7f97c4">
                    {80 - ((y - 18) / 28) * 20}
                  </text>
                </g>
              ))}
              <polyline
                points={pts.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="url(#lx-line)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ filter: "drop-shadow(0 0 4px rgba(80,200,255,0.9))" }}
              />
              {pts.map(([x, y]) => (
                <circle
                  key={x}
                  cx={x}
                  cy={y}
                  r="3.4"
                  fill="#9be4ff"
                  style={{ filter: "drop-shadow(0 0 4px rgba(120,220,255,0.95))" }}
                />
              ))}
              {years.map((yr, i) => (
                <text
                  key={yr}
                  x={pts[i][0]}
                  y="124"
                  textAnchor="middle"
                  fontSize="9"
                  fill="#7f97c4"
                >
                  {yr}
                </text>
              ))}
            </svg>
          </div>
        </main>
      </div>
    </div>
  );
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

  return (
    <div className="lexia-page">
      {/* FUNDO — 100% DIVs/CSS */}
      <div className="lexia-bg" aria-hidden>
        <div className="lexia-glow lexia-glow-1" />
        <div className="lexia-glow lexia-glow-2" />
        <div className="lexia-glow lexia-glow-3" />
        <div className="lexia-tri lexia-tri-tl" />
        <div className="lexia-tri lexia-tri-tl2" />
        <div className="lexia-stripe-tl" />
        <div className="lexia-tri lexia-tri-tr" />
        <div className="lexia-band-l" />
        <div className="lexia-neon lexia-neon-1" />
        <div className="lexia-neon lexia-neon-2" />
        <div className="lexia-neon-v" />
        <div className="lexia-ring lexia-ring-1" />
        <div className="lexia-ring lexia-ring-2" />
        <div className="lexia-win" style={{ left: "44%" }} />
        <div className="lexia-win" style={{ left: "52%" }} />
        <div className="lexia-tri lexia-tri-bl" />
        <div className="lexia-desk" />
      </div>

      <div className="lexia-shell">
        {/* LADO ESQUERDO */}
        <section className="lexia-presentation">
          <div className="lexia-copy">
            <div>
              <div className="lexia-logo">
                <LexiaMark />
                <div>
                  <div className="lexia-logo-name">
                    Lexia<em>-IA</em>
                  </div>
                  <div className="lexia-logo-tag">GESTÃO INTELIGENTE DE CLIENTES</div>
                </div>
              </div>

              <div className="lexia-mid">
                <h1 className="lexia-h1">
                  Bem-<span>vindo!</span>
                </h1>
                <h2 className="lexia-h2">
                  Disciplina e velocidade em cada transação, <span>faça login.</span>
                </h2>
                <ul className="lexia-benefits">
                  <li>
                    <ChartNoAxesCombined />
                    <span>Gerencie seus clientes com eficiência</span>
                  </li>
                  <li>
                    <Zap />
                    <span>Acompanhe resultados em tempo real</span>
                  </li>
                  <li>
                    <ShieldCheck />
                    <span>Segurança em primeiro lugar</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="lexia-brand">
              <div className="lexia-brand-row">
                <i />
                <span>CRM LEXIA-IA</span>
                <i />
              </div>
              <div className="lexia-brand-sub">SUA EMPRESA SEMPRE À FRENTE</div>
            </div>
          </div>

          {/* NOTEBOOK / DASHBOARD */}
          <div className="lexia-stage">
            <div className="lexia-bars" aria-hidden>
              {[18, 26, 36, 46, 56].map((h) => (
                <i key={h} style={{ height: `${h}%` }} />
              ))}
            </div>
            <svg className="lexia-arrow" viewBox="0 0 200 160" aria-hidden>
              <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path
                  d="M10 150 L70 100 L110 125 L180 30"
                  stroke="rgba(140,230,255,0.3)"
                  strokeWidth="15"
                />
                <path d="M145 30 L183 30 L183 68" stroke="rgba(140,230,255,0.3)" strokeWidth="15" />
                <path d="M10 150 L70 100 L110 125 L180 30" stroke="#9beaff" strokeWidth="6" />
                <path d="M145 30 L183 30 L183 68" stroke="#9beaff" strokeWidth="6" />
              </g>
            </svg>
            <div className="lexia-laptop">
              <div className="lexia-screen">
                <Dashboard />
              </div>
              <div className="lexia-base" />
            </div>
            <div className="lexia-phone" aria-hidden />
          </div>
        </section>

        {/* LADO DIREITO: LOGIN (funcionalidades preservadas) */}
        <aside className="lexia-login">
          <div className="lexia-card">
            <div className="lexia-card-logo">
              <LexiaMark />
              <span className="lexia-card-name">
                Lexia<em>-IA</em>
              </span>
            </div>

            <h2 className="lexia-card-title">{isSignup ? "Criar conta" : "Bem-vindo!"}</h2>
            <p className="lexia-card-sub">
              {isSignup
                ? "Preencha seus dados para começar."
                : "Disciplina e velocidade em cada transação, faça login."}
            </p>

            <form
              onSubmit={isSignup ? handleSignUp : handleSignIn}
              className="lexia-form"
              id="login-form"
            >
              <div className="lexia-input-wrap">
                <Mail className="lead" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  placeholder="Seu e-mail"
                  aria-label="Seu e-mail"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="lexia-field"
                />
              </div>

              <div className="lexia-input-wrap">
                <Lock className="lead" />
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Sua senha"
                  aria-label="Sua senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="lexia-field"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  className="lexia-eye"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>

              {isSignup && (
                <div className="lexia-input-wrap">
                  <Lock className="lead" />
                  <input
                    id="auth-confirm"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={6}
                    placeholder="Confirmar senha"
                    aria-label="Confirmar senha"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="lexia-field"
                  />
                </div>
              )}

              {!isSignup && (
                <div className="lexia-forgot-row">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={loading}
                    className="lexia-forgot"
                  >
                    Esqueceu sua senha?
                  </button>
                </div>
              )}

              <button type="submit" disabled={loading} className="lexia-btn">
                <span className="circle">
                  <ArrowRight />
                </span>
                {loading ? "Aguarde..." : isSignup ? "Criar conta" : "Entrar"}
              </button>
            </form>

            <p className="lexia-foot">
              {isSignup ? "Já tem uma conta? " : "Novo na plataforma? "}
              <Link to="/auth" search={{ mode: isSignup ? "signin" : "signup" }}>
                {isSignup ? "Entrar" : "Crie sua conta"}
              </Link>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
