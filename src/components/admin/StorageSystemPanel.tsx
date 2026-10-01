import { AlertTriangle, Database, FileArchive, HardDrive, Loader2, ScrollText, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface VpsStorageSnapshot {
  database_bytes?: number;
  storage_bytes?: number;
  docker_logs_bytes?: number;
  backups_bytes?: number;
  orphan_disk_bytes?: number;
  root_total_bytes?: number;
  root_used_bytes?: number;
  root_available_bytes?: number;
  docker_total_bytes?: number;
  project_bytes?: number;
  system_logs_bytes?: number;
  created_at?: string;
}

export interface VpsStorageSummary {
  snapshot?: VpsStorageSnapshot;
  maintenance?: { status?: string; requested_at?: string; completed_at?: string; last_error?: string };
  catalogued_media_bytes?: number;
  pending_media_bytes?: number;
  failed_media_count?: number;
}

const formatBytes = (value = 0) => {
  if (value <= 0) return "0 MB";
  const gb = value / 1024 ** 3;
  return gb >= 0.1
    ? `${gb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`
    : `${(value / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

export function StorageSystemPanel({ summary, requesting, onRequest }: { summary: VpsStorageSummary; requesting: boolean; onRequest: () => void }) {
  const snapshot = summary.snapshot || {};
  const hasSnapshot = Boolean(snapshot.created_at);
  const pending = ["pending", "running"].includes(summary.maintenance?.status || "");
  const items = [
    { label: "Banco de dados", value: snapshot.database_bytes, icon: Database },
    { label: "Arquivos", value: snapshot.storage_bytes, icon: HardDrive },
    { label: "Logs", value: snapshot.docker_logs_bytes, icon: ScrollText },
    { label: "Backups", value: snapshot.backups_bytes, icon: FileArchive },
  ];

  return (
    <section className="space-y-3" aria-labelledby="vps-storage-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 id="vps-storage-title" className="text-lg font-semibold">Uso completo do VPS</h3><p className="text-sm text-muted-foreground">Banco, arquivos, logs, backups e resíduos fora das conversas.</p></div>
        <Button variant="destructive" onClick={onRequest} disabled={requesting || pending}>
          {requesting || pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {pending ? "Limpeza solicitada" : "Limpar resíduos do VPS"}
        </Button>
      </div>
      {!hasSnapshot && <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Aguardando a primeira medição</AlertTitle><AlertDescription>Após atualizar a VPS, os valores aparecerão em até 10 minutos.</AlertDescription></Alert>}
      {hasSnapshot && <Card className="p-4"><div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Disco total da VPS</p><p className="text-xl font-bold">{formatBytes(snapshot.root_total_bytes)}</p></div><div><p className="text-xs text-muted-foreground">Todo o espaço usado</p><p className="text-xl font-bold">{formatBytes(snapshot.root_used_bytes)}</p></div><div><p className="text-xs text-muted-foreground">Espaço disponível</p><p className="text-xl font-bold">{formatBytes(snapshot.root_available_bytes)}</p></div></div></Card>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map(({ label, value, icon: Icon }) => <Card key={label} className="p-3"><Icon className="mb-2 h-5 w-5 text-primary" /><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{formatBytes(value)}</p></Card>)}
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <p><span className="text-muted-foreground">Órfãos no disco:</span> <strong>{formatBytes(snapshot.orphan_disk_bytes)}</strong></p>
        <p><span className="text-muted-foreground">Na fila de exclusão:</span> <strong>{formatBytes(summary.pending_media_bytes)}</strong></p>
        <p><span className="text-muted-foreground">Falhas na exclusão:</span> <strong>{Number(summary.failed_media_count || 0).toLocaleString("pt-BR")}</strong></p>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <p><span className="text-muted-foreground">Docker completo:</span> <strong>{formatBytes(snapshot.docker_total_bytes)}</strong></p>
        <p><span className="text-muted-foreground">Projeto:</span> <strong>{formatBytes(snapshot.project_bytes)}</strong></p>
        <p><span className="text-muted-foreground">Logs do sistema:</span> <strong>{formatBytes(snapshot.system_logs_bytes)}</strong></p>
      </div>
      {summary.maintenance?.last_error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Última limpeza falhou</AlertTitle><AlertDescription>{summary.maintenance.last_error}</AlertDescription></Alert>}
    </section>
  );
}