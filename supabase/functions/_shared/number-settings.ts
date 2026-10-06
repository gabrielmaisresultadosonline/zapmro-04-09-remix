/**
 * Configurações de automação por número de WhatsApp.
 *
 * Cadastros com mais de um número não podem compartilhar automações
 * (Agente I.A., Recuperador, gatilho de 24h, prompt, etc.). Esses valores
 * ficam em `crm_whatsapp_numbers.number_settings` (JSONB) e sobrepõem os de
 * `crm_settings`, que continua guardando só o que é do cadastro (chave
 * OpenAI, Google, tamanhos de tela) e servindo de padrão legado.
 * Espelhado em src/lib/numberSettings.ts.
 */
export const PER_NUMBER_SETTING_KEYS = [
  'ai_agent_enabled', 'ai_kanban_auto_organizer', 'ai_send_bundled', 'ai_operation_mode', 'ai_system_prompt',
  'ai_recovery_enabled', 'ai_recovery_delay_minutes', 'ai_recovery_max_attempts', 'ai_recovery_finalized_status', 'ai_recovery_scope',
  'ai_agent_trigger', 'ai_agent_trigger_keyword', 'ai_agent_prompt', 'ai_agent_label_on_transfer',
  'initial_auto_response_enabled', 'initial_response_text', 'initial_response_buttons', 'initial_flow_id',
  'business_hours_enabled', 'business_hours_start', 'business_hours_end', 'business_hours_tz',
  'outside_hours_message', 'business_description',
  'countdown_trigger_enabled', 'countdown_trigger_flow_id', 'countdown_trigger_template_id',
  'countdown_trigger_message_type', 'countdown_trigger_content', 'countdown_trigger_threshold_minutes',
  'countdown_trigger_status_filter', 'countdown_trigger_scope',
] as const;

/** Sobrepõe as automações do número sobre as do cadastro. */
export function mergeNumberSettings(base: any, numberSettings: unknown): any {
  const merged: Record<string, unknown> = { ...(base || {}) };
  if (numberSettings && typeof numberSettings === 'object') {
    const ns = numberSettings as Record<string, unknown>;
    for (const key of PER_NUMBER_SETTING_KEYS) {
      if (ns[key] !== undefined) merged[key] = ns[key];
    }
  }
  return merged;
}

export interface NumberScopedSettings {
  settings: any;
  /** id em crm_whatsapp_numbers; null = cadastro legado sem lista de números. */
  boxId: string | null;
}

/**
 * Expande linhas de `crm_settings` em uma unidade por número conectado,
 * cada uma com as próprias credenciais e automações. Cadastros sem
 * números cadastrados seguem como uma unidade única (legado).
 */
export async function expandSettingsPerNumber(supabase: any, settingsRows: any[]): Promise<NumberScopedSettings[]> {
  const userIds = Array.from(new Set((settingsRows || []).map((s) => s.user_id).filter(Boolean)));
  if (userIds.length === 0) return [];
  const { data: numbers, error } = await supabase
    .from('crm_whatsapp_numbers')
    .select('id, user_id, meta_phone_number_id, meta_access_token, number_settings')
    .in('user_id', userIds);
  if (error) console.error('[NUMBER-SETTINGS] Falha ao carregar números:', error.message);
  const byUser = new Map<string, any[]>();
  for (const n of numbers || []) {
    const list = byUser.get(n.user_id) || [];
    list.push(n);
    byUser.set(n.user_id, list);
  }
  const out: NumberScopedSettings[] = [];
  for (const base of settingsRows || []) {
    const list = byUser.get(base.user_id) || [];
    if (list.length === 0) {
      out.push({ settings: base, boxId: null });
      continue;
    }
    for (const n of list) {
      if (!n.meta_phone_number_id || !n.meta_access_token) continue; // desconectado
      out.push({
        boxId: n.id,
        settings: {
          ...mergeNumberSettings(base, n.number_settings),
          meta_phone_number_id: n.meta_phone_number_id,
          meta_access_token: n.meta_access_token,
        },
      });
    }
  }
  return out;
}

/** Carrega as automações efetivas de uma caixa específica. */
export async function loadNumberSettings(supabase: any, base: any, boxId: string | null | undefined): Promise<any> {
  if (!boxId) return base;
  const { data, error } = await supabase
    .from('crm_whatsapp_numbers')
    .select('number_settings')
    .eq('id', boxId)
    .maybeSingle();
  if (error) {
    console.error('[NUMBER-SETTINGS] Falha ao carregar automações da caixa', boxId, error.message);
    return base;
  }
  return mergeNumberSettings(base, data?.number_settings);
}
