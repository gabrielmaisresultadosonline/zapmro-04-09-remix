import { useEffect, useRef, useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import {
  DedupeProgress,
  hasRunDedupeScan,
  markDedupeScanDone,
  runMediaDedupeScan,
} from "@/lib/mediaDedupeScan";

export interface MediaDedupeScanOverlayProps {
  /** Cadastro logado; sem ele a varredura não roda (evita escopo global). */
  userId?: string | null;
  /** Chamado ao terminar, para recarregar as conversas com as URLs unificadas. */
  onFinished?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/** Tempo restante em linguagem simples ("cerca de 2 min"). */
function formatEta(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `cerca de ${Math.ceil(seconds)} s restantes`;
  const minutes = Math.ceil(seconds / 60);
  return `cerca de ${minutes} min ${minutes === 1 ? "restante" : "restantes"}`;
}


/**
 * Varredura única por cliente: unifica arquivos idênticos já existentes no
 * armazenamento. Aparece uma vez, com barra de progresso, e nas próximas
 * visitas o CRM abre direto.
 */
export const MediaDedupeScanOverlay = ({ userId, onFinished }: MediaDedupeScanOverlayProps) => {
  const [progress, setProgress] = useState<DedupeProgress | null>(null);
  const startedRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!userId || startedRef.current) return;
    if (hasRunDedupeScan(userId)) return;
    startedRef.current = true;

    let cancelled = false;
    setProgress({ step: "Preparando a verificação...", percent: 2 });

    (async () => {
      try {
        const result = await runMediaDedupeScan(userId, (p) => {
          if (!cancelled) setProgress(p);
        });
        // Marca como concluída apenas quando terminou sem exceção, para que uma
        // falha de rede não deixe o cliente sem a otimização.
        markDedupeScanDone(userId);
        if (cancelled) return;
        setProgress({ step: "Concluído", percent: 100 });
        if (result.duplicatesRemoved > 0) {
          toast({
            title: "Armazenamento otimizado",
            description: `${result.duplicatesRemoved} arquivo(s) duplicado(s) unificado(s) — ${formatBytes(result.bytesFreed)} liberados.`,
          });
        }
        onFinished?.();
      } catch (error) {
        console.error("[MediaDedupeScanOverlay] varredura falhou", error);
      } finally {
        if (!cancelled) setTimeout(() => setProgress(null), 600);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, onFinished, toast]);

  if (!progress) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm px-4"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <HardDrive className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Estamos atualizando</p>
            <p className="text-xs text-muted-foreground">
              Verificando os arquivos das conversas uma única vez para liberar espaço.
            </p>
          </div>
        </div>

        <Progress value={progress.percent} className="h-2" />

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progress.step}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Nada é perdido: apenas cópias com conteúdo idêntico são unificadas.
        </p>
      </div>
    </div>
  );
};

export default MediaDedupeScanOverlay;
