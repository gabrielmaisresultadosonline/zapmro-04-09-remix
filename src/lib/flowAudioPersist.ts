import { supabase } from '@/integrations/supabase/client';
import { resolveMediaUrl } from '@/lib/mediaUrl';

/**
 * Suporte à conversão "uma vez só" dos áudios de fluxos.
 *
 * Por quê: antes, o áudio convertido ficava só na tela até o usuário clicar em
 * Salvar. Se ele fechasse sem salvar (ou a lista de fluxos estivesse
 * desatualizada), a conversão recomeçava a cada abertura. Aqui:
 *  1. o resultado é gravado direto no fluxo salvo na nuvem (crm_flows.nodes);
 *  2. um cache local mapeia URL original → URL convertida (reabrir é instantâneo);
 *  3. arquivos que já são OGG + Opus + mono são apenas marcados, sem reconverter.
 */

export interface ConvertedAudio {
  audioUrl: string;
  fileName: string;
}

const CACHE_KEY = 'crm_flow_audio_converted_v1';

function readCache(): Record<string, ConvertedAudio> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getCachedConversion(originalUrl: string): ConvertedAudio | null {
  const hit = readCache()[originalUrl];
  return hit && typeof hit.audioUrl === 'string' && hit.audioUrl ? hit : null;
}

export function setCachedConversion(originalUrl: string, result: ConvertedAudio): void {
  try {
    const cache = readCache();
    cache[originalUrl] = result;
    // Mantém o cache pequeno: só as 300 conversões mais recentes.
    const entries = Object.entries(cache).slice(-300);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* armazenamento local indisponível: segue sem cache */
  }
}

/**
 * Lê só o começo do arquivo e verifica se já é OGG + Opus + mono.
 * O Opus sempre decodifica a 48 kHz, então esse arquivo já é aceito pela Meta.
 */
export async function isAlreadyWhatsAppVoice(url: string): Promise<boolean> {
  try {
    const res = await fetch(resolveMediaUrl(url), { headers: { Range: 'bytes=0-4095' } });
    if (!res.ok && res.status !== 206) return false;
    const bytes = new Uint8Array(await res.arrayBuffer()).subarray(0, 4096);
    const ascii = new TextDecoder('latin1').decode(bytes);
    if (!ascii.startsWith('OggS')) return false;
    const head = ascii.indexOf('OpusHead');
    if (head < 0) return false;
    const channels = bytes[head + 9];
    return channels === 1;
  } catch {
    return false;
  }
}

/**
 * Grava os novos dados do bloco direto no fluxo salvo, sem depender do botão
 * Salvar. Atualiza apenas o bloco indicado, preservando o restante do fluxo.
 * Retorna a lista de blocos gravada (ou null se não deu para gravar).
 */
export async function persistFlowNodeData(
  flowId: string | null | undefined,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<any[] | null> {
  if (!flowId) return null;
  const { data: row, error } = await supabase
    .from('crm_flows')
    .select('nodes')
    .eq('id', flowId)
    .maybeSingle();
  if (error || !row) return null;

  const current: any[] = Array.isArray((row as any).nodes) ? (row as any).nodes : [];
  let changed = false;
  const next = current.map((n) => {
    if (n?.id !== nodeId) return n;
    changed = true;
    return { ...n, data: { ...(n.data || {}), ...patch } };
  });
  if (!changed) return null;

  const { data: updated, error: upErr } = await supabase
    .from('crm_flows')
    .update({ nodes: next, updated_at: new Date().toISOString() } as any)
    .eq('id', flowId)
    .select('id');
  if (upErr || !updated?.length) return null;
  return next;
}
