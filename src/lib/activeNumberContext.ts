/**
 * Contexto do número de WhatsApp aberto no momento.
 *
 * Cada número de `crm_whatsapp_numbers` tem conversas, contatos e histórico
 * próprios (coluna `whatsapp_number_id`). Este módulo guarda qual número está
 * aberto para que:
 *  - as consultas do CRM filtrem apenas aquela caixa de entrada;
 *  - todas as chamadas às Edge Functions enviem `whatsapp_number_id`, fazendo
 *    o envio sair sempre pelo número da conversa (evita o erro de
 *    "Re-engagement message" causado por enviar pelo número errado).
 *
 * Não usa React para poder ser lido de qualquer camada (client Supabase,
 * helpers, componentes) sem prop drilling.
 */

const STORAGE_KEY = "crm_active_number_context";

let activeNumberId: string | null = readInitial();

function readInitial(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Número aberto agora (ou `null` quando o usuário ainda não escolheu). */
export function getActiveWhatsAppNumberId(): string | null {
  return activeNumberId;
}

/** Define/limpa o número aberto. Fica por aba (sessionStorage): cada navegador/aba trabalha com seu próprio número. */
export function setActiveWhatsAppNumberId(numberId: string | null): void {
  activeNumberId = numberId;
  try {
    if (numberId) sessionStorage.setItem(STORAGE_KEY, numberId);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage indisponível — mantém apenas em memória */
  }
}

/** Campos a serem gravados em inserts de contatos/mensagens. */
export function activeNumberPatch(): { whatsapp_number_id?: string } {
  return activeNumberId ? { whatsapp_number_id: activeNumberId } : {};
}
