export function scheduledRequest(row: any, contact: any) {
  if (!contact?.user_id || row.user_id !== contact.user_id) throw new Error('Cadastro do agendamento inválido');
  if (row.whatsapp_number_id && contact.whatsapp_number_id && row.whatsapp_number_id !== contact.whatsapp_number_id) throw new Error('WhatsApp do agendamento não corresponde ao contato');
  const payload = row.message_data || {};
  if (!['sendTemplate', 'sendMessage', 'startFlow'].includes(payload.action)) throw new Error('Tipo de agendamento inválido');
  return {
    action: payload.action, contactId: contact.id, to: contact.wa_id, waId: contact.wa_id,
    whatsapp_number_id: row.whatsapp_number_id || contact.whatsapp_number_id || null,
    ...(payload.action === 'sendTemplate' ? { templateName: payload.templateName, languageCode: payload.languageCode || payload.language || 'pt_BR', templateConfig: payload.templateConfig, components: payload.components } : {}),
    ...(payload.action === 'sendMessage' ? { text: payload.text } : {}),
    ...(payload.action === 'startFlow' ? { flowId: payload.flowId } : {}),
    metadata: { source: 'scheduled_send', scheduled_message_id: row.id },
  };
}

export async function dispatchScheduled(supabase: any) {
  // A claimed row is never automatically retried after an ambiguous network result.
  // This avoids duplicate sends if the Meta accepted the message before a timeout.
  const { data: rows, error } = await supabase.rpc('crm_claim_scheduled_messages', { p_limit: 10 });
  if (error) throw error;
  const results = [];
  for (const row of rows || []) {
    try {
      const { data: contact, error: lookupError } = await supabase.from('crm_contacts').select('*').eq('id', row.contact_id).eq('user_id', row.user_id).maybeSingle();
      if (lookupError) throw lookupError;
      const body = scheduledRequest(row, contact);
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/meta-whatsapp-crm`, {
        method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Falha ao executar agendamento');
      const { error: updateError } = await supabase.from('crm_scheduled_messages').update({ status: 'sent', processed_at: new Date().toISOString(), last_error: null }).eq('id', row.id).eq('status', 'processing');
      if (updateError) throw updateError;
      results.push({ id: row.id, success: true });
    } catch (err: any) {
      const message = String(err?.message || err).replace(/sk-[\w.-]+/g, '[chave ocultada]').slice(0, 500);
      const { error: saveError } = await supabase.from('crm_scheduled_messages').update({ status: 'failed', processed_at: new Date().toISOString(), last_error: message }).eq('id', row.id).eq('status', 'processing');
      console.error('[SCHEDULED]', row.id, message, saveError?.message || '');
      results.push({ id: row.id, success: false });
    }
  }
  return results;
}