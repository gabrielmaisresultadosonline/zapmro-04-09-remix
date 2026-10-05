import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
// Núcleo ESM servido pelo próprio site: o worker do ffmpeg é "module" e não
// consegue carregar a versão UMD (era a causa de "failed to import ffmpeg-core.js").
import ffmpegCoreURL from '@ffmpeg/core?url';
import ffmpegWasmURL from '@ffmpeg/core/wasm?url';

// Limite oficial da Meta/WhatsApp para vídeo: 16 MB decimais.
// A compressão mira abaixo do limite porque a Meta reprova o arquivo de forma assíncrona
// quando o MP4 fica sem trilha de vídeo ou com contêiner/codec fora do padrão esperado.
export const WHATSAPP_VIDEO_MAX_BYTES = 16_000_000;
const TARGET_BYTES = 15_500_000;
const FFMPEG_LOAD_TIMEOUT_MS = 120_000;
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

export type CompressProgress = (pct: number) => void;

export interface CompressOptions {
  startTime?: number;
  endTime?: number;
  targetMb?: number;
  targetBytes?: number;
  maxBytes?: number;
}

/**
 * Carrega o ffmpeg.wasm uma única vez (chamadas simultâneas compartilham a
 * mesma carga). Em falha, descarta a instância para a próxima tentativa
 * começar limpa, e sempre devolve uma mensagem legível.
 */
export async function getFfmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    const instance = new FFmpeg();
    let timer: number | undefined;
    try {
      await Promise.race([
        instance.load({
          coreURL: new URL(ffmpegCoreURL, window.location.href).href,
          wasmURL: new URL(ffmpegWasmURL, window.location.href).href,
        }),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(
            () => reject(new Error('O conversor demorou demais para carregar. Verifique a internet e tente de novo.')),
            FFMPEG_LOAD_TIMEOUT_MS,
          );
        }),
      ]);
      ffmpegInstance = instance;
      return instance;
    } catch (err) {
      try { instance.terminate(); } catch { /* instância já encerrada */ }
      ffmpegInstance = null;
      const detail = err instanceof Error && err.message ? err.message : String(err || '');
      throw new Error(`Não foi possível carregar o conversor de mídia${detail ? `: ${detail}` : ''}.`);
    } finally {
      if (timer) window.clearTimeout(timer);
      ffmpegLoading = null;
    }
  })();

  return ffmpegLoading;
}

async function readFfmpegFileAsBytes(ffmpeg: FFmpeg, path: string) {
  const data = await ffmpeg.readFile(path);
  return data instanceof Uint8Array ? data : new TextEncoder().encode(data);
}

async function assertMp4HasVideoStream(ffmpeg: FFmpeg, outputName: string) {
  const probeName = `${outputName}.probe.json`;
  const exitCode = await ffmpeg.ffprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,width,height',
    '-of', 'json',
    outputName,
    '-o', probeName,
  ], 60_000);

  if (exitCode !== 0) {
    await ffmpeg.deleteFile(probeName).catch(() => undefined);
    throw new Error('A Meta recusaria este vídeo porque não foi possível validar a trilha de vídeo. Tente enviar o arquivo original novamente.');
  }

  const probeBytes = await readFfmpegFileAsBytes(ffmpeg, probeName);
  await ffmpeg.deleteFile(probeName).catch(() => undefined);
  const probeText = new TextDecoder().decode(probeBytes);
  const probe = JSON.parse(probeText || '{}');
  const stream = Array.isArray(probe?.streams) ? probe.streams[0] : null;

  if (stream?.codec_type !== 'video' || !stream?.width || !stream?.height) {
    throw new Error('A Meta recusaria este arquivo: o MP4 gerado ficou sem trilha de vídeo. Comprima novamente a partir do vídeo original.');
  }
}

async function transcodeToMetaMp4(
  ffmpeg: FFmpeg,
  inputName: string,
  outputName: string,
  startTime: number,
  duration: number,
  videoBitrate: number,
  audioBitrate: number,
  onProgress?: CompressProgress,
) {
  const progressHandler = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) {
      onProgress?.(Math.max(1, Math.min(95, Math.round(progress * 95))));
    }
  };

  ffmpeg.on('progress', progressHandler);
  try {
    const exitCode = await ffmpeg.exec([
      '-ss', startTime.toFixed(3),
      '-i', inputName,
      '-t', duration.toFixed(3),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '4.0',
      '-preset', 'veryfast',
      '-b:v', String(videoBitrate),
      '-maxrate', String(Math.floor(videoBitrate * 1.25)),
      '-bufsize', String(Math.floor(videoBitrate * 2)),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', String(audioBitrate),
      '-ac', '1',
      '-movflags', '+faststart',
      '-brand', 'mp42',
      '-f', 'mp4',
      outputName,
    ], 180_000);

    if (exitCode !== 0) {
      throw new Error('Não foi possível converter o vídeo para MP4 compatível com a Meta. Tente cortar alguns segundos e comprimir novamente.');
    }
  } finally {
    ffmpeg.off('progress', progressHandler);
  }
}

export async function compressVideoForWhatsApp(
  file: File,
  onProgress?: CompressProgress,
  options: CompressOptions = {}
): Promise<File> {
  // Carrega metadados apenas para calcular duração/corte. A conversão real é feita
  // com FFmpeg, não com MediaRecorder, para evitar MP4 sem stream de vídeo.
  const srcUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = srcUrl;
  video.muted = true;
  video.volume = 0;
  video.playsInline = true;

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('Erro ao carregar vídeo'));
  });

  const fullDur = video.duration;
  if (!fullDur || !isFinite(fullDur)) {
    URL.revokeObjectURL(srcUrl);
    throw new Error('Não foi possível ler a duração do vídeo');
  }

  const startTime = Math.max(0, Math.min(options.startTime ?? 0, fullDur));
  const endTime = Math.max(startTime + 0.1, Math.min(options.endTime ?? fullDur, fullDur));
  const dur = endTime - startTime;
  const maxBytes = options.maxBytes ?? WHATSAPP_VIDEO_MAX_BYTES;
  let targetBytes = options.targetBytes ?? (options.targetMb ? options.targetMb * 1024 * 1024 : TARGET_BYTES);
  targetBytes = Math.min(targetBytes, Math.floor(maxBytes * 0.98));

  const audioBitrate = 64_000;
  let targetBitrate = Math.max(180_000, Math.floor((targetBytes * 8) / dur) - audioBitrate);
  URL.revokeObjectURL(srcUrl);

  const ffmpeg = await getFfmpeg();
  const sourceExt = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const inputName = `input-${Date.now()}.${sourceExt}`;
  const base = file.name.replace(/\.[^.]+$/, '');
  let finalBytes: Uint8Array | null = null;

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const outputName = `output-${Date.now()}-${attempt}.mp4`;
      onProgress?.(attempt === 0 ? 1 : 5);
      await transcodeToMetaMp4(ffmpeg, inputName, outputName, startTime, dur, targetBitrate, audioBitrate, onProgress);
      await assertMp4HasVideoStream(ffmpeg, outputName);
      const bytes = await readFfmpegFileAsBytes(ffmpeg, outputName);
      await ffmpeg.deleteFile(outputName).catch(() => undefined);

      if (bytes.byteLength <= maxBytes) {
        finalBytes = bytes;
        break;
      }

      targetBitrate = Math.max(140_000, Math.floor(targetBitrate * (maxBytes / bytes.byteLength) * 0.86));
    }
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => undefined);
  }

  if (!finalBytes) {
    throw new Error('Ainda acima de 16MB. Corte mais um pedaço e tente novamente.');
  }

  const arrayBuffer = new ArrayBuffer(finalBytes.byteLength);
  new Uint8Array(arrayBuffer).set(finalBytes);
  const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
  onProgress?.(100);
  return new File([blob], `${base}-meta.mp4`, { type: 'video/mp4' });
}