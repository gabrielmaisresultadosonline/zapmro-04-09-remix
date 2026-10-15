/**
 * Regra de plano no servidor (espelha src/lib/planAccess.tsx / AccessGate).
 *
 * Porquê: a tela já esconde Disparo em massa e Agente I.A. no teste grátis,
 * mas o servidor também precisa recusar — senão um disparo/agente ligado antes
 * (ou por outra aba) continuaria rodando para quem está só testando.
 *
 * "Teste" = não é admin, não tem plano pago válido e tem trial_ends_at.
 * Cadastros antigos sem trial_ends_at (grandfathered) continuam liberados.
 */
const cache = new Map<string, { trial: boolean; at: number }>();
const TTL_MS = 60_000;

export async function isTrialOnlyUser(supabase: any, userId?: string | null): Promise<boolean> {
  if (!userId) return false;
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.trial;
  try {
    const { data, error } = await supabase
      .from('crm_profiles')
      .select('role, trial_ends_at, access_until, is_paid')
      .eq('user_id', userId)
      .maybeSingle();
    // Em erro de leitura não bloqueamos: falhar aberto evita parar clientes pagos.
    if (error) return false;
    let trial = false;
    if (data && data.role !== 'admin' && data.role !== 'super_admin') {
      const paidUntil = data.access_until ? new Date(data.access_until).getTime() : 0;
      const paidActive = data.is_paid === true && paidUntil > Date.now();
      trial = !paidActive && !data.is_paid && Boolean(data.trial_ends_at);
    }
    cache.set(userId, { trial, at: Date.now() });
    return trial;
  } catch {
    return false;
  }
}

export const PAID_ONLY_MESSAGE = 'Disponível apenas nos planos pagos (teste grátis não inclui Disparo em massa nem Agente I.A.).';
