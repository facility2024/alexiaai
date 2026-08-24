import { Check, UserCheck } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Props = { name: string; color: string; size?: number };

/** Selo estilo "verificado" do Facebook: círculo colorido com check branco. */
export function VerifiedLabelBadge({ name, color, size = 14 }: Props) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={name}
            className="inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-background/60"
            style={{ backgroundColor: color, width: size, height: size }}
          >
            <Check className="text-white" style={{ width: size * 0.7, height: size * 0.7 }} strokeWidth={3.5} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Selo dourado indicando que este chat foi transferido para o atendente atual. */
export function TransferredBadge({ size = 14 }: { size?: number }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label="Transferido para você"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-gold-gradient ring-1 ring-background/60 shadow-glow"
            style={{ width: size, height: size }}
          >
            <UserCheck className="text-primary-foreground" style={{ width: size * 0.7, height: size * 0.7 }} strokeWidth={3} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Transferido pelo agente — você está atendendo
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
