import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Canal de presença lido pelo Admin Central ("Conectados agora"). */
export const ONLINE_PRESENCE_CHANNEL = "crm-online-v1";

export interface OnlinePresencePayload {
  user_id: string;
  email: string | null;
  tab_id: string;
  path: string;
  joined_at: string;
}

const LAST_SIGNAL_KEY = "crm_last_reload_signal_at";

/**
 * Anuncia esta aba como conectada e recarrega a página quando o Admin Central
 * envia "Reiniciar". Sem interface visível.
 */
export function OnlinePresence() {
  useEffect(() => {
    let cancelled = false;
    let presence: ReturnType<typeof supabase.channel> | null = null;
    let signals: ReturnType<typeof supabase.channel> | null = null;
    let poll: number | undefined;
    const tabId = (() => {
      try { return crypto.randomUUID(); } catch { return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    })();
    const startedAt = new Date().toISOString();

    const reloadIfNew = (createdAt: string | null | undefined, target: string | null | undefined, userId: string) => {
      if (!createdAt || createdAt <= startedAt) return;
      if (target && target !== userId) return;
      try {
        if (localStorage.getItem(LAST_SIGNAL_KEY) === createdAt) return;
        localStorage.setItem(LAST_SIGNAL_KEY, createdAt);
      } catch { /* sem storage: recarrega mesmo assim */ }
      window.location.reload();
    };

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user || cancelled) return;

      presence = supabase.channel(ONLINE_PRESENCE_CHANNEL, { config: { presence: { key: tabId } } });
      presence.subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        const payload: OnlinePresencePayload = {
          user_id: user.id,
          email: user.email ?? null,
          tab_id: tabId,
          path: window.location.pathname,
          joined_at: startedAt,
        };
        await presence?.track(payload);
      });

      signals = supabase
        .channel(`crm-reload-${tabId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_client_reload_signals" }, (msg) => {
          const row = msg.new as { created_at?: string; target_user_id?: string | null };
          reloadIfNew(row.created_at, row.target_user_id, user.id);
        })
        .subscribe();

      // Reserva caso o tempo real caia: confere o último sinal a cada 60s.
      poll = window.setInterval(async () => {
        const { data } = await supabase
          .from("crm_client_reload_signals" as never)
          .select("created_at, target_user_id")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const row = data as { created_at?: string; target_user_id?: string | null } | null;
        reloadIfNew(row?.created_at, row?.target_user_id, user.id);
      }, 60000);
    })();

    return () => {
      cancelled = true;
      if (poll) window.clearInterval(poll);
      if (presence) supabase.removeChannel(presence);
      if (signals) supabase.removeChannel(signals);
    };
  }, []);

  return null;
}

export default OnlinePresence;
