import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RotateCw, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminCall, adminErrorMessage, type AdminCreds } from "@/lib/adminCentralApi";
import { ONLINE_PRESENCE_CHANNEL, type OnlinePresencePayload } from "@/components/crm/OnlinePresence";

interface OnlineUser {
  user_id: string;
  email: string | null;
  tabs: number;
  since: string;
}

/** Admin Central: quem está com o CRM aberto agora + reiniciar páginas. */
export function OnlineNowPanel({ creds }: { creds: AdminCreds }) {
  const [entries, setEntries] = useState<OnlinePresencePayload[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase.channel(ONLINE_PRESENCE_CHANNEL);
    const sync = () => {
      const state = channel.presenceState<OnlinePresencePayload>();
      setEntries(Object.values(state).flat().filter((p) => p?.user_id));
    };
    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => { supabase.removeChannel(channel); };
  }, []);

  const users = useMemo<OnlineUser[]>(() => {
    const map = new Map<string, OnlineUser>();
    for (const p of entries) {
      const cur = map.get(p.user_id);
      if (cur) {
        cur.tabs += 1;
        if (p.joined_at < cur.since) cur.since = p.joined_at;
      } else {
        map.set(p.user_id, { user_id: p.user_id, email: p.email, tabs: 1, since: p.joined_at });
      }
    }
    return [...map.values()].sort((a, b) => (a.email || "").localeCompare(b.email || ""));
  }, [entries]);

  const reload = async (userId: string | null) => {
    if (!userId && !window.confirm(`Recarregar a página de todos os ${users.length} conectados agora?`)) return;
    setBusy(userId ?? "all");
    try {
      await adminCall("reload_clients", creds, { userId });
      toast.success(userId ? "Página desse usuário será recarregada." : "Todas as páginas abertas serão recarregadas.");
    } catch (e) {
      toast.error(adminErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4 space-y-4 bg-white border-[#E8F5F1]">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-[#25D366]" />
          <h3 className="font-semibold text-[#075E54]">Conectados agora</h3>
          <Badge className="bg-[#25D366]/15 text-[#075E54] hover:bg-[#25D366]/15 border-0">{users.length} usuário{users.length === 1 ? "" : "s"} · {entries.length} aba{entries.length === 1 ? "" : "s"}</Badge>
          {!connected && <span className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> conectando…</span>}
        </div>
        <Button onClick={() => reload(null)} disabled={busy !== null} className="bg-[#128C7E] hover:bg-[#075E54] text-white disabled:opacity-70">
          {busy === "all" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCw className="h-4 w-4 mr-2" />}
          Reiniciar todos
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Mostra quem está com o CRM aberto neste momento. "Reiniciar" recarrega a página de cada aba aberta (conversas, fluxos e contatos não são afetados).
      </p>
      {users.length === 0 ? (
        <p className="text-sm text-center text-slate-500 py-6">Ninguém com o CRM aberto agora.</p>
      ) : (
        <ul className="divide-y divide-[#E8F5F1]">
          {users.map((u) => (
            <li key={u.user_id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium break-all flex items-center gap-2 text-[#075E54]">
                  <span className="w-2 h-2 rounded-full bg-[#25D366] animate-pulse" /> {u.email || u.user_id}
                </p>
                <p className="text-xs text-slate-500">
                  {u.tabs} aba{u.tabs === 1 ? "" : "s"} · aberto desde {new Date(u.since).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => reload(u.user_id)} disabled={busy !== null} className="shrink-0 bg-white border-[#25D366]/40 text-[#075E54] hover:bg-[#F0FDF4] hover:text-[#075E54]">
                {busy === u.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                <span className="ml-1">Reiniciar</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default OnlineNowPanel;
