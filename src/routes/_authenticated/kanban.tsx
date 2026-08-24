import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  MouseSensor, TouchSensor, useSensor, useSensors, useDroppable, useDraggable,
  pointerWithin,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  Sparkles, RefreshCw, Settings2, Bot, Trash2, MessageSquare, Plus,
  Circle, Inbox, Video, UserCheck, FileUp, ScanSearch, FileSignature, CheckCircle2,
  Flame, ClipboardList, Gavel,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  getKanbanBoard, moveCard, runKanbanAgent, syncCrmToKanban,
  deleteCard, toggleCardTag, upsertColumn,
  qualifyCard, getCardDocuments, toggleCardDocument,
} from "@/lib/kanban.functions";
import { runEduardoForCard } from "@/lib/contracts.functions";
import { supabase } from "@/integrations/supabase/client";
import { AGENTS, type AgentKey } from "@/lib/agents";
import { useNavigate } from "@tanstack/react-router";



const AGENT_STYLE: Record<AgentKey, { bg: string; ring: string }> = {
  whatsapp:   { bg: "#25D366", ring: "#25D36655" },
  triagem:    { bg: "#8b5cf6", ring: "#8b5cf655" },
  analise:    { bg: "#3b82f6", ring: "#3b82f655" },
  documentos: { bg: "#f59e0b", ring: "#f59e0b55" },
  contratos:  { bg: "#ef4444", ring: "#ef444455" },
};

function agentForCard(card: {
  qualified_at: string | null;
  viability_score: number | null;
}): AgentKey {
  // Heurística por estado do card:
  // sem qualificação → Sofia (WhatsApp);
  // qualificado sem score → Marina (Triagem);
  // com score → Rafael (Análise).
  if (!card.qualified_at) return "whatsapp";
  if (card.viability_score == null) return "triagem";
  return "analise";
}

// Mapeia o agente responsável pela ETAPA (posição da coluna no funil).
const AGENT_BY_STAGE: AgentKey[] = [
  "whatsapp",   // Etapa 1 — Primeiro atendimento
  "whatsapp",   // Etapa 2 — Interesse
  "triagem",    // Etapa 3 — Call/Meet
  "analise",    // Etapa 4 — Especialista
  "documentos", // Etapa 5 — Envio de documentos
  "contratos",  // Etapa 6 — Contrato
];
function agentForStage(idx: number): AgentKey {
  return AGENT_BY_STAGE[idx] ?? "contratos";
}

function AgentBadge({ agentKey, size = "sm" }: { agentKey: AgentKey; size?: "sm" | "md" }) {
  const agent = AGENTS.find((a) => a.key === agentKey)!;
  const style = AGENT_STYLE[agentKey];
  const dim = size === "md" ? "h-6 w-6" : "h-5 w-5";
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`${agent.name} — ${agent.role}`}
    >
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-full ring-2 ${dim}`}
        style={{ background: style.bg, boxShadow: `0 0 0 2px ${style.ring}` }}
      >
        <img src={agent.avatar} alt={agent.name} className="h-full w-full object-cover" loading="lazy" />
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {agent.name}
      </span>
    </span>
  );
}

export const Route = createFileRoute("/_authenticated/kanban")({
  head: () => ({ meta: [{ title: "Kanban Inteligente — LexIA" }] }),
  component: KanbanPage,
});

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Circle, Inbox, Sparkles, Video, UserCheck, FileUp, ScanSearch, FileSignature, CheckCircle2,
};

const URGENCY_COLOR: Record<string, string> = {
  urgente: "#ef4444", alta: "#f97316", media: "#eab308", baixa: "#22c55e",
};

type Column = { id: string; name: string; color: string; icon: string; rule_prompt: string | null; position: number };
type Card = {
  id: string; chat_id: string; column_id: string; contact_name: string | null;
  contact_phone: string | null; tag_ids: string[]; summary: string | null;
  assignee: string | null; last_message_at: string | null; ai_enabled: boolean;
  legal_area: string | null; urgency: string | null;
  viability_score: number | null; estimated_ticket: number | null;
  case_facts: unknown; case_timeline: unknown;
  last_client_message_at: string | null; sla_hours: number | null;
  qualified_at: string | null;
};
type Tag = { id: string; name: string; color: string };
type CardDoc = {
  id: string; card_id: string; document_name: string;
  required: boolean; received: boolean; received_at: string | null;
};

function isCooling(card: Card): boolean {
  if (!card.last_client_message_at) return false;
  const diffH = (Date.now() - new Date(card.last_client_message_at).getTime()) / 3_600_000;
  return diffH > (card.sla_hours ?? 24);
}

function KanbanPage() {
  const fnGet = useServerFn(getKanbanBoard);
  const fnMove = useServerFn(moveCard);
  const fnAgent = useServerFn(runKanbanAgent);
  const fnSync = useServerFn(syncCrmToKanban);
  const fnDelete = useServerFn(deleteCard);
  const fnToggleTag = useServerFn(toggleCardTag);

  const [columns, setColumns] = useState<Column[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [runningAi, setRunningAi] = useState<string | null>(null);

  // Mouse (desktop): inicia com pequeno movimento — experiência ágil.
  // Touch (mobile): long-press curto (180ms), assim swipes continuam rolando o quadro.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  async function load() {
    try {
      const res = await fnGet();
      setColumns(res.columns as Column[]);
      setCards(res.cards as Card[]);
      setTags(res.tags as Tag[]);
    } catch (e: any) { toast.error(e.message ?? "Falha ao carregar"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("kanban-cards-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kanban_cards" },
        () => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void load(), 150);
        },
      )
      .subscribe();

    return () => {
      clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const byCol = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of columns) m.set(c.id, []);
    for (const card of cards) m.get(card.column_id)?.push(card);
    return m;
  }, [columns, cards]);

  function onDragStart(e: DragStartEvent) {
    setActiveCard(cards.find((c) => c.id === e.active.id) ?? null);
  }
  async function onDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const cardId = String(e.active.id);
    const toCol = e.over?.id ? String(e.over.id) : null;
    if (!toCol) return;
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.column_id === toCol) return;
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, column_id: toCol } : c)));
    try { await fnMove({ data: { cardId, toColumnId: toCol } }); }
    catch (err: any) { toast.error(err.message ?? "Falha ao mover"); load(); }
  }

  const [lastImported, setLastImported] = useState<number | null>(null);
  async function handleSync() {
    const r = await fnSync().catch((e) => { toast.error(e.message); return null; });
    if (!r) return;
    setLastImported(r.created);
    if (r.created > 0) {
      toast.success(`${r.created} ${r.created === 1 ? "novo card importado" : "novos cards importados"} do CRM`, {
        description: "Confira na primeira coluna do funil.",
      });
    } else {
      toast.info("Nenhuma conversa nova para importar", {
        description: "Todos os chats do CRM já viraram cards.",
      });
    }
    load();
    setTimeout(() => setLastImported(null), 6000);
  }
  async function handleAi(cardId: string) {
    setRunningAi(cardId);
    try {
      const d = await fnAgent({ data: { cardId } });
      toast.success(`IA: ${d?.reason ?? d?.action ?? "ok"}`);
      load();
    } catch (e: any) { toast.error(e.message ?? "IA falhou"); }
    finally { setRunningAi(null); }
  }

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Header editorial */}
      <div className="flex flex-col gap-4 border-b border-border/60 pb-6">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-accent">Funil · CRM</div>
          <h1 className="font-display italic text-5xl leading-[0.95] text-foreground mt-2">
            Kanban <span className="text-accent">Inteligente</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Um agente lê a conversa do WhatsApp e move o lead entre as etapas conforme as regras que você configurou.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleSync} className="relative border-accent/30">
            <RefreshCw className="h-4 w-4 mr-2" /> Importar do CRM
            {lastImported !== null && (
              <span
                className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold animate-pulse ${
                  lastImported > 0
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {lastImported > 0 ? `+${lastImported} novos` : "0 novos"}
              </span>
            )}
          </Button>
          <NewColumnDialog onCreated={load} />
          <Button asChild className="bg-gold-gradient text-primary-foreground shadow-glow">
            <Link to="/kanban/configuracoes"><Settings2 className="h-4 w-4 mr-2" /> Configurar</Link>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-20">Carregando quadro…</div>
      ) : columns.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-muted-foreground mb-4">Nenhuma coluna configurada.</p>
          <Button asChild><Link to="/kanban/configuracoes">Configurar Kanban</Link></Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0">
            {columns.map((col, idx) => {
              const Icon = ICONS[col.icon] ?? Circle;
              const list = byCol.get(col.id) ?? [];
              return (
                <ColumnDrop key={col.id} id={col.id}>
                  <div
                    className="w-[85vw] max-w-[320px] sm:w-[320px] shrink-0 snap-start rounded-xl glass border border-border/40 flex flex-col animate-fade-up"
                    style={{ animationDelay: `${idx * 60}ms` }}
                  >
                    <div className="flex items-center justify-between px-4 pt-4 pb-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                          style={{ background: `${col.color}22`, color: col.color }}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                            Etapa {idx + 1}
                          </div>
                          <div className="font-display italic text-lg leading-none text-foreground truncate">{col.name}</div>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{list.length}</span>
                    </div>
                    <div className={list.length > 0 || idx === 0 ? "divider-laser" : "divider-gold"} />
                    <div className="flex-1 space-y-2 p-3 min-h-[120px]">
                      {list.map((card) => (
                        <CardItem
                          key={card.id}
                          card={card}
                          tagMap={tagMap}
                          agentKey={agentForStage(idx)}
                          onClick={() => setSelected(card)}
                          onAi={() => handleAi(card.id)}
                          aiRunning={runningAi === card.id}
                        />
                      ))}
                      {list.length === 0 && (
                        <div className="text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground/50 py-8">
                          vazio
                        </div>
                      )}
                    </div>
                  </div>
                </ColumnDrop>
              );
            })}
            <div className="w-[85vw] max-w-[280px] sm:w-[280px] shrink-0 snap-start flex items-start pt-4">
              <NewColumnDialog onCreated={load} variant="inline" />
            </div>
          </div>
          <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
            {activeCard && (
              <div className="rounded-lg border border-accent/60 bg-card/95 px-3 py-2 shadow-glow font-display italic text-base text-foreground pointer-events-none whitespace-nowrap">
                {activeCard.contact_name ?? activeCard.chat_id}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {selected && (
        <CardDetail
          card={selected}
          columns={columns}
          tags={tags}
          onClose={() => setSelected(null)}
          onDelete={async () => {
            if (!confirm("Excluir este card?")) return;
            await fnDelete({ data: { cardId: selected.id } }).catch((e) => toast.error(e.message));
            setSelected(null); load();
          }}
          onToggleTag={async (tagId) => {
            await fnToggleTag({ data: { cardId: selected.id, tagId } }).catch((e) => toast.error(e.message));
            load();
          }}
          onAi={async () => { await handleAi(selected.id); setSelected(null); }}
          onQualified={load}
        />
      )}
    </div>
  );
}

function ColumnDrop({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={isOver ? "ring-2 ring-accent/60 rounded-xl transition-all" : "transition-all"}>
      {children}
    </div>
  );
}

function CardItem({
  card, tagMap, agentKey, onClick, onAi, aiRunning,
}: {
  card: Card; tagMap: Map<string, Tag>; agentKey: AgentKey;
  onClick: () => void; onAi: () => void; aiRunning: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id });
  // Não aplicamos transform aqui: o DragOverlay cuida da visualização do arrasto.
  // Assim o card fica no lugar (não "desmonta" a coluna) e só a pílula do overlay se move.
  const style: React.CSSProperties = {
    opacity: isDragging ? 0 : 1,
    visibility: isDragging ? "hidden" : "visible",
  };
  const cooling = isCooling(card);
  const urgencyColor = card.urgency ? URGENCY_COLOR[card.urgency] : null;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="group relative rounded-lg border border-border/40 bg-card/70 p-3 hover-lift cursor-grab active:cursor-grabbing"
    >
      {urgencyColor && (
        <span
          className="absolute left-0 top-2 h-6 w-[3px] rounded-r"
          style={{ background: urgencyColor, boxShadow: `0 0 8px ${urgencyColor}` }}
          title={`Urgência: ${card.urgency}`}
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onClick} className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="font-display italic text-base leading-tight text-foreground truncate flex-1">
              {card.contact_name ?? card.chat_id}
            </div>
            {cooling && (
              <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0 animate-pulse" aria-label="Lead esfriando" />
            )}
          </div>
          {card.summary && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{card.summary}</div>
          )}
          {(card.legal_area || typeof card.viability_score === "number") && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {card.legal_area && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                  {card.legal_area}
                </span>
              )}
              {typeof card.viability_score === "number" && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                  style={{
                    borderColor: card.viability_score >= 70 ? "#22c55e55" : card.viability_score >= 40 ? "#eab30855" : "#ef444455",
                    color: card.viability_score >= 70 ? "#22c55e" : card.viability_score >= 40 ? "#eab308" : "#ef4444",
                  }}
                  title="Score de viabilidade"
                >
                  {card.viability_score}
                </span>
              )}
            </div>
          )}
        </button>
        <button
          type="button" onClick={onAi} disabled={aiRunning}
          title="Rodar IA neste card"
          className="p-1.5 rounded-md text-muted-foreground hover:text-accent hover:bg-accent/10 transition"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Bot className={`h-3.5 w-3.5 ${aiRunning ? "animate-spin" : ""}`} />
        </button>
      </div>
      {card.tag_ids?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {card.tag_ids.map((tid) => {
            const t = tagMap.get(tid);
            if (!t) return null;
            return (
              <span
                key={tid}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
                style={{ borderColor: `${t.color}55`, color: t.color, background: `${t.color}12` }}
              >
                {t.name}
              </span>
            );
          })}
        </div>
      )}
      <div className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between gap-2">
        <AgentBadge agentKey={agentKey} />
        {agentKey === "contratos" && <EduardoRunButton cardId={card.id} />}
      </div>

    </div>
  );
}

function EduardoRunButton({ cardId }: { cardId: string }) {
  const navigate = useNavigate();
  const run = useServerFn(runEduardoForCard);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          const r = await run({ data: { card_id: cardId } });
          toast.success(`Eduardo gerou o contrato "${r.template_name}" (score ${r.score}).`);
          navigate({ to: "/eduardo/$contractId", params: { contractId: r.contract_id } });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Falha ao executar o Eduardo.");
        } finally {
          setBusy(false);
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
      title="Eduardo gera o contrato a partir do template e roda a auditoria de IA"
    >
      <FileSignature className={`h-3 w-3 ${busy ? "animate-pulse" : ""}`} />
      {busy ? "gerando…" : "gerar contrato"}
    </button>
  );
}


function CardDetail({
  card, columns, tags, onClose, onDelete, onToggleTag, onAi, onQualified,
}: {
  card: Card; columns: Column[]; tags: Tag[];
  onClose: () => void; onDelete: () => void;
  onToggleTag: (tagId: string) => void; onAi: () => void;
  onQualified: () => void;
}) {
  const col = columns.find((c) => c.id === card.column_id);
  const fnQualify = useServerFn(qualifyCard);
  const fnGetDocs = useServerFn(getCardDocuments);
  const fnToggleDoc = useServerFn(toggleCardDocument);
  const [qualifying, setQualifying] = useState(false);
  const [docs, setDocs] = useState<CardDoc[]>([]);

  async function loadDocs() {
    try {
      const r = await fnGetDocs({ data: { cardId: card.id } });
      setDocs(r as CardDoc[]);
    } catch { /* ignore */ }
  }
  useEffect(() => { loadDocs(); /* eslint-disable-next-line */ }, [card.id]);

  async function handleQualify() {
    setQualifying(true);
    try {
      await fnQualify({ data: { cardId: card.id } });
      toast.success("Card qualificado pela IA");
      await loadDocs();
      onQualified();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha na qualificação";
      toast.error(msg);
    } finally { setQualifying(false); }
  }

  async function handleToggleDoc(doc: CardDoc) {
    setDocs((prev) => prev.map((d) => d.id === doc.id ? { ...d, received: !d.received } : d));
    try { await fnToggleDoc({ data: { id: doc.id, received: !doc.received } }); }
    catch { loadDocs(); }
  }

  const timeline = Array.isArray(card.case_timeline) ? card.case_timeline as { date?: string; event?: string }[] : [];
  const facts = Array.isArray(card.case_facts) ? card.case_facts as string[] : [];
  const cooling = isCooling(card);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-accent/30 bg-card shadow-elegant p-6 animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[10px] uppercase tracking-[0.24em] text-accent">{col?.name}</div>
        <h2 className="font-display italic text-3xl text-foreground mt-1">
          {card.contact_name ?? card.chat_id}
        </h2>
        <div className="text-xs text-muted-foreground mt-1">{card.contact_phone}</div>

        {/* Dossiê jurídico */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <DossieChip label="Área" value={card.legal_area ?? "—"} icon={<Gavel className="h-3 w-3" />} />
          <DossieChip
            label="Urgência" value={card.urgency ?? "—"}
            color={card.urgency ? URGENCY_COLOR[card.urgency] : undefined}
          />
          <DossieChip
            label="Score" value={typeof card.viability_score === "number" ? `${card.viability_score}/100` : "—"}
            color={typeof card.viability_score === "number"
              ? (card.viability_score >= 70 ? "#22c55e" : card.viability_score >= 40 ? "#eab308" : "#ef4444")
              : undefined}
          />
          <DossieChip
            label="Ticket est."
            value={card.estimated_ticket ? `R$ ${Number(card.estimated_ticket).toLocaleString("pt-BR")}` : "—"}
          />
        </div>

        {cooling && (
          <div className="mt-3 flex items-center gap-2 text-xs text-orange-500 bg-orange-500/10 border border-orange-500/30 rounded-md p-2">
            <Flame className="h-3.5 w-3.5" />
            Lead esfriando — sem resposta há mais de {card.sla_hours ?? 24}h
          </div>
        )}

        {card.summary && (
          <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground italic">
            "{card.summary}"
          </div>
        )}

        {facts.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Fatos do caso</div>
            <ul className="text-xs text-foreground/80 space-y-1 list-disc pl-4">
              {facts.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}

        {timeline.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Linha do tempo</div>
            <ol className="border-l border-accent/30 pl-3 space-y-2">
              {timeline.map((t, i) => (
                <li key={i} className="text-xs">
                  <div className="font-mono text-accent">{t.date ?? "—"}</div>
                  <div className="text-foreground/80">{t.event ?? ""}</div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {docs.length > 0 && (
          <div className="mt-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2 flex items-center gap-1.5">
              <ClipboardList className="h-3 w-3" /> Checklist de documentos
              <span className="ml-auto text-muted-foreground">
                {docs.filter((d) => d.received).length}/{docs.length}
              </span>
            </div>
            <div className="space-y-1">
              {docs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded px-2 py-1">
                  <input
                    type="checkbox" checked={d.received}
                    onChange={() => handleToggleDoc(d)}
                    className="accent-accent"
                  />
                  <span className={d.received ? "line-through text-muted-foreground" : "text-foreground"}>
                    {d.document_name}
                  </span>
                  {d.required && !d.received && (
                    <span className="ml-auto text-[9px] uppercase tracking-wider text-orange-500">obrig.</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">Tags</div>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => {
              const active = card.tag_ids?.includes(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => onToggleTag(t.id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition ${active ? "" : "opacity-40 hover:opacity-100"}`}
                  style={{ borderColor: `${t.color}66`, color: t.color, background: active ? `${t.color}18` : "transparent" }}
                >
                  {t.name}
                </button>
              );
            })}
            {tags.length === 0 && <div className="text-xs text-muted-foreground">Nenhuma tag criada</div>}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={handleQualify} disabled={qualifying} className="bg-accent text-accent-foreground shadow-glow">
            <Gavel className={`h-4 w-4 mr-2 ${qualifying ? "animate-pulse" : ""}`} />
            {qualifying ? "Qualificando…" : "Qualificar com IA"}
          </Button>
          <Button onClick={onAi} variant="outline">
            <Bot className="h-4 w-4 mr-2" /> Rodar agente
          </Button>
          <Button variant="outline" asChild>
            <Link to="/crm"><MessageSquare className="h-4 w-4 mr-2" /> Abrir conversa</Link>
          </Button>
          <Button variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4 mr-2" /> Excluir
          </Button>
          <Button variant="ghost" onClick={onClose} className="ml-auto">Fechar</Button>
        </div>
      </div>
    </div>
  );
}

function DossieChip({ label, value, color, icon }: {
  label: string; value: string; color?: string; icon?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md border border-border/40 bg-muted/20 p-2"
      style={color ? { borderColor: `${color}44` } : undefined}
    >
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <div
        className="text-sm font-medium mt-0.5 truncate"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function NewColumnDialog({ onCreated, variant = "header" }: { onCreated: () => void; variant?: "header" | "inline" }) {
  const fnUp = useServerFn(upsertColumn);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) { toast.error("Dê um nome à coluna"); return; }
    setSaving(true);
    try {
      await fnUp({ data: { name: name.trim(), color, rule_prompt: description.trim() || undefined } });
      toast.success("Coluna criada");
      setName(""); setDescription(""); setColor("#8b5cf6");
      setOpen(false);
      onCreated();
    } catch (e: any) {
      toast.error(e.message ?? "Falhou");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "inline" ? (
          <Button
            variant="outline"
            className="w-full h-[120px] border-dashed border-accent/40 text-accent hover:bg-accent/5 flex-col gap-1"
          >
            <Plus className="h-5 w-5" />
            <span className="text-xs uppercase tracking-[0.18em]">Nova coluna</span>
          </Button>
        ) : (
          <Button variant="outline" className="border-accent/30">
            <Plus className="h-4 w-4 mr-2" /> Nova coluna
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display italic text-2xl">Criar nova coluna</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Nome da etapa</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Proposta enviada" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Descrição / regra para o agente IA
            </Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explique quando um lead deve entrar nesta coluna. O agente usa esse texto para decidir."
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Ex: "quando o cliente confirmar que aceitou a proposta comercial"
            </p>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cor</Label>
            <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-24" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} className="bg-gold-gradient text-primary-foreground">
            {saving ? "Criando…" : "Criar coluna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
