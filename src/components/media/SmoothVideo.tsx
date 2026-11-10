import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { mediaFileOpens } from "@/lib/mediaStorage";

export interface SmoothVideoProps
  extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src"> {
  /** URL já resolvida do vídeo. */
  src: string;
  /** Classe do elemento <video>. */
  className?: string;
  /** Classe do contêiner que posiciona o indicador de carregamento. */
  containerClassName?: string;
  /**
   * Playlist HLS adaptativa (opcional). Quando existe, o vídeo começa na
   * qualidade mais leve e sobe conforme a conexão; se falhar, volta para `src`.
   */
  hlsSrc?: string | null;
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
  hlsSrc,
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
  // Arquivo não existe mais no servidor: não adianta tentar de novo.
  const [missing, setMissing] = useState(false);
  const probedRef = useRef(false);
  // true enquanto o hls.js (ou HLS nativo do Safari) controla o vídeo.
  const [, setHlsActive] = useState(false);
  const hlsActiveRef = useRef(false);

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
    setMissing(false);
    probedRef.current = false;
    setLoading(true);
    clearStallTimer();
    return clearStallTimer;
  }, [src, clearStallTimer]);

  // Liga o streaming adaptativo quando há playlist HLS.
  useEffect(() => {
    const el = videoRef.current;
    hlsActiveRef.current = false;
    setHlsActive(false);
    if (!el || !hlsSrc) return;
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    const fallback = () => {
      hlsActiveRef.current = false;
      setHlsActive(false);
      hls?.destroy();
      hls = null;
      el.src = src;
      el.load();
      if (rest.autoPlay) void el.play().catch(() => undefined);
    };

    // Safari/iOS tocam HLS nativamente (com troca de qualidade automática).
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      hlsActiveRef.current = true;
      setHlsActive(true);
      el.src = hlsSrc;
      const onNativeError = () => fallback();
      el.addEventListener("error", onNativeError, { once: true });
      return () => el.removeEventListener("error", onNativeError);
    }

    void import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) return fallback(); // toca o MP4 normal
      hlsActiveRef.current = true;
      setHlsActive(true);
      const inst = new Hls({
        startLevel: 0, // começa na qualidade mais leve: abre rápido
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 400_000,
        maxBufferLength: 30,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 4,
      });
      hls = inst;
      let mediaRecoveries = 0;
      inst.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && mediaRecoveries < 3) {
          mediaRecoveries += 1;
          inst.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 3) {
          mediaRecoveries += 1;
          inst.recoverMediaError();
        } else {
          fallback();
        }
      });
      inst.loadSource(hlsSrc);
      inst.attachMedia(el);
    }).catch(() => { if (!destroyed) fallback(); });

    return () => {
      destroyed = true;
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlsSrc, src]);

  const handleWaiting = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    setLoading(true);
    // Com HLS o próprio hls.js recupera e baixa a qualidade sozinho.
    if (!hlsActiveRef.current) scheduleStallRecovery();
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
    if (hlsActiveRef.current) return; // tratado pelo hls.js / fallback
    if (!probedRef.current && /^https?:\/\//i.test(src)) {
      probedRef.current = true;
      void mediaFileOpens(src).then((ok) => {
        if (ok) return;
        clearStallTimer();
        retriesRef.current = MAX_AUTO_RETRIES;
        setMissing(true);
        setFailed(true);
        setLoading(false);
      });
    }
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
          <span className="px-4 text-center">
            {missing
              ? "Este vídeo não está mais no servidor. Ele precisa ser enviado de novo pela administração."
              : "Não conseguimos carregar o vídeo agora."}
          </span>
          {!missing && <button
            type="button"
            onClick={handleManualRetry}
            className="inline-flex items-center gap-2 rounded-full bg-white/15 hover:bg-white/25 px-4 py-2 font-semibold transition"
          >
            <RefreshCw className="h-4 w-4" /> Tentar de novo
          </button>}
        </div>
      )}

      <video
        ref={videoRef}
        src={hlsSrc ? undefined : src}
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
