/**
 * Camada de acesso do módulo /acessor.
 *
 * As tabelas acessor_* são novas e ainda não constam nos tipos gerados do
 * Supabase (`integrations/supabase/types.ts`). Para não editar aquele arquivo
 * gerado — e não afetar o CRM — usamos um cliente com tipagem relaxada apenas
 * aqui, mantendo tipos explícitos nas fronteiras de leitura/escrita.
 */
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

export const acessorDb = supabase as unknown as SupabaseClient;

export type AcessorStatus = "trial" | "active" | "expired" | "blocked";

export interface AcessorProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  whatsapp: string | null;
  status: AcessorStatus;
  trial_ends_at: string;
  active_until: string | null;
  created_at: string;
}

export interface AcessorNumber {
  id: string;
  user_id: string;
  phone: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export interface AcessorEntry {
  id: string;
  user_id: string;
  kind: "gasto" | "entrada" | "investimento" | "nota";
  description: string;
  amount: number | null;
  category: string | null;
  occurred_at: string;
  raw_message: string | null;
}

export interface AcessorAppointment {
  id: string;
  user_id: string;
  title: string;
  starts_at: string;
  notes: string | null;
  status: "agendado" | "concluido" | "cancelado";
}

export const onlyDigits = (value: string): string => value.replace(/\D/g, "");

export const formatCurrency = (value: number | null): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value ?? 0);

export const formatDateTime = (value: string): string =>
  new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Dias restantes de teste/plano (0 quando já venceu). */
export const daysLeft = (iso: string | null): number => {
  if (!iso) return 0;
  const diff = new Date(iso).getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000);
};

/** Chamada autenticada à Edge Function administrativa do /acessor. */
export async function callAcessorAdmin<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
  token?: string | null,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("acessor-admin", {
    body: { action, ...payload },
    headers: token ? { "x-acessor-admin-token": token } : undefined,
  });
  if (error) {
    const details = typeof (error as { context?: { text?: () => Promise<string> } }).context?.text === "function"
      ? await (error as unknown as { context: { text: () => Promise<string> } }).context.text()
      : error.message;
    try {
      const parsed = JSON.parse(details) as { error?: string };
      throw new Error(parsed.error || error.message);
    } catch {
      throw new Error(details || error.message);
    }
  }
  return data as T;
}

export const ADMIN_TOKEN_KEY = "acessor_admin_token";
