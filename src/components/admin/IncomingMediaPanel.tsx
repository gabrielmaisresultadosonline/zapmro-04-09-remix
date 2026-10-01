import { useCallback, useEffect, useState } from "react";
import { Film, Loader2, Trash2 } from "lucide-react";
import { adminCall, adminErrorMessage, adminRead, type AdminCreds } from "@/lib/adminCentralApi";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface IncomingSummary {
  total_files?: number;
  total_bytes?: number;
  expired_files?: number;
  expired_bytes?: number;
}

const gb = (v?: number) => `${(Number(v || 0) / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;

/** Mídias recebidas pelo WhatsApp (vídeos, áudios, documentos). Apagadas após 15 dias. */
export function IncomingMediaPanel({ creds }: { creds: AdminCreds }) {
  const [summary, setSummary] = useState<IncomingSummary | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminRead<{ summary?: IncomingSummary }>("incoming_media_summary", creds, {}, { timeoutMs: 60000 });
      setSummary(r.summary || {});
    } catch (error) {
      toast.error(adminErrorMessage(error, "Não foi possível medir as mídias recebidas"));
    }
  }, [creds]);

  useEffect(() => { void load(); }, [load]);

  async function expireNow() {
    if (running) return;
    if (!window.confirm("Apagar mídias recebidas com mais de 15 dias? Fluxos, templates, agendamentos, contatos e textos das conversas são preservados.")) return;
    setRunning(true);
    try {
      const r = await adminCall<{ files?: number; bytes?: number }>("expire_incoming_media", creds, {}, { timeoutMs: 300000 });
      toast.success(`${Number(r.files || 0).toLocaleString("pt-BR")} arquivos apagados (${gb(r.bytes)} liberados). Se ainda restar, clique de novo.`);
      await load();
    } catch (error) {
      toast.error(adminErrorMessage(error, "Erro ao apagar mídias antigas"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Film className="h-7 w-7 text-primary" />
        <div>
          <h3 className="font-semibold">Mídias recebidas pelo WhatsApp</h3>
          <p className="text-sm text-muted-foreground">Vídeos, áudios e documentos recebidos ou enviados pelo celular. Apagados automaticamente após 15 dias.</p>
        </div>
      </div>
      {summary === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">Total guardado</p><p className="text-xl font-bold">{gb(summary.total_bytes)}</p><p className="text-xs text-muted-foreground">{Number(summary.total_files || 0).toLocaleString("pt-BR")} arquivos</p></div>
          <div><p className="text-xs text-muted-foreground">Mais de 15 dias</p><p className="text-xl font-bold">{gb(summary.expired_bytes)}</p><p className="text-xs text-muted-foreground">{Number(summary.expired_files || 0).toLocaleString("pt-BR")} arquivos</p></div>
          <Button variant="destructive" onClick={() => void expireNow()} disabled={running || !summary.expired_files} className="self-center">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Limpar mídias antigas
          </Button>
        </div>
      )}
    </Card>
  );
}
