import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, HardDrive, Loader2, Minus } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
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

interface Point {
  x: number;
  y: number;
}

/**
 * Varredura única por cliente, rodando em SEGUNDO PLANO: o painel é flutuante,
 * arrastável e não bloqueia o uso do CRM. Fecha sozinho ao concluir.
 */
export const MediaDedupeScanOverlay = ({ userId, onFinished }: MediaDedupeScanOverlayProps) => {
  const [progress, setProgress] = useState<DedupeProgress | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [pos, setPos] = useState<Point>({ x: 16, y: 16 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const startedRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!userId || startedRef.current) return;
    if (hasRunDedupeScan(userId)) return;
    startedRef.current = true;

    let cancelled = false;
    setProgress({ step: "Preparando a verificação...", percent: 2 });
    console.log("[dedupe] varredura iniciada em segundo plano para", userId);

    (async () => {
      try {
        const result = await runMediaDedupeScan(userId, (p) => {
          if (!cancelled) setProgress(p);
        });
        markDedupeScanDone(userId);
        if (cancelled) return;
        setProgress({ step: "Concluído", percent: 100 });
        console.log("[dedupe] varredura concluída", result);
        if (result.duplicatesRemoved > 0) {
          toast({
            title: "Armazenamento otimizado",
            description: `${result.duplicatesRemoved} arquivo(s) duplicado(s) unificado(s) — ${formatBytes(result.bytesFreed)} liberados.`,
          });
        }
        onFinished?.();
      } catch (error) {
        console.error("[dedupe] varredura falhou", error);
      } finally {
        if (!cancelled) setTimeout(() => setProgress(null), 1200);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, onFinished, toast]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const maxX = Math.max(0, window.innerWidth - 200);
    const maxY = Math.max(0, window.innerHeight - 80);
    setPos({
      x: Math.min(maxX, Math.max(0, event.clientX - drag.dx)),
      y: Math.min(maxY, Math.max(0, event.clientY - drag.dy)),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!progress) return null;

  return (
    <div
      className={cn(
        "fixed z-[100] w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card/95 shadow-lg backdrop-blur",
        "select-none",
      )}
      style={{ left: pos.x, top: pos.y }}
      role="status"
      aria-live="polite"
    >
      <div
        className="flex cursor-grab items-center gap-2 border-b px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <HardDrive className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          Otimizando armazenamento ({Math.round(progress.percent)}%)
        </p>
        <button
          type="button"
          onClick={() => setMinimized((v) => !v)}
          className="rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={minimized ? "Expandir painel" : "Minimizar painel"}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      {!minimized && (
        <div className="space-y-3 p-3">
          <Progress value={progress.percent} className="h-2" />

          <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span className="truncate">{progress.step}</span>
            </p>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {typeof progress.done === "number" && typeof progress.total === "number"
                  ? `${progress.done} de ${progress.total} arquivos`
                  : `${Math.round(progress.percent)}%`}
              </span>
              <span>{formatEta(progress.etaSeconds) ?? "calculando tempo..."}</span>
            </div>
            {progress.current && (
              <p className="truncate font-mono text-[10px] text-muted-foreground/80" title={progress.current}>
                {progress.current}
              </p>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Continue usando o CRM normalmente — isso roda em segundo plano e some ao terminar.
          </p>
        </div>
      )}
    </div>
  );
};

export default MediaDedupeScanOverlay;
