/** Internal-only response control; never forwarded to WhatsApp. */
export const AI_SILENCE_MARKER = '[[NAO_RESPONDER]]';

export const AI_CONTEXT_RESPONSE_RULE = `18. CONFIRMAÇÕES E SILÊNCIO (PRIORIDADE SOBRE INSTRUÇÕES PARA SEMPRE RESPONDER): leia o histórico e identifique o que ainda precisa ser feito. Se a empresa já explicou, respondeu ou avisou e o cliente apenas confirma que recebeu/entendeu ("ok", "tá bom", "entendi", "obrigado", "estou aguardando" ou só um emoji), sem dúvida nova, pedido novo ou ação pendente que dependa dessa confirmação, NÃO envie mensagem. Responda internamente apenas ${AI_SILENCE_MARKER}; pode acrescentar etiquetas KANBAN/ETIQUETA se necessário, mas nenhum texto, arquivo ou transferência. Não repita o aviso, a promessa de retorno, a transferência já feita, a explicação, nem mande "perfeito", "certo" ou "qualquer coisa estou aqui" só para responder. Isso vale mesmo se o aviso foi enviado ontem e a confirmação chegou hoje. "Estou aguardando" após um aviso de espera não exige repetir o aviso; cobrança de prazo, reclamação ou pergunta nova exige atendimento. NÃO use uma lista de palavras isolada: "ok" ou um emoji podem confirmar uma compra, autorizar envio de arquivo ou aceitar uma transferência que você acabou de perguntar; nesses casos execute a ação pendente normalmente. Se houver mensagens anteriores do cliente ainda sem resposta, responda o que falta. Em primeiro contato sem resposta anterior da empresa, atenda normalmente. Nunca mostre a etiqueta de silêncio ao cliente.`;

export interface AiResponseDecision {
  silent: boolean;
  reply: string;
}

/** Silence requires an explicit model decision based on history, not a keyword filter. */
export function resolveAiResponseDecision(rawReply: string, hasPreviousCompanyMessage: boolean): AiResponseDecision {
  const hasSilenceMarker = rawReply.includes(AI_SILENCE_MARKER);
  const reply = rawReply.split(AI_SILENCE_MARKER).join('').trim();
  // Classification may continue internally; operational tags must never be swallowed.
  const remaining = reply.replace(/\[\[(?:KANBAN|ETIQUETA):[^\]]+\]\]/gi, '').trim();
  return {
    silent: hasPreviousCompanyMessage && hasSilenceMarker && remaining.length === 0,
    reply,
  };
}