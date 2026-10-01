import { useCallback, useEffect, useMemo, useState } from "react";
import { Database, HardDrive, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { adminCall, adminErrorMessage, adminRead, type AdminCreds } from "@/lib/adminCentralApi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { StorageResiduesPanel, type StorageResidue } from "@/components/admin/StorageResiduesPanel";
import { StorageSystemPanel, type VpsStorageSummary } from "@/components/admin/StorageSystemPanel";

export interface StorageEntry {
  user_id: string;
  email: string;
  full_name: string | null;
  whatsapp_number_id: string;
  number_label: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
  is_connected: boolean;
  is_primary: boolean;
  messages_count: number;
  contacts_count: number;
  message_bytes: number;
  media_bytes: number;
  total_bytes: number;
  last_message_at: string | null;
  last_cleanup_at: string | null;
}

const formatBytes = (value: number) => {
  if (value <= 0) return "0 MB";
  const gb = value / 1024 ** 3;
  if (gb >= 0.1) return `${gb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
  return `${(value / 1024 ** 2).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
};

function StorageRow({ entry, onClear, clearing }: { entry: StorageEntry; onClear: (entry: StorageEntry) => void; clearing: boolean }) {
  const number = entry.display_phone_number || entry.number_label || entry.verified_name || "Número sem identificação";
  return (
    <Card className="p-4 border-border bg-card text-card-foreground">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate">{entry.full_name || entry.email}</strong>
            <Badge variant={entry.is_connected ? "default" : "secondary"}>{entry.is_connected ? "Conectado" : "Já conectado"}</Badge>
            {entry.is_primary && <Badge variant="outline">Principal</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{entry.email}</p>
          <p className="font-medium">{number}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[520px]">
          <div><p className="text-xs text-muted-foreground">Armazenamento</p><p className="font-semibold">{formatBytes(entry.total_bytes)}</p></div>
          <div><p className="text-xs text-muted-foreground">Mensagens</p><p className="font-semibold tabular-nums">{entry.messages_count.toLocaleString("pt-BR")}</p></div>
          <div><p className="text-xs text-muted-foreground">Contatos</p><p className="font-semibold tabular-nums">{entry.contacts_count.toLocaleString("pt-BR")}</p></div>
          <Button variant="destructive" size="sm" onClick={() => onClear(entry)} disabled={clearing || entry.messages_count === 0}>
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Zerar histórico
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function StorageAdminPanel({ creds }: { creds: AdminCreds }) {
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [residues, setResidues] = useState<StorageResidue[]>([]);
  const [vps, setVps] = useState<VpsStorageSummary>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<StorageEntry | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [requestingVpsCleanup, setRequestingVpsCleanup] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminRead<{ entries?: StorageEntry[]; residues?: StorageResidue[]; vps?: VpsStorageSummary }>("list_storage", creds);
      setEntries(result.entries || []);
      setResidues(result.residues || []);
      setVps(result.vps || {});
    } catch (error) {
      toast.error(adminErrorMessage(error, "Erro ao carregar armazenamento"));
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? entries.filter((entry) => [entry.email, entry.full_name, entry.number_label, entry.display_phone_number, entry.verified_name].some((value) => value?.toLowerCase().includes(term))) : entries;
  }, [entries, query]);
  const totalBytes = entries.reduce((sum, entry) => sum + Number(entry.total_bytes || 0), 0);

  async function clearStorage() {
    if (!target || clearingId) return;
    setClearingId(target.whatsapp_number_id);
    try {
      const result = await adminCall<{ deletedMessages?: number; freedBytes?: number }>("clear_number_storage", creds, { userId: target.user_id, numberId: target.whatsapp_number_id });
      toast.success(`${Number(result.deletedMessages || 0).toLocaleString("pt-BR")} mensagens apagadas; contatos e número preservados.`);
      setTarget(null);
      await load();
    } catch (error) {
      toast.error(adminErrorMessage(error, "Erro ao zerar o histórico"));
    } finally {
      setClearingId(null);
    }
  }

  async function clearResidues(entry: StorageResidue) {
    if (clearingId) return;
    if (!window.confirm("Limpar mensagens antigas e mídias sem uso deste cadastro? Contatos, fluxos e templates serão preservados.")) return;
    setClearingId(entry.user_id);
    try {
      const result = await adminCall<{ deletedMessages?: number }>("clear_residual_storage", creds, { userId: entry.user_id });
      toast.success(`${Number(result.deletedMessages || 0).toLocaleString("pt-BR")} mensagens antigas removidas; contatos preservados.`);
      await load();
    } catch (error) {
      toast.error(adminErrorMessage(error, "Erro ao limpar resíduos antigos"));
    } finally {
      setClearingId(null);
    }
  }

  async function requestVpsCleanup() {
    if (requestingVpsCleanup) return;
    if (!window.confirm("Solicitar limpeza segura de arquivos órfãos, logs e backups antigos do VPS?")) return;
    setRequestingVpsCleanup(true);
    try {
      await adminCall("request_vps_storage_cleanup", creds);
      toast.success("Limpeza solicitada. A VPS executará em até 10 minutos.");
      await load();
    } catch (error) {
      toast.error(adminErrorMessage(error, "Erro ao solicitar limpeza do VPS"));
    } finally {
      setRequestingVpsCleanup(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="flex items-center gap-3 p-4"><HardDrive className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Total estimado</p><p className="text-2xl font-bold">{formatBytes(totalBytes)}</p></div></Card>
        <Card className="flex items-center gap-3 p-4"><Database className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">WhatsApps armazenados</p><p className="text-2xl font-bold">{entries.length.toLocaleString("pt-BR")}</p></div></Card>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cadastro ou número..." /></div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Recarregar</Button>
      </div>
      <p className="text-sm text-muted-foreground">A limpeza automática remove históricos sem atividade há 30 dias. Contatos, números, configurações, fluxos e templates permanecem salvos.</p>
      <StorageSystemPanel summary={vps} requesting={requestingVpsCleanup} onRequest={() => void requestVpsCleanup()} />
      <StorageResiduesPanel entries={residues} clearingId={clearingId} onClear={(entry) => void clearResidues(entry)} />
      <div><h3 className="text-lg font-semibold">Armazenamento por WhatsApp</h3><p className="text-sm text-muted-foreground">Mostra caixas conectadas e desconectadas que ainda permanecem cadastradas.</p></div>
      {loading ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : <div className="space-y-3">{filtered.map((entry) => <StorageRow key={entry.whatsapp_number_id} entry={entry} onClear={setTarget} clearing={clearingId === entry.whatsapp_number_id} />)}{filtered.length === 0 && <Card className="p-8 text-center text-muted-foreground">Nenhum armazenamento encontrado.</Card>}</div>}
      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}><DialogContent><DialogHeader><DialogTitle>Zerar o histórico deste WhatsApp?</DialogTitle><DialogDescription>As mensagens e mídias exclusivas serão apagadas. O cadastro, o número, os contatos, as configurações, os fluxos e os templates serão mantidos.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button><Button variant="destructive" onClick={() => void clearStorage()} disabled={clearingId !== null}>{clearingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Zerar agora</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}