/**
 * Gera o prompt do Agente I.A. a partir dos últimos atendimentos de um WhatsApp.
 *
 * Roda em segundo plano, em lotes pequenos (poucas conversas por rodada),
 * com trava no banco (crm_claim_ai_prompt_job) para nunca rodar em dobro.
 * Usa a chave OpenAI do próprio cadastro. Etapas:
 *  1. reading: para cada conversa, transcreve os áudios (dos dois lados),
 *     separa CLIENTE x ATENDENTE e extrai um resumo estruturado;
 *  2. writing: junta todos os resumos e escreve o prompt final completo.
 */

import { transcribeOnce } from './audio-transcript-cache.ts'

export const PROMPT_JOB_DAYS = 5
export const PROMPT_JOB_MAX_CONTACTS = 120
const CONTACTS_PER_STEP = 2
const MAX_AUDIOS_PER_CONTACT = 8
const MAX_TRANSCRIPT_CHARS = 24000
const MAX_NOTE_CHARS = 1800
const MAX_ATTEMPTS = 60
/** Abaixo disso o resultado tende a ficar fraco: avisamos o usuário. */
export const LOW_VOLUME_CONVERSATIONS = 5
export const LOW_VOLUME_MESSAGES = 60

class FatalAiError extends Error {}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** Lista as conversas do período com troca real (cliente e atendente). */
export async function collectConversations(supabase: any, userId: string, numberId: string | null, days = PROMPT_JOB_DAYS) {
  const since = sinceIso(days)
  const counts = new Map<string, { inbound: number; outbound: number }>()
  let messages = 0
  const pageSize = 1000
  for (let page = 0; page < 30; page++) {
    let q = supabase.from('crm_messages')
      .select('contact_id, direction')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1)
    if (numberId) q = q.eq('whatsapp_number_id', numberId)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    for (const m of data || []) {
      if (!m.contact_id) continue
      const c = counts.get(m.contact_id) || { inbound: 0, outbound: 0 }
      if (m.direction === 'inbound') c.inbound++
      else c.outbound++
      counts.set(m.contact_id, c)
      messages++
    }
    if (!data || data.length < pageSize) break
  }
  // Conversas de verdade: o cliente falou e alguém respondeu. Mais longas primeiro.
  const ranked = [...counts.entries()]
    .filter(([, c]) => c.inbound > 0 && c.outbound > 0)
    .sort((a, b) => (b[1].inbound + b[1].outbound) - (a[1].inbound + a[1].outbound))
  return {
    contactIds: ranked.slice(0, PROMPT_JOB_MAX_CONTACTS).map(([id]) => id),
    conversations: ranked.length,
    messages,
  }
}

/** Remove trechos de chave (sk-...) da mensagem da OpenAI antes de mostrar/salvar. */
function sanitizeProviderMessage(msg: string): string {
  return String(msg || '').replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, 'sk-…').slice(0, 300)
}

/**
 * Chamada de chat com recuos automáticos:
 * - modelo indisponível/sem permissão no projeto (401/403/404 em modelo ≠ mini) → tenta gpt-4o-mini;
 * - modo JSON recusado (400) → tenta sem response_format;
 * - 401 em chave restrita (Missing scopes) → mensagem específica de permissão.
 * Só vira erro fatal quando o gpt-4o-mini (o mesmo do teste da chave) também é recusado.
 */
async function openAiChat(apiKey: string, model: string, system: string, user: string, json: boolean, maxTokens: number): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const providerMsg = sanitizeProviderMessage(data?.error?.message || `OpenAI ${res.status}`)
    const errCode = String(data?.error?.code || data?.error?.type || '')
    console.warn(`[PROMPT-BUILDER] OpenAI ${res.status} (${model}${json ? ', json' : ''}): ${errCode} ${providerMsg}`)
    // Modelo maior recusado → mesmo modelo do teste da chave.
    if ([401, 403, 404].includes(res.status) && model !== 'gpt-4o-mini') {
      return openAiChat(apiKey, 'gpt-4o-mini', system, user, json, maxTokens)
    }
    // Modo JSON recusado → texto livre (a nota continua útil).
    if (res.status === 400 && json) return openAiChat(apiKey, model, system, user, false, maxTokens)
    if (res.status === 402 || /insufficient_quota|credit_balance_exhausted|billing_hard_limit/i.test(errCode)) {
      throw new FatalAiError('A conta da OpenAI está sem créditos. Adicione créditos e tente de novo.')
    }
    if ((res.status === 401 || res.status === 403) && /insufficient permissions|missing scopes|scope/i.test(providerMsg)) {
      throw new FatalAiError(`A chave da OpenAI não tem permissão para gerar textos (chave restrita). Em platform.openai.com/api-keys, edite a chave e marque "All" ou libere "Model capabilities". Detalhe da OpenAI: ${providerMsg}`)
    }
    if (res.status === 401 && /invalidated|revoked|deactivated|disabled/i.test(providerMsg)) {
      throw new FatalAiError('A OpenAI cancelou esta chave (foi apagada ou detectada como exposta). Gere uma chave NOVA em platform.openai.com/api-keys, cole no Agente I.A., clique em "Salvar Motor" e gere de novo.')
    }
    if (res.status === 401) {
      throw new FatalAiError(`A OpenAI recusou a chave salva no Agente I.A. Clique em "Salvar Motor" depois de testar a chave e tente de novo. Detalhe da OpenAI: ${providerMsg}`)
    }
    throw new Error(providerMsg)
  }
  return String(data?.choices?.[0]?.message?.content || '').trim()
}

/**
 * Chaves recusadas na transcrição nesta execução. Quando a OpenAI recusa o
 * áudio (ex.: chave sem permissão de áudio), o prompt segue só com os textos
 * em vez de parar tudo.
 */
const audioRefusedKeys = new Set<string>()

async function transcribe(apiKey: string, url: string): Promise<string> {
  try {
    if (!url || !url.startsWith('http') || audioRefusedKeys.has(apiKey)) return ''
    const audio = await fetch(url)
    if (!audio.ok) return ''
    const blob = await audio.blob()
    if (blob.size > 24 * 1024 * 1024) return ''
    const form = new FormData()
    form.append('file', blob, url.split('/').pop()?.split('?')[0] || 'audio.ogg')
    form.append('model', 'whisper-1')
    form.append('language', 'pt')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form,
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      audioRefusedKeys.add(apiKey)
      console.warn(`[PROMPT-JOB] OpenAI recusou a transcrição (${res.status}): ${data?.error?.message || ''}. Seguindo só com textos.`)
      return ''
    }
    return res.ok ? String(data?.text || '').trim() : ''
  } catch {
    return ''
  }
}

const isPlaceholder = (text: string) => !text || /^\[(áudio|audio|mensagem|imagem|vídeo|video)/i.test(text) || /^🎤|^🎵/.test(text)

/** Monta a conversa com papéis separados; transcreve e guarda os áudios. */
async function buildTranscript(supabase: any, apiKey: string, contactId: string, days: number) {
  const { data } = await supabase.from('crm_messages')
    .select('id, direction, message_type, content, media_url, metadata, created_at')
    .eq('contact_id', contactId)
    .eq('is_deleted', false)
    .gte('created_at', sinceIso(days))
    .order('created_at', { ascending: true })
    .limit(400)
  const rows: any[] = data || []
  // Prioriza os áudios do atendente (é onde está a explicação da venda).
  const pending = rows
    .filter((m) => m.message_type === 'audio' && m.media_url && !m.metadata?.ai_transcript && isPlaceholder(String(m.content || '')))
    .sort((a, b) => (a.direction === 'outbound' ? -1 : 1) - (b.direction === 'outbound' ? -1 : 1))
  // Mesmo arquivo (ex.: áudio de fluxo repetido) é transcrito uma única vez.
  const byUrl = new Map<string, any[]>()
  for (const m of pending) byUrl.set(m.media_url, [...(byUrl.get(m.media_url) || []), m])
  let transcribed = 0
  let paid = 0
  for (const [url, group] of byUrl) {
    if (paid >= MAX_AUDIOS_PER_CONTACT) break
    const { text, cached } = await transcribeOnce(supabase, url, (u) => transcribe(apiKey, u))
    if (!cached) paid++
    if (!text) continue
    transcribed++
    for (const m of group) m.metadata = { ...(m.metadata || {}), ai_transcript: text }
  }
  const lines: string[] = []
  const seenAudio = new Set<string>()
  for (const m of rows) {
    const who = m.direction === 'inbound' ? 'CLIENTE' : 'ATENDENTE'
    const transcript = m.metadata?.ai_transcript
    let text = String(m.content || '').trim()
    if (m.message_type === 'audio') {
      const key = String(m.media_url || transcript || '')
      if (key && seenAudio.has(key)) text = '(áudio repetido, mesmo de antes)'
      else {
        if (key) seenAudio.add(key)
        text = transcript ? `(áudio) ${transcript}` : (isPlaceholder(text) ? '(áudio sem transcrição)' : `(áudio) ${text}`)
      }
    }
    else if (m.message_type === 'image') text = `(imagem)${text ? ' ' + text : ''}`
    else if (m.message_type === 'video') text = `(vídeo)${text ? ' ' + text : ''}`
    else if (m.message_type === 'document') text = `(documento)${text ? ' ' + text : ''}`
    if (!text) continue
    lines.push(`${who}: ${text.slice(0, 1500)}`)
  }
  let joined = lines.join('\n')
  if (joined.length > MAX_TRANSCRIPT_CHARS) {
    joined = joined.slice(0, MAX_TRANSCRIPT_CHARS / 2) + '\n[...]\n' + joined.slice(-MAX_TRANSCRIPT_CHARS / 2)
  }
  return { transcript: joined, messages: rows.length, transcribed }
}

const NOTE_SYSTEM = `Você analisa UMA conversa de WhatsApp entre um ATENDENTE (a empresa) e um CLIENTE.
As linhas "ATENDENTE:" são da empresa (inclui áudios transcritos); "CLIENTE:" são do cliente.
Extraia SOMENTE fatos presentes na conversa, sem inventar. Responda em JSON com as chaves:
"produtos" (o que é vendido, planos, condições), "precos" (valores, formas de pagamento, descontos),
"teste_gratis" (se existe ou não teste/garantia, exatamente como foi dito), "processo_venda" (passo a passo que o atendente seguiu),
"perguntas_cliente" (dúvidas e objeções do cliente), "respostas_atendente" (como o atendente respondeu cada dúvida/objeção),
"tom_de_voz" (estilo do atendente: formal/informal, gírias, emojis, tamanho das mensagens, expressões que repete),
"frases_marcantes" (até 5 frases reais do atendente que representam bem o jeito dele),
"resultado" (fechou, não fechou, em andamento) e "outros" (prazos, links, horários, regras, entregas).
Use listas curtas de strings. Deixe vazio o que não aparecer.`

const FINAL_SYSTEM = `Você é especialista em criar prompts de sistema para agentes de vendas e atendimento no WhatsApp.
Recebe resumos de vários atendimentos REAIS de uma empresa (separando o que o cliente perguntou e o que o atendente respondeu).
Escreva, em português do Brasil, o prompt de sistema mais completo e profissional possível para um agente de I.A. atender os clientes
EXATAMENTE como esse atendente atende. Regras:
- Use somente informações que aparecem nos resumos; quando houver informações conflitantes (ex.: preços diferentes), use a mais recente/frequente e sinalize.
- Se algo não existe (ex.: "não há teste grátis"), deixe isso explícito.
- Nunca invente preços, links, prazos ou promessas. Onde faltar informação, oriente o agente a perguntar ou transferir para um humano.
Estrutura obrigatória (títulos em MAIÚSCULAS, sem markdown com **):
1. IDENTIDADE E OBJETIVO
2. TOM DE VOZ E ESTILO (como escreve, tamanho das mensagens, emojis, expressões típicas, exemplos de frases reais)
3. PRODUTOS E SERVIÇOS
4. PREÇOS, PLANOS E PAGAMENTO
5. TESTE GRÁTIS / GARANTIA
6. PROCESSO DE VENDA PASSO A PASSO (como o atendente conduz do primeiro contato ao fechamento)
7. PERGUNTAS FREQUENTES E RESPOSTAS (lista completa, no estilo do atendente)
8. OBJEÇÕES E COMO CONTORNAR
9. INFORMAÇÕES IMPORTANTES (prazos, horários, links, regras)
10. QUANDO TRANSFERIR PARA UM HUMANO
11. O QUE NUNCA FAZER
Responda apenas com o prompt final, pronto para colar.`

/**
 * Escolhe a chave da OpenAI que realmente funciona, na mesma ordem do Agente I.A.:
 * 1) chave do cadastro; 2) chave do dono do WhatsApp (se outro); 3) cadastro legado;
 * 4) chave do servidor. Cada uma é testada (GET de modelo, sem custo) e a primeira
 * aceita é usada. Evita o gerador usar uma chave antiga cancelada enquanto o
 * Agente responde com outra.
 */
const workingKeyCache = new Map<string, string>()
async function resolveWorkingKey(supabase: any, job: any, settings: any): Promise<string> {
  const cacheId = String(job.id)
  if (workingKeyCache.has(cacheId)) return workingKeyCache.get(cacheId)!
  const clean = (v: unknown) => String(v || '').replace(/\s+/g, '')
  const candidates: Array<{ source: string; key: string }> = []
  const push = (source: string, key: string) => {
    if (key && !candidates.some((c) => c.key === key)) candidates.push({ source, key })
  }
  push('cadastro', clean(settings?.openai_api_key))
  try {
    if (job.whatsapp_number_id) {
      const { data: num } = await supabase.from('crm_whatsapp_numbers').select('user_id').eq('id', job.whatsapp_number_id).maybeSingle()
      if (num?.user_id && num.user_id !== job.user_id) {
        const { data: owner } = await supabase.from('crm_settings').select('openai_api_key').eq('user_id', num.user_id).maybeSingle()
        push('dono_do_numero', clean(owner?.openai_api_key))
      }
    }
    const { data: legacy } = await supabase.from('crm_settings').select('openai_api_key').eq('id', '00000000-0000-0000-0000-000000000001').maybeSingle()
    push('legado', clean(legacy?.openai_api_key))
  } catch (e: any) {
    console.warn('[PROMPT-BUILDER] Falha ao listar chaves alternativas', e?.message || e)
  }
  push('servidor', clean(Deno.env.get('OPENAI_API_KEY')))
  if (candidates.length === 0) return ''

  let lastMessage = ''
  for (const c of candidates) {
    try {
      const res = await fetch('https://api.openai.com/v1/models/gpt-4o-mini', { headers: { Authorization: `Bearer ${c.key}` } })
      if (res.ok) {
        console.log('[PROMPT-BUILDER] Chave em uso', JSON.stringify({ job: job.id, source: c.source, tested: candidates.length }))
        workingKeyCache.set(cacheId, c.key)
        return c.key
      }
      const body = await res.json().catch(() => ({}))
      lastMessage = sanitizeProviderMessage(body?.error?.message || `HTTP ${res.status}`)
      console.warn('[PROMPT-BUILDER] Chave recusada', JSON.stringify({ job: job.id, source: c.source, status: res.status, message: lastMessage }))
      // Erro que não é da chave (rede/limite): usa esta mesma e deixa a chamada decidir.
      if (res.status !== 401 && res.status !== 403) {
        workingKeyCache.set(cacheId, c.key)
        return c.key
      }
    } catch {
      workingKeyCache.set(cacheId, c.key)
      return c.key
    }
  }
  // Nenhuma aceita: devolve a do cadastro para gerar a mensagem certa ao usuário.
  console.warn('[PROMPT-BUILDER] Nenhuma chave aceita pela OpenAI', JSON.stringify({ job: job.id, sources: candidates.map((c) => c.source), last: lastMessage }))
  return candidates[0].key
}

/** Executa uma rodada (pequena) de um trabalho já reservado. */
export async function runPromptJobStep(supabase: any, job: any): Promise<void> {
  const update = async (patch: Record<string, unknown>) => {
    await supabase.from('crm_ai_prompt_jobs')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id)
  }
  try {
    if (job.attempts > MAX_ATTEMPTS + (job.total || 0)) {
      await update({ status: 'failed', error: 'O processamento passou do limite de tentativas. Tente gerar novamente.', lease_until: null })
      return
    }
    const { data: settings, error: settingsErr } = await supabase.from('crm_settings')
      .select('openai_api_key, business_description, ai_system_prompt').eq('user_id', job.user_id).maybeSingle()
    if (settingsErr) console.warn('[PROMPT-BUILDER] Falha ao ler crm_settings', settingsErr.message)
    const apiKey = await resolveWorkingKey(supabase, job, settings)
    if (!apiKey) throw new FatalAiError('Cadastre a chave da OpenAI do Agente I.A. para gerar o prompt.')

    const ids: string[] = job.contact_ids || []
    if (job.phase === 'reading' && job.cursor < ids.length) {
      const batch = ids.slice(job.cursor, job.cursor + CONTACTS_PER_STEP)
      const notes: any[] = Array.isArray(job.notes) ? [...job.notes] : []
      let messages = job.message_count || 0
      let audios = job.audio_count || 0
      for (const contactId of batch) {
        const t = await buildTranscript(supabase, apiKey, contactId, job.days || PROMPT_JOB_DAYS)
        messages += t.messages
        audios += t.transcribed
        if (t.transcript.length < 40) continue
        const note = await openAiChat(apiKey, 'gpt-4o-mini', NOTE_SYSTEM, t.transcript, true, 1200)
        notes.push(note.slice(0, MAX_NOTE_CHARS))
      }
      const cursor = job.cursor + batch.length
      await update({
        notes, cursor, message_count: messages, audio_count: audios,
        phase: cursor >= ids.length ? 'writing' : 'reading',
        lease_until: null,
      })
      return
    }

    // Etapa final: escreve o prompt completo.
    const notes: string[] = Array.isArray(job.notes) ? job.notes : []
    if (notes.length === 0) throw new FatalAiError('Não encontramos conteúdo suficiente nas conversas para montar o prompt.')
    let docsText = ''
    let docsQ = supabase.from('crm_ai_documents').select('code, title, description').eq('user_id', job.user_id).eq('is_active', true)
    if (job.whatsapp_number_id) docsQ = docsQ.or(`whatsapp_number_id.eq.${job.whatsapp_number_id},whatsapp_number_id.is.null`)
    const { data: docs } = await docsQ.limit(50)
    if (docs?.length) docsText = docs.map((d: any) => `- (${d.code}) ${d.title}${d.description ? ': ' + d.description : ''}`).join('\n')

    const input = [
      settings?.business_description ? `DESCRIÇÃO DA EMPRESA INFORMADA PELO DONO:\n${settings.business_description}` : '',
      docsText ? `ARQUIVOS DISPONÍVEIS PARA O AGENTE ENVIAR (cite o código entre parênteses quando fizer sentido):\n${docsText}` : '',
      `RESUMOS DE ${notes.length} ATENDIMENTOS REAIS DOS ÚLTIMOS ${job.days || PROMPT_JOB_DAYS} DIAS:`,
      ...notes.map((n, i) => `--- Atendimento ${i + 1} ---\n${n}`),
    ].filter(Boolean).join('\n\n').slice(0, 300000)
    const prompt = await openAiChat(apiKey, 'gpt-4o', FINAL_SYSTEM, input, false, 6000)
    if (!prompt || prompt.length < 200) throw new Error('O prompt gerado veio incompleto; tentando de novo.')
    await update({ status: 'done', phase: 'done', result_prompt: prompt, lease_until: null, error: null })
  } catch (err: any) {
    const message = err?.message || String(err)
    console.error('[PROMPT-BUILDER] Falha na rodada', job.id, message)
    if (err instanceof FatalAiError) {
      await update({ status: 'failed', error: message, lease_until: null })
    } else {
      // Erro passageiro (rede/limite): espera 30s e a próxima rodada tenta de novo.
      await update({ error: message, lease_until: new Date(Date.now() + 30_000).toISOString() })
    }
  }
}

/** Reserva e executa uma rodada do próximo trabalho pendente (se houver). */
export async function tickPromptJobs(supabase: any, jobId?: string | null): Promise<void> {
  audioRefusedKeys.clear()
  const { data, error } = await supabase.rpc('crm_claim_ai_prompt_job', { p_job_id: jobId || null })
  if (error) {
    if (!/does not exist|schema cache/i.test(error.message || '')) console.error('[PROMPT-BUILDER] claim falhou:', error.message)
    return
  }
  const job = Array.isArray(data) ? data[0] : data
  if (job?.id) await runPromptJobStep(supabase, job)
}
