import { useCallback, useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Mesma janela usada pelo servidor para iniciar o fluxo ao responder. */
const REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReplyBroadcast {
  id: string;
  name: string;
  reply_flow_id?: string | null;
  reply_flow_cancelled_at?: string | null;
}

interface ReplyItem {
  id: string;
  broadcast_id: string;
  wa_id: string;
  recipient_name: string | null;
  processed_at: string | null;
  reply_flow_started_at: string | null;
  reply_flow_cancelled_at: string | null;
}

type ReplyState = "waiting" | "answered" | "cancelled" | "expired";

const STATE_LABEL: Record<ReplyState, string> = {
  waiting: "Aguardando",
  answered: "Respondeu / atendido",
  cancelled: "Cancelado",
  expired: "Expirado (7 dias)",
};

/** Calcula o estado da resposta a partir dos dados persistidos. */
export function getReplyState(item: ReplyItem, campaign?: ReplyBroadcast, now = Date.now()): ReplyState {
  if (item.reply_flow_started_at) return "answered";
  if (item.reply_flow_cancelled_at || campaign?.reply_flow_cancelled_at) return "cancelled";
  const sentAt = item.processed_at ? new Date(item.processed_at).getTime() : 0;
  if (!sentAt || now - sentAt > REPLY_WINDOW_MS) return "expired";
  return "waiting";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broadcasts: ReplyBroadcast[];
  initialBroadcastId?: string | null;
  onChanged?: () => void;
}

export default function BroadcastReplyQueue({ open, onOpenChange, broadcasts, initialBroadcastId, onChanged }: Props) {
  const replyCampaigns = useMemo(() => broadcasts.filter((b) => b.reply_flow_id), [broadcasts]);
  const campaignById = useMemo(() => new Map(replyCampaigns.map((b) => [b.id, b])), [replyCampaigns]);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<ReplyState | "all">("waiting");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ReplyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) setCampaignFilter(initialBroadcastId || "all");
  }, [open, initialBroadcastId]);

  const load = useCallback(async () => {
    const ids = campaignFilter === "all" ? replyCampaigns.map((b) => b.id) : [campaignFilter];
    if (ids.length === 0) { setItems([]); return; }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("crm_broadcast_items")
        .select("id, broadcast_id, wa_id, recipient_name, processed_at, reply_flow_started_at, reply_flow_cancelled_at")
        .in("broadcast_id", ids)
        .eq("status", "sent")
        .order("processed_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      setItems((data || []) as ReplyItem[]);
    } catch (e: any) {
      toast.error("Não foi possível carregar a lista", { description: e?.message });
    } finally {
      setLoading(false);
    }
  }, [campaignFilter, replyCampaigns]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const now = Date.now();
  const withState = items.map((i) => ({ ...i, state: getReplyState(i, campaignById.get(i.broadcast_id), now) }));
  const counts = withState.reduce<Record<ReplyState, number>>(
    (acc, i) => { acc[i.state]++; return acc; },
    { waiting: 0, answered: 0, cancelled: 0, expired: 0 },
  );
  const term = search.trim().toLowerCase();
  const visible = withState.filter((i) =>
    (stateFilter === "all" || i.state === stateFilter) &&
    (!term || i.wa_id.includes(term) || (i.recipient_name || "").toLowerCase().includes(term)));
  const waitingIds = withState.filter((i) => i.state === "waiting").map((i) => i.id);

  const cancelItems = async (ids: string[], key: string) => {
    if (ids.length === 0) return;
    setBusy(key);
    try {
      const stamp = new Date().toISOString();
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await (supabase as any).from("crm_broadcast_items")
          .update({ reply_flow_cancelled_at: stamp })
          .in("id", ids.slice(i, i + 200))
          .is("reply_flow_started_at", null);
        if (error) throw error;
      }
      toast.success(`${ids.length} resposta(s) cancelada(s)`, { description: "Se responderem agora, o fluxo não será enviado." });
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error("Falha ao cancelar", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const cancelCampaign = async (campaignId: string) => {
    if (!window.confirm("Cancelar o fluxo de resposta desta campanha inteira? Quem responder depois não receberá o fluxo.")) return;
    setBusy(`c-${campaignId}`);
    try {
      const { error } = await (supabase as any).from("crm_broadcasts")
        .update({ reply_flow_cancelled_at: new Date().toISOString() }).eq("id", campaignId);
      if (error) throw error;
      toast.success("Fluxo de resposta cancelado para a campanha");
      onChanged?.();
      await load();
    } catch (e: any) {
      toast.error("Falha ao cancelar", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const selected = campaignFilter !== "all" ? campaignById.get(campaignFilter) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Aguardando resposta dos disparos</DialogTitle>
          <DialogDescription>
            Quem responder em até 7 dias recebe o fluxo configurado, uma única vez. Cancele para não enviar mais o fluxo.
          </DialogDescription>
        </DialogHeader>

        {replyCampaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum disparo com fluxo ao responder nesta caixa.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os disparos</SelectItem>
                  {replyCampaigns.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}{b.reply_flow_cancelled_at ? " (cancelado)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Buscar nome ou número" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(["waiting", "answered", "cancelled", "expired", "all"] as const).map((s) => (
                <Button key={s} type="button" size="sm" variant={stateFilter === s ? "default" : "outline"}
                  className="h-7 text-xs" onClick={() => setStateFilter(s)}>
                  {s === "all" ? `Todos (${withState.length})` : `${STATE_LABEL[s]} (${counts[s]})`}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="destructive" className="h-8 text-xs"
                disabled={waitingIds.length === 0 || !!busy}
                onClick={() => window.confirm(`Cancelar ${waitingIds.length} resposta(s) aguardando?`) && cancelItems(waitingIds, "all")}>
                {busy === "all" ? <RefreshCcw className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                Cancelar todos aguardando ({waitingIds.length})
              </Button>
              {selected && !selected.reply_flow_cancelled_at && (
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={!!busy}
                  onClick={() => cancelCampaign(selected.id)}>
                  Cancelar fluxo desta campanha
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => load()} disabled={loading}>
                <RefreshCcw className={cn("w-3 h-3 mr-1", loading && "animate-spin")} /> Atualizar
              </Button>
            </div>

            <ScrollArea className="flex-1 min-h-[200px] max-h-[50vh] border border-border rounded-md">
              <div className="divide-y divide-border">
                {visible.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-6 text-center">{loading ? "Carregando..." : "Nenhum contato neste filtro."}</p>
                ) : visible.map((i) => (
                  <div key={i.id} className="flex items-center gap-2 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{i.recipient_name || i.wa_id}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {i.wa_id} · {campaignById.get(i.broadcast_id)?.name || "Campanha"}
                        {i.processed_at ? ` · enviado ${new Date(i.processed_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
                      </p>
                    </div>
                    <Badge variant={i.state === "answered" ? "default" : i.state === "waiting" ? "secondary" : "outline"} className="text-[10px] shrink-0">
                      {STATE_LABEL[i.state]}
                    </Badge>
                    {i.state === "waiting" && (
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive shrink-0"
                        disabled={!!busy} onClick={() => cancelItems([i.id], i.id)} aria-label="Cancelar resposta">
                        {busy === i.id ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                        <span className="ml-1 hidden sm:inline">Cancelar</span>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
