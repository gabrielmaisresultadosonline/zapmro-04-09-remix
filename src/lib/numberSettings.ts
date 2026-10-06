import { supabase } from "@/integrations/supabase/client";

/**
 * Automações por número de WhatsApp (espelho de
 * supabase/functions/_shared/number-settings.ts). Em cadastros com mais de
 * um número, cada caixa tem o próprio Agente I.A., Recuperador, gatilho de
 * 24h, prompt e horário — nada é compartilhado entre números.
 */
export const PER_NUMBER_SETTING_KEYS = [
  "ai_agent_enabled", "ai_kanban_auto_organizer", "ai_send_bundled", "ai_operation_mode", "ai_system_prompt",
  "ai_recovery_enabled", "ai_recovery_delay_minutes", "ai_recovery_max_attempts", "ai_recovery_finalized_status", "ai_recovery_scope",
  "ai_agent_trigger", "ai_agent_trigger_keyword", "ai_agent_prompt", "ai_agent_label_on_transfer",
  "initial_auto_response_enabled", "initial_response_text", "initial_response_buttons", "initial_flow_id",
  "business_hours_enabled", "business_hours_start", "business_hours_end", "business_hours_tz",
  "outside_hours_message", "business_description",
  "countdown_trigger_enabled", "countdown_trigger_flow_id", "countdown_trigger_template_id",
  "countdown_trigger_message_type", "countdown_trigger_content", "countdown_trigger_threshold_minutes",
  "countdown_trigger_status_filter", "countdown_trigger_scope",
] as const;

type SettingsMap = Record<string, unknown>;

/** Lê as automações salvas de um número (vazio se ainda não houver). */
export async function fetchNumberSettings(numberId: string): Promise<SettingsMap | null> {
  const { data, error } = await supabase
    .from("crm_whatsapp_numbers" as never)
    .select("number_settings")
    .eq("id", numberId)
    .maybeSingle();
  if (error) {
    console.warn("[numberSettings] falha ao ler automações do número:", error.message);
    return null;
  }
  const value = (data as { number_settings?: unknown } | null)?.number_settings;
  return value && typeof value === "object" ? (value as SettingsMap) : {};
}

/** Sobrepõe as automações do número sobre as do cadastro. */
export function overlayNumberSettings<T extends SettingsMap>(base: T, numberSettings: SettingsMap | null): T {
  if (!numberSettings) return base;
  const merged: SettingsMap = { ...base };
  for (const key of PER_NUMBER_SETTING_KEYS) {
    if (numberSettings[key] !== undefined) merged[key] = numberSettings[key];
  }
  return merged as T;
}

/** Separa o que é do número do que é do cadastro. */
export function splitNumberSettings(settings: SettingsMap): { perNumber: SettingsMap; shared: SettingsMap } {
  const perNumber: SettingsMap = {};
  const shared: SettingsMap = {};
  const keys = new Set<string>(PER_NUMBER_SETTING_KEYS);
  for (const [key, value] of Object.entries(settings)) {
    if (keys.has(key)) perNumber[key] = value;
    else shared[key] = value;
  }
  return { perNumber, shared };
}

/** Grava as automações no número, preservando chaves não enviadas. */
export async function saveNumberSettings(numberId: string, patch: SettingsMap): Promise<void> {
  const current = (await fetchNumberSettings(numberId)) || {};
  const { error } = await supabase
    .from("crm_whatsapp_numbers" as never)
    .update({ number_settings: { ...current, ...patch }, updated_at: new Date().toISOString() } as never)
    .eq("id", numberId);
  if (error) throw error;
}
