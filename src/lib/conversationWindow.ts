/**
 * Janela de atendimento da WhatsApp Business Platform — fonte única da regra.
 *
 * - Conversa comum: 24h contadas da ÚLTIMA mensagem recebida do cliente.
 * - Conversa vinda de anúncio Click-to-WhatsApp: 72h contadas do evento do
 *   anúncio (`ctwa_opened_at`). Só vale para contatos que vieram de anúncio.
 * - Envios da empresa NUNCA abrem nem estendem a janela.
 *
 * Quando as duas regras se aplicam, vale a que expira mais tarde.
 * Espelho de `supabase/functions/_shared/conversation-window.ts` (mesma lógica).
 */

export type ConversationWindowSource = 'user' | 'click_to_whatsapp_ad'
export type ConversationWindowType = '24h' | '72h'

export interface ConversationWindowContact {
  last_message_received_at?: string | null
  ctwa_opened_at?: string | null
}

export interface ConversationWindow {
  type: ConversationWindowType
  opened_at: string | null
  expires_at: string | null
  is_open: boolean
  source: ConversationWindowSource
}

export const USER_WINDOW_MS = 24 * 60 * 60 * 1000
export const CTWA_WINDOW_MS = 72 * 60 * 60 * 1000

const parseTime = (value: unknown): number | null => {
  if (!value) return null
  const time = Date.parse(String(value).trim())
  return Number.isFinite(time) ? time : null
}

export function getConversationWindow(
  contact: ConversationWindowContact | null | undefined,
  now: number = Date.now(),
): ConversationWindow {
  const userAt = parseTime(contact?.last_message_received_at)
  const adAt = parseTime(contact?.ctwa_opened_at)

  const candidates: Array<{ type: ConversationWindowType; source: ConversationWindowSource; openedAt: number; expiresAt: number }> = []
  if (userAt !== null) candidates.push({ type: '24h', source: 'user', openedAt: userAt, expiresAt: userAt + USER_WINDOW_MS })
  if (adAt !== null) candidates.push({ type: '72h', source: 'click_to_whatsapp_ad', openedAt: adAt, expiresAt: adAt + CTWA_WINDOW_MS })

  if (candidates.length === 0) {
    // Cliente nunca escreveu: não existe janela; só template aprovado.
    return { type: '24h', opened_at: null, expires_at: null, is_open: false, source: 'user' }
  }

  const best = candidates.sort((a, b) => b.expiresAt - a.expiresAt)[0]
  return {
    type: best.type,
    opened_at: new Date(best.openedAt).toISOString(),
    expires_at: new Date(best.expiresAt).toISOString(),
    is_open: now < best.expiresAt,
    source: best.source,
  }
}

/** Um referral da Meta indica anúncio Click-to-WhatsApp? */
export function isClickToWhatsAppReferral(referral: { source_type?: string | null; ctwa_clid?: string | null } | null | undefined): boolean {
  if (!referral) return false
  return Boolean(referral.ctwa_clid) || String(referral.source_type || '').toLowerCase() === 'ad'
}

export const WINDOW_CLOSED_MESSAGE =
  'A janela de atendimento desta conversa expirou. Mensagens livres estão bloqueadas — envie um template aprovado pela Meta.'
