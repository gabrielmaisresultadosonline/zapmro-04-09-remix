import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type JsonRecord = Record<string, unknown>

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

Deno.serve(async (req: Request) => {
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

  const body = await req.json().catch(() => ({})) as JsonRecord
  const requestedBroadcastId = typeof body.broadcast_id === 'string' ? body.broadcast_id : null
  if (requestedBroadcastId && !/^[0-9a-f-]{36}$/i.test(requestedBroadcastId)) {
    return json({ success: false, error: 'Invalid broadcast_id' }, 400)
  }

  const workerId = crypto.randomUUID()
  try {
    const { data: claimedRows, error: claimError } = await admin.rpc('crm_claim_broadcast_item', {
      p_worker_id: workerId,
      p_broadcast_id: requestedBroadcastId,
      p_user_id: requestedUserId,
    })
    if (claimError) throw claimError
    const item = Array.isArray(claimedRows) ? claimedRows[0] : null
    if (!item) return json({ success: true, processed: 0 })

    const { data: broadcast, error: broadcastError } = await admin
      .from('crm_broadcasts')
      .select('*')
      .eq('id', item.claimed_broadcast_id)
      .single()
    if (broadcastError || !broadcast) throw broadcastError || new Error('Campaign not found')

    const { data: template } = broadcast.type === 'template' && broadcast.template_id
      ? await admin.from('crm_templates').select('name, language').eq('id', broadcast.template_id).eq('user_id', broadcast.user_id).maybeSingle()
      : { data: null }

    let contact: { id: string; name?: string | null } | null = null
    if (['message', 'template', 'flow'].includes(String(broadcast.type))) {
      let contactQuery = admin.from('crm_contacts').select('id, name').eq('user_id', broadcast.user_id).eq('wa_id', item.wa_id)
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
    } else if (broadcast.type === 'flow') {
      if (!contact?.id || !broadcast.flow_id) throw new Error('Contato ou fluxo da campanha não foi encontrado')
      payload.contactId = contact.id
      payload.waId = item.wa_id
      payload.flowId = broadcast.flow_id
    } else {
      payload.to = item.wa_id
      payload.text = broadcast.message_text || ''
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
    if (!response.ok || result.success === false) {
      const message = String(result.message || result.error || `HTTP ${response.status}`)
      const code = String(result.code || `HTTP_${response.status}`)
      await admin.from('crm_broadcast_items').update({
        status: 'failed', error_code: code, error_message: message,
        processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', item.item_id).eq('locked_by', workerId)
      await admin.from('crm_broadcasts').update({
        failed_count: Number(broadcast.failed_count || 0) + 1,
        sent_count: Number(broadcast.sent_count || 0) + 1,
        last_error: message,
        last_heartbeat_at: new Date().toISOString(),
        next_run_at: new Date(Date.now() + randomDelaySeconds(broadcast.random_delay_min, broadcast.random_delay_max) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', broadcast.id)
    } else {
      await admin.from('crm_broadcast_items').update({
        status: 'sent', meta_message_id: typeof result.messageId === 'string' ? result.messageId : null,
        processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', item.item_id).eq('locked_by', workerId)
      await admin.from('crm_broadcasts').update({
        sent_count: Number(broadcast.sent_count || 0) + 1,
        last_error: null,
        last_heartbeat_at: new Date().toISOString(),
        next_run_at: new Date(Date.now() + randomDelaySeconds(broadcast.random_delay_min, broadcast.random_delay_max) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', broadcast.id)
    }

    const { count: remaining } = await admin.from('crm_broadcast_items')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcast.id)
      .eq('status', 'queued')
    if ((remaining || 0) === 0) {
      const { count: processing } = await admin.from('crm_broadcast_items')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcast.id)
        .eq('status', 'processing')
      if ((processing || 0) === 0) {
        await admin.from('crm_broadcasts').update({
          status: 'completed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', broadcast.id).in('status', ['pending', 'running'])

        if (broadcast.apply_tag) {
          let contactsQuery = admin.from('crm_contacts').update({ status: broadcast.apply_tag })
            .eq('user_id', broadcast.user_id)
            .in('wa_id', broadcast.uploaded_numbers || [])
          if (broadcast.whatsapp_number_id) contactsQuery = contactsQuery.eq('whatsapp_number_id', broadcast.whatsapp_number_id)
          await contactsQuery
        }
      }
    }

    console.log('[BROADCAST-WORKER]', { broadcast_id: broadcast.id, item_id: item.item_id, sequence: item.sequence_number })
    return json({ success: true, processed: 1, broadcast_id: broadcast.id })
  } catch (error) {
    console.error('[BROADCAST-WORKER-ERROR]', error)
    return json({ success: false, error: errorMessage(error) }, 500)
  }
})