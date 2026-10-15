/**
 * Cache de transcrição de áudio por arquivo (media_url).
 *
 * O mesmo áudio de fluxo é enviado para muitos contatos com a mesma URL
 * (upload deduplicado). Antes de pagar uma nova transcrição, procura um texto
 * já salvo para aquele arquivo: primeiro em memória, depois em qualquer
 * mensagem com a mesma URL (metadata.ai_transcript). Depois de transcrever,
 * grava o texto em todas as mensagens com a mesma URL.
 */

const memory = new Map<string, string>()
const MAX_MEMORY = 2000

export function cleanAudioUrl(url: string): string {
  return String(url || '').trim()
}

/** Texto já conhecido para este arquivo, ou '' se nunca foi transcrito. */
export async function getCachedTranscript(supabase: any, url: string): Promise<string> {
  const key = cleanAudioUrl(url)
  if (!key) return ''
  const hit = memory.get(key)
  if (hit) return hit
  try {
    const { data } = await supabase
      .from('crm_messages')
      .select('metadata')
      .eq('media_url', key)
      .not('metadata->>ai_transcript', 'is', null)
      .limit(1)
      .maybeSingle()
    const text = String(data?.metadata?.ai_transcript || '').trim()
    if (text) remember(key, text)
    return text
  } catch {
    return ''
  }
}

function remember(key: string, text: string) {
  if (memory.size >= MAX_MEMORY) memory.delete(memory.keys().next().value as string)
  memory.set(key, text)
}

/** Grava o texto em todas as mensagens do mesmo arquivo (sem mudar o conteúdo visível). */
export async function saveTranscriptForUrl(supabase: any, url: string, text: string): Promise<void> {
  const key = cleanAudioUrl(url)
  if (!key || !text) return
  remember(key, text)
  try {
    const { data } = await supabase
      .from('crm_messages')
      .select('id, metadata')
      .eq('media_url', key)
      .is('metadata->>ai_transcript', null)
      .limit(500)
    for (const row of data || []) {
      await supabase.from('crm_messages')
        .update({ metadata: { ...(row.metadata || {}), ai_transcript: text } })
        .eq('id', row.id)
    }
  } catch (err) {
    console.warn('[AUDIO-CACHE] Falha ao gravar transcrição:', (err as Error)?.message || String(err))
  }
}

/** Transcreve só se o arquivo ainda não tiver texto salvo. */
export async function transcribeOnce(
  supabase: any,
  url: string,
  transcribe: (url: string) => Promise<string>,
): Promise<{ text: string; cached: boolean }> {
  const cached = await getCachedTranscript(supabase, url)
  if (cached) return { text: cached, cached: true }
  const text = String(await transcribe(url) || '').trim()
  if (text) await saveTranscriptForUrl(supabase, url, text)
  return { text, cached: false }
}
