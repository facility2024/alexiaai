import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listLabels,
  createLabel,
  deleteLabel,
  assignLabel,
  unassignLabel,
  listAllAssignments,
} from "@/lib/chat-labels.functions";

const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899",
];

export function LabelsPopover({ chatId }: { chatId: string }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[4]);

  const qc = useQueryClient();
  const listFn = useServerFn(listLabels);
  const createFn = useServerFn(createLabel);
  const deleteFn = useServerFn(deleteLabel);
  const assignFn = useServerFn(assignLabel);
  const unassignFn = useServerFn(unassignLabel);
  const assignmentsFn = useServerFn(listAllAssignments);

  const { data: labels = [] } = useQuery({ queryKey: ["chat-labels"], queryFn: () => listFn() });
  const { data: assignments = [] } = useQuery({
    queryKey: ["chat-label-assignments"],
    queryFn: () => assignmentsFn(),
  });

  const assignedIds = new Set(assignments.filter((a) => a.chat_id === chatId).map((a) => a.label_id));

  const create = useMutation({
    mutationFn: () => createFn({ data: { name: name.trim(), color } }),
    onSuccess: () => {
      toast.success("Etiqueta criada");
      setName(""); setCreating(false);
      qc.invalidateQueries({ queryKey: ["chat-labels"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });
  const toggle = useMutation({
    mutationFn: (v: { label_id: string; on: boolean }) =>
      v.on ? assignFn({ data: { chat_id: chatId, label_id: v.label_id } })
           : unassignFn({ data: { chat_id: chatId, label_id: v.label_id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-label-assignments"] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat-labels"] });
      qc.invalidateQueries({ queryKey: ["chat-label-assignments"] });
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-border/60 hover:border-accent/40 hover:text-accent">
          <Tag className="mr-2 h-3 w-3" /> Etiquetas
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          Etiquetas do chat
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {labels.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Nenhuma etiqueta ainda.</p>
          )}
          {labels.map((l) => {
            const on = assignedIds.has(l.id);
            return (
              <div key={l.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/5">
                <button
                  onClick={() => toggle.mutate({ label_id: l.id, on: !on })}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full"
                    style={{ backgroundColor: l.color }}
                  >
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />
                  </span>
                  <span className="text-xs">{l.name}</span>
                  {on && <span className="ml-auto text-[10px] text-accent">atribuída</span>}
                </button>
                <button
                  onClick={() => remove.mutate(l.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  title="Excluir etiqueta"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/60 p-2">
          {!creating ? (
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-3 w-3" /> Nova etiqueta
            </Button>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder="Nome da etiqueta"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs"
              />
              <div className="flex flex-wrap gap-1.5">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full ring-2 transition ${color === c ? "ring-foreground" : "ring-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  Prévia:
                  <span
                    className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full"
                    style={{ backgroundColor: color }}
                  >
                    <Check className="h-2 w-2 text-white" strokeWidth={4} />
                  </span>
                </div>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setName(""); }}>
                    Cancelar
                  </Button>
                  <Button size="sm" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                    Criar
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
