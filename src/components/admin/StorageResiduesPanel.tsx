import { Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface StorageResidue {
  user_id: string;
  email: string | null;
  full_name: string | null;
  messages_count: number;
  message_bytes: number;
  media_count: number;
  media_bytes: number;
  total_bytes: number;
}

const formatBytes = (value: number) => {
  if (value <= 0) return "0 MB";
  const gb = value / 1024 ** 3;
  return gb >= 0.1 ? `${gb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB` : `${(value / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

export function StorageResiduesPanel({ entries, clearingId, onClear }: { entries: StorageResidue[]; clearingId: string | null; onClear: (entry: StorageResidue) => void }) {
  if (!entries.length) return null;
  return (
    <section className="space-y-3" aria-labelledby="residual-storage-title">
      <div><h3 id="residual-storage-title" className="text-lg font-semibold">Históricos antigos sem número ativo</h3><p className="text-sm text-muted-foreground">Inclui dados antigos de números removidos ou registros que ficaram sem caixa.</p></div>
      {entries.map((entry) => (
        <Card key={entry.user_id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate">{entry.full_name || entry.email || "Cadastro removido"}</strong><Badge variant="secondary">Número removido</Badge></div><p className="text-sm text-muted-foreground">{entry.email || entry.user_id}</p></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
            <div><p className="text-xs text-muted-foreground">Armazenamento</p><p className="font-semibold">{formatBytes(entry.total_bytes)}</p></div>
            <div><p className="text-xs text-muted-foreground">Mensagens antigas</p><p className="font-semibold">{Number(entry.messages_count).toLocaleString("pt-BR")}</p></div>
            <div><p className="text-xs text-muted-foreground">Mídias sem uso</p><p className="font-semibold">{Number(entry.media_count).toLocaleString("pt-BR")}</p></div>
            <Button variant="destructive" size="sm" onClick={() => onClear(entry)} disabled={clearingId !== null}>{clearingId === entry.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Limpar resíduos</Button>
          </div>
        </Card>
      ))}
    </section>
  );
}