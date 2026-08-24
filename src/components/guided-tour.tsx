import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Volume2, VolumeX, Play, Pause, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { synthesizeTTS } from "@/lib/tts.functions";
import lexiaLogo from "@/assets/lexia-logo.png";
import { Button } from "@/components/ui/button";

export type TourStep = {
  title: string;
  description: string;
  target?: string; // data-tour id
};

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Bem-vindo ao LexIA",
    description:
      "Olá! Este é um tour rápido pelo seu painel LexIA. Use as setas para navegar OU clique em qualquer item do menu que eu vou explicar em detalhes com áudio. Para sair, clique no X a qualquer momento.",
  },
  { title: "Dashboard", target: "/dashboard", description: "Visão geral do escritório: métricas, atendimentos em andamento, novos leads e desempenho da equipe em tempo real." },
  { title: "CRM", target: "/crm", description: "Central de conversas. Acompanhe atendimentos do WhatsApp, responda clientes e transfira conversas entre agentes humanos ou de IA." },
  { title: "Kanban", target: "/kanban", description: "Organize casos e leads em colunas visuais. Arraste cartões entre etapas do funil e acompanhe o progresso." },
  { title: "Guia de uso", target: "/guia", description: "Documentação completa: passo a passo detalhado de cada funcionalidade, para agentes humanos e agentes de IA." },
  { title: "Clientes", target: "/clientes", description: "Cadastro completo de clientes. Consulte histórico, dados de contato, casos vinculados e envie mensagens diretas." },
  { title: "Casos", target: "/casos", description: "Gestão jurídica dos processos ativos. Anexe documentos, defina prazos e centralize as movimentações." },
  { title: "Agendamentos", target: "/agendamentos", description: "Calendário de reuniões e audiências. A IA agenda automaticamente conforme sua disponibilidade." },
  { title: "Base de conhecimento", target: "/base-conhecimento", description: "Alimente a IA com documentos, modelos de petição e conteúdos do escritório para respostas mais precisas." },
  { title: "Treinamento da IA", target: "/treinamento-ia", description: "Ajuste o comportamento da IA com exemplos. Ensine o jeito do seu escritório de atender." },
  { title: "Personalidade da IA", target: "/personalidade-ia", description: "Defina tom de voz, formalidade e estilo de comunicação da IA." },
  { title: "WhatsApp", target: "/whatsapp", description: "Conecte números via QR Code, gerencie sessões e distribua atendimentos." },
  { title: "Integrações", target: "/integracoes", description: "Conecte pagamentos, webhooks, CRMs e calendários externos." },
  { title: "SMS", target: "/sms", description: "Envie cobranças, lembretes e comunicações por SMS aos clientes." },
  { title: "Configurações de IA", target: "/configuracoes", description: "Parâmetros técnicos: modelos, limites, prompts globais e regras de encaminhamento humano." },
  { title: "Painel Admin", target: "/admin", description: "Acesso exclusivo do administrador. Controla toda a operação em nível gerencial." },
  { title: "Equipe & Permissões", target: "/admin/usuarios", description: "Cadastre membros, defina o que cada um acessa e aprove novos usuários." },
  { title: "Convites", target: "/admin/convites", description: "Gere links de convite com permissões específicas e prazo de validade." },
  { title: "Setores", target: "/admin/setores", description: "Organize a equipe em setores para roteamento inteligente de atendimentos." },
  { title: "Modo escuro", target: "theme-toggle", description: "Alterne entre tema claro e escuro. A preferência fica salva no dispositivo." },
  { title: "Sair", target: "logout", description: "Encerra sua sessão com segurança. Sempre saia em dispositivos compartilhados." },
  {
    title: "Pronto para começar!",
    description:
      "Você concluiu o tour do LexIA. Reabra este tutorial a qualquer momento pelo botão 'Iniciar tour guiado' no menu lateral.",
  },
];

const STORAGE_KEY = "lexia-tour-completed";

type Rect = { top: number; left: number; width: number; height: number };

function getTargetRect(target?: string): Rect | null {
  if (!target || typeof document === "undefined") return null;
  const el = document.querySelector(`[data-tour="${target}"]`) as HTMLElement | null;
  if (!el) return null;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function GuidedTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<number, string>>(new Map());
  const runTTS = useServerFn(synthesizeTTS);

  const current = TOUR_STEPS[step];
  const total = TOUR_STEPS.length;

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  // While tour is open, intercept clicks on any [data-tour] element:
  // block navigation and jump to the matching step (popup + audio).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest("[data-tour]") as HTMLElement | null;
      if (!el) return;
      const key = el.getAttribute("data-tour");
      if (!key) return;
      const idx = TOUR_STEPS.findIndex((s) => s.target === key);
      if (idx === -1) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setStep(idx);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open]);

  // Track viewport
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  // Track target rect (recompute on scroll/resize)
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const update = () => {
      setRect(getTargetRect(current.target));
    };
    update();
    const loop = () => {
      update();
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [open, step, current.target]);

  // Fetch TTS (with prefetch of next step)
  const fetchStep = async (idx: number): Promise<string | null> => {
    if (idx < 0 || idx >= TOUR_STEPS.length) return null;
    const cached = cacheRef.current.get(idx);
    if (cached) return cached;
    try {
      const s = TOUR_STEPS[idx];
      const text = `${s.title}. ${s.description}`;
      const res = await runTTS({ data: { text } });
      const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: res.mime });
      const url = URL.createObjectURL(blob);
      cacheRef.current.set(idx, url);
      return url;
    } catch (e) {
      console.error("TTS erro", e);
      return null;
    }
  };

  useEffect(() => {
    if (!open || muted) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const url = await fetchStep(step);
      if (cancelled || !url) {
        setLoading(false);
        return;
      }
      const audio = audioRef.current;
      if (audio) {
        audio.src = url;
        audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }
      setLoading(false);
      // Prefetch next 2 in background
      fetchStep(step + 1);
      fetchStep(step + 2);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open, muted]);

  // Prefetch first steps on open for faster start
  useEffect(() => {
    if (!open) return;
    fetchStep(0);
    fetchStep(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      cacheRef.current.forEach((u) => URL.revokeObjectURL(u));
      cacheRef.current.clear();
    };
  }, []);

  if (!open) return null;

  const next = () => setStep((s) => Math.min(total - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));
  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
    audioRef.current?.pause();
    onClose();
  };
  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  // Compute card position: place to the right of target if room, else left, else centered
  const CARD_W = 420;
  const CARD_H_EST = 340;
  const PAD = 16;
  let cardStyle: React.CSSProperties = {
    position: "fixed",
    left: `calc(50% - ${CARD_W / 2}px)`,
    top: `calc(50% - ${CARD_H_EST / 2}px)`,
    width: CARD_W,
  };
  let anchor: { x: number; y: number } | null = null;
  let cardCenter: { x: number; y: number } | null = null;

  if (rect && viewport.w) {
    const rightSpace = viewport.w - (rect.left + rect.width);
    const leftSpace = rect.left;
    let left: number;
    if (rightSpace >= CARD_W + PAD * 2) {
      left = rect.left + rect.width + PAD;
    } else if (leftSpace >= CARD_W + PAD * 2) {
      left = rect.left - CARD_W - PAD;
    } else {
      left = Math.max(PAD, viewport.w - CARD_W - PAD);
    }
    let top = rect.top + rect.height / 2 - CARD_H_EST / 2;
    top = Math.max(PAD, Math.min(top, viewport.h - CARD_H_EST - PAD));
    cardStyle = { position: "fixed", left, top, width: CARD_W };
    anchor = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    cardCenter = { x: left + CARD_W / 2, y: top + CARD_H_EST / 2 };
  }

  // Spotlight padding around target
  const SP = 8;
  const spot = rect
    ? {
        x: Math.max(0, rect.left - SP),
        y: Math.max(0, rect.top - SP),
        w: rect.width + SP * 2,
        h: rect.height + SP * 2,
      }
    : null;

  return (
    <div className="fixed inset-0 z-[100] animate-in fade-in duration-200">
      {/* Dimmed backdrop with spotlight cutout */}
      <svg
        className="absolute inset-0 h-full w-full"
        onClick={finish}
        style={{ cursor: "pointer" }}
      >
        <defs>
          <mask id="tour-spotlight">
            <rect width="100%" height="100%" fill="white" />
            {spot && (
              <rect
                x={spot.x}
                y={spot.y}
                width={spot.w}
                height={spot.h}
                rx={10}
                ry={10}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.78)"
          mask="url(#tour-spotlight)"
        />
        {spot && (
          <rect
            x={spot.x}
            y={spot.y}
            width={spot.w}
            height={spot.h}
            rx={10}
            ry={10}
            fill="none"
            stroke="hsl(var(--accent))"
            strokeWidth={2}
            className="animate-pulse"
            style={{ pointerEvents: "none" }}
          />
        )}
        {/* Connector line from card to target */}
        {anchor && cardCenter && (
          <line
            x1={cardCenter.x}
            y1={cardCenter.y}
            x2={anchor.x}
            y2={anchor.y}
            stroke="hsl(var(--accent))"
            strokeWidth={2}
            strokeDasharray="6 6"
            style={{ pointerEvents: "none" }}
          />
        )}
      </svg>

      {/* Floating card */}
      <div
        style={cardStyle}
        className="rounded-2xl border border-accent/40 bg-card shadow-elegant overflow-hidden animate-in zoom-in-95 duration-300"
      >
        <div className="bg-gold-gradient h-1 w-full" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src={lexiaLogo} alt="LexIA" className="h-10 w-10 object-contain" />
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
                  <Sparkles className="h-3 w-3" />
                  Tour guiado
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Passo {step + 1} de {total}
                </div>
              </div>
            </div>
            <button
              onClick={finish}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
              aria-label="Fechar tour"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gold-gradient transition-all duration-500"
              style={{ width: `${((step + 1) / total) * 100}%` }}
            />
          </div>

          <div className="mt-4">
            <h3 className="text-xl font-semibold text-foreground">{current.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {current.description}
            </p>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
            <button
              onClick={togglePlay}
              disabled={muted || loading}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-40 transition"
              aria-label={playing ? "Pausar" : "Reproduzir"}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <div className="flex-1 text-xs text-muted-foreground">
              {loading ? "Gerando voz..." : muted ? "Áudio desativado" : playing ? "Narrando..." : "Áudio pronto"}
            </div>
            <button
              onClick={() => setMuted((m) => !m)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition"
              aria-label={muted ? "Ativar áudio" : "Silenciar"}
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={prev} disabled={step === 0} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <button
              onClick={finish}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              Pular tour
            </button>
            {step < total - 1 ? (
              <Button size="sm" onClick={next} className="gap-1 bg-accent text-accent-foreground hover:opacity-90">
                Próximo <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={finish} className="bg-gold-gradient text-black hover:opacity-90">
                Concluir
              </Button>
            )}
          </div>
        </div>
        <audio ref={audioRef} onEnded={() => setPlaying(false)} hidden />
      </div>
    </div>
  );
}

export function useTourAutoStart() {
  const [open, setOpen] = useState(false);
  // Auto-start desativado — tour só abre pelo botão "Iniciar tour guiado".
  return { open, setOpen };
}
