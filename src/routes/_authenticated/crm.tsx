import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, Pause, Play, Send, Bot, UserCheck, Paperclip, X, Loader2, Volume2, VolumeX, MessageSquareText, Sparkles } from "lucide-react";
import { extractClientFromChat } from "@/lib/client-extract.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { sendOperatorMessage, sendOperatorMedia } from "@/lib/whatsapp.functions";
import { Textarea } from "@/components/ui/textarea";
import { sendSms } from "@/lib/sms.functions";
import { uploadOperatorMedia } from "@/lib/media-upload.functions";
import { MediaBubble } from "@/components/chat/media-bubble";
import { Media } from "@/components/chat/media";
import { getMyOrgContext, listTeam } from "@/lib/admin.functions";
import {
  getAiGlobalState,
  setAiGlobalState,
  assignChat,
  listAssignments,
} from "@/lib/chat-routing.functions";
import { getChatUnreadCounts, markChatRead, toggleChatPause } from "@/lib/crm-reads.functions";
import { listLabels, listAllAssignments } from "@/lib/chat-labels.functions";
import { LabelsPopover } from "@/components/chat/labels-popover";
import { VerifiedLabelBadge, TransferredBadge } from "@/components/chat/verified-label-badge";
import { agentDisplayName } from "@/lib/agents";

export const Route = createFileRoute("/_authenticated/crm")({
  head: () => ({ meta: [{ title: "CRM — LexIA" }] }),
  component: CrmPage,
});

type Msg = {
  id: string;
  chat_id: string;
  direction: "inbound" | "outbound";
  sender: string;
  content: string | null;
  created_at: string;
  storage_path?: string | null;
  mime?: string | null;
  filename?: string | null;
  message_type?: string | null;
  media_status?: string | null;
  media_id?: string | null;
};

type ChatItem = { chat_id: string; last: string; last_at: string; paused_by: string | null };

function CrmPage() {
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [filterMine, setFilterMine] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("crm-sound-enabled") !== "0";
  });
  const fnGetUnread = useServerFn(getChatUnreadCounts);
  const fnMarkRead = useServerFn(markChatRead);
  const qcTop = useQueryClient();
  const { data: unread = {} } = useQuery({
    queryKey: ["crm-unread"],
    queryFn: () => fnGetUnread() as Promise<Record<string, number>>,
    refetchInterval: 30000,
  });


  const fnSend = useServerFn(sendOperatorMessage);
  const fnSendSms = useServerFn(sendSms);
  const fnTogglePause = useServerFn(toggleChatPause);
  const fnExtractClient = useServerFn(extractClientFromChat);
  const fnSendMedia = useServerFn(sendOperatorMedia);
  const fnUploadMedia = useServerFn(uploadOperatorMedia);
  const [extracting, setExtracting] = useState(false);
  async function handleExtractClient() {
    if (!active) return;
    setExtracting(true);
    try {
      const r = await fnExtractClient({ data: { chat_id: active } }) as { ok: boolean; created?: boolean; reason?: string };
      if (r.ok) toast.success(r.created ? "Cliente cadastrado" : "Cadastro atualizado");
      else toast.info(r.reason ?? "Sem dados para extrair");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao extrair");
    } finally { setExtracting(false); }
  }
  const [smsOpen, setSmsOpen] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [smsSending, setSmsSending] = useState(false);

  function openSmsDialog() {
    if (!active) return;
    setSmsText(
      `Olá! Aqui é do escritório LexIA. Podemos continuar seu atendimento? Responda por aqui.`,
    );
    setSmsOpen(true);
  }

  async function handleSendSms() {
    if (!active || !smsText.trim()) return;
    const phone = active.replace(/\D/g, "");
    if (phone.length < 8) return toast.error("Chat sem telefone válido");
    setSmsSending(true);
    try {
      await fnSendSms({ data: { to: phone, message: smsText.trim() } });
      toast.success("SMS enviado");
      playChime();
      setSmsOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar SMS");
    } finally {
      setSmsSending(false);
    }
  }
  const scrollRef = useRef<HTMLDivElement>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const seenMsgIdsRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);

  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("crm-sound-enabled", soundEnabled ? "1" : "0");
    }
  }, [soundEnabled]);

  const NOTIFICATION_SOUND_URL = "https://coconudimudial.b-cdn.net/ANUNCIANTES%20COCONUDI/universfield-new-notification-051-494246.mp3";
  const chimeRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const a = new Audio(NOTIFICATION_SOUND_URL);
    a.preload = "auto";
    a.volume = 0.8;
    chimeRef.current = a;

    // Autoplay é bloqueado até o primeiro gesto do usuário. Desbloqueia o
    // elemento tocando muted no primeiro click/tecla e liberando em seguida.
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      const el = chimeRef.current;
      if (!el) return;
      const prevMuted = el.muted;
      el.muted = true;
      const p = el.play();
      const finish = () => {
        try { el.pause(); el.currentTime = 0; el.muted = prevMuted; } catch {}
        audioUnlockedRef.current = true;
      };
      if (p && typeof (p as Promise<void>).then === "function") {
        (p as Promise<void>).then(finish).catch(finish);
      } else {
        finish();
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: false });
    window.addEventListener("keydown", unlock, { once: false });
    window.addEventListener("touchstart", unlock, { once: false });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);
  function playChime() {
    if (!soundEnabledRef.current) return;
    try {
      // Cria uma nova instância a cada disparo para evitar estado travado
      // (ex.: player pausado/em uso pelo desbloqueio inicial no gesto do usuário)
      const a = new Audio(NOTIFICATION_SOUND_URL);
      a.preload = "auto";
      a.volume = 0.8;
      a.muted = false;
      void a.play().catch((err) => {
        console.warn("[crm] chime play blocked:", err);
        // Fallback: tenta reaproveitar o áudio já desbloqueado
        const b = chimeRef.current;
        if (b) {
          try { b.currentTime = 0; void b.play().catch(() => {}); } catch {}
        }
      });
    } catch (err) {
      console.warn("[crm] chime error:", err);
    }
  }


  async function loadChats() {
    const { data } = await supabase
      .from("crm_messages")
      .select("chat_id, content, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const seen = new Map<string, ChatItem>();
    for (const r of data ?? []) {
      if (!seen.has(r.chat_id)) {
        seen.set(r.chat_id, { chat_id: r.chat_id, last: r.content ?? "", last_at: r.created_at, paused_by: null });
      }
    }
    const ids = Array.from(seen.keys());
    if (ids.length) {
      const { data: paused } = await supabase
        .from("crm_paused_chats").select("chat_id, paused_by").in("chat_id", ids);
      for (const p of paused ?? []) {
        const item = seen.get(p.chat_id);
        if (item) item.paused_by = p.paused_by;
      }
    }
    setChats(Array.from(seen.values()));
  }

  async function loadMessages(chatId: string) {
    const { data } = await supabase
      .from("crm_messages")
      .select("id, chat_id, direction, sender, content, created_at, storage_path, mime, filename, message_type, media_status, media_id")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(500);
    setMessages((data ?? []) as Msg[]);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  }

  useEffect(() => { loadChats(); }, []);
  useEffect(() => { if (active) loadMessages(active); }, [active]);

  const activeRef = useRef<string | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Ao abrir uma conversa, marcar como lida no servidor.
  useEffect(() => {
    if (!active) return;
    (async () => {
      try {
        await fnMarkRead({ data: { chat_id: active } });
        qcTop.invalidateQueries({ queryKey: ["crm-unread"] });
      } catch { /* silencioso */ }
    })();
  }, [active]);

  useEffect(() => {
    let cancelled = false;
    let channel: any;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (cancelled || !u.user) return;
      // Marca as mensagens já existentes como "vistas" para não gerar som/badge
      // ao carregar histórico ou dar refresh na página.
      try {
        const { data: existing } = await supabase
          .from("crm_messages").select("id").order("created_at", { ascending: false }).limit(500);
        for (const r of existing ?? []) seenMsgIdsRef.current.add(r.id);
      } catch { /* ignore */ }
      bootstrappedRef.current = true;

      channel = supabase.channel(`crm-realtime-${u.user.id}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "crm_messages" },
          (payload: any) => {
            loadChats();
            const row = payload.new ?? payload.old;
            const chatId = row?.chat_id;
            if (chatId && activeRef.current === chatId) loadMessages(chatId);

            // Somente novas mensagens INBOUND de cliente disparam som/badge.
            if (
              bootstrappedRef.current &&
              payload.eventType === "INSERT" &&
              payload.new?.direction === "inbound" &&
              payload.new?.id &&
              !seenMsgIdsRef.current.has(payload.new.id)
            ) {
              seenMsgIdsRef.current.add(payload.new.id);
              const cid = payload.new.chat_id as string;
              const isViewing =
                activeRef.current === cid &&
                (typeof document === "undefined" || document.visibilityState === "visible");
              if (!isViewing) {
                qcTop.invalidateQueries({ queryKey: ["crm-unread"] });
                playChime();
              }
            }
          })
        .on("postgres_changes",
          { event: "*", schema: "public", table: "crm_paused_chats" },
          () => loadChats())
        .on("postgres_changes",
          { event: "*", schema: "public", table: "chat_assignments" },
          () => {
            // Atribuição (admin, usuário ou futuro agente de IA) → atualiza
            // lista visível, transferências e contadores imediatamente.
            qcTop.invalidateQueries({ queryKey: ["assignments"] });
            qcTop.invalidateQueries({ queryKey: ["crm-unread"] });
            loadChats();
          })
        .subscribe();
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, []);


  async function togglePause(chatId: string, currentlyPaused: string | null) {
    try {
      const res = await fnTogglePause({ data: { chat_id: chatId, pause: !currentlyPaused } });
      toast.success(res.paused ? "Bot pausado" : "Bot retomado");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao alterar estado do bot");
    }
    loadChats();
  }

  async function handleSend() {
    if (!active || !text.trim()) return;
    const message = text.trim();
    const chatId = active;
    // Otimista: mostra imediatamente na UI e libera o input. O envio real
    // ocorre em background; a subscription realtime substitui pela linha
    // definitiva quando o servidor persistir.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Msg = {
      id: tempId,
      chat_id: chatId,
      direction: "outbound",
      sender: "operator",
      content: message,
      created_at: new Date().toISOString(),
      message_type: "text",
    } as Msg;
    setMessages((prev) => [...prev, optimistic]);
    setText("");
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 30);
    setSending(true);
    try {
      const result = await fnSend({ data: { chatId, message } });
      if (!result.ok) {
        // Remove o otimista e devolve o texto para o usuário tentar de novo.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setText(message);
        toast.error(result.message ?? "Falha ao enviar mensagem");
        return;
      }
      // Realtime tratará de inserir a mensagem real; ainda recarrega chats
      // para atualizar o preview lateral.
      loadChats();
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(message);
      toast.error(e.message ?? "Erro");
    } finally {
      setSending(false);
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [pendingCaption, setPendingCaption] = useState("");

  function openPreview(file: File) {
    setPendingFile(file);
    setPendingCaption("");
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      setPendingPreview(URL.createObjectURL(file));
    } else {
      setPendingPreview(null);
    }
  }

  function closePreview() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview(null);
    setPendingFile(null);
    setPendingCaption("");
  }

  async function confirmSendMedia() {
    if (!active || !pendingFile) return;
    const file = pendingFile;
    const caption = pendingCaption.trim();
    setUploading(true);
    try {
      // Lê o arquivo como base64 e faz upload direto para Bunny via server function.
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const { mediaId } = await fnUploadMedia({
        data: { filename: file.name, mime: file.type || "application/octet-stream", base64 },
      });
      const result = await fnSendMedia({
        data: {
          chatId: active,
          mediaId,
          mime: file.type || "application/octet-stream",
          filename: file.name,
          caption: caption || undefined,
        },
      });
      if (!result?.ok) throw new Error(result?.message ?? "Falha ao enviar mídia via WhatsApp");
      toast.success("Mídia enviada");
      closePreview();
      await Promise.all([loadMessages(active), loadChats()]);
    } catch (e: any) {
      toast.error(e.message ?? "Falha no upload");
    } finally {
      setUploading(false);
    }
  }

  const activeChat = chats.find((c) => c.chat_id === active);

  // Admin/multi-usuário
  const ctxFn = useServerFn(getMyOrgContext);
  const aiFn = useServerFn(getAiGlobalState);
  const setAiFn = useServerFn(setAiGlobalState);
  const assignFn = useServerFn(assignChat);
  const teamFn = useServerFn(listTeam);
  const assignmentsFn = useServerFn(listAssignments);
  const qc = useQueryClient();
  const { data: ctx } = useQuery({ queryKey: ["my-org-context"], queryFn: () => ctxFn() });
  const { data: aiState } = useQuery({ queryKey: ["ai-global"], queryFn: () => aiFn() });
  const { data: team = [] } = useQuery({
    queryKey: ["team"],
    queryFn: () => teamFn(),
    enabled: ctx?.isOwner === true,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["assignments"],
    queryFn: () => assignmentsFn(),
  });
  const activeAssignment = assignments.find((a) => a.chat_id === active);
  const aiActive = aiState?.active ?? true;
  const setAiMut = useMutation({
    mutationFn: (v: boolean) => setAiFn({ data: { active: v } }),
    onSuccess: () => {
      toast.success("IA atualizada");
      qc.invalidateQueries({ queryKey: ["ai-global"] });
    },
  });
  const assignMut = useMutation({
    mutationFn: (input: Parameters<typeof assignChat>[0]["data"]) => assignFn({ data: input }),
    onSuccess: () => {
      toast.success("Conversa atribuída");
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
  });

  // Etiquetas
  const labelsFn = useServerFn(listLabels);
  const labelAssignFn = useServerFn(listAllAssignments);
  const { data: labels = [] } = useQuery({ queryKey: ["chat-labels"], queryFn: () => labelsFn() });
  const { data: labelAssignments = [] } = useQuery({
    queryKey: ["chat-label-assignments"],
    queryFn: () => labelAssignFn(),
  });
  const labelsByChat = (() => {
    const map = new Map<string, typeof labels>();
    for (const a of labelAssignments) {
      const l = labels.find((x) => x.id === a.label_id);
      if (!l) continue;
      const arr = map.get(a.chat_id) ?? [];
      arr.push(l);
      map.set(a.chat_id, arr);
    }
    return map;
  })();
  const isTransferred = (chatId: string) => {
    const a = assignments.find((x) => x.chat_id === chatId);
    if (!a || a.assigned_to !== ctx?.user_id) return false;
    const reason = (a as any).reason ?? "";
    return reason !== "manual" && reason !== "self-assign";
  };

  const visibleChats = (() => {
    if (!ctx?.user_id) return chats;
    const assignedToOther = new Set(
      assignments
        .filter((a) => a.assigned_to && a.assigned_to !== ctx.user_id)
        .map((a) => a.chat_id),
    );
    const mine = new Set(
      assignments.filter((a) => a.assigned_to === ctx.user_id).map((a) => a.chat_id),
    );
    if (ctx.isOwner && !filterMine) {
      // "Todos": esconde chats já atribuídos a outro atendente humano,
      // para não duplicar com a aba "Meus atendimentos" dele.
      return chats.filter((c) => !assignedToOther.has(c.chat_id));
    }
    return chats.filter((c) => mine.has(c.chat_id));
  })();


  return (
    <div className="flex flex-col gap-3 animate-fade-up" data-allow-copy>
      {ctx?.isOwner && (
        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 px-4 py-2">
          <div className="flex items-center gap-2">
            <Bot className={`h-4 w-4 ${aiActive ? "text-emerald-500" : "text-muted-foreground"}`} />
            <span className="text-xs">
              IA <strong>{aiActive ? "ativa" : "pausada"}</strong> para toda a conta
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {aiActive ? "Responde automaticamente" : "Só humanos respondem"}
            </span>
            <Switch checked={aiActive} onCheckedChange={(v) => setAiMut.mutate(v)} />
          </div>
        </div>
      )}
      {ctx?.isOwner && (
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1 self-start">
          <button
            onClick={() => setFilterMine(false)}
            className={`px-3 py-1 text-xs rounded-md transition ${!filterMine ? "bg-white text-black" : "text-muted-foreground hover:text-foreground"}`}
          >
            Todos
          </button>
          <button
            onClick={() => setFilterMine(true)}
            className={`px-3 py-1 text-xs rounded-md transition ${filterMine ? "bg-white text-black" : "text-muted-foreground hover:text-foreground"}`}
          >
            Meus atendimentos
          </button>

        </div>
      )}
      <div className="flex items-center gap-2 self-start rounded-lg border border-border/60 bg-card/40 px-3 py-1.5">
        <button
          type="button"
          onClick={async () => {
            const next = !soundEnabled;
            setSoundEnabled(next);
            if (next) {
              // Desbloqueia autoplay: precisa tocar dentro do gesto do usuário
              try {
                let a = chimeRef.current;
                if (!a) {
                  a = new Audio(NOTIFICATION_SOUND_URL);
                  a.preload = "auto";
                  a.volume = 0.8;
                  chimeRef.current = a;
                }
                a.muted = false;
                a.currentTime = 0;
                await a.play();
                toast.success("Som de notificação ativado");
              } catch (err) {
                console.warn("[crm] falha ao desbloquear áudio:", err);
                toast.error("Não foi possível ativar o som. Verifique as permissões do navegador.");
              }
            }
          }}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition"
          title={soundEnabled ? "Desativar som de novas mensagens" : "Ativar som de novas mensagens (clique para liberar o áudio)"}
        >
          {soundEnabled ? <Volume2 className="h-4 w-4 text-accent" /> : <VolumeX className="h-4 w-4" />}
          Som de mensagens: <strong className={soundEnabled ? "text-accent" : ""}>{soundEnabled ? "ATIVADO" : "DESATIVADO"}</strong>
        </button>
      </div>
    <div className="grid h-[calc(100dvh-9rem)] grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
      {/* Lista de conversas */}
      <Card className={`flex flex-col overflow-hidden border-border/60 bg-card/60 backdrop-blur-sm ${active ? "hidden lg:flex" : "flex"}`}>
        <div className="sticky top-0 z-10 glass border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-accent" />
            <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Conversas
            </span>
          </div>
          <p className="mt-1 font-display text-xl leading-none text-foreground">
            {visibleChats.length} <span className="text-sm text-muted-foreground">ativas</span>
          </p>
        </div>
        <ScrollArea className="flex-1">
          {visibleChats.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma conversa {ctx?.isOwner && filterMine ? "atribuída a você" : "ainda"}.
            </p>
          ) : visibleChats.map((c, i) => {
            const isActive = active === c.chat_id;
            return (
              <button
                key={c.chat_id}
                onClick={() => setActive(c.chat_id)}
                style={{ animationDelay: `${i * 30}ms` }}
                className={`group relative block w-full animate-fade-up border-b border-border/40 px-4 py-3 text-left transition-all duration-300 ${
                  isActive ? "bg-accent/8" : "hover:bg-accent/5"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-8 w-[2px] -translate-y-1/2 rounded-r bg-gold-gradient shadow-glow" />
                )}
                <div className="flex items-center gap-3 pl-2">
                  <span
                    role="button"
                    tabIndex={0}
                    title="Agendar call no Google Calendar para este atendimento"
                    onClick={(e) => {
                      e.stopPropagation();
                      const url =
                        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
                        `&text=${encodeURIComponent(`Atendimento — ${c.chat_id}`)}` +
                        `&details=${encodeURIComponent(
                          `Cliente WhatsApp: ${c.chat_id}\nChat ID: ${c.chat_id}\nAbrir CRM: ${window.location.origin}/crm`,
                        )}`;
                      window.open(url, "_blank", "noopener,noreferrer");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLSpanElement).click();
                      }
                    }}
                    className="shrink-0 h-7 w-7 rounded-full overflow-hidden ring-1 ring-border/60 hover:ring-accent/60 transition cursor-pointer"
                  >
                    <img
                      src="https://COCONUDIMUDIAL.b-cdn.net/ANUNCIANTES%20COCONUDI/WhatsApp%20Image%202026-07-11%20at%2010.08.08.jpeg"
                      alt="Agendar"
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-medium uppercase tracking-wider ring-1 transition-all ${
                    isActive
                      ? "bg-accent/15 text-accent ring-accent/40"
                      : "bg-muted/50 text-muted-foreground ring-border/40 group-hover:ring-accent/30"
                  }`}>
                    {c.chat_id.slice(-2)}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`flex min-w-0 items-center gap-1.5 truncate text-[13px] font-medium ${isActive ? "text-foreground" : "text-foreground/90"}`}>
                        <span className="truncate">{c.chat_id}</span>
                        {isTransferred(c.chat_id) && <TransferredBadge size={12} />}
                        {(labelsByChat.get(c.chat_id) ?? []).slice(0, 3).map((l) => (
                          <VerifiedLabelBadge key={l.id} name={l.name} color={l.color} size={12} />
                        ))}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {c.paused_by && (
                          <span className="text-[9px] uppercase tracking-[0.18em] text-accent/80">
                            pausado
                          </span>
                        )}
                        {(unread[c.chat_id] ?? 0) > 0 && (
                          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-semibold text-primary-foreground shadow-glow">
                            {unread[c.chat_id] > 99 ? "99+" : unread[c.chat_id]}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className={`mt-0.5 line-clamp-1 text-xs ${(unread[c.chat_id] ?? 0) > 0 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      {c.last}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </ScrollArea>
      </Card>

      {/* Painel de chat */}
      <Card className={`flex flex-col overflow-hidden border-border/60 bg-card/40 backdrop-blur-sm ${active ? "flex" : "hidden lg:flex"}`}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/8 ring-1 ring-accent/20">
              <MessageSquare className="h-6 w-6 text-accent" />
            </div>
            <p className="font-display text-2xl text-foreground">
              Selecione uma conversa
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Escolha um contato à esquerda para acompanhar o histórico e responder como atendente humano.
            </p>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 glass border-b border-border/60 px-3 py-3 sm:px-6 sm:py-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  onClick={() => setActive(null)}
                  aria-label="Voltar para lista"
                  className="lg:hidden shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-muted-foreground hover:text-accent"
                >
                  ‹
                </button>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase tracking-[0.24em] text-accent">
                    Em conversa
                  </span>
                  <div className="mt-0.5 flex items-center gap-2 truncate font-display text-base sm:text-xl text-foreground">
                    <span className="truncate">{activeChat?.chat_id}</span>
                    {active && isTransferred(active) && <TransferredBadge size={16} />}
                    {active && (labelsByChat.get(active) ?? []).map((l) => (
                      <VerifiedLabelBadge key={l.id} name={l.name} color={l.color} size={16} />
                    ))}
                  </div>
                  {activeChat?.paused_by && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      Bot pausado por <span className="text-accent">{activeChat.paused_by}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {activeAssignment?.assigned_to && (
                  <Badge variant="outline" className="border-accent/40 text-accent text-[10px]">
                    <UserCheck className="h-3 w-3 mr-1" />
                    {team.find((t) => t.member_id === activeAssignment.assigned_to)?.profile
                      ?.full_name ?? "Atribuído"}
                  </Badge>
                )}
                {ctx?.isOwner && (
                  <select
                    value={activeAssignment?.assigned_to ?? ""}
                    onChange={(e) =>
                      assignMut.mutate({
                        chat_id: active!,
                        assigned_to: e.target.value || null,
                        reason: "manual",
                      })
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="">Sem atribuição</option>
                    {team.map((t) => (
                      <option key={t.member_id} value={t.member_id}>
                        {t.profile?.full_name ?? t.profile?.email ?? t.member_id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                )}
                {!ctx?.isOwner && ctx?.user_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      assignMut.mutate({
                        chat_id: active!,
                        assigned_to: ctx.user_id,
                        reason: "self-assign",
                      })
                    }
                  >
                    Assumir
                  </Button>
                )}
                {active && <LabelsPopover chatId={active} />}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openSmsDialog}
                  className="border-border/60 hover:border-accent/40 hover:text-accent"
                  title="Enviar SMS usando o provedor SMS ativo"
                >
                  <MessageSquareText className="mr-2 h-3 w-3" />SMS
                </Button>
                {ctx?.role === "admin" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => togglePause(active, activeChat?.paused_by ?? null)}
                    className="border-border/60 hover:border-accent/40 hover:text-accent"
                  >
                    {activeChat?.paused_by
                      ? <><Play className="mr-2 h-3 w-3" />Retomar bot</>
                      : <><Pause className="mr-2 h-3 w-3" />Pausar bot</>}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={extracting}
                  onClick={handleExtractClient}
                  className="border-border/60 hover:border-accent/40 hover:text-accent"
                  title="Extrair dados do cliente da conversa"
                >
                  {extracting
                    ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />Extraindo...</>
                    : <><Sparkles className="mr-2 h-3 w-3" />Extrair dados</>}
                </Button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
              {messages.map((m, i) => {
                const isInbound = m.direction === "inbound";
                return (
                  <div
                    key={m.id}
                    className={`flex animate-fade-up ${isInbound ? "justify-start" : "justify-end"}`}
                    style={{ animationDelay: `${Math.min(i * 20, 200)}ms` }}
                  >
                    <div className="max-w-[85%] sm:max-w-[68%] space-y-1">
                      <div
                        className={`rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${
                          isInbound
                            ? "bg-muted/60 text-foreground rounded-tl-sm"
                            : m.sender === "operator"
                              ? "bg-accent/15 text-foreground ring-1 ring-accent/30 rounded-tr-sm"
                              : "bg-primary text-primary-foreground rounded-tr-sm shadow-glow"
                        }`}
                      >
                        {m.media_id ? (
                          <Media mediaId={m.media_id} mime={m.mime ?? null} filename={m.filename ?? null} />
                        ) : m.storage_path ? (
                          <MediaBubble path={m.storage_path} mime={m.mime ?? null} filename={m.filename ?? null} />
                        ) : m.message_type && ["image","video","audio","document","sticker"].includes(m.message_type) ? (
                          <p className="text-xs italic opacity-70">
                            {m.message_type === "image" ? "📷 Imagem" : m.message_type === "video" ? "🎬 Vídeo" : m.message_type === "audio" ? "🎧 Áudio" : "📎 Arquivo"}
                            {m.media_status === "failed"
                              ? " — não foi possível baixar a mídia."
                              : " — carregando…"}
                          </p>
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        )}
                      </div>
                      <p className={`text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 ${isInbound ? "pl-2" : "pr-2 text-right"}`}>
                        {agentDisplayName(m.sender)} · {new Date(m.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-border/60 glass px-4 py-3">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept="image/*,audio/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) openPreview(f);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-background/40 px-2 py-1.5 transition-all focus-within:border-accent/40 focus-within:shadow-glow">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 shrink-0 rounded-full"
                  title="Anexar (envio binário)"
                >
                  <Paperclip className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} />
                </Button>
                <Input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                  placeholder="Responder como atendente humano (pausa o bot)…"
                  className="border-0 bg-transparent px-3 shadow-none focus-visible:ring-0"
                />
                <Button
                  onClick={handleSend}
                  disabled={sending || !text.trim()}
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full bg-gold-gradient text-primary-foreground shadow-glow hover:opacity-90"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {activeChat?.paused_by === null && (
                <p className="mt-2 pl-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                  Enviar como humano pausa o bot automaticamente.
                </p>
              )}
            </div>
          </>
        )}
      </Card>
    </div>

    <Dialog open={!!pendingFile} onOpenChange={(o) => { if (!o && !uploading) closePreview(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar mídia</DialogTitle>
        </DialogHeader>
        {pendingFile && (
          <div className="space-y-3">
            <div className="flex items-center justify-center rounded-lg border border-border/60 bg-black/40 p-3 min-h-[220px]">
              {pendingPreview && pendingFile.type.startsWith("image/") && (
                <img src={pendingPreview} alt={pendingFile.name} className="max-h-[360px] max-w-full rounded object-contain" />
              )}
              {pendingPreview && pendingFile.type.startsWith("video/") && (
                <video src={pendingPreview} controls className="max-h-[360px] max-w-full rounded" />
              )}
              {!pendingPreview && (
                <div className="text-center text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{pendingFile.name}</p>
                  <p className="mt-1 text-xs">{(pendingFile.size / 1024).toFixed(1)} KB · {pendingFile.type || "arquivo"}</p>
                </div>
              )}
            </div>
            <Input
              value={pendingCaption}
              onChange={(e) => setPendingCaption(e.target.value)}
              placeholder="Adicione uma legenda (opcional)"
              disabled={uploading}
              onKeyDown={(e) => { if (e.key === "Enter" && !uploading) confirmSendMedia(); }}
            />
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={closePreview} disabled={uploading}>
            <X className="mr-1 h-4 w-4" /> Cancelar
          </Button>
          <Button
            onClick={confirmSendMedia}
            disabled={uploading || !pendingFile}
            className="bg-gold-gradient text-primary-foreground shadow-glow hover:opacity-90"
          >
            {uploading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
            ) : (
              <><Send className="mr-2 h-4 w-4" /> Enviar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={smsOpen} onOpenChange={(o) => { if (!smsSending) setSmsOpen(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar SMS para {active ?? ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Destino: <span className="text-foreground">{active}</span> · usa o provedor SMS ativo em <span className="text-accent">/sms</span>.
          </div>
          <Textarea
            rows={4}
            maxLength={300}
            value={smsText}
            onChange={(e) => setSmsText(e.target.value)}
            placeholder="Mensagem curta de SMS..."
          />
          <div className="text-[11px] text-muted-foreground text-right">{smsText.length}/300</div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setSmsOpen(false)} disabled={smsSending}>Cancelar</Button>
          <Button disabled={smsSending || !smsText.trim()} onClick={handleSendSms}>
            {smsSending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando…</> : <><MessageSquareText className="mr-2 h-4 w-4" />Enviar SMS</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}
