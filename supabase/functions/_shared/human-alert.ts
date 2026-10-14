/**
 * Aviso de ATENDIMENTO HUMANO para o celular do atendente.
 *
 * O atendente é um contato comum na caixa do WhatsApp. Ele só recebe
 * mensagens livres dentro da janela de 24h aberta por uma mensagem dele.
 * Funções puras aqui; o envio fica no index (usa handleInternalSendMessage).
 */

export const HUMAN_ALERT_RENEW_BUTTON_ID = 'human_alert_renew'
/** Quanto antes do fim da janela o pedido de renovação é enviado. */
export const HUMAN_ALERT_RENEW_BEFORE_MS = 6 * 60 * 60 * 1000
/** Evita avisar duas vezes o mesmo cliente em sequência. */
export const HUMAN_ALERT_DEDUPE_MS = 2 * 60 * 60 * 1000

export const onlyDigits = (value: unknown): string => String(value ?? '').replace(/\D/g, '')

/** Chave estável (DDD + 8 últimos dígitos) que ignora 55 e o nono dígito. */
export function phoneMatchKey(value: unknown): string {
  let d = onlyDigits(value)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10) return d
  return d.slice(0, 2) + d.slice(-8)
}

/** Variações possíveis do wa_id para o mesmo número brasileiro. */
export function phoneVariants(value: unknown): string[] {
  const raw = onlyDigits(value)
  if (!raw) return []
  const out = new Set<string>([raw])
  let local = raw.startsWith('55') && raw.length >= 12 ? raw.slice(2) : raw
  if (local.length === 10 || local.length === 11) {
    const ddd = local.slice(0, 2)
    const last8 = local.slice(-8)
    out.add(`55${ddd}9${last8}`)
    out.add(`55${ddd}${last8}`)
    out.add(`${ddd}9${last8}`)
    out.add(`${ddd}${last8}`)
  }
  return Array.from(out)
}

export function isSamePhone(a: unknown, b: unknown): boolean {
  const ka = phoneMatchKey(a)
  return ka.length >= 10 && ka === phoneMatchKey(b)
}

export function formatPhoneForAlert(waId: unknown): string {
  const d = onlyDigits(waId)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4)
    const rest = d.slice(4)
    return `+55 ${ddd} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`
  }
  return d ? `+${d}` : '—'
}

/** Uma única mensagem: título em negrito, número, nome e resumo. */
export function buildHumanAlertText(params: { waId: string; name?: string | null; summary: string }): string {
  const lines = ['*ATENDIMENTO HUMANO*', `Número: ${formatPhoneForAlert(params.waId)}`]
  const name = String(params.name || '').trim()
  if (name && onlyDigits(name) !== onlyDigits(params.waId)) lines.push(`Nome: ${name}`)
  lines.push(`Resumo: ${params.summary.trim() || 'Cliente pediu atendimento humano.'}`)
  lines.push(`Abrir conversa: https://wa.me/${onlyDigits(params.waId)}`)
  return lines.join('\n')
}

export const HUMAN_ALERT_RENEW_TEXT =
  'Clique abaixo para continuar recebendo avisos automáticos de atendimento humano.'
