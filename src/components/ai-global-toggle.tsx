// Botão global isolado: liga/desliga TODOS os agentes de IA da organização.
// Usa `ai_global_state` + as server functions já existentes
// (`getAiGlobalState` / `setAiGlobalState`) — não altera a pausa manual
// por chat (`crm_paused_chats`), que continua funcionando normalmente.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAiGlobalState, setAiGlobalState } from "@/lib/chat-routing.functions";

export function AiGlobalToggle() {
  const getFn = useServerFn(getAiGlobalState);
  const setFn = useServerFn(setAiGlobalState);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ai-global-state"],
    queryFn: () => getFn(),
  });

  const mutation = useMutation({
    mutationFn: (active: boolean) => setFn({ data: { active } }),
    onSuccess: (_r, active) => {
      qc.setQueryData(["ai-global-state"], (prev: { active: boolean } | undefined) => ({
        ...(prev ?? { active: true }),
        active,
      }));
      toast.success(active ? "Agentes IA ATIVADOS globalmente" : "Agentes IA DESATIVADOS globalmente");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao alterar estado global"),
  });

  const active = data?.active ?? true;
  const busy = isLoading || mutation.isPending;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-4 py-3 backdrop-blur-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-full ring-1"
        style={{
          background: active ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
          borderColor: active ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)",
        }}
      >
        {active ? <Power className="h-4 w-4 text-emerald-500" /> : <PowerOff className="h-4 w-4 text-red-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Agentes IA — Global</div>
        <div className="text-sm font-medium text-foreground">
          {busy ? "Processando…" : active ? "Todos os agentes atendendo" : "Todos os agentes pausados"}
        </div>
      </div>
      <Button
        size="sm"
        variant={active ? "outline" : "default"}
        disabled={busy}
        onClick={() => mutation.mutate(!active)}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : active ? "Desativar todos" : "Ativar todos"}
      </Button>
    </div>
  );
}
