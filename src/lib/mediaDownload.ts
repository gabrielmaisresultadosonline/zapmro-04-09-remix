/**
 * mediaDownload — baixa arquivos do chat preservando o nome original.
 *
 * Por quê: o atributo `download` de um <a> é ignorado quando o arquivo vem de
 * outra origem (o Storage), então o navegador salvava com o nome do servidor
 * (ex.: "documento (1).pdf" ou "media_1712...").  Baixando o binário e
 * gerando um object URL local o nome escolhido é sempre respeitado.
 */

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

/** Remove caracteres que o sistema de arquivos não aceita. */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "arquivo";
}

/** Extensão a partir da URL (ignora query string). */
function extensionFromUrl(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const last = clean.split("/").pop() || "";
  const parts = last.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

/**
 * Nome final do arquivo: prioriza o nome original enviado pelo usuário e só
 * completa a extensão quando ela realmente estiver faltando.
 */
export function buildDownloadName(url: string, fileName?: string | null, mimeType?: string | null): string {
  const fallbackExt = extensionFromUrl(url) || (mimeType ? EXTENSION_BY_MIME[mimeType.split(";")[0].trim()] : "") || "";
  if (fileName && fileName.trim()) {
    const clean = sanitizeFileName(fileName);
    if (/\.[a-z0-9]{1,8}$/i.test(clean) || !fallbackExt) return clean;
    return `${clean}.${fallbackExt}`;
  }
  const base = `arquivo-${new Date().toISOString().slice(0, 10)}`;
  return fallbackExt ? `${base}.${fallbackExt}` : base;
}

/**
 * Baixa a mídia mantendo o nome original.
 * Se o fetch falhar (CORS/offline), abre em nova aba como antes.
 */
export async function downloadMediaFile(
  url: string,
  fileName?: string | null,
  mimeType?: string | null,
): Promise<void> {
  const finalName = buildDownloadName(url, fileName, mimeType);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = finalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch (error) {
    console.warn("[mediaDownload] falha ao baixar, abrindo em nova aba", error);
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
