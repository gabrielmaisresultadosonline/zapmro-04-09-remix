import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { z } from 'npm:zod@3.25.76'

const BodySchema = z.object({
  source: z.string().max(50).optional(),
  contact_limit: z.number().int().min(1).max(1000).optional(),
  max_batches: z.number().int().min(1).max(100).optional(),
}).strict()

interface CleanupResult {
  deleted_contacts: number
  deleted_messages: number
  queued_media: number
  deleted_payload: unknown
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: 'Backend configuration is missing' }, 500)
  }

  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!bearer || bearer !== serviceRoleKey) return json({ success: false, error: 'Unauthorized' }, 401)

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return json({ success: false, error: parsed.error.flatten().fieldErrors }, 400)

  const contactLimit = parsed.data.contact_limit ?? 100
  const maxBatches = parsed.data.max_batches ?? 50
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const totals = { contacts: 0, messages: 0, queued_media: 0, batches: 0 }

  try {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const { data, error } = await admin.rpc('crm_cleanup_inactive_histories', {
        p_inactive_days: 10,
        p_contact_limit: contactLimit,
      })
      if (error) throw error

      const result = (Array.isArray(data) ? data[0] : data) as CleanupResult | null
      const contacts = Number(result?.deleted_contacts ?? 0)
      totals.contacts += contacts
      totals.messages += Number(result?.deleted_messages ?? 0)
      totals.queued_media += Number(result?.queued_media ?? 0)
      totals.batches += 1

      if (contacts < contactLimit) break
    }

    console.log('[RETENTION-CLEANUP] concluído', totals)
    return json({ success: true, retention_days: 10, ...totals })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[RETENTION-CLEANUP] falha:', message)
    return json({ success: false, error: message, ...totals }, 500)
  }
})