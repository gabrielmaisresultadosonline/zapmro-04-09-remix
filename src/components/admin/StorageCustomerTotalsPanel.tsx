import { ChevronDown, Database, FileText, HardDrive, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface CustomerStorageEntry {
  user_id: string;
  email: string | null;
  full_name: string | null;
  database_row_bytes: number;
  media_file_bytes: number;
  total_bytes: number;
  total_rows: number;
  categories: Record<string, number>;
  table_details: Record<string, { rows?: number; bytes?: number }>;
  active_numbers: number;
  disconnected_numbers: number;
  removed_numbers: number;
  measured_at: string;
}

const formatBytes = (value = 0) => {
  if (value <= 0) return "0 MB";
  const gb = value / 1024 ** 3;
  return gb >= 0.1 ? `${gb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB` : `${(value / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

export function StorageCustomerTotalsPanel({ entries }: { entries: CustomerStorageEntry[] }) {
  return (
    <section className="space-y-3" aria-labelledby="customer-storage-title">
      <div>
        <h3 id="customer-storage-title" className="text-lg font-semibold">Total completo por cadastro</h3>
        <p className="text-sm text-muted-foreground">Mensagens, mídias, contatos, fluxos, templates, disparos, configurações e demais registros salvos.</p>
      </div>
      <div className="space-y-3">
        {entries.map((entry) => (
          <Card key={entry.user_id} className="p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <strong className="block truncate">{entry.full_name || entry.email || "Cadastro sem identificação"}</strong>
                <p className="truncate text-sm text-muted-foreground">{entry.email || entry.user_id}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{entry.active_numbers} ativos</Badge>
                  <Badge variant="secondary">{entry.disconnected_numbers} desconectados</Badge>
                  <Badge variant="secondary">{entry.removed_numbers} removidos</Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
                <div><HardDrive className="mb-1 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">Total salvo</p><p className="font-semibold">{formatBytes(entry.total_bytes)}</p></div>
                <div><Database className="mb-1 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">Registros</p><p className="font-semibold">{formatBytes(entry.database_row_bytes)}</p></div>
                <div><FileText className="mb-1 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">Mídias</p><p className="font-semibold">{formatBytes(entry.media_file_bytes)}</p></div>
                <div><Users className="mb-1 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">Itens salvos</p><p className="font-semibold tabular-nums">{Number(entry.total_rows || 0).toLocaleString("pt-BR")}</p></div>
              </div>
            </div>
            <details className="mt-4 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium"><ChevronDown className="h-4 w-4" /> Ver todas as categorias</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(entry.categories || {}).sort((a, b) => Number(b[1]) - Number(a[1])).map(([label, bytes]) => (
                  <div key={label} className="rounded-md border border-border p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium">{formatBytes(Number(bytes))}</p></div>
                ))}
              </div>
            </details>
          </Card>
        ))}
      </div>
    </section>
  );
}