import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getConversationWindow, WINDOW_CLOSED_MESSAGE } from "../_shared/conversation-window.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  try {
    const body = await req.json()
    const { webhook_id, token, to, message, template_id, variables, order_id } = body

    if (!webhook_id || !token || !to) {
      return new Response(JSON.stringify({ error: 'Missing required fields: webhook_id, token, to' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate Webhook
    const { data: webhook, error: webhookError } = await supabase
      .from('crm_webhooks')
      .select('*')
      .eq('id', webhook_id)
      .eq('secret_token', token)
      .eq('is_active', true)
      .single()

    if (webhookError || !webhook) {
      return new Response(JSON.stringify({ error: 'Invalid or inactive webhook credentials' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check for duplicate delivery if order_id is provided
    if (order_id) {
      const { data: existingDelivery } = await supabase
        .from('crm_webhook_delivery_logs')
        .select('id')
        .eq('webhook_id', webhook_id)
        .eq('order_id', order_id)
        .eq('status', 'success')
        .maybeSingle();

      if (existingDelivery) {
        console.log(`[CRM-WEBHOOK] Duplicate delivery detected for order ${order_id}. Skipping.`);
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Message already sent for this order',
          duplicate: true 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get Meta Settings DO DONO do webhook (isolamento multi-tenant)
    const ownerId = webhook.user_id
    if (!ownerId) {
      throw new Error('Webhook sem dono definido (user_id). Recrie o webhook no CRM.')
    }

    const { data: settings } = await supabase
      .from('crm_settings')
      .select('*')
      .eq('user_id', ownerId)
      .maybeSingle()

    if (!settings?.meta_access_token || !settings?.meta_phone_number_id) {
      throw new Error('CRM Meta settings not configured')
    }

    const { meta_access_token, meta_phone_number_id } = settings

    // Clean phone number (remove non-digits)
    const cleanTo = to.replace(/\D/g, '')

    let result;
    let finalMessageText = message || webhook.message_template || '';

    if (webhook.response_type === 'template' || template_id) {
      // Send Template
      const tid = template_id || webhook.template_id
      const { data: template } = await supabase
        .from('crm_templates')
        .select('*')
        .eq('id', tid)
        .eq('user_id', ownerId)
        .maybeSingle()
      
      if (!template) throw new Error('Template not found')

      finalMessageText = `[Template: ${template.name}]`;

      const components = variables ? [
        {
          type: 'body',
          parameters: variables.map((v: string) => ({ type: 'text', text: v }))
        }
      ] : []

      const response = await fetch(
        `https://graph.facebook.com/v20.0/${meta_phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${meta_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanTo,
            type: 'template',
            template: {
              name: template.name,
              language: { code: template.language || 'pt_BR' },
              components: components
            },
          }),
        }
      )
      result = await response.json()
    } else {
      // Send Text Message
      if (!finalMessageText) finalMessageText = 'Mensagem automática via Webhook';

      // Janela de atendimento (24h / 72h anúncio): fora dela, só template.
      const variants = Array.from(new Set([cleanTo,
        cleanTo.startsWith('55') && cleanTo.length === 13 ? cleanTo.slice(0, 4) + cleanTo.slice(5) : cleanTo,
        cleanTo.startsWith('55') && cleanTo.length === 12 ? cleanTo.slice(0, 4) + '9' + cleanTo.slice(4) : cleanTo]))
      let windowQuery: any = await supabase.from('crm_contacts')
        .select('last_message_received_at, ctwa_opened_at')
        .eq('user_id', ownerId).in('wa_id', variants)
        .order('last_message_received_at', { ascending: false, nullsFirst: false }).limit(1)
      if (windowQuery.error) {
        windowQuery = await supabase.from('crm_contacts')
          .select('last_message_received_at')
          .eq('user_id', ownerId).in('wa_id', variants)
          .order('last_message_received_at', { ascending: false, nullsFirst: false }).limit(1)
      }
      const convWindow = getConversationWindow((windowQuery.data as any[] | null)?.[0] ?? null)
      if (!convWindow.is_open) {
        await supabase.from('crm_webhook_delivery_logs').insert([{
          webhook_id, to_number: cleanTo, message: finalMessageText, status: 'error',
          error_message: WINDOW_CLOSED_MESSAGE, order_id: order_id || null,
        }])
        return new Response(JSON.stringify({ success: false, code: 'WINDOW_CLOSED', error: WINDOW_CLOSED_MESSAGE, window: convWindow }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${meta_phone_number_id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${meta_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanTo,
            type: 'text',
            text: { body: finalMessageText },
          }),
        }
      )
      result = await response.json()
    }

    if (result.error) {
      console.error('Meta API Error:', result.error)
      
      // Log failure
      await supabase.from('crm_webhook_delivery_logs').insert([{
        webhook_id,
        to_number: cleanTo,
        message: finalMessageText,
        status: 'error',
        error_message: result.error.message || 'Meta API Error',
        order_id: order_id || null
      }])

      throw new Error(result.error.message || 'Error sending message')
    }

    // Log success with idempotency check
    const { data: existingLog } = await supabase
      .from('crm_webhook_delivery_logs')
      .select('id')
      .eq('webhook_id', webhook_id)
      .eq('order_id', order_id)
      .eq('status', 'success')
      .maybeSingle();

    if (existingLog && order_id) {
      console.log(`Duplicate webhook detected for order ${order_id}, skipping delivery log.`);
    } else {
      await supabase.from('crm_webhook_delivery_logs').insert([{
        webhook_id,
        to_number: cleanTo,
        message: finalMessageText,
        status: 'success',
        order_id: order_id || null
      }])
    }

    // Update last_used_at
    await supabase.from('crm_webhooks').update({ last_used_at: new Date().toISOString() }).eq('id', webhook_id)

    // Ensure contact exists and log message
    let { data: contact } = await supabase
      .from('crm_contacts')
      .select('id, status')
      .eq('wa_id', cleanTo)
      .eq('user_id', ownerId)
      .maybeSingle();

    if (!contact) {
      const { data: newContact, error: createError } = await supabase
        .from('crm_contacts')
        .insert([{
          wa_id: cleanTo,
          name: cleanTo,
          user_id: ownerId,
          status: webhook.default_status || 'new',
          source_type: `webhook_${webhook.name}`
        }])
        .select('id, status')
        .single();
      
      if (createError) console.error('Error creating contact from webhook:', createError);
      contact = newContact;
    } else if (webhook.default_status && contact.status !== webhook.default_status) {
      // Update existing contact status if webhook has a default status
      await supabase
        .from('crm_contacts')
        .update({ status: webhook.default_status })
        .eq('id', contact.id);
    }

    if (contact) {
      await supabase.from('crm_messages').insert([{
        contact_id: contact.id,
        user_id: ownerId,
        direction: 'outbound',
        message_type: 'text',
        content: finalMessageText,
        meta_message_id: result.messages?.[0]?.id,
        status: 'sent'
      }]);

      await supabase.from('crm_contacts').update({
        last_interaction: new Date().toISOString()
      }).eq('id', contact.id);
    }

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Webhook Error:', error)
    
    // Attempt to log error if it hasn't been logged yet in the success/error branch
    // Note: this is a bit redundant but ensures we capture unexpected crashes
    
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
