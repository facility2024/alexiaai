/**
 * © 2026 FacilitySoftware — LexIA CRM Jurídico
 * TODOS OS DIREITOS RESERVADOS / ALL RIGHTS RESERVED.
 *
 * AVISO LEGAL DE PROPRIEDADE INTELECTUAL / LEGAL NOTICE:
 * Este código-fonte, sua interface, layout, imagens, marcas, dados sensíveis
 * (informações de clientes, prompts de IA, fluxos de atendimento jurídico) e
 * quaisquer artefatos derivados são de propriedade exclusiva da FacilitySoftware.
 *
 * É PROIBIDO: copiar, clonar, reproduzir, publicar, distribuir, aplicar
 * engenharia reversa, capturar telas, extrair código via IA / LLM / agente
 * autônomo, ou treinar modelos de inteligência artificial com este conteúdo.
 *
 * Violações configuram crime previsto na Lei nº 9.610/98 (Direitos Autorais),
 * Lei nº 9.609/98 (Software), Lei nº 13.709/2018 (LGPD), art. 184 do Código
 * Penal Brasileiro, além de responsabilização civil por perdas e danos.
 *
 * DO NOT COPY. DO NOT SCRAPE. DO NOT TRAIN AI MODELS ON THIS SOURCE.
 * Contato para licenciamento: WhatsApp +55 11 98296-9676 — FacilitySoftware.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import lexiaLogo from "@/assets/lexia-logo.png";

const IDLE_TIMEOUT_MS = 60_000;

const CONTACT = "11982969676";

// Proteção ativa. Áreas com data-allow-copy liberam copiar/colar/print.
const isMaintenance = () => false;

function isBlockedTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return true;
  // Bloqueia por padrão; libera dentro de [data-allow-copy] (áreas de atendimento).
  if (el.closest("[data-allow-copy]")) return false;
  return true;
}


export function SecurityGuard() {
  const [blocked, setBlocked] = useState(false);
  const [obfuscated, setObfuscated] = useState(false);

  useEffect(() => {
    // Janela de manutenção: pula listeners e detecção de devtools.
    if (isMaintenance()) return;




    const trigger = (e?: Event) => {
      if (e && !isBlockedTarget(e.target)) return;
      e?.preventDefault?.();
      setBlocked(true);
    };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // PrintScreen -> ofusca a tela
      if (e.key === "PrintScreen") {
        if (!isBlockedTarget(e.target)) return;
        e.preventDefault();
        setObfuscated(true);
        setTimeout(() => setObfuscated(false), 4000);
        setBlocked(true);
        return;
      }
      // F12 / DevTools / View-source / Save — sempre bloqueado
      if (
        e.key === "F12" ||
        (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(k)) ||
        (e.metaKey && e.altKey && ["i", "j", "c"].includes(k)) ||
        (e.ctrlKey && ["u", "s"].includes(k)) ||
        (e.metaKey && ["u", "s"].includes(k))
      ) {
        e.preventDefault();
        setBlocked(true);
        return;
      }
      // Copy / Cut / Paste — liberados globalmente (só bloqueia em data-block-copy)
      if ((e.ctrlKey || e.metaKey) && ["c", "x", "v"].includes(k)) {
        if (!isBlockedTarget(e.target)) return;
        e.preventDefault();
        setBlocked(true);
      }
    };

    const onCtx = (e: MouseEvent) => trigger(e);
    const onCopy = (e: ClipboardEvent) => trigger(e);
    const onVis = () => {
      if (document.visibilityState === "hidden") setObfuscated(true);
      else setTimeout(() => setObfuscated(false), 500);
    };
    const onBlur = () => setObfuscated(true);
    const onFocus = () => setObfuscated(false);
    const onDrag = (e: Event) => {
      if (!isBlockedTarget(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKey, true);
    document.addEventListener("contextmenu", onCtx, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCopy, true);
    document.addEventListener("dragstart", onDrag, true);
    document.addEventListener("selectstart", onDrag, true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    // Idle timer: after 1 min sem interação, ativa tela "Conteúdo protegido"
    let idleTimer: number | undefined;
    const resetIdle = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      setObfuscated(false);
      idleTimer = window.setTimeout(() => setObfuscated(true), IDLE_TIMEOUT_MS);
    };
    const idleEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"];
    idleEvents.forEach((ev) => window.addEventListener(ev, resetIdle, { passive: true }));
    resetIdle();

    // Detecção de DevTools por tamanho desativada — gerava falso positivo
    // e reabria o modal sozinho. Bloqueio de F12/Ctrl+Shift+I continua ativo via onKey.


    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKey, true);
      document.removeEventListener("contextmenu", onCtx, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCopy, true);
      document.removeEventListener("dragstart", onDrag, true);
      document.removeEventListener("selectstart", onDrag, true);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      idleEvents.forEach((ev) => window.removeEventListener(ev, resetIdle));
      if (idleTimer) window.clearTimeout(idleTimer);
    };
  }, []);


  const handleClose = () => {
    setBlocked(false);
    setObfuscated(false);
  };


  if (isMaintenance()) return null;

  return (
    <>

      {/* Camada de ofuscamento quando janela perde foco / PrintScreen */}
      {obfuscated && (
        <div
          aria-hidden
          className="fixed inset-0 z-[9998] backdrop-blur-2xl bg-background/95 flex items-center justify-center pointer-events-none"
        >
          <div className="text-center">
            <img src={lexiaLogo} alt="" className="mx-auto h-16 w-16 opacity-80" />
            <p className="mt-4 text-sm uppercase tracking-[0.3em] text-accent inline-flex items-center gap-2">
              Conteúdo protegido
              <Loader2 className="h-4 w-4 animate-spin" />
            </p>
          </div>
        </div>
      )}

      {blocked && (
        <div
          role="alertdialog"
          aria-modal
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/90 backdrop-blur-xl p-4"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="max-w-lg w-full rounded-2xl border border-accent/40 bg-card shadow-2xl p-6 text-center animate-fade-up">
            <img src={lexiaLogo} alt="LexIA" className="mx-auto h-16 w-16" />
            <h2 className="mt-4 font-display text-2xl text-foreground">
              Ação não autorizada
            </h2>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
              Você <strong className="text-foreground">não tem autorização</strong> para
              copiar, inspecionar, capturar ou extrair qualquer informação deste
              sistema. Este software, seu código-fonte, dados e interface são
              propriedade exclusiva da <strong className="text-accent">FacilitySoftware</strong>.
            </p>
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
              A tentativa configura violação da <strong>Lei nº 9.610/98</strong> (Direitos
              Autorais), <strong>Lei nº 9.609/98</strong> (Proteção de Software),
              <strong> Lei nº 13.709/2018</strong> (LGPD) e do <strong>art. 184 do Código
              Penal Brasileiro</strong>, sujeitando o infrator a processos cíveis e
              criminais.
            </p>
            <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
              <p className="text-xs text-muted-foreground">
                Interessado em licenciar o sistema? Fale com a FacilitySoftware:
              </p>
              <a
                href={`https://wa.me/55${CONTACT}`}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-display text-lg text-accent hover:underline"
              >
                WhatsApp (11) 98296-9676
              </a>
            </div>
            <button
              onClick={handleClose}
              className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
            >
              Fechar e voltar ao sistema
            </button>
          </div>
        </div>
      )}
    </>
  );
}
