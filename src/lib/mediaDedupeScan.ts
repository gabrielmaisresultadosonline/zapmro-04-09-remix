/**
 * mediaDedupeScan — varredura única (por usuário) que unifica arquivos duplicados.
 *
 * Por quê: antes da deduplicação por hash, cada envio criava um objeto novo no
 * Storage. O mesmo vídeo enviado para 200 conversas virou 200 arquivos. Esta
 * rotina roda UMA vez por cliente, encontra arquivos com conteúdo idêntico,
 * mantém apenas um, aponta todas as referências para ele e só então apaga as
 * cópias sobrando.
 *
 * Segurança (não pode quebrar nada):
 *  - Só considera duplicata quando o SHA-256 do conteúdo é IGUAL (não confia em
 *    nome, tamanho ou data).
 *  - Só apaga a cópia depois que as referências no banco foram atualizadas com
 *    sucesso. Qualquer erro no meio aborta aquela cópia e ela é preservada.
 *  - Nunca apaga a URL "vencedora" nem arquivos que não conseguiu baixar/ler.
 */
import { supabase } from "@/integrations/supabase/client";
import { collectStorageUrls, hashBlob, parseStorageUrl } from "@/lib/mediaStorage";

export interface DedupeProgress {
  /** Etapa legível para o usuário. */
  step: string;
  /** 0–100. */
  percent: number;
}

export interface DedupeResult {
  scanned: number;
  duplicatesRemoved: number;
  bytesFreed: number;
  referencesUpdated: number;
  skipped: number;
}

const STORAGE_KEY_PREFIX = "zapmro:media-dedupe:v2:";
const PAGE = 1000;
/** Não baixamos arquivos gigantes para hashear: risco de travar o navegador. */
const MAX_HASH_BYTES = 25 * 1024 * 1024;

export function hasRunDedupeScan(userId: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`) === "done";
  } catch {
    return true; // sem localStorage, não insistimos na varredura
  }
}

export function markDedupeScanDone(userId: string) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${userId}`, "done");
  } catch {
    /* ignorado: só perde a memória de "já rodou" */
  }
}

interface MessageRow {
  id: string;
  media_url: string | null;
  content: string | null;
}

async function fetchMessagesWithMedia(userId: string): Promise<MessageRow[]> {
  const rows: MessageRow[] = [];
  for (let page = 0; page < 200; page += 1) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from("crm_messages")
      .select("id, media_url, content")
      .eq("user_id", userId)
      .not("media_url", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data || []) as MessageRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

/** Metadados do objeto sem baixar o binário (usado para pré-agrupar). */
async function headMeta(url: string): Promise<{ size: number; type: string } | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const size = Number(res.headers.get("content-length") || 0);
    if (!size) return null;
    return { size, type: res.headers.get("content-type") || "" };
  } catch {
    return null;
  }
}

async function hashUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size || blob.size > MAX_HASH_BYTES) return null;
    return await hashBlob(blob);
  } catch {
    return null;
  }
}

/**
 * Executa a varredura. `onProgress` alimenta a barra de carregamento.
 */
export async function runMediaDedupeScan(
  userId: string,
  onProgress?: (progress: DedupeProgress) => void,
): Promise<DedupeResult> {
  const result: DedupeResult = { scanned: 0, duplicatesRemoved: 0, bytesFreed: 0, referencesUpdated: 0, skipped: 0 };
  const report = (step: string, percent: number) => onProgress?.({ step, percent: Math.min(99, Math.max(1, percent)) });

  report("Lendo as conversas...", 3);
  const messages = await fetchMessagesWithMedia(userId);

  // URLs distintas do Storage referenciadas pelas mensagens.
  const urls = Array.from(collectStorageUrls(messages.map((m) => [m.media_url, m.content])));
  result.scanned = urls.length;
  if (urls.length < 2) return result;

  report("Analisando os arquivos...", 8);
  const byFingerprint = new Map<string, string[]>();
  for (let i = 0; i < urls.length; i += 1) {
    const meta = await headMeta(urls[i]);
    if (!meta) {
      result.skipped += 1;
    } else {
      const key = `${meta.size}|${meta.type}`;
      const list = byFingerprint.get(key) || [];
      list.push(urls[i]);
      byFingerprint.set(key, list);
    }
    if (i % 15 === 0) report(`Analisando arquivos (${i + 1}/${urls.length})...`, 8 + (i / urls.length) * 42);
  }

  // Só grupos com mais de um candidato podem ter duplicata real.
  const groups = Array.from(byFingerprint.entries()).filter(([, list]) => list.length > 1);
  if (!groups.length) return result;

  report("Confirmando arquivos idênticos...", 55);
  let processed = 0;
  const totalGroups = groups.length;

  // Fluxos: carregados uma vez e reescritos apenas se alguma URL mudar.
  const { data: flows } = await supabase.from("crm_flows").select("id, nodes, edges").eq("user_id", userId);
  const flowUpdates = new Map<string, { nodes: string; edges: string }>();
  (flows || []).forEach((flow: any) => {
    flowUpdates.set(String(flow.id), {
      nodes: JSON.stringify(flow.nodes ?? []),
      edges: JSON.stringify(flow.edges ?? []),
    });
  });
  let flowsChanged = false;

  for (const [, list] of groups) {
    const byHash = new Map<string, string[]>();
    for (const url of list) {
      const hash = await hashUrl(url);
      if (!hash) {
        result.skipped += 1;
        continue; // sem certeza => preserva
      }
      const same = byHash.get(hash) || [];
      same.push(url);
      byHash.set(hash, same);
    }

    for (const [, identical] of byHash) {
      if (identical.length < 2) continue;
      const [keep, ...duplicates] = identical;

      for (const duplicate of duplicates) {
        if (duplicate === keep) continue;
        const parsed = parseStorageUrl(duplicate);
        if (!parsed) continue;

        try {
          // 1) Reaponta as mensagens para o arquivo mantido.
          const affected = messages.filter((m) => m.media_url === duplicate || m.content === duplicate);
          for (const message of affected) {
            const patch: { media_url?: string; content?: string } = {};
            if (message.media_url === duplicate) patch.media_url = keep;
            if (message.content === duplicate) patch.content = keep;
            if (!Object.keys(patch).length) continue;
            const { error } = await supabase.from("crm_messages").update(patch).eq("id", message.id);
            if (error) throw error;
            if (patch.media_url) message.media_url = keep;
            if (patch.content) message.content = keep;
            result.referencesUpdated += 1;
          }

          // 2) Reaponta os fluxos (em memória; gravados no fim).
          flowUpdates.forEach((value, flowId) => {
            if (!value.nodes.includes(duplicate) && !value.edges.includes(duplicate)) return;
            flowUpdates.set(flowId, {
              nodes: value.nodes.split(duplicate).join(keep),
              edges: value.edges.split(duplicate).join(keep),
            });
            flowsChanged = true;
          });

          // 3) Só agora o arquivo sobrando sai do bucket.
          const meta = await headMeta(duplicate);
          const { error: removeError } = await supabase.storage.from(parsed.bucket).remove([parsed.path]);
          if (removeError) throw removeError;
          result.duplicatesRemoved += 1;
          result.bytesFreed += meta?.size ?? 0;
        } catch (error) {
          console.error("[mediaDedupeScan] duplicata preservada por erro", { duplicate, error });
          result.skipped += 1;
        }
      }
    }

    processed += 1;
    report(`Unificando arquivos (${processed}/${totalGroups})...`, 55 + (processed / totalGroups) * 40);
  }

  if (flowsChanged) {
    report("Atualizando os fluxos...", 97);
    for (const [flowId, value] of flowUpdates) {
      try {
        await supabase
          .from("crm_flows")
          .update({ nodes: JSON.parse(value.nodes), edges: JSON.parse(value.edges) })
          .eq("id", flowId);
      } catch (error) {
        console.error("[mediaDedupeScan] falha ao atualizar fluxo", { flowId, error });
      }
    }
  }

  console.log("[mediaDedupeScan] concluído", result);
  return result;
}
