import { fetchFile } from '@ffmpeg/util';
import { getFfmpeg } from '@/lib/videoCompress';

/**
 * Converte qualquer áudio (mp3, m4a, wav, aac, ogg vorbis, vídeo com áudio...)
 * para o padrão aceito pela Meta como mensagem de voz:
 * OGG + Opus + 48 kHz + Mono. Equivale a:
 *   ffmpeg -i entrada -vn -c:a libopus -ar 48000 -ac 1 saida.ogg
 */
export async function convertToWhatsAppVoice(input: Blob, onProgress?: (pct: number) => void): Promise<File> {
  const ffmpeg = await getFfmpeg();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inName = `in_${id}`;
  const outName = `out_${id}.ogg`;
  const handler = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(100, Math.round(progress * 100))));
  ffmpeg.on('progress', handler);
  try {
    await ffmpeg.writeFile(inName, await fetchFile(input));
    const code = await ffmpeg.exec([
      '-i', inName,
      '-vn', '-map_metadata', '-1',
      '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'voip',
      '-ar', '48000', '-ac', '1',
      '-f', 'ogg', outName,
    ]);
    if (code !== 0) throw new Error('Não foi possível converter este áudio. Tente outro arquivo.');
    const data = await ffmpeg.readFile(outName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
    if (bytes.byteLength < 100) throw new Error('O áudio convertido ficou vazio. Verifique o arquivo original.');
    return new File([new Uint8Array(bytes)], `audio_${id}.ogg`, { type: 'audio/ogg; codecs=opus' });
  } finally {
    ffmpeg.off('progress', handler);
    await ffmpeg.deleteFile(inName).catch(() => undefined);
    await ffmpeg.deleteFile(outName).catch(() => undefined);
  }
}
