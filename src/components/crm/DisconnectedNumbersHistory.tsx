import { useEffect, useMemo, useState } from "react";
import { Copy, History, Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import {
  describeNumber,
  fetchUserFlows,
  isNumberConnected,
  copyFlowsToNumber,
  type SavedFlowSummary,
  type WhatsAppNumberRecord,
} from "@/lib/whatsappNumbers";

interface HistorySource {
  id: string;
  label: string;
  removed: boolean;
}

export interface DisconnectedNumbersHistoryProps {
  userId: string;
  numbers: WhatsAppNumberRecord[];
}

/**
 * Histórico de números desconectados do cadastro, com os fluxos que ficaram
 * salvos em cada um e a opção de transferi-los para um número conectado.
 */
export function DisconnectedNumbersHistory({ userId, numbers }: DisconnectedNumbersHistoryProps) {
  const [flows, setFlows] = useState<SavedFlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<HistorySource | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);

  const connected = useMemo(() => numbers.filter(isNumberConnected), [numbers]);

  const load = async () => {
    setLoading(true);
    setFlows(await fetchUserFlows(userId));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, numbers.length]);

  /** Removidos antigos: só restam os fluxos guardados. Desconectados ficam na lista principal. */
  const sources = useMemo<HistorySource[]>(() => {
    const list: HistorySource[] = [];
    const seen = new Set<string>();
    for (const f of flows) {
      if (f.whatsapp_number_id || !f.archived_from_number_id || seen.has(f.archived_from_number_id)) continue;
      seen.add(f.archived_from_number_id);
      list.push({ id: f.archived_from_number_id, label: f.archived_from_label || "WhatsApp removido", removed: true });
    }
    return list;
  }, [flows]);

  if (sources.length === 0) return null;

  const flowsOf = (id: string) =>
    flows.filter((f) => f.whatsapp_number_id === id || (!f.whatsapp_number_id && f.archived_from_number_id === id));

  const openTransfer = (record: HistorySource) => {
    setSource(record);
    setSelected(new Set(flowsOf(record.id).map((f) => f.id)));
    setTargetId(connected[0]?.id ?? "");
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = async () => {
    if (!source || !targetId) return;
    setSaving(true);
    const result = await copyFlowsToNumber(userId, [...selected], targetId);
    setSaving(false);
    if (!result.success) {
      toast.error(result.error || "Não foi possível copiar os fluxos");
      return;
    }
    toast.success(`${result.count} fluxo(s) copiado(s)`);
    setSource(null);
    void load();
  };

  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-white/50" />
        <h2 className="text-white/80 text-sm font-semibold">Histórico de números desconectados</h2>
      </div>

      {loading ? (
        <div className="py-4 flex justify-center">
          <Loader2 className="w-5 h-5 text-[#00a884] animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map((record) => {
            const count = flowsOf(record.id).length;
            return (
              <div key={record.id} className="rounded-xl border border-white/5 bg-[#111b21]/60 p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white/80 text-sm font-medium truncate">{record.label}</p>
                  <p className="text-white/40 text-xs">
                    {record.removed ? "Removido" : "Desconectado"} • {count} fluxo(s) salvo(s)
                  </p>
                </div>
                <button
                  type="button"
                  disabled={count === 0 || connected.length === 0}
                  onClick={() => openTransfer(record)}
                  title={connected.length === 0 ? "Conecte um número para receber os fluxos" : undefined}
                  className="h-9 px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-2 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                   <Copy className="w-4 h-4" />
                   Copiar fluxos
                </button>
              </div>
            );
          })}
        </div>
      )}

      {source && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202c33] rounded-2xl border border-white/10 p-6">
             <h2 className="text-white font-bold text-lg mb-1">Copiar fluxos</h2>
             <p className="text-white/50 text-xs mb-4">De: {source.label}. Os originais permanecem guardados e as cópias chegam desligadas.</p>

            <div className="max-h-56 overflow-y-auto space-y-1 mb-4">
              {flowsOf(source.id).map((flow) => (
                <label key={flow.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={selected.has(flow.id)} onChange={() => toggle(flow.id)} className="accent-[#00a884]" />
                  <Workflow className="w-4 h-4 text-white/40" />
                  <span className="text-white text-sm truncate">{flow.name || "Fluxo sem nome"}</span>
                </label>
              ))}
            </div>

            <label className="text-white/60 text-xs block mb-1" htmlFor="flow-transfer-target">Para o número</label>
            <select
              id="flow-transfer-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full h-11 rounded-lg bg-[#111b21] border border-white/10 px-3 text-white text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
            >
              {connected.map((n) => (
                <option key={n.id} value={n.id}>{describeNumber(n)}</option>
              ))}
            </select>

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setSource(null)} className="flex-1 h-10 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={saving || selected.size === 0 || !targetId}
                className="flex-1 h-10 rounded-lg bg-[#00a884] hover:bg-[#02916f] text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                 Copiar {selected.size > 0 ? `(${selected.size})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DisconnectedNumbersHistory;
