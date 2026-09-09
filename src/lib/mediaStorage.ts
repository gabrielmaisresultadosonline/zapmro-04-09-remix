/**
 * mediaStorage — utilitários de armazenamento com deduplicação e coleta de lixo.
 *
 * Por quê: o CRM subia um arquivo novo a cada envio/fluxo, mesmo quando o
 * conteúdo era idêntico (o mesmo vídeo enviado para 200 contatos gerava 200
 * objetos no bucket). Aqui o caminho do arquivo passa a ser derivado do
 * hash SHA-256 do conteúdo, então o mesmo binário sempre reaproveita o mesmo
 * objeto e a mesma URL pública.
 *
 * Também centraliza a remoção: arquivos só são apagados do Storage quando
 * NENHUMA mensagem e NENHUM fluxo do usuário ainda referencia a URL.
 */
import { supabase } from "@/integrations/supabase/client";

export interface DedupedUploadResult {
  /** URL pública final (nova ou reaproveitada). */
  url: string;
  /** Caminho dentro do bucket. */
  path: string;
  /** true quando o binário já existia e nada foi enviado de novo. */
  reused: boolean;
  /** Hash SHA-256 do conteúdo. */
  hash: string;
}

const STORAGE_MARKER = "/storage/v1/object/public/";

/** Calcula o SHA-256 do arquivo em hexadecimal. */
export async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sanitizeExtension(ext?: string | null): string {
  const clean = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean || "bin";
}

/**
 * Sobe um arquivo em caminho determinístico (hash do conteúdo).
 * Se o objeto já existe no bucket, apenas devolve a URL existente.
 */
export async function uploadDedupedMedia(options: {
  bucket: string;
  folder: string;
  file: Blob;
  contentType?: string;
  extension?: string;
  /** Progresso real do envio (0-100). Opcional: sem ele o comportamento é o de antes. */
  onProgress?: (percent: number) => void;
}): Promise<DedupedUploadResult> {
  const { bucket, folder, file, contentType, extension, onProgress } = options;
  const hash = await hashBlob(file);
  const ext = sanitizeExtension(extension);
  const fileName = `${hash}.${ext}`;
  const path = `${folder.replace(/\/+$/, "")}/${fileName}`;

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  const url = publicData.publicUrl;

  // Confere existência sem baixar o binário.
  const { data: existing } = await supabase.storage
    .from(bucket)
    .list(folder.replace(/\/+$/, ""), { limit: 1, search: fileName });

  if (existing?.some((item) => item.name === fileName)) {
    console.log("[mediaStorage] reaproveitando arquivo existente", { bucket, path });
    // Reaproveitar também tira o arquivo da lixeira, se ele estiver lá.
    await registerMediaAsset({
      bucket,
      path,
      url,
      hash,
      mimeType: contentType || (file as File).type || null,
      sizeBytes: (file as Blob).size ?? null,
    });
    return { url, path, reused: true, hash };
  }

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: contentType || (file as File).type || "application/octet-stream",
    upsert: true,
    cacheControl: "31536000",
  });

  // Corrida entre dois uploads do mesmo hash não é erro: o conteúdo é igual.
  if (error && !/exists|duplicate/i.test(error.message)) throw error;

  console.log("[mediaStorage] arquivo enviado", { bucket, path, reused: false });
  await registerMediaAsset({
    bucket,
    path,
    url,
    hash,
    mimeType: contentType || (file as File).type || null,
    sizeBytes: (file as Blob).size ?? null,
  });
  return { url, path, reused: false, hash };
}

/**
 * As funções do catálogo (102-catalogo-de-midias.sql) ainda não constam nos
 * tipos gerados do banco. Este alias mantém a chamada tipada sem `any` e sem
 * quebrar quando o catálogo ainda não foi aplicado na VPS.
 */
type CatalogRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;

const catalogRpc = supabase.rpc.bind(supabase) as unknown as CatalogRpc;

/**
 * Registra o arquivo físico no catálogo (crm_media_assets).
 * Best-effort: se o catálogo ainda não existir no banco, o upload continua
 * funcionando exatamente como antes.
 */
export async function registerMediaAsset(input: {
  bucket: string;
  path: string;
  url: string;
  hash?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}): Promise<void> {
  try {
    const { error } = await catalogRpc("crm_media_register", {
      p_bucket: input.bucket,
      p_path: input.path,
      p_public_url: input.url,
      p_sha256: input.hash ?? null,
      p_mime_type: input.mimeType ?? null,
      p_size_bytes: input.sizeBytes ?? null,
    });
    if (error) console.warn("[mediaStorage] catálogo indisponível", error.message);
  } catch (e) {
    console.warn("[mediaStorage] catálogo indisponível", e);
  }
}

/** Ajusta o contador de referências de uma URL (best-effort). */
async function addMediaReference(url: string, delta: number, reason?: string): Promise<void> {
  try {
    await catalogRpc("crm_media_addref", {
      p_public_url: url,
      p_delta: delta,
      p_reason: reason ?? null,
    });
  } catch {
    /* catálogo opcional */
  }
}

/** Marca URLs como usadas por uma mensagem/fluxo/template. */
export async function retainMediaUrls(urls: Iterable<string>, reason?: string): Promise<void> {
  for (const url of new Set(Array.from(urls).filter(Boolean))) {
    await addMediaReference(url, 1, reason);
  }
}

/** Libera referências (não apaga nada de imediato). */
export async function releaseMediaUrls(urls: Iterable<string>, reason?: string): Promise<void> {
  for (const url of new Set(Array.from(urls).filter(Boolean))) {
    await addMediaReference(url, -1, reason);
  }
}

/** Extrai bucket + path de uma URL pública do Storage. */
export function parseStorageUrl(url: string): { bucket: string; path: string } | null {
  if (typeof url !== "string") return null;
  const idx = url.indexOf(STORAGE_MARKER);
  if (idx === -1) return null;
  const rest = url.slice(idx + STORAGE_MARKER.length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  try {
    return { bucket: rest.slice(0, slash), path: decodeURIComponent(rest.slice(slash + 1)) };
  } catch {
    return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
  }
}

/** Varre qualquer estrutura (nodes/edges/metadata) coletando URLs do Storage. */
export function collectStorageUrls(value: unknown, found = new Set<string>()): Set<string> {
  if (!value) return found;
  if (typeof value === "string") {
    if (value.includes(STORAGE_MARKER)) {
      const matches = value.match(/https?:\/\/[^\s"')]+/g) || [value];
      matches.forEach((m) => {
        if (m.includes(STORAGE_MARKER)) found.add(m.replace(/[)\],.]+$/, ""));
      });
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStorageUrls(item, found));
    return found;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectStorageUrls(item, found));
  }
  return found;
}

/** Retorna as URLs ainda referenciadas por mensagens ou fluxos do usuário. */
async function findUrlsStillInUse(urls: string[], userId?: string | null): Promise<Set<string>> {
  const inUse = new Set<string>();
  if (!urls.length) return inUse;

  // Mensagens: consultas separadas com .eq evitam problemas de escape que o
  // filtro `or(...)` do PostgREST teria com URLs contendo vírgulas/parênteses.
  for (const url of urls) {
    const byMedia = await supabase.from("crm_messages").select("id").eq("media_url", url).limit(1);
    if (byMedia.data && byMedia.data.length > 0) {
      inUse.add(url);
      continue;
    }
    const byContent = await supabase.from("crm_messages").select("id").eq("content", url).limit(1);
    if (byContent.data && byContent.data.length > 0) inUse.add(url);
  }


  // Fluxos: os nodes são pequenos, então varremos no cliente.
  let flowQuery = supabase.from("crm_flows").select("nodes, edges");
  if (userId) flowQuery = flowQuery.eq("user_id", userId);
  const { data: flows } = await flowQuery;
  if (flows?.length) {
    const flowUrls = collectStorageUrls(flows);
    urls.forEach((url) => {
      if (flowUrls.has(url)) inUse.add(url);
    });
  }

  // Templates (inclusive aprovados na Meta): a mídia do cabeçalho não pode sumir.
  let templateQuery = supabase.from("crm_templates").select("components");
  if (userId) templateQuery = templateQuery.eq("user_id", userId);
  const { data: templates } = await templateQuery;
  if (templates?.length) {
    const templateUrls = collectStorageUrls(templates);
    urls.forEach((url) => {
      if (templateUrls.has(url)) inUse.add(url);
    });
  }

  return inUse;
}

/**
 * Agenda a remoção das URLs que não são mais referenciadas.
 *
 * Importante: NADA é apagado na hora. O arquivo entra na lixeira
 * (crm_media_gc_queue) e só sai do disco depois do prazo (7 dias por padrão),
 * e mesmo assim o worker confere de novo se alguém voltou a usar o arquivo.
 * Com `immediate: true` o comportamento antigo (apagar já) é preservado.
 */
export async function deleteMediaUrlsIfUnused(
  urls: Iterable<string>,
  options: {
    userId?: string | null;
    force?: boolean;
    immediate?: boolean;
    reason?: string;
    delayDays?: number;
  } = {},
): Promise<{ removed: number; kept: number; queued: number }> {
  const unique = Array.from(new Set(Array.from(urls).filter(Boolean)));
  if (!unique.length) return { removed: 0, kept: 0, queued: 0 };

  const inUse = options.force ? new Set<string>() : await findUrlsStillInUse(unique, options.userId);
  const byBucket = new Map<string, string[]>();
  const unused: Array<{ url: string; bucket: string; path: string }> = [];
  let kept = 0;

  for (const url of unique) {
    if (inUse.has(url)) {
      kept += 1;
      continue;
    }
    const parsed = parseStorageUrl(url);
    if (!parsed) continue;
    unused.push({ url, bucket: parsed.bucket, path: parsed.path });
    const list = byBucket.get(parsed.bucket) || [];
    list.push(parsed.path);
    byBucket.set(parsed.bucket, list);
  }

  // Caminho padrão: lixeira de 7 dias.
  if (!options.immediate) {
    let queued = 0;
    for (const item of unused) {
      try {
        const { error } = await catalogRpc("crm_media_enqueue_delete", {
          p_bucket: item.bucket,
          p_path: item.path,
          p_public_url: item.url,
          p_reason: options.reason ?? null,
          p_delay_days: options.delayDays ?? 7,
        });
        if (!error) queued += 1;
        else console.warn("[mediaStorage] lixeira indisponível", error.message);
      } catch (e) {
        console.warn("[mediaStorage] lixeira indisponível", e);
      }
    }
    console.log("[mediaStorage] arquivos agendados para remoção", {
      queued,
      kept,
      prazoDias: options.delayDays ?? 7,
    });
    return { removed: 0, kept, queued };
  }

  let removed = 0;
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) {
        console.error("[mediaStorage] falha ao remover arquivos", { bucket, error: error.message });
        continue;
      }
      removed += chunk.length;
    }
  }

  console.log("[mediaStorage] limpeza concluída", { removed, kept });
  return { removed, kept, queued: 0 };
}
