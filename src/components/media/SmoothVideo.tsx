import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SmoothVideoProps
  extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src"> {
  /** URL já resolvida do vídeo. */
  src: string;
  /** Classe do elemento <video>. */
  className?: string;
  /** Classe do contêiner que posiciona o indicador de carregamento. */
  containerClassName?: string;
}

/**
 * Player de vídeo tolerante a rede ruim.
 *
 * Por que existe: com muitos espectadores simultâneos o primeiro byte demora e
 * o navegador às vezes desiste (evento `error`) ou fica parado em buffer
 * (`stalled`/`waiting`) sem se recuperar sozinho — o usuário precisava
 * atualizar a página. Aqui o próprio player:
 *
 * - mostra o indicador só quando realmente está esperando dados;
 * - se travar por mais de ~8s, recarrega a fonte e retoma no mesmo segundo;
 * - em caso de erro, tenta novamente com espera progressiva (até 4 vezes);
 * - depois disso oferece um botão de "tentar de novo" em vez de tela preta.
 *
 * A recuperação preserva `currentTime` e o estado de reprodução, então o
 * espectador percebe no máximo um pequeno engasgo.
 */
const MAX_AUTO_RETRIES = 4;
const STALL_TIMEOUT_MS = 8000;

export const SmoothVideo: React.FC<SmoothVideoProps> = ({
  src,
  className,
  containerClassName,
  poster,
  onWaiting,
  onPlaying,
  onError,
  ...rest
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const retriesRef = useRef(0);
  const stallTimerRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current !== null) {
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  /** Recarrega a fonte mantendo posição e reprodução. */
  const recover = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;

    const position = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const wasPlaying = !el.paused && !el.ended;

    try {
      el.load();
      const resume = () => {
        el.removeEventListener("loadedmetadata", resume);
        try {
          if (position > 0.5) el.currentTime = position;
        } catch {
          // Alguns servidores só aceitam seek após o primeiro chunk: ignora.
        }
        if (wasPlaying) void el.play().catch(() => undefined);
      };
      el.addEventListener("loadedmetadata", resume);
    } catch {
      // Sem recuperação possível: o botão manual continua disponível.
    }
  }, []);

  /** Agenda uma recuperação caso o buffer não volte a tempo. */
  const scheduleStallRecovery = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = window.setTimeout(() => {
      if (retriesRef.current >= MAX_AUTO_RETRIES) {
        setFailed(true);
        setLoading(false);
        return;
      }
      retriesRef.current += 1;
      recover();
    }, STALL_TIMEOUT_MS);
  }, [clearStallTimer, recover]);

  // Nova fonte => zera contadores e estados.
  useEffect(() => {
    retriesRef.current = 0;
    setFailed(false);
    setLoading(true);
    clearStallTimer();
    return clearStallTimer;
  }, [src, clearStallTimer]);

  const handleWaiting = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setLoading(true);
    scheduleStallRecovery();
    onWaiting?.(e);
  };

  const handleReady = () => {
    clearStallTimer();
    setLoading(false);
    setFailed(false);
  };

  const handlePlaying = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    handleReady();
    onPlaying?.(e);
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    clearStallTimer();
    if (retriesRef.current < MAX_AUTO_RETRIES) {
      retriesRef.current += 1;
      // Espera progressiva: alivia o servidor quando muitos abrem ao mesmo tempo.
      window.setTimeout(recover, 600 * retriesRef.current);
      return;
    }
    setLoading(false);
    setFailed(true);
    onError?.(e);
  };

  const handleManualRetry = () => {
    retriesRef.current = 0;
    setFailed(false);
    setLoading(true);
    recover();
  };

  return (
    <div className={cn("relative w-full", containerClassName)}>
      {loading && !failed && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <Loader2 className="h-10 w-10 animate-spin text-white/80" aria-label="Carregando vídeo" />
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20 bg-black/70 text-white text-sm">
          <span>Não conseguimos carregar o vídeo agora.</span>
          <button
            type="button"
            onClick={handleManualRetry}
            className="inline-flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 font-semibold transition"
          >
            <RefreshCw className="h-4 w-4" /> Tentar de novo
          </button>
        </div>
      )}

      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        // "metadata" evita que dezenas de espectadores puxem o arquivo inteiro
        // ao mesmo tempo; o prefetch do card já deixa o começo em cache.
        preload="metadata"
        onLoadedMetadata={handleReady}
        onLoadedData={handleReady}
        onCanPlay={handleReady}
        onCanPlayThrough={handleReady}
        onWaiting={handleWaiting}
        onStalled={handleWaiting}
        onPlaying={handlePlaying}
        onError={handleError}
        className={className}
        {...rest}
      />
    </div>
  );
};

export default SmoothVideo;
