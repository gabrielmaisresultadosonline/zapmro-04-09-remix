import { Clock, Megaphone, User } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getConversationWindow, type ConversationWindowContact } from "@/lib/conversationWindow";

export interface ConversationWindowBadgeProps {
  contact: ConversationWindowContact | null | undefined;
  /** Relógio externo (re-render por segundo já existente no CRM). */
  now: number;
}

const formatDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const formatRemaining = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

/**
 * Selo da janela de atendimento (24h comum / 72h anúncio Click-to-WhatsApp).
 * Clique abre os detalhes: origem, última mensagem recebida, tipo, expiração.
 */
export function ConversationWindowBadge({ contact, now }: ConversationWindowBadgeProps) {
  const win = getConversationWindow(contact, now);
  const remaining = win.expires_at ? new Date(win.expires_at).getTime() - now : 0;
  const isAd = win.source === "click_to_whatsapp_ad";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Detalhes da janela de atendimento"
          className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded border shadow-sm shrink-0 text-[8px] font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            win.is_open ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {isAd ? <Megaphone className="w-2.5 h-2.5" /> : <Clock className={cn("w-2.5 h-2.5", !win.is_open && "animate-pulse")} />}
          {win.type} · {win.is_open ? formatRemaining(remaining) : "EXPIRADA"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-xs space-y-2" align="end">
        <p className={cn("font-black text-sm", win.is_open ? "text-primary" : "text-destructive")}>
          {win.is_open ? "JANELA ABERTA" : "JANELA EXPIRADA"}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Origem</dt>
          <dd className="flex items-center gap-1 font-semibold">
            {isAd ? <><Megaphone className="w-3 h-3" /> Anúncio Click-to-WhatsApp</> : <><User className="w-3 h-3" /> Cliente (conversa comum)</>}
          </dd>
          <dt className="text-muted-foreground">Última recebida</dt>
          <dd className="font-semibold">{formatDateTime(contact?.last_message_received_at ?? null)}</dd>
          <dt className="text-muted-foreground">Tipo</dt>
          <dd className="font-semibold">{win.type}</dd>
          <dt className="text-muted-foreground">Abertura</dt>
          <dd className="font-semibold">{formatDateTime(win.opened_at)}</dd>
          <dt className="text-muted-foreground">Expira em</dt>
          <dd className="font-semibold">{formatDateTime(win.expires_at)}</dd>
        </dl>
        <p className="text-muted-foreground border-t border-border pt-2">
          {win.is_open
            ? "Mensagens livres liberadas. Envios da empresa não estendem a janela."
            : "Mensagens livres bloqueadas. Envie somente um template aprovado pela Meta."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default ConversationWindowBadge;
