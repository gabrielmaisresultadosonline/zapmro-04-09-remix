import { supabase } from "@/integrations/supabase/client";
import { setActiveWhatsAppNumberId } from "@/lib/activeNumberContext";

/**
 * Suporte a múltiplos números de WhatsApp dentro do mesmo cadastro.
 *
 * O admin libera a quantidade em `crm_profiles.max_whatsapp_numbers`.
 * Cada número fica em `crm_whatsapp_numbers` com credenciais próprias e
 * uma senha opcional. Ao escolher um número, suas credenciais são
 * aplicadas em `crm_settings` (fonte usada por todo o CRM/edge functions).
 */
export interface WhatsAppNumberRecord {
  id: string;
  user_id: string;
  label: string | null;
  meta_access_token: string | null;
  meta_phone_number_id: string | null;
  meta_waba_id: string | null;
  meta_business_id: string | null;
  meta_app_id: string | null;
  meta_app_secret: string | null;
  meta_display_phone_number: string | null;
  meta_verified_name: string | null;
  access_pin: string | null;
  is_active: boolean;
  created_at?: string;
}

const activeKey = (userId: string) => `crm_active_number_${userId}`;
const unlockedKey = (userId: string, numberId: string) =>
  `crm_number_unlocked_${userId}_${numberId}`;

export function getActiveNumberId(userId: string): string | null {
  try {
    return localStorage.getItem(activeKey(userId));
  } catch {
    return null;
  }
}

export function setActiveNumberId(userId: string, numberId: string | null) {
  try {
    if (numberId) localStorage.setItem(activeKey(userId), numberId);
    else localStorage.removeItem(activeKey(userId));
  } catch {
    /* storage indisponível — segue sem persistir */
  }
  // Espelha no contexto global usado pelas consultas e pelas Edge Functions.
  setActiveWhatsAppNumberId(numberId);
}

/** Busca um número específico do cadastro (usado ao restaurar a escolha). */
export async function fetchNumberById(
  userId: string,
  numberId: string
): Promise<WhatsAppNumberRecord | null> {
  const numbers = await fetchUserNumbers(userId);
  return numbers.find((n) => n.id === numberId) ?? null;
}

export function isNumberUnlocked(userId: string, numberId: string): boolean {
  try {
    return sessionStorage.getItem(unlockedKey(userId, numberId)) === "1";
  } catch {
    return false;
  }
}

export function markNumberUnlocked(userId: string, numberId: string) {
  try {
    sessionStorage.setItem(unlockedKey(userId, numberId), "1");
  } catch {
    /* noop */
  }
}

export async function fetchMaxWhatsAppNumbers(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("crm_profiles")
    .select("max_whatsapp_numbers")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return 1;
  const value = Number((data as any)?.max_whatsapp_numbers ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export async function fetchUserNumbers(userId: string): Promise<WhatsAppNumberRecord[]> {
  const { data, error } = await supabase
    .from("crm_whatsapp_numbers" as any)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[whatsappNumbers] falha ao listar números:", error.message);
    return [];
  }
  return (data || []) as unknown as WhatsAppNumberRecord[];
}

/**
 * Garante que a conexão atual de `crm_settings` exista na lista de números.
 * Chamado após o Embedded Signup para registrar automaticamente o número
 * recém-conectado sem exigir nenhuma ação extra do usuário.
 */
export async function syncSettingsIntoNumbers(
  userId: string,
  settings: any
): Promise<WhatsAppNumberRecord[]> {
  if (!settings?.meta_phone_number_id || !settings?.meta_access_token) {
    return fetchUserNumbers(userId);
  }

  const existing = await fetchUserNumbers(userId);
  const match = existing.find(
    (n) => n.meta_phone_number_id === settings.meta_phone_number_id
  );

  const payload = {
    user_id: userId,
    label:
      match?.label ||
      settings.meta_verified_name ||
      settings.meta_display_phone_number ||
      "WhatsApp",
    meta_access_token: settings.meta_access_token ?? null,
    meta_phone_number_id: settings.meta_phone_number_id ?? null,
    meta_waba_id: settings.meta_waba_id ?? null,
    meta_business_id: settings.meta_business_id ?? null,
    meta_app_id: settings.meta_app_id ?? null,
    meta_app_secret: settings.meta_app_secret ?? null,
    meta_display_phone_number: settings.meta_display_phone_number ?? null,
    meta_verified_name: settings.meta_verified_name ?? null,
    is_active: true,
    updated_at: new Date().toISOString(),
  };

  if (match) {
    await supabase
      .from("crm_whatsapp_numbers" as any)
      .update(payload as any)
      .eq("id", match.id);
  } else {
    await supabase.from("crm_whatsapp_numbers" as any).insert(payload as any);
  }

  return fetchUserNumbers(userId);
}

/** Aplica as credenciais do número escolhido em `crm_settings`. */
export async function activateNumber(
  userId: string,
  record: WhatsAppNumberRecord
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from("crm_settings")
    .update({
      meta_access_token: record.meta_access_token,
      meta_phone_number_id: record.meta_phone_number_id,
      meta_waba_id: record.meta_waba_id,
      meta_business_id: record.meta_business_id,
      meta_app_id: record.meta_app_id,
      meta_app_secret: record.meta_app_secret,
      meta_display_phone_number: record.meta_display_phone_number,
      meta_verified_name: record.meta_verified_name,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("user_id", userId);

  if (error) return { success: false, error: error.message };

  setActiveNumberId(userId, record.id);
  markNumberUnlocked(userId, record.id);
  return { success: true };
}

/** Define/remove a senha de um número (feito pelo próprio usuário). */
export async function setNumberPin(numberId: string, pin: string | null) {
  const { error } = await supabase
    .from("crm_whatsapp_numbers" as any)
    .update({ access_pin: pin && pin.trim() ? pin.trim() : null, updated_at: new Date().toISOString() } as any)
    .eq("id", numberId);
  return { success: !error, error: error?.message };
}

export function describeNumber(record: WhatsAppNumberRecord): string {
  return (
    record.meta_display_phone_number ||
    record.meta_verified_name ||
    record.label ||
    record.meta_phone_number_id ||
    "WhatsApp"
  );
}
