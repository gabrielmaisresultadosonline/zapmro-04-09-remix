/**
 * Escolha única da chave da OpenAI usada pelo Agente I.A., Recuperador e
 * gerador de prompt.
 *
 * Problema que resolve: cada parte lia a chave de um lugar ("cadastro do
 * contato", "cadastro de quem clicou", variável do servidor...). Quando a
 * leitura do cadastro falhava ou vinha de outro dono, caía na chave do
 * servidor — antiga e cancelada pela OpenAI — e o usuário via "chave recusada"
 * mesmo com uma chave nova e válida salva no CRM.
 *
 * Ordem testada (a primeira aceita pela OpenAI vence):
 *   1. cadastros informados (quem clicou, dono do contato)
 *   2. dono do número de WhatsApp
 *   3. cadastro legado
 *   4. variável OPENAI_API_KEY do servidor
 * O teste é um GET de modelo (sem custo). Resultado fica em cache por 10 min.
 * Nunca registra a chave nem partes dela.
 */

const LEGACY_SETTINGS_ID = '00000000-0000-0000-0000-000000000001';
const CACHE_MS = 10 * 60 * 1000;

type KeyStatus = { ok: boolean; status: number; message: string; at: number };
const keyStatusCache = new Map<string, KeyStatus>();

export const cleanOpenAiKey = (v: unknown): string => String(v || '').replace(/\s+/g, '');

export interface ResolvedOpenAiKey {
  key: string;
  source: string;
  /** true quando todas as chaves encontradas foram recusadas (401/403). */
  allRejected: boolean;
  lastMessage: string;
  sourcesTried: string[];
}

async function testKey(key: string): Promise<KeyStatus> {
  const cached = keyStatusCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  let result: KeyStatus;
  try {
    const res = await fetch('https://api.openai.com/v1/models/gpt-4o-mini', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(12_000),
    });
    const body = res.ok ? null : await res.json().catch(() => ({}));
    const message = String(body?.error?.message || (res.ok ? '' : `HTTP ${res.status}`))
      .replace(/sk-[A-Za-z0-9_*.\-]+/g, 'sk-…').slice(0, 200);
    result = { ok: res.ok, status: res.status, message, at: Date.now() };
  } catch (e: any) {
    // Falha de rede: não condena a chave.
    result = { ok: true, status: 0, message: String(e?.message || e), at: Date.now() - CACHE_MS + 30_000 };
  }
  keyStatusCache.set(key, result);
  return result;
}

/** Marca uma chave como recusada (ex.: a chamada real devolveu 401). */
export function markOpenAiKeyRejected(key: string, status: number, message: string) {
  keyStatusCache.set(cleanOpenAiKey(key), { ok: false, status, message, at: Date.now() });
}

export async function resolveOpenAiKey(
  supabase: any,
  opts: { userIds?: Array<string | null | undefined>; whatsappNumberId?: string | null; firstKeys?: Array<{ source: string; key: unknown }> },
): Promise<ResolvedOpenAiKey> {
  const candidates: Array<{ source: string; key: string }> = [];
  const push = (source: string, raw: unknown) => {
    const key = cleanOpenAiKey(raw);
    if (key && !candidates.some((c) => c.key === key)) candidates.push({ source, key });
  };
  for (const k of opts.firstKeys || []) push(k.source, k.key);

  const userIds = Array.from(new Set((opts.userIds || []).filter(Boolean) as string[]));
  try {
    if (opts.whatsappNumberId) {
      const { data: num } = await supabase.from('crm_whatsapp_numbers')
        .select('user_id').eq('id', opts.whatsappNumberId).maybeSingle();
      if (num?.user_id && !userIds.includes(num.user_id)) userIds.push(num.user_id);
    }
    for (const uid of userIds) {
      const { data, error } = await supabase.from('crm_settings')
        .select('openai_api_key').eq('user_id', uid).maybeSingle();
      if (error) console.warn('[OPENAI-KEY] Falha ao ler cadastro', JSON.stringify({ user_id: uid, error: error.message }));
      push(`cadastro:${uid.slice(0, 8)}`, data?.openai_api_key);
    }
    const { data: legacy } = await supabase.from('crm_settings')
      .select('openai_api_key').eq('id', LEGACY_SETTINGS_ID).maybeSingle();
    push('legado', legacy?.openai_api_key);
  } catch (e: any) {
    console.warn('[OPENAI-KEY] Falha ao listar chaves', e?.message || e);
  }
  push('servidor', Deno.env.get('OPENAI_API_KEY'));

  const sourcesTried = candidates.map((c) => c.source);
  if (candidates.length === 0) return { key: '', source: '', allRejected: false, lastMessage: '', sourcesTried };

  let lastMessage = '';
  for (const c of candidates) {
    const st = await testKey(c.key);
    if (st.ok || (st.status !== 401 && st.status !== 403)) {
      console.log('[OPENAI-KEY] Chave em uso', JSON.stringify({ source: c.source, status: st.status, tried: sourcesTried }));
      return { key: c.key, source: c.source, allRejected: false, lastMessage: st.message, sourcesTried };
    }
    lastMessage = st.message;
    console.warn('[OPENAI-KEY] Chave recusada', JSON.stringify({ source: c.source, status: st.status, message: st.message }));
  }
  return { key: candidates[0].key, source: candidates[0].source, allRejected: true, lastMessage, sourcesTried };
}
