import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { z } from 'npm:zod@3.25.76'
import {
  buildServerTemplateComponents,
  isMediaHeader,
  parseServerTemplateSchema,
  validateComponentsAgainstSchema,
  type TemplateSendConfig,
} from '../_shared/template-variables.ts'

type JsonRecord = Record<string, unknown>

const BodySchema = z.object({
  broadcast_id: z.string().uuid().optional(),
  source: z.string().max(50).optional(),
}).strict()

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const errorMessage = (value: unknown): string => value instanceof Error ? value.message : String(value)

const randomDelaySeconds = (minimum: unknown, maximum: unknown): number => {
  const min = Math.max(0, Number(minimum) || 0)
  const max = Math.max(min, Number(maximum) || min)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function processOne(req: Request, workerId: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'Backend configuration is missing' }, 500)

  const authorization = req.headers.get('authorization') || ''
  const bearer = authorization.replace(/^Bearer\s+/i, '')
  const isServiceRequest = bearer === serviceRoleKey
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let requestedUserId: string | null = null
  if (!isServiceRequest) {
    if (!bearer) return json({ success: false, error: 'Unauthorized' }, 401)
    const { data, error } = await admin.auth.getUser(bearer)
    if (error || !data.user) return json({ success: false, error: 'Unauthorized' }, 401)
    requestedUserId = data.user.id
  }

  const parsedBody = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsedBody.success) return json({ success: false, error: parsedBody.error.flatten().fieldErrors }, 400)
  const requestedBroadcastId = parsedBody.data.broadcast_id || null

  let claimedItem: Record<string, unknown> | null = null
  try {
    const { data: claimedRows, error: claimError } = await admin.rpc('crm_claim_broadcast_item', {
      p_worker_id: workerId,
      p_broadcast_id: requestedBroadcastId,
      p_user_id: requestedUserId,
    })
    if (claimError) throw claimError
    const item = Array.isArray(claimedRows) ? claimedRows[0] : null
    if (!item) return json({ success: true, processed: 0 })
    claimedItem = item

    const { data: broadcast, error: broadcastError } = await admin
      .from('crm_broadcasts')
      .select('*')
      .eq('id', item.claimed_broadcast_id)
      .single()
    if (broadcastError || !broadcast) throw broadcastError || new Error('Campaign not found')

    const { data: template } = broadcast.type === 'template' && broadcast.template_id
      ? await admin.from('crm_templates').select('name, language, components, is_carousel').eq('id', broadcast.template_id).eq('user_id', broadcast.user_id).maybeSingle()
      : { data: null }

    let contact: { id: string; name?: string | null; metadata?: unknown; status?: string | null } | null = null
    if (['message', 'template', 'flow'].includes(String(broadcast.type))) {
      let contactQuery = admin.from('crm_contacts').select('id, name, metadata, status').eq('user_id', broadcast.user_id).eq('wa_id', item.wa_id)
      if (broadcast.whatsapp_number_id) contactQuery = contactQuery.eq('whatsapp_number_id', broadcast.whatsapp_number_id)
      const found = await contactQuery.limit(1).maybeSingle()
      contact = found.data
      if (!contact) {
        const created = await admin.from('crm_contacts').insert({
          user_id: broadcast.user_id,
          whatsapp_number_id: broadcast.whatsapp_number_id,
          wa_id: item.wa_id,
          name: item.recipient_name || item.wa_id,
          status: 'new',
          source_type: 'broadcast',
        }).select('id, name').single()
        if (created.error) throw created.error
        contact = created.data
      }
    }

    const payload: JsonRecord = {
      action: broadcast.type === 'template' ? 'sendTemplate' : broadcast.type === 'flow' ? 'startFlow' : 'sendMessage',
      whatsapp_number_id: broadcast.whatsapp_number_id,
      broadcastId: broadcast.id,
    }
    if (broadcast.type === 'template') {
      if (!template?.name) throw new Error('Template da campanha não foi encontrado')
      payload.to = item.wa_id
      payload.templateName = template.name
      payload.languageCode = template.language || 'pt_BR'
      payload.templateConfig = broadcast.template_config || null
      // Monta os componentes a partir do template exato da campanha (por id) e
      // dos valores salvos nela: a Meta recebe as variáveis/mídia desta campanha,
      // nunca os exemplos da aprovação.
      if (!template.is_carousel) {
        const schema = parseServerTemplateSchema(template.components)
        const isDynamic = isMediaHeader(schema.headerKind) || schema.headerVariables.length > 0
          || schema.bodyVariables.length > 0 || schema.urlButtonIndexes.length > 0
        if (isDynamic) {
          const config = (broadcast.template_config && typeof broadcast.template_config === 'object')
            ? broadcast.template_config as TemplateSendConfig : null
          if (!config) throw new Error('A campanha não tem as variáveis do template salvas. Crie a campanha novamente preenchendo as variáveis.')
          const recipient = { ...(contact || {}), wa_id: item.wa_id, name: contact?.name || item.recipient_name || item.wa_id }
          const components = buildServerTemplateComponents(schema, config, recipient)
          const issues = validateComponentsAgainstSchema(schema, components)
          if (issues.length > 0) throw new Error(issues[0].message)
          payload.components = components
        }
      }
    } else if (broadcast.type === 'flow') {
      if (!contact?.id || !broadcast.flow_id) throw new Error('Contato ou fluxo da campanha não foi encontrado')
      payload.contactId = contact.id
      payload.waId = item.wa_id
      payload.flowId = broadcast.flow_id
    } else {
      payload.to = item.wa_id
      payload.text = broadcast.message_text || ''
    }

    // Pausar/parar pode acontecer enquanto o contato é preparado. Revalidamos
    // imediatamente antes da chamada externa para não iniciar um novo envio.
    const { data: latestCampaign } = await admin.from('crm_broadcasts').select('status').eq('id', broadcast.id).single()
    if (!['pending', 'running'].includes(String(latestCampaign?.status))) {
      await admin.from('crm_broadcast_items').update({
        status: latestCampaign?.status === 'cancelled' ? 'skipped' : 'queued',
        locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
      }).eq('id', item.item_id).eq('locked_by', workerId)
      await admin.rpc('crm_refresh_broadcast_progress', { p_broadcast_id: broadcast.id })
      return json({ success: true, processed: 0, status: latestCampaign?.status })
    }

    const functionUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/meta-whatsapp-crm`
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const result = await response.json().catch(() => ({})) as JsonRecord
    const missingMetaConfirmation = broadcast.type !== 'flow' && !result.messageId
    if (!response.ok || result.success === false || missingMetaConfirmation) {
      const message = String(result.message || result.error || (missingMetaConfirmation ? 'A Meta não confirmou o envio (sem ID de mensagem)' : `HTTP ${response.status}`))
      const code = String(result.code || (missingMetaConfirmation ? 'META_CONFIRMATION_MISSING' : `HTTP_${response.status}`))
      await admin.from('crm_broadcast_items').update({
        status: 'failed', error_code: code, error_message: message,
        processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', item.item_id).eq('locked_by', workerId)
      await admin.from('crm_broadcasts').update({
        last_error: message,
        next_run_at: new Date(Date.now() + randomDelaySeconds(broadcast.random_delay_min, broadcast.random_delay_max) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', broadcast.id)
    } else {
      await admin.from('crm_broadcast_items').update({
        status: 'sent', meta_message_id: typeof result.messageId === 'string' ? result.messageId : null,
        processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', item.item_id).eq('locked_by', workerId)
      await admin.from('crm_broadcasts').update({
        last_error: null,
        next_run_at: new Date(Date.now() + randomDelaySeconds(broadcast.random_delay_min, broadcast.random_delay_max) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', broadcast.id)
    }

    await admin.rpc('crm_refresh_broadcast_progress', { p_broadcast_id: broadcast.id })
    const { data: refreshedCampaign } = await admin.from('crm_broadcasts').select('status').eq('id', broadcast.id).single()
    if (refreshedCampaign?.status === 'completed' && broadcast.apply_tag) {
      let contactsQuery = admin.from('crm_contacts').update({ status: broadcast.apply_tag })
        .eq('user_id', broadcast.user_id)
        .in('wa_id', broadcast.uploaded_numbers || [])
      if (broadcast.whatsapp_number_id) contactsQuery = contactsQuery.eq('whatsapp_number_id', broadcast.whatsapp_number_id)
      await contactsQuery
    }

    console.log('[BROADCAST-WORKER]', { broadcast_id: broadcast.id, item_id: item.item_id, sequence: item.sequence_number })
    return json({ success: true, processed: 1, broadcast_id: broadcast.id })
  } catch (error) {
    console.error('[BROADCAST-WORKER-ERROR]', error)
    if (claimedItem?.item_id && claimedItem?.claimed_broadcast_id) {
      const message = errorMessage(error)
      await admin.from('crm_broadcast_items').update({
        status: 'failed', error_code: 'WORKER_ERROR', error_message: message,
        processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', claimedItem.item_id).eq('locked_by', workerId)
      await admin.from('crm_broadcasts').update({ last_error: message, updated_at: new Date().toISOString() })
        .eq('id', claimedItem.claimed_broadcast_id)
      await admin.rpc('crm_refresh_broadcast_progress', { p_broadcast_id: claimedItem.claimed_broadcast_id })
    }
    return json({ success: false, error: errorMessage(error) }, 500)
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Tempo máximo que uma chamada fica "segurando" a campanha para respeitar o intervalo exato. */
const LOOP_BUDGET_MS = 50_000

/**
 * Processa vários destinatários na mesma chamada, esperando exatamente o
 * intervalo sorteado (next_run_at) entre um envio e outro. Um "lease" no banco
 * impede que o cron rode a mesma campanha ao mesmo tempo.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS' || req.method !== 'POST') return processOne(req, crypto.randomUUID())
  const workerId = crypto.randomUUID()
  const started = Date.now()
  const bodyText = await req.text()
  let body: JsonRecord = {}
  try { body = bodyText ? JSON.parse(bodyText) : {} } catch { /* processOne valida */ }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const admin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }) : null

  let last: Response | null = null
  let lockedBroadcast: string | null = null
  try {
    for (let i = 0; i < 500; i++) {
      const res = await processOne(new Request(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(body) }), workerId)
      const data = await res.clone().json().catch(() => ({})) as JsonRecord
      last = res
      const bid = typeof data.broadcast_id === 'string' ? data.broadcast_id : null
      if (!admin || data.processed !== 1 || !bid) break
      lockedBroadcast = bid
      body = { ...body, broadcast_id: bid }
      const { data: c } = await admin.from('crm_broadcasts').select('status, next_run_at').eq('id', bid).single()
      if (!c || !['pending', 'running'].includes(String(c.status))) break
      const wait = Math.max(0, Date.parse(String(c.next_run_at || '')) - Date.now() || 0)
      if (Date.now() - started + wait > LOOP_BUDGET_MS) break
      await sleep(wait)
    }
  } finally {
    if (admin && lockedBroadcast) {
      await admin.from('crm_broadcasts').update({ worker_lease_owner: null, worker_lease_until: null })
        .eq('id', lockedBroadcast).eq('worker_lease_owner', workerId)
    }
  }
  return last || json({ success: true, processed: 0 })
})
