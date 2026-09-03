import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.42.0"
import { executeVisualNode, processStep } from "../_shared/flow-executor.ts"
import {
  buildServerTemplateComponents,
  parseServerTemplateSchema,
  summarizeSentComponents,
  validateComponentsAgainstSchema,
} from "../_shared/template-variables.ts"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const META_GRAPH_API_VERSION = 'v25.0';

/**
 * O Storage roda atrás do gateway interno (http://gateway:8000), então
 * getPublicUrl devolve um host que o navegador não resolve. Reescrevemos
 * para o domínio público antes de gravar a URL no banco.
 */
function toPublicMediaUrl(url: string): string {
  const publicBase = (Deno.env.get('PUBLIC_API_URL') || '').replace(/\/$/, '');
  if (!publicBase || !url) return url;
  const match = url.match(/\/storage\/v1\/object\/(?:public\/)?(.+)$/);
  if (!match) return url;
  return `${publicBase}/storage/v1/object/public/${match[1]}`;
}

function describeMessageForHistory(message: any) {
  const content = message.content || "";
  if (message.direction !== 'inbound') return content;

  if (message.message_type === 'image') {
    return `${content || '[Imagem recebida]'}${message.media_url ? ` (imagem anexada: ${message.media_url})` : ''}`;
  }

  if (message.message_type === 'audio') {
    // O áudio já chega transcrito internamente: entregue apenas o conteúdo falado.
    return content || '[Áudio recebido]';
  }

  if (message.message_type === 'video') {
    return `${content || '[Vídeo recebido]'}${message.media_url ? ` (vídeo anexado para análise humana posterior: ${message.media_url})` : ''}`;
  }

  return content || `[Mensagem: ${message.message_type || 'desconhecida'}]`;
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getMetaTemplateErrorMessage(result: any) {
  const error = result?.error || {};
  const detail = firstNonEmptyString(
    error?.error_user_msg,
    error?.error_data?.details,
    error?.error_user_title,
    error?.message,
  );
  const trace = firstNonEmptyString(error?.fbtrace_id);
  return trace && detail ? `${detail} (Meta: ${trace})` : detail || 'A Meta recusou os parâmetros do template.';
}

/**
 * A Meta recusa botões de URL apontando direto para o WhatsApp
 * ("Direct links to WhatsApp aren't allowed for buttons").
 */
function isWhatsAppDirectLink(value: unknown) {
  const url = firstNonEmptyString(value);
  if (!url) return false;
  if (/^(https?:\/\/)?([a-z0-9-]+\.)*(wa\.me|whatsapp\.com|wa\.link|whatsapp\.net)(\/|$|\?)/i.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)(wa\.me|whatsapp\.com|wa\.link|whatsapp\.net)$/.test(host);
  } catch {
    return false;
  }
}


function validateTemplateForMeta(name: unknown, category: unknown, language: unknown, components: unknown) {
  const templateName = firstNonEmptyString(name);
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) {
    throw new Error('O nome do template deve conter apenas letras minúsculas, números e underline.');
  }

  const normalizedCategory = firstNonEmptyString(category).toUpperCase();
  if (!['MARKETING', 'UTILITY'].includes(normalizedCategory)) {
    throw new Error('Este editor aceita templates Marketing ou Utility. Templates de autenticação exigem o formato OTP da Meta.');
  }

  if (!firstNonEmptyString(language)) throw new Error('Selecione o idioma do template.');
  if (!Array.isArray(components)) throw new Error('Os componentes do template são inválidos.');

  const body = components.find((component: any) => component?.type === 'BODY');
  if (!firstNonEmptyString(body?.text)) throw new Error('O corpo da mensagem é obrigatório.');
  if (String(body.text).length > 1024) throw new Error('O corpo da mensagem excede o limite de 1.024 caracteres da Meta.');

  for (const component of components) {
    const getVariableIndexes = (value: unknown) =>
      Array.from(new Set(Array.from(String(value || '').matchAll(/\{\{(\d+)\}\}/g), (match) => Number(match[1])))).sort((a, b) => a - b);
    const assertSequentialVariables = (value: unknown, label: string) => {
      const indexes = getVariableIndexes(value);
      if (!indexes.every((index, position) => index === position + 1)) {
        throw new Error(`${label} usa variáveis fora de sequência. Use {{1}}, {{2}}, {{3}} sem pular números.`);
      }
    };

    if (component?.type === 'BODY') assertSequentialVariables(component?.text, 'O corpo da mensagem');
    if (component?.type === 'HEADER' && component?.format === 'TEXT' && !firstNonEmptyString(component?.text)) {
      throw new Error('Preencha o texto do cabeçalho ou selecione “Nenhum”.');
    }
    if (component?.type === 'HEADER' && component?.format === 'TEXT') {
      const indexes = getVariableIndexes(component?.text);
      if (indexes.length > 1 || (indexes.length === 1 && indexes[0] !== 1)) {
        throw new Error('O cabeçalho aceita somente a variável {{1}}.');
      }
    }
    if (component?.type === 'FOOTER' && /\{\{\d+\}\}/.test(String(component?.text || ''))) {
      throw new Error('O rodapé não pode conter variáveis.');
    }
    if (component?.type === 'BUTTONS') {
      const buttons = component.buttons || [];
      if (buttons.length > 10) throw new Error('A Meta permite no máximo 10 botões por template.');
      if (buttons.filter((button: any) => button?.type === 'URL').length > 2) {
        throw new Error('A Meta permite no máximo 2 botões de URL por template.');
      }
      if (buttons.filter((button: any) => button?.type === 'PHONE_NUMBER' || button?.type === 'PHONE').length > 1) {
        throw new Error('A Meta permite no máximo 1 botão de telefone por template.');
      }
      for (const button of buttons) {
        if (!firstNonEmptyString(button?.text)) throw new Error('Preencha o texto de todos os botões.');
        if (button?.type === 'URL' && !/^https?:\/\//i.test(firstNonEmptyString(button?.url))) {
          throw new Error('Todo botão de link precisa de uma URL completa iniciando com https://.');
        }
        if (button?.type === 'URL' && isWhatsAppDirectLink(button?.url)) {
          throw new Error('A Meta não aprova botões com link direto para o WhatsApp (wa.me, api.whatsapp.com, chat.whatsapp.com). Use o link do seu site ou um botão de Resposta Rápida.');
        }
        if (button?.type === 'URL' && /\{\{\d+\}\}/.test(String(button?.url || '')) && !Array.isArray(button?.example)) {
          throw new Error('Botões com link dinâmico precisam de um exemplo válido para a variável da URL.');
        }
      }
    }

    if (component?.type === 'CAROUSEL') {
      if (!Array.isArray(component.cards) || component.cards.length < 2) {
        throw new Error('O carrossel precisa ter pelo menos 2 cartões.');
      }
      const firstButtons = component.cards[0]?.components?.find((item: any) => item?.type === 'BUTTONS')?.buttons || [];
      const expectedTypes = firstButtons.map((button: any) => button?.type).join(',');
      const expectedHeaderFormat = component.cards[0]?.components?.find((item: any) => item?.type === 'HEADER')?.format;
      for (const [index, card] of component.cards.entries()) {
        const cardHeader = card?.components?.find((item: any) => item?.type === 'HEADER');
        const cardBody = card?.components?.find((item: any) => item?.type === 'BODY');
        const cardButtons = card?.components?.find((item: any) => item?.type === 'BUTTONS')?.buttons || [];
        if (!firstNonEmptyString(cardBody?.text)) throw new Error(`Preencha o texto do cartão ${index + 1}.`);
        if (cardHeader?.format !== expectedHeaderFormat) throw new Error('Todos os cartões do carrossel precisam usar o mesmo tipo de mídia.');
        if (cardButtons.map((button: any) => button?.type).join(',') !== expectedTypes) {
          throw new Error('Todos os cartões do carrossel precisam ter os mesmos tipos de botão, na mesma ordem.');
        }
        for (const button of cardButtons) {
          if (button?.type === 'URL' && isWhatsAppDirectLink(button?.url)) {
            throw new Error(`O cartão ${index + 1} usa um link direto do WhatsApp no botão. A Meta não aprova esse tipo de link.`);
          }
        }

      }
    }
  }
}

function normalizeTriggerText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getReferralFromWebhookMessage(message: any) {
  const referral = message?.referral || message?.context?.referral || message?.unsupported?.referral || null;
  return referral && typeof referral === 'object' ? referral : null;
}

function getReferralTextParts(referral: any) {
  if (!referral || typeof referral !== 'object') return [];
  return [
    referral.headline,
    referral.title,
    referral.body,
    referral.description,
    referral.text,
    referral.text?.body,
    referral.caption,
    referral.cta_text,
    referral.welcome_message?.text,
    referral.welcome_message?.button?.text,
    referral.source_url,
    referral.url,
  ].filter((value) => typeof value === 'string' && value.trim());
}

function flowMatchesIncomingTrigger(flow: any, allCandidateTexts: string[]) {
  const triggerType = flow?.trigger_type;
  const keywords: string[] = Array.isArray(flow?.trigger_keywords)
    ? flow.trigger_keywords.map((keyword: string) => normalizeTriggerText(keyword)).filter(Boolean)
    : (flow?.trigger_keyword ? [normalizeTriggerText(flow.trigger_keyword)] : []);

  if (keywords.length === 0 || allCandidateTexts.length === 0) return false;

  if (triggerType === 'exact_phrase') {
    // Frases Completas: exige correspondência EXATA (após normalização).
    // Não usar includes aqui — isso fazia frases longas dispararem com
    // partes soltas (ex.: "olá" disparando "Olá! Posso ter mais informações...").
    return keywords.some((keyword) => allCandidateTexts.some((candidate) => candidate === keyword));
  }

  if (triggerType === 'keyword') {
    return keywords.some((keyword) => allCandidateTexts.some((candidate) => candidate.includes(keyword)));
  }

  return false;
}

function isUnavailableUnsupportedMessage(message: any) {
  if (message?.type !== 'unsupported') return false;
  const error = Array.isArray(message?.errors) ? message.errors[0] : null;
  const details = firstNonEmptyString(error?.error_data?.details, error?.message, error?.title);
  return Number(error?.code) === 131060 || /unavailable/i.test(details);
}

/**
 * Detecta se o evento recebido é a EDIÇÃO de uma mensagem já enviada
 * (o usuário editou a mensagem no WhatsApp segundos depois).
 *
 * A Meta entrega a edição de formas diferentes dependendo da versão da API:
 *  - campo `message_edits` no changes[].field
 *  - objeto `edit` / `edited` / `is_edited` dentro da mensagem
 *  - `context.edited` apontando para a mensagem original
 *
 * Uma edição NUNCA pode ser tratada como mensagem nova: não dispara fluxo,
 * não conta como resposta e não aciona o Agente I.A.
 */
function detectEditedInboundMessage(message: any, field?: string): { isEdit: boolean; originalMessageId: string | null } {
  if (!message) return { isEdit: false, originalMessageId: null };

  const fieldIsEdit = typeof field === 'string' && /message_edits|edited_messages/i.test(field);

  const editNode = message.edit || message.edited || message.message_edit || null;
  const explicitFlag =
    message.is_edited === true ||
    message.edited === true ||
    (editNode && typeof editNode === 'object');

  const contextEdited =
    message?.context?.edited === true ||
    (!!message?.context?.edited_message_id);

  const originalMessageId =
    (editNode && typeof editNode === 'object'
      ? (editNode.original_message_id || editNode.message_id || editNode.id)
      : null) ||
    message?.context?.edited_message_id ||
    message?.edited_message_id ||
    (fieldIsEdit ? (message?.context?.id || message?.context?.message_id || null) : null) ||
    null;

  return {
    isEdit: !!(fieldIsEdit || explicitFlag || contextEdited),
    originalMessageId: originalMessageId ? String(originalMessageId) : null,
  };
}


const COMMON_CTWA_TRIGGER_TEXTS = [
  'Olá! Posso ter mais informações sobre isso?',
  'Gostaria de saber sobre o sistema inovador !',
  'Gostaria de saber sobre o sistema inovador!',
];

/**
 * Carrega um fluxo garantindo o isolamento por usuário.
 * Fluxos legados migrados da base antiga podem estar com `user_id` NULL:
 * nesse caso o fluxo é adotado (backfill) pelo usuário que o está executando,
 * em vez de falhar com "no rows" (que virava HTTP 500 no front).
 */
async function loadFlowForUser(supabase: any, flowId: string, userId: string) {
  const { data: flow, error } = await supabase
    .from('crm_flows')
    .select('*')
    .eq('id', flowId)
    .maybeSingle();

  if (error) throw new Error(`Falha ao carregar o fluxo: ${error.message}`);
  if (!flow) throw new Error('Fluxo não encontrado');

  if (!flow.user_id) {
    await supabase.from('crm_flows').update({ user_id: userId }).eq('id', flowId).is('user_id', null);
    flow.user_id = userId;
  } else if (flow.user_id !== userId) {
    throw new Error('Fluxo pertence a outra conta');
  }

  return flow;
}

async function getConfiguredCtwaFallbackText(supabase: any, userId?: string) {
  if (!userId) return '';

  const { data: flows, error } = await supabase
    .from('crm_flows')
    .select('trigger_keyword, trigger_keywords')
    .eq('user_id', userId)
    .eq('is_active', true)
    .in('trigger_type', ['exact_phrase', 'keyword']);

  if (error) {
    console.error('[WEBHOOK] Failed to load CTWA fallback triggers', { userId, error: error.message });
    return '';
  }

  const configuredKeywords = (flows || []).flatMap((flow: any) => {
    const multi = Array.isArray(flow?.trigger_keywords) ? flow.trigger_keywords : [];
    return [...multi, flow?.trigger_keyword].filter((keyword) => typeof keyword === 'string' && keyword.trim());
  });

  for (const defaultText of COMMON_CTWA_TRIGGER_TEXTS) {
    const match = configuredKeywords.find((keyword: string) => normalizeTriggerText(keyword) === normalizeTriggerText(defaultText));
    if (match) return match.trim();
  }

  return '';
}

function extractInboundTextFromWebhookMessage(message: any) {
  const node = message?.[message?.type] || {};
  const directText = firstNonEmptyString(
    message?.text?.body,
    message?.button?.text,
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
    node?.caption,
    node?.text,
    node?.body,
    message?.body,
    message?.caption,
    message?.message?.text,
    message?.message?.body,
    message?.unsupported?.text?.body,
    message?.unsupported?.body,
    message?.unsupported?.caption,
  );

  if (directText) return directText;

  const referral = getReferralFromWebhookMessage(message);
  if (referral) {
    const parts = getReferralTextParts(referral);
    if (parts.length > 0) return parts.join('\n');
  }

  return '';
}

function collectInboundTriggerTexts(message: any, resolvedText?: string) {
  const node = message?.[message?.type] || {};
  const referral = getReferralFromWebhookMessage(message);
  // Se o contato enviou um texto real (digitado ou clique em botão), o gatilho
  // deve ser avaliado APENAS contra esse texto — nunca contra o welcome_message
  // do referral do anúncio (CTWA). Caso contrário, um simples "Oi" dispara o
  // fluxo cujo gatilho é o texto pré-preenchido do anúncio.
  const userTypedText = firstNonEmptyString(
    message?.text?.body,
    message?.button?.text,
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
  );
  const hasUserTypedText = !!(userTypedText && userTypedText.trim());

  const rawCandidates = [
    resolvedText,
    extractInboundTextFromWebhookMessage(message),
    message?.text?.body,
    message?.button?.text,
    message?.interactive?.button_reply?.title,
    message?.interactive?.list_reply?.title,
    node?.caption,
    node?.text,
    node?.body,
    message?.body,
    message?.caption,
    message?.message?.text,
    message?.message?.body,
    message?.unsupported?.text?.body,
    message?.unsupported?.body,
    message?.unsupported?.caption,
    // Só incluímos textos do referral (welcome_message/headline/etc.) quando
    // o usuário NÃO enviou um texto próprio — ex.: clique de anúncio que chega
    // como "unsupported" sem body.
    ...(hasUserTypedText ? [] : getReferralTextParts(referral)),
  ];

  const normalized = rawCandidates
    .flatMap((value) => typeof value === 'string' ? [value, ...value.split(/\r?\n/)] : [])
    .map(normalizeTriggerText)
    .filter(Boolean);

  return [...new Set(normalized)];
}

async function transcribeAudioForAi(apiKey: string, audioUrl: string) {
  // (implementação abaixo)
  return await _transcribeAudioForAi(apiKey, audioUrl);
}

/**
 * Considera "vazio" qualquer conteúdo que seja apenas um marcador de mídia,
 * garantindo que o Agente I.A nunca receba placeholders no lugar do conteúdo real.
 */
function isPlaceholderContent(content: unknown) {
  if (typeof content !== 'string') return true;
  const normalized = content.trim().toLowerCase();
  if (!normalized) return true;
  return [
    '[mensagem de áudio]', '[mensagem de audio]', '[áudio]', '[audio]',
    '[áudio recebido]', '[audio recebido]', '🎤', '🎤 áudio', '(áudio)',
    '[voice]', '[ptt]',
  ].includes(normalized);
}

type AiKanbanCategory = 'frio' | 'quente' | 'cliente' | 'humano';

const AI_KANBAN_DEFINITIONS: Record<AiKanbanCategory, { label: string; value: string; color: string; sortOrder: number }> = {
  frio: { label: 'Frio', value: 'ai_frio', color: 'blue', sortOrder: 40 },
  quente: { label: 'Quente', value: 'ai_quente', color: 'red', sortOrder: 41 },
  cliente: { label: 'Cliente', value: 'ai_cliente', color: 'green', sortOrder: 42 },
  humano: { label: 'Quer falar com humano', value: 'ai_humano', color: 'amber', sortOrder: 43 },
};

function extractAiKanbanCategory(reply: string): AiKanbanCategory | null {
  const match = reply.match(/\[\[KANBAN:(frio|quente|cliente|humano)\]\]/i);
  return match ? match[1].toLowerCase() as AiKanbanCategory : null;
}

function cleanAiControlTags(reply: string): string {
  return reply
    .replace(/\[\[KANBAN:(?:frio|quente|cliente|humano)\]\]/gi, '')
    .replace(/\[\[TRANSFER_TO_HUMAN\]\]/gi, '')
    .trim();
}

function buildAiMessageParts(reply: string, sendBundled: boolean, maximumParts: number): string[] {
  const cleanReply = reply.trim();
  if (!cleanReply) return [];
  if (!sendBundled) return cleanReply.split(/\n\n+/).map((part) => part.trim()).filter(Boolean).slice(0, maximumParts);

  // A API do WhatsApp aceita texto limitado. Agrupa por padrão, mas mantém um
  // fallback seguro para não perder respostas excepcionalmente longas.
  const parts: string[] = [];
  let remaining = cleanReply;
  while (remaining.length > 4000 && parts.length < maximumParts - 1) {
    let splitAt = remaining.lastIndexOf('\n', 4000);
    if (splitAt < 2000) splitAt = remaining.lastIndexOf(' ', 4000);
    if (splitAt < 2000) splitAt = 4000;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function organizeContactInAiKanban(supabase: any, contact: any, userId: string, category: AiKanbanCategory) {
  const definition = AI_KANBAN_DEFINITIONS[category];
  const { data: existingStatus, error: statusError } = await supabase
    .from('crm_statuses')
    .select('value')
    .eq('user_id', userId)
    .eq('value', definition.value)
    .maybeSingle();
  if (statusError) throw new Error(`Não foi possível consultar o Kanban: ${statusError.message}`);

  if (!existingStatus) {
    const { error: insertStatusError } = await supabase.from('crm_statuses').insert({
      user_id: userId,
      label: definition.label,
      value: definition.value,
      color: definition.color,
      sort_order: definition.sortOrder,
    });
    if (insertStatusError) throw new Error(`Não foi possível preparar o Kanban: ${insertStatusError.message}`);
  }

  const { error: contactError } = await supabase
    .from('crm_contacts')
    .update({ status: definition.value })
    .eq('id', contact.id)
    .eq('user_id', userId);
  if (contactError) throw new Error(`Não foi possível organizar o contato no Kanban: ${contactError.message}`);
}

/**
 * Resolve o texto real de uma mensagem recebida. Se for áudio, transcreve
 * internamente (Whisper) e persiste, para a I.A responder direto ao conteúdo
 * sem nunca anunciar que está "ouvindo" ou "aguardando transcrição".
 */
async function resolveInboundMessageText(
  supabase: any,
  apiKey: string,
  msg: { id?: string; content?: string | null; message_type?: string | null; media_url?: string | null } | null,
) {
  if (!msg) return '';
  if (!isPlaceholderContent(msg.content)) return String(msg.content).trim();
  if (msg.message_type === 'audio' && msg.media_url) {
    const transcription = await _transcribeAudioForAi(apiKey, msg.media_url);
    if (transcription) {
      if (msg.id) {
        await supabase.from('crm_messages').update({ content: transcription }).eq('id', msg.id);
      }
      return transcription;
    }
  }
  return typeof msg.content === 'string' ? msg.content.trim() : '';
}

async function _transcribeAudioForAi(apiKey: string, audioUrl: string) {
  try {
    console.log(`[AI-AGENT] Downloading audio for transcription: ${audioUrl.slice(0, 100)}...`);
    
    // Validate URL
    if (!audioUrl || !audioUrl.startsWith('http')) {
      console.error('[AI-AGENT] Invalid audio URL for transcription:', audioUrl);
      return '';
    }

    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Falha ao baixar áudio (${audioRes.status})`);

    const audioBlob = await audioRes.blob();
    const formData = new FormData();
    
    // Determinando a extensão correta se possível, mas OpenAI Whisper aceita .ogg / .mp3 / .wav etc.
    // WhatsApp costuma enviar .ogg ou .m4a dependendo da plataforma
    const filename = audioUrl.split('/').pop()?.split('?')[0] || 'audio.ogg';
    formData.append('file', audioBlob, filename);
    formData.append('model', 'whisper-1');

    console.log(`[AI-AGENT] Calling OpenAI Whisper for file: ${filename}...`);
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[AI-AGENT] Whisper error:', JSON.stringify(data));
      return '';
    }
    console.log(`[AI-AGENT] Transcription success: ${data.text?.slice(0, 100)}...`);
    return data.text || '';
  } catch (err) {
    console.error('[AI-AGENT] Audio transcription exception:', err);
    return '';
  }
}

  async function processAiAgentResponse(
   supabase: any,
   contact: any,
   waId: string,
   text?: string,
   sourceMessageId?: string,
   userId?: string,
   /**
    * Caixa (número de WhatsApp) que deve responder. Sem isto o agente usava
    * sempre as credenciais de `crm_settings` (número principal): em cadastros
    * com 2+ números a resposta saía pelo número errado — ou nem saía, porque
    * `crm_settings` não guarda credencial dos números secundários. Era a causa
    * de "IA ativada mas não responde nada".
    */
   whatsappNumberId?: string | null,
 ) {
   const aiRunId = crypto.randomUUID().slice(0, 8);
   const aiLog = (stage: string, details: Record<string, unknown> = {}) => {
     console.log('[AI-AUTO]', JSON.stringify({
       run_id: aiRunId,
       stage,
       wa_id: waId,
       contact_id: contact?.id || null,
       user_id: userId || contact?.user_id || null,
       source_message_id: sourceMessageId || null,
       whatsapp_number_id: whatsappNumberId || contact?.whatsapp_number_id || null,
       ...details,
     }));
   };
   aiLog('processing_started', {
     ai_active: contact?.ai_active === true,
     flow_state: contact?.flow_state || null,
     has_input_text: Boolean(text),
   });
   let messageText = text;

    const { data: baseSettings, error: settingsError } = await supabase.from('crm_settings').select('openai_api_key, meta_phone_number_id, meta_access_token, vps_transcoder_url, ai_agent_enabled, ai_kanban_auto_organizer, ai_send_bundled, business_description, ai_system_prompt').eq('user_id', userId).maybeSingle();
  
  if (settingsError) {
    console.error(`[AI-AGENT] Error fetching settings for user ${userId}:`, settingsError);
  }

  // Credenciais da caixa correta. `crm_whatsapp_numbers` é a fonte de verdade
  // por número; `crm_settings` fica só como compatibilidade (cadastro antigo).
  const boxId = whatsappNumberId || contact?.whatsapp_number_id || null;
  let aiSettings: any = baseSettings;
  if (boxId) {
    const { data: boxRow, error: boxErr } = await supabase
      .from('crm_whatsapp_numbers')
      .select('id, meta_phone_number_id, meta_access_token, meta_waba_id, meta_display_phone_number, is_active')
      .eq('id', boxId)
      .maybeSingle();
    if (boxErr) console.error('[AI-AGENT] Falha ao carregar credenciais da caixa', boxId, boxErr.message);
    if (boxRow?.meta_phone_number_id && boxRow?.meta_access_token) {
      aiSettings = applyNumberToSettings(baseSettings, boxRow);
      aiLog('credentials_resolved', {
        source: 'crm_whatsapp_numbers',
        phone_number_id: boxRow.meta_phone_number_id,
        display: boxRow.meta_display_phone_number || null,
      });
    } else {
      aiLog('credentials_fallback_settings', {
        reason: boxRow ? 'box_without_credentials' : 'box_not_found',
        has_settings_credentials: Boolean(baseSettings?.meta_phone_number_id && baseSettings?.meta_access_token),
      });
    }
  } else {
    aiLog('credentials_fallback_settings', {
      reason: 'no_box_id',
      has_settings_credentials: Boolean(baseSettings?.meta_phone_number_id && baseSettings?.meta_access_token),
    });
  }

  const manualAiActivation = contact?.metadata?.manual_ai_activation === true;
  if (!aiSettings?.ai_agent_enabled && !manualAiActivation) {
    aiLog('skipped_not_enabled', {
      global_enabled: aiSettings?.ai_agent_enabled === true,
      manual_enabled: manualAiActivation,
    });
    console.log(`[AI-AGENT] Ignorado para ${waId}: ativação geral desligada e conversa sem ativação manual.`);
    return { success: true, skipped: 'ai_not_enabled_for_contact' };
  }

  if (!aiSettings?.meta_phone_number_id || !aiSettings?.meta_access_token) {
    // Sem credencial não há como responder. Antes isto virava um throw genérico
    // ("Credenciais Meta não configuradas") no fim da função e ficava invisível.
    aiLog('failed_missing_meta_credentials', {
      box_id: boxId,
      has_phone_number_id: Boolean(aiSettings?.meta_phone_number_id),
      has_access_token: Boolean(aiSettings?.meta_access_token),
    });
    console.error(`[AI-AGENT] Sem credenciais Meta para responder ${waId} (caixa ${boxId || 'não resolvida'}).`);
    return { success: false, error: 'meta_credentials_missing', whatsapp_number_id: boxId };
  }

  const OPENAI_API_KEY = aiSettings?.openai_api_key || Deno.env.get('OPENAI_API_KEY');

  if (!OPENAI_API_KEY) {
    aiLog('failed_missing_openai_key');
    console.error(`[AI-AGENT] OpenAI API Key não configurada para o usuário ${userId}.`);
    
    // Tenta avisar o usuário que o token está faltando
    const settings = aiSettings || await getCrmSettings(supabase, userId);
    if (settings?.meta_phone_number_id && settings?.meta_access_token) {
      const missingTokenMsg = "⚠️ Atenção: O Agente I.A. foi iniciado, mas a sua chave da OpenAI ainda não foi configurada. Por favor, acesse o menu Configurações -> Agente IA no CRM, insira sua chave (sk-...) e clique em Salvar para ativar o atendimento automático.";
      
      // Envia aviso apenas se ainda não avisou recentemente (evitar loop)
      const { data: lastMsg } = await supabase.from('crm_messages').select('content').eq('contact_id', contact.id).eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1).maybeSingle();
      
      if (lastMsg?.content !== missingTokenMsg) {
        await handleInternalSendMessage(
          supabase, 
          settings.meta_phone_number_id, 
          settings.meta_access_token, 
          { to: waId, text: missingTokenMsg }, 
          contact,
          settings.vps_transcoder_url
        );
      }
    }
    
    return { success: false, error: "OpenAI Token missing" };
  }

  if (sourceMessageId) {
    // Check if we already have a response in progress or sent for THIS specific incoming message
    const { data: existingResponse } = await supabase
      .from('crm_messages')
      .select('id')
      .eq('contact_id', contact.id)
      .eq('direction', 'outbound')
      .eq('metadata->source_message_id', sourceMessageId)
      .maybeSingle();

    if (existingResponse) {
      aiLog('skipped_already_replied');
      console.log(`[AI-AGENT] Already replied to message ${sourceMessageId}. Skipping.`);
      return { success: true, skipped: 'already_replied' };
    }

    await wait(3000); // Reduced wait time for faster response
    const { data: latestInboundAfterWait } = await supabase
      .from('crm_messages')
      .select('id, meta_message_id, content, message_type, media_url')
      .eq('contact_id', contact.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestInboundAfterWait?.meta_message_id && latestInboundAfterWait.meta_message_id !== sourceMessageId) {
      aiLog('skipped_newer_message', { newest_message_id: latestInboundAfterWait.meta_message_id });
      console.log(`[AI-AGENT] Newer inbound message arrived for ${waId}. Skipping stale response for ${sourceMessageId}.`);
      return { success: true, skipped: 'newer_message_waiting' };
    }

    // Transcreve internamente caso a última mensagem seja áudio.
    const resolvedLatest = await resolveInboundMessageText(supabase, OPENAI_API_KEY, latestInboundAfterWait);
    messageText = resolvedLatest || messageText;
  }

  
  // 1. Obter texto se não fornecido (pegar última mensagem do cliente)
  if (isPlaceholderContent(messageText)) {
    console.log(`[AI-AGENT-DEBUG] messageText is empty or default for ${waId}. Fetching last inbound message.`);
    const { data: lastMessage } = await supabase
      .from('crm_messages')
      .select('id, content, message_type, media_url')
      .eq('contact_id', contact.id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    console.log(`[AI-AGENT-DEBUG] Last message for ${waId}: type=${lastMessage?.message_type}, hasMedia=${!!lastMessage?.media_url}, content="${lastMessage?.content}"`);
    messageText = await resolveInboundMessageText(supabase, OPENAI_API_KEY, lastMessage);
  }

  // 1.1 Se chegamos aqui e ainda não temos messageText mas o sourceMessageId foi passado, tentamos buscar especificamente essa mensagem
  if (isPlaceholderContent(messageText) && sourceMessageId) {
    const { data: sourceMsg } = await supabase
      .from('crm_messages')
      .select('id, content, message_type, media_url')
      .eq('meta_message_id', sourceMessageId)
      .maybeSingle();
    messageText = await resolveInboundMessageText(supabase, OPENAI_API_KEY, sourceMsg);
  }

  // 2. Obter contexto da conversa (histórico)
  const { data: recentMessages } = await supabase
    .from('crm_messages')
    .select('id, content, direction, message_type, media_url')
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: false })
    .limit(60);

  const processedRecentMessages = [];
  for (const msg of recentMessages || []) {
    if (msg.direction === 'inbound' && msg.message_type === 'audio' && msg.media_url && isPlaceholderContent(msg.content)) {
      console.log(`[AI-AGENT-DEBUG] Transcribing history audio for ${waId}. Current content: "${msg.content}"`);
      const transcription = await _transcribeAudioForAi(OPENAI_API_KEY, msg.media_url);
      if (transcription) {
        msg.content = transcription;
        // Persistir no banco para não repetir
        await supabase.from('crm_messages').update({ content: transcription }).eq('contact_id', contact.id).eq('media_url', msg.media_url).eq('direction', 'inbound');
      }
    }
    processedRecentMessages.push(msg);
  }
    
  const history = processedRecentMessages
    .reverse()
    .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Assistente'}: ${describeMessageForHistory(m)}`)
    .join('\n');
    
  let aiPrompt = contact.ai_agent_prompt || contact.metadata?.ai_agent_prompt || "";
  let labelOnTransfer = contact.metadata?.ai_agent_label_on_transfer || "";

  // Fallback essencial: se o contato ficou preso no nó de IA sem prompt salvo,
  // busca o prompt diretamente do nó salvo no fluxo visual.
  if (!aiPrompt && contact.current_flow_id && contact.current_node_id) {
    console.log(`[AI-AGENT] Attempting to fetch prompt from node data for flow ${contact.current_flow_id} node ${contact.current_node_id}`);
    const { data: flowConfig } = await supabase
      .from('crm_flows')
      .select('nodes')
      .eq('id', contact.current_flow_id)
      .maybeSingle();

    const aiNode = flowConfig?.nodes?.find((n: any) => n.id === contact.current_node_id && n.type === 'aiAgent');
    if (aiNode?.data) {
      console.log(`[AI-AGENT] Found node data for ${contact.current_node_id}. Prompt length: ${aiNode.data.prompt?.length || 0}`);
      aiPrompt = aiNode.data.prompt || "";
      labelOnTransfer = aiNode.data.labelOnHumanTransfer || "";
      
      // Persiste o prompt no contato para as próximas mensagens
      await supabase.from('crm_contacts').update({ ai_agent_prompt: aiPrompt }).eq('id', contact.id);
    } else {
      console.warn(`[AI-AGENT] No AI node found in flow config for id ${contact.current_node_id}`);
    }
  }

  if (!aiPrompt) aiPrompt = "Você é um assistente prestativo.";
  
  const kanbanInstruction = aiSettings?.ai_kanban_auto_organizer
    ? `\n14. ORGANIZADOR KANBAN: ao final de TODA resposta, inclua exatamente uma etiqueta interna: [[KANBAN:frio]], [[KANBAN:quente]], [[KANBAN:cliente]] ou [[KANBAN:humano]]. Use frio para baixo interesse, quente para intenção de compra clara, cliente para compra/contratação confirmada e humano quando pedir atendimento humano. A etiqueta não será mostrada ao cliente.`
    : '';
  const sendingInstruction = aiSettings?.ai_send_bundled
    ? '\n15. FORMATO DE ENVIO: responda em um único bloco coeso sempre que possível.'
    : '';

  const systemPrompt = `${aiPrompt}
  
  REGRAS INTERNAS E OBRIGATÓRIAS:
  1. Envie respostas DIRETAS e HUMANAS. Evite formalidade excessiva.
  2. IMPORTANTE: Você pode enviar até 3 mensagens curtas sequenciais para parecer mais humano (ex: uma saudação, depois a resposta, depois uma pergunta), em vez de um único bloco de texto longo. Use isso quando houver necessidade de separar assuntos ou dar ênfase.
  3. NUNCA use as palavras "agente" ou "assistente" para se referir a si mesmo. Você deve falar como uma pessoa real da equipe.
  4. RESPOSTAS CURTAS: Não dê respostas longas se não houver necessidade. Seja objetivo e direto.
  5. TRANSFERÊNCIA PARA HUMANO: Quando o cliente pedir EXPLICITAMENTE para falar com um atendente humano, você DEVE confirmar antes de finalizar a transferência.
  6. Para transferir apenas após a confirmação explícita do desejo do cliente, você DEVE incluir a palavra-chave [[TRANSFER_TO_HUMAN]] logo após o seu texto de resposta. Exemplo: "Um momento, vou chamar alguém. [[TRANSFER_TO_HUMAN]]"
  7. IMPORTANTE: Não force a transferência se o cliente apenas mencionar um nome ou fizer uma pergunta sobre quem está falando. Continue o atendimento com IA até que o pedido de falar com humano seja claro e direto.
  8. Considere o histórico inteiro e as últimas mensagens do cliente como uma única solicitação.
    9. MÍDIAS (ÁUDIO/IMAGEM): Todo áudio já chega para você TRANSCRITO automaticamente e as imagens já vêm anexadas. Trate a transcrição exatamente como se fosse uma mensagem de texto do cliente e responda o conteúdo direto. NUNCA diga "não consigo ouvir seu áudio" ou "não consigo ver sua imagem".
    9.1. PROIBIDO ANUNCIAR TRANSCRIÇÃO: nunca escreva frases como "vou ouvir seu áudio", "um momento", "aguardando a transcrição do áudio", "estou processando seu áudio" ou similares. Responda diretamente o que foi pedido no áudio, na mesma mensagem.
    9.2. Nunca mencione que existe transcrição, sistema, processamento interno ou que a mensagem era um áudio.
    10. LINKS: Ao enviar um link, envie apenas a URL pura (ex: https://site.com). Nunca use markdown para links como [texto](url) e nunca repita o link. Digite o link uma única vez.
    11. SAUDAÇÕES: Não envie saudações (como "Oi!", "Olá!", "Bom dia") se você já estiver conversando com o cliente no histórico recente. Se o histórico já contém interações, pule a saudação inicial e vá direto para a resposta ou pergunta.
    12. Nunca saia do personagem.
    13. MEMÓRIA DA CONVERSA: Sempre retome TODO o contexto já conversado no histórico (dados, nomes, valores, combinados, dúvidas pendentes). Nunca repita perguntas cujas respostas já estão no histórico e nunca recomece o atendimento do zero.${kanbanInstruction}${sendingInstruction}`;
  
  try {
    const visualAttachments = (recentMessages || [])
      .filter((m: any) => m.direction === 'inbound' && m.message_type === 'image' && m.media_url)
      .slice(-3)
      .map((m: any) => ({ type: 'image_url', image_url: { url: m.media_url } }));

    const userContent: any = visualAttachments.length > 0
      ? [
          { type: 'text', text: `Histórico da conversa:\n${history}\n\nNova mensagem do cliente: ${messageText || "(Nenhuma mensagem recente - inicie o atendimento)"}` },
          ...visualAttachments
        ]
      : `Histórico da conversa:\n${history}\n\nNova mensagem do cliente: ${messageText || "(Nenhuma mensagem recente - inicie o atendimento)"}`;

    console.log(`[AI-AGENT] Calling OpenAI for ${waId}. Model: gpt-4o-mini. System prompt length: ${systemPrompt.length}`);
    
    // Log the prompt being used for debugging
    console.log(`[AI-AGENT-PROMPT] User instructions for ${waId}: ${aiPrompt.slice(0, 200)}...`);
    
    // MODIFICAÇÃO: Unificando todos os prompts para garantir contexto completo
    const fullSystemPrompt = `
${systemPrompt}

DESCRIÇÃO DO NEGÓCIO:
${aiSettings?.business_description || "Não informada."}

INSTRUÇÕES ESPECÍFICAS DESTE ATENDIMENTO/CONTATO:
${aiPrompt}
    `.trim();

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: fullSystemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.7,
        n: 1
      }),
    });



    const aiData = await aiResponse.json();
    
    if (!aiResponse.ok) {
      aiLog('failed_model_request', { status: aiResponse.status });
      console.error(`[AI-AGENT] OpenAI Error for ${waId}:`, JSON.stringify(aiData));
      return { success: false, error: "OpenAI API returned error" };
    }
    
    const rawReply = aiData.choices?.[0]?.message?.content || "";
    const kanbanCategory = aiSettings?.ai_kanban_auto_organizer
      ? extractAiKanbanCategory(rawReply)
      : null;
    const wantsHumanTransfer = rawReply.includes('[[TRANSFER_TO_HUMAN]]');
    const reply = cleanAiControlTags(rawReply);
    aiLog('model_reply_received', { reply_length: reply.length });
    console.log(`[AI-AGENT] OpenAI reply for ${waId}: ${reply.slice(0, 100)}...`);

    if (kanbanCategory && contact?.id && (userId || contact?.user_id)) {
      try {
        await organizeContactInAiKanban(supabase, contact, userId || contact.user_id, kanbanCategory);
        aiLog('kanban_organized', { category: kanbanCategory });
      } catch (kanbanError: any) {
        // Organização é auxiliar: uma falha nela nunca deve impedir a resposta.
        aiLog('kanban_organization_failed', { error: kanbanError?.message || String(kanbanError) });
      }
    }
    
    if (wantsHumanTransfer) {
      console.log(`[AI-AGENT] AI decided to transfer contact ${waId} to human.`);
      
      // Extract the message text before the transfer tag if it exists
      const cleanReply = reply;
      
      // If there's a message to send before transferring, send it
      if (cleanReply) {
        const settings = aiSettings;
        if (settings) {
          const messageParts = buildAiMessageParts(cleanReply, aiSettings?.ai_send_bundled === true, 3);
          for (const part of messageParts) {
            try {
              await handleInternalSendMessage(
                supabase,
                settings.meta_phone_number_id,
                settings.meta_access_token,
                {
                  to: waId,
                  text: part.trim(),
                  whatsapp_number_id: boxId,
                  metadata: { source_message_id: sourceMessageId }
                },
                contact,
                settings.vps_transcoder_url,
                userId || contact.user_id
              );
            } catch (transferSendErr: any) {
              aiLog('transfer_send_failed', { error: transferSendErr?.message || String(transferSendErr) });
            }
            if (messageParts.length > 1) await wait(1500);
          }
        }
      }

      const { data: flow } = await supabase.from('crm_flows').select('*').eq('id', contact.current_flow_id).eq('user_id', contact.user_id).single();
      if (flow) {
        const currentNodeId = contact.current_node_id;
        const transferEdge = flow.edges?.find((e: any) => e.source === currentNodeId && e.sourceHandle === 'human_transfer');
        
        if (transferEdge) {
          const nextNode = flow.nodes?.find((n: any) => n.id === transferEdge.target);
          if (nextNode) {
            const updateData: any = {
              flow_state: 'running',
              current_node_id: nextNode.id,
              last_flow_interaction: new Date().toISOString(),
              ai_active: false
            };
            
            if (labelOnTransfer || aiSettings?.ai_kanban_auto_organizer) {
              updateData.status = labelOnTransfer || AI_KANBAN_DEFINITIONS.humano.value;
            }
            
            await supabase.from('crm_contacts').update(updateData).eq('id', contact.id);
            await executeVisualNode(supabase, flow, nextNode, contact.id, waId);
            return { success: true, action: 'transferred' };
          }
        }
      }
      
      await supabase.from('crm_contacts').update({ 
        flow_state: 'idle', 
        ai_active: false,
        status: labelOnTransfer || (aiSettings?.ai_kanban_auto_organizer ? AI_KANBAN_DEFINITIONS.humano.value : 'human'),
        current_flow_id: null,
        current_node_id: null,
        next_execution_time: null
      }).eq('id', contact.id);
      
    } else if (reply) {
      // Credenciais já resolvidas no início (caixa correta + fallback validado).
      const settings = aiSettings;

      // MODIFICAÇÃO: Verifica se a resposta da IA é igual à última mensagem enviada para evitar duplicidade
      const { data: lastOutbound } = await supabase
        .from('crm_messages')
        .select('content')
        .eq('contact_id', contact.id)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastOutbound?.content === reply) {
        aiLog('skipped_duplicate_reply');
        console.log(`[AI-AGENT] Duplicated response detected for contact ${waId}. Skipping send.`);
      } else {
        console.log(`[AI-AGENT] Sending reply to ${waId}: ${reply.substring(0, 50)}...`);

        // Split reply into multiple messages if it contains double newlines or is too long,
        // to simulate human typing multiple messages. Limit to max 10 messages.
        const messageParts = buildAiMessageParts(reply, aiSettings?.ai_send_bundled === true, 10);

        let sentParts = 0;
        for (const part of messageParts) {
          try {
            await handleInternalSendMessage(
              supabase,
              settings.meta_phone_number_id,
              settings.meta_access_token,
              {
                to: waId,
                text: part.trim(),
                whatsapp_number_id: boxId,
                metadata: { source_message_id: sourceMessageId, ai_run_id: aiRunId }
              },
              contact,
              settings.vps_transcoder_url,
              userId || contact.user_id
            );
            sentParts++;
          } catch (sendErr: any) {
            // Falha de envio precisa aparecer no log — antes o throw subia e o
            // erro real da Meta ficava escondido em "Error processing AI response".
            aiLog('send_failed', {
              part_index: sentParts,
              phone_number_id: settings.meta_phone_number_id,
              error: sendErr?.message || String(sendErr),
            });
            console.error(`[AI-AGENT] Falha ao enviar resposta para ${waId}:`, sendErr?.message || sendErr);
            return { success: false, error: sendErr?.message || 'send_failed', sent_parts: sentParts };
          }
          // Small delay between messages to feel more human
          if (messageParts.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
        aiLog('reply_sent', { parts: sentParts, phone_number_id: settings.meta_phone_number_id });
      }
      
      
      console.log(`[AI-AGENT] Updating contact ${waId} to ensure continued AI interaction.`);
      await supabase.from('crm_contacts').update({ 
        flow_state: 'ai_handling',
        ai_active: true,
        last_interaction: new Date().toISOString(),
        metadata: { 
          ...(contact.metadata || {}),
          has_waited_initial_response: true,
          // Marca que esta conversa realmente foi atendida pelo Agente I.A.
          // Usado pelo Recuperador I.A. para nunca recuperar conversas antigas/externas.
          ai_engaged: true,
          ai_engaged_at: new Date().toISOString()
        }
      }).eq('id', contact.id);
      aiLog('reply_completed');
    }
    
    return { success: true };
  } catch (err: any) {
    aiLog('failed_exception', { error: err?.message || String(err) });
    console.error("[AI-AGENT] Error processing AI response:", err);
    return { success: false, error: err.message };
  }
}

// Save a message echo (sent from the WhatsApp Business mobile app/desktop) as
// an outbound message in the CRM so both sides of the conversation stay in sync.
async function saveOutboundEcho(
  supabase: any,
  userId: string,
  echo: any,
  businessPhone: string,
  /** Caixa (número) que enviou este eco. Mantém o histórico separado por número. */
  whatsappNumberId: string | null = null,
  /** Token do próprio número, usado para baixar mídia sem depender do número principal. */
  numberAccessToken: string | null = null,
) {
  const echoScope = <T,>(query: T): T =>
    whatsappNumberId ? ((query as any).eq('whatsapp_number_id', whatsappNumberId) as T) : query;
  const echoNumberPatch = whatsappNumberId ? { whatsapp_number_id: whatsappNumberId } : {};

  try {
    const metaMessageId = echo?.id;
    // The recipient (customer) — Meta puts the customer in `to` for echoes.
    let waId: string | undefined = echo?.to || echo?.recipient_id || echo?.contacts?.[0]?.wa_id;
    if (!waId && echo?.from && businessPhone) {
      // Defensive: if `from` differs from business phone, treat `from` as recipient
      const from = String(echo.from).replace(/\D/g, '');
      if (from !== businessPhone) waId = echo.from;
    }
    if (!waId) {
      console.warn('[WEBHOOK-ECHO] Missing recipient for echo, skipping', { metaMessageId });
      return { success: false, error: 'missing_recipient' };
    }

    // Deduplicate: avoid double-saving if we already stored this message id
    // (could be our own send or a previous echo delivery)
    if (metaMessageId) {
      const { data: existing } = await supabase
        .from('crm_messages')
        .select('id')
        .eq('meta_message_id', metaMessageId)
        .eq('user_id', userId)
        .maybeSingle();
      if (existing) {
        console.log('[WEBHOOK-ECHO] Duplicate echo ignored', { metaMessageId, waId });
        return { success: true, deduped: true };
      }
    }

    // Find or create contact
    // Busca por TODAS as variantes (com/sem 9º dígito) para nunca duplicar a conversa.
    const echoVariants = getBrazilianPhoneVariants(waId);
    const { data: echoContactRows } = await echoScope(
      supabase
        .from('crm_contacts')
        .select('id')
        .in('wa_id', echoVariants)
        .eq('user_id', userId)
    ).limit(1);
    let contact: any = echoContactRows && echoContactRows.length > 0 ? echoContactRows[0] : null;

    if (!contact) {
      const { data: created, error: createErr } = await supabase
        .from('crm_contacts')
        .insert({
          wa_id: canonicalBrazilianWaId(waId),
          name: canonicalBrazilianWaId(waId),
          status: 'new',
          source_type: 'whatsapp_echo',
          user_id: userId,
          last_interaction: new Date().toISOString(),
          metadata: { source: 'meta_webhook_echo' },
          ...echoNumberPatch
        })
        .select('id')
        .maybeSingle();
      if (createErr || !created) {
        // Corrida: outro processo criou o contato primeiro — reaproveita o existente.
        const { data: retryRows } = await echoScope(
          supabase
            .from('crm_contacts')
            .select('id')
            .in('wa_id', echoVariants)
            .eq('user_id', userId)
        ).limit(1);
        if (retryRows && retryRows.length > 0) {
          contact = retryRows[0];
        } else {
          console.error('[WEBHOOK-ECHO] Failed to create contact', {
            waId,
            whatsapp_number_id: whatsappNumberId,
            error: createErr?.message || 'insert returned no row',
          });
          return { success: false, error: createErr?.message || 'contact_create_failed' };
        }
      } else {
        contact = created;
      }
    }


    // Build content/type
    const type = echo?.type || 'text';
    let content = '';
    let echoMediaUrl: string | null = null;
    if (type === 'text') {
      content = echo?.text?.body || '';
    } else if (type === 'interactive') {
      content = echo?.interactive?.button_reply?.title || echo?.interactive?.list_reply?.title || `[${type}]`;
    } else if (['image', 'video', 'ptv', 'audio', 'voice', 'sticker', 'document'].includes(type)) {
      const node = echo?.[type] || {};
      content = node?.caption || '';
      const mediaId = node?.id;
      if (mediaId) {
        try {
          // Prioriza o token da própria caixa; crm_settings é só compatibilidade
          // para cadastros antigos de um único número.
          let token = numberAccessToken;
          if (!token) {
            const { data: echoSettings } = await supabase
              .from('crm_settings')
              .select('meta_access_token')
              .eq('user_id', userId)
              .maybeSingle();
            token = echoSettings?.meta_access_token || null;
          }
          if (token) {
            echoMediaUrl = await fetchAndStoreIncomingMedia(
              supabase,
              token,
              mediaId,
              type === 'voice' ? 'audio' : (type === 'ptv' ? 'video' : type),
              `echo_${waId}_${type}`,
              node?.mime_type
            );
          }
        } catch (err) {
          console.error('[WEBHOOK-ECHO] Media resolve error', err);
        }
      }
    } else {
      content = `[${type}]`;
    }

    const { error: insertErr } = await supabase.from('crm_messages').insert({
      contact_id: contact!.id,
      direction: 'outbound',
      message_type: type === 'ptv' ? 'video' : type,
      content: content || `[${type}]`,
      status: 'sent',
      meta_message_id: metaMessageId || null,
      media_url: echoMediaUrl,
      metadata: { raw: echo, source: 'echo_mobile_app' },
      user_id: userId,
      ...echoNumberPatch,

      // Preserve the real send order from the WhatsApp client (phone/desktop).
      // Webhook events can arrive out-of-order; rely on Meta's timestamp so the
      // chat renders in the same order the user actually sent the messages.
      created_at: echo?.timestamp
        ? new Date(Number(echo.timestamp) * 1000).toISOString()
        : new Date().toISOString()
    });
    if (insertErr) {
      // Duplicate (race condition) — partial unique index will reject it. Treat as success.
      if (String(insertErr.message || '').toLowerCase().includes('duplicate')) {
        console.log('[WEBHOOK-ECHO] Duplicate echo rejected by unique index', { metaMessageId, waId });
        return { success: true, deduped: true };
      }
      console.error('[WEBHOOK-ECHO] Failed to insert outbound echo', { waId, error: insertErr.message });
      return { success: false, error: insertErr.message };
    }

    await supabase.from('crm_contacts').update({
      last_interaction: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', contact!.id);

    console.log('[WEBHOOK-ECHO] Saved outbound echo from mobile app', { waId, userId, contact_id: contact!.id, metaMessageId, type });
    return { success: true };
  } catch (err: any) {
    console.error('[WEBHOOK-ECHO] Unexpected error', err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Coexistência (SMB): a Meta entrega os mesmos eventos com OUTROS nomes de campo.
 *   - field `smb_message_echoes`  -> value.smb_message_echoes  (enviadas pelo celular)
 *   - field `history`             -> value.history[].threads[].messages (sync inicial)
 *   - field `smb_app_state_sync`  -> apenas estado/contatos (nada a persistir aqui)
 * Normalizamos para o formato canônico (`message_echoes` / `messages`) para que
 * TODO o restante do handler continue funcionando sem duplicação de lógica.
 */
function normalizeSmbWebhookEntries(entries: any[]): any[] {
  return entries.map((entryItem: any) => {
    if (!Array.isArray(entryItem?.changes)) return entryItem;
    const changes = entryItem.changes.map((change: any) => {
      const field = String(change?.field || '');
      const value = { ...(change?.value || {}) };

      // 1) Echoes de coexistência
      const smbEchoes = Array.isArray((value as any).smb_message_echoes)
        ? (value as any).smb_message_echoes
        : [];
      if (smbEchoes.length > 0) {
        value.message_echoes = [...(Array.isArray(value.message_echoes) ? value.message_echoes : []), ...smbEchoes];
        delete (value as any).smb_message_echoes;
        console.log('[WEBHOOK-SMB] Echoes de coexistência normalizados', { count: smbEchoes.length, field });
      }

      // 2) Histórico inicial (threads) -> messages
      if (Array.isArray((value as any).history)) {
        const historyMessages: any[] = [];
        for (const bucket of (value as any).history) {
          for (const thread of (Array.isArray(bucket?.threads) ? bucket.threads : [])) {
            for (const msg of (Array.isArray(thread?.messages) ? thread.messages : [])) {
              if (msg && typeof msg === 'object') historyMessages.push(msg);
            }
          }
        }
        if (historyMessages.length > 0) {
          value.messages = [...(Array.isArray(value.messages) ? value.messages : []), ...historyMessages];
          console.log('[WEBHOOK-SMB] Histórico normalizado', { count: historyMessages.length });
        }
        delete (value as any).history;
      }

      // 3) Estado do app: só log (não há mensagem para persistir)
      if (/smb_app_state_sync/i.test(field)) {
        console.log('[WEBHOOK-SMB] app_state_sync recebido', {
          phone_number_id: value?.metadata?.phone_number_id || null,
        });
      }

      const normalizedField = /smb_message_echoes/i.test(field) ? 'message_echoes' : change?.field;
      return { ...change, field: normalizedField, value };
    });
    return { ...entryItem, changes };
  });
}

async function handleProcessWebhook(supabase: any, entry: any, skipSave = false, userId?: string) {
  const rawEntries = Array.isArray(entry) ? entry : (entry ? [entry] : []);
  const entries = normalizeSmbWebhookEntries(rawEntries);
  const changes = entries.flatMap((entryItem: any) =>
    Array.isArray(entryItem?.changes)
      ? entryItem.changes.map((change: any) => ({ entryItem, change }))
      : []
  );


  const shouldSplitPayload = changes.length > 1 || changes.some(({ change }: any) => {
    const value = change?.value || {};
    const messagesCount = Array.isArray(value.messages) ? value.messages.length : 0;
    const statusesCount = Array.isArray(value.statuses) ? value.statuses.length : 0;
    const echoesCount = Array.isArray(value.message_echoes) ? value.message_echoes.length : 0;
    return messagesCount > 1 || (statusesCount > 0 && (messagesCount > 0 || echoesCount > 0));
  });

  if (shouldSplitPayload) {
    const results = [];
    for (const { entryItem, change } of changes) {
      const value = change?.value || {};
      const baseValue = { ...value };
      delete (baseValue as any).messages;
      delete (baseValue as any).statuses;
      delete (baseValue as any).message_echoes;

      const units: any[] = [];
      if (Array.isArray(value.statuses) && value.statuses.length > 0) {
        units.push({ ...baseValue, statuses: value.statuses });
      }
      if (Array.isArray(value.message_echoes) && value.message_echoes.length > 0) {
        units.push({ ...baseValue, message_echoes: value.message_echoes });
      }
      if (Array.isArray(value.messages) && value.messages.length > 0) {
        for (const message of value.messages) {
          units.push({ ...baseValue, messages: [message] });
        }
      }
      if (units.length === 0) units.push(value);

      for (const unitValue of units) {
        const singleEntry = [{ ...entryItem, changes: [{ ...change, value: unitValue }] }];
        const response = await handleProcessWebhook(supabase, singleEntry, skipSave, userId);
        try {
          results.push(await response.clone().json());
        } catch {
          results.push({ success: response.ok, status: response.status });
        }
      }
    }
    return jsonResponse({ success: true, type: 'batched_webhook', results });
  }

  const value = entry?.[0]?.changes?.[0]?.value || {};
  const webhookField = entry?.[0]?.changes?.[0]?.field;

  // IMPORTANTE: estes dois identificadores são usados em todo o handler
  // (resolução do dono e da caixa). Precisam viver no escopo da função —
  // declarar dentro do `if (!userId)` causava ReferenceError no runtime.
  const webhookPhoneNumberId: string | null = value?.metadata?.phone_number_id ?? null;
  const webhookWabaId: string | null = entry?.[0]?.id ?? null;

  // Número (caixa) que recebeu esta mensagem. Resolvido ANTES do dono porque,
  // para o 2º/3º número do cadastro, a credencial só existe em
  // crm_whatsapp_numbers (crm_settings guarda apenas o número principal).
  const inboundNumberRow = await getWhatsAppNumberByPhoneId(
    supabase,
    webhookPhoneNumberId,
    webhookWabaId,
  );

  if (!userId && inboundNumberRow?.user_id) {
    userId = inboundNumberRow.user_id;
  }

  if (!userId && (webhookPhoneNumberId || webhookWabaId)) {
    const query = supabase
      .from('crm_settings')
      .select('user_id')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1);
    const { data: resolvedRows, error: resolveError } = webhookPhoneNumberId
      ? await query.eq('meta_phone_number_id', webhookPhoneNumberId)
      : await query.eq('meta_waba_id', webhookWabaId);
    if (resolveError) console.warn('[WEBHOOK] Failed to resolve user inside handler', resolveError);
    const resolved = Array.isArray(resolvedRows) ? resolvedRows[0] : null;
    if (resolved?.user_id) userId = resolved.user_id;
  }

  if (!userId) {
    console.warn('[WEBHOOK] Event received but no CRM user was resolved for this webhook payload', {
      phone_number_id: webhookPhoneNumberId,
      waba_id: webhookWabaId,
      hasMessages: !!value?.messages?.length,
      hasStatuses: !!value?.statuses?.length,
    });
    return jsonResponse({ success: true, ignored: 'missing_user' });
  }

  // Caixa efetiva do evento. Quando o phone_number_id do payload não casa com
  // nenhuma linha de crm_whatsapp_numbers (cadastro antigo, número recém trocado
  // na Meta), caímos no número padrão do usuário — é exatamente o que o trigger
  // do banco faria, e assim o app e o banco nunca divergem no ON CONFLICT.
  let inboundNumberId: string | null =
    inboundNumberRow?.user_id === userId ? inboundNumberRow.id : null;
  if (!inboundNumberId) {
    const { data: fallbackNumbers } = await supabase
      .from('crm_whatsapp_numbers')
      .select('id, is_primary, created_at')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(1);
    const fallbackNumber = Array.isArray(fallbackNumbers) ? fallbackNumbers[0] : null;
    if (fallbackNumber?.id) {
      inboundNumberId = fallbackNumber.id;
      console.warn('[WEBHOOK] phone_number_id não encontrado; usando número padrão do cadastro', {
        phone_number_id: webhookPhoneNumberId,
        waba_id: webhookWabaId,
        whatsapp_number_id: inboundNumberId,
      });
    }
  }
  /** Restringe a consulta ao número da caixa quando ele é conhecido. */
  const scopeNumber = <T,>(query: T): T =>
    inboundNumberId ? ((query as any).eq('whatsapp_number_id', inboundNumberId) as T) : query;
  const numberPatch = inboundNumberId ? { whatsapp_number_id: inboundNumberId } : {};


  if (Array.isArray(value.statuses) && value.statuses.length > 0) {
    const results = [];
    for (const statusEvent of value.statuses) {
      results.push(await syncOutboundStatusFromMeta(supabase, userId, statusEvent));
    }
    return jsonResponse({ success: true, type: 'statuses', results });
  }

  // Handle "message_echoes" — messages sent from the WhatsApp Business mobile app
  // (or other clients) on the same number. Meta delivers them so we can keep CRM
  // history in sync with what the user types on their phone.
  const echoes: any[] = Array.isArray(value.message_echoes) ? value.message_echoes : [];
  // Some payloads put echoes inside `messages` with `from` equal to the business phone.
  const businessPhone = (value?.metadata?.display_phone_number || '').replace(/\D/g, '');
  const messageEchoesInMessages: any[] = Array.isArray(value.messages)
    ? value.messages.filter((m: any) => {
        const from = String(m?.from || '').replace(/\D/g, '');
        return businessPhone && from === businessPhone;
      })
    : [];
  const allEchoes = [...echoes, ...messageEchoesInMessages];

  if (allEchoes.length > 0) {
    const results = [];
    for (const echo of allEchoes) {
      // Edições de mensagens enviadas pela empresa também não geram nova bolha.
      if (detectEditedInboundMessage(echo, webhookField).isEdit) {
        results.push({ ignored: 'edited_echo', id: echo?.id || null });
        continue;
      }
      results.push(await saveOutboundEcho(
        supabase,
        userId,
        echo,
        businessPhone,
        inboundNumberId,
        inboundNumberRow?.user_id === userId ? (inboundNumberRow?.meta_access_token || null) : null,
      ));

    }

    if (allEchoes.length === (value.messages?.length || 0) || echoes.length > 0) {
      return jsonResponse({ success: true, type: 'echoes', results });
    }
  }

  if (!value?.messages?.[0]) {
    return jsonResponse({ success: true, ignored: 'empty_event' });
  }

  const message = value.messages[0];
  const waId = message.from;
  const webhookRunId = crypto.randomUUID().slice(0, 8);
  const webhookAiLog = (stage: string, details: Record<string, unknown> = {}) => {
    console.log('[AI-AUTO-WEBHOOK]', JSON.stringify({
      run_id: webhookRunId,
      stage,
      wa_id: waId || null,
      user_id: userId || null,
      message_id: message?.id || null,
      message_type: message?.type || null,
      ...details,
    }));
  };
  webhookAiLog('inbound_received');

  // Skip if this single message is actually an echo we already handled above.
  if (businessPhone && String(waId || '').replace(/\D/g, '') === businessPhone) {
    return jsonResponse({ success: true, ignored: 'echo_already_handled' });
  }

  // ─────────────────────────────────────────────────────────────
  // EDIÇÃO DE MENSAGEM
  // O contato editou uma mensagem já enviada. Isso NÃO é uma nova
  // mensagem: não pode disparar fluxo, não conta como resposta de
  // "aguardando resposta" e não aciona o Agente I.A.
  // Apenas atualizamos o conteúdo já salvo na conversa.
  // ─────────────────────────────────────────────────────────────
  const editInfo = detectEditedInboundMessage(message, webhookField);
  if (editInfo.isEdit) {
    const newText = extractInboundTextFromWebhookMessage(message) || message?.text?.body || '';
    const targetMetaId = editInfo.originalMessageId || message?.id;
    webhookAiLog('edited_message_ignored', {
      original_message_id: editInfo.originalMessageId,
      target_meta_id: targetMetaId,
    });

    if (!skipSave && targetMetaId && newText) {
      try {
        const { data: originalRow } = await supabase
          .from('crm_messages')
          .select('id, content, metadata')
          .eq('meta_message_id', targetMetaId)
          .eq('user_id', userId)
          .maybeSingle();

        if (originalRow) {
          await supabase
            .from('crm_messages')
            .update({
              content: newText,
              metadata: {
                ...(originalRow.metadata || {}),
                edited: true,
                edited_at: new Date().toISOString(),
                previous_content: originalRow.content || null,
              },
            })
            .eq('id', originalRow.id);
        }
      } catch (err) {
        console.error('[WEBHOOK] Failed to apply message edit', err);
      }
    }

    return jsonResponse({ success: true, ignored: 'edited_message' });
  }



  let text = '';
  let buttonId = '';
  let mediaUrlForSave: string | null = null;
  let mediaCaption = '';
  let extractedInboundText = extractInboundTextFromWebhookMessage(message);

  if (!extractedInboundText && isUnavailableUnsupportedMessage(message)) {
    // CTWA fallback should ONLY apply to brand-new conversations coming from
    // Click-to-WhatsApp ads. If the contact already has prior interactions,
    // an "unsupported" event is almost certainly a real unsupported payload
    // (WhatsApp Business auto-reply / stickers / etc.) — NOT a CTWA click.
    // Injecting the synthetic trigger text here caused active conversations
    // to fire the wrong flow when the customer's auto-reply arrived.
    const hasReferral = !!getReferralFromWebhookMessage(message);
    const variants = getBrazilianPhoneVariants(waId);
    const { data: existingContactForCtwa } = await scopeNumber(
      supabase
        .from('crm_contacts')
        .select('id, total_messages_received, last_message_received_at')
        .in('wa_id', variants)
        .eq('user_id', userId)
    )
      .order('last_message_received_at', { ascending: false, nullsFirst: true })
      .limit(1)
      .maybeSingle();
    const isBrandNewContact =
      !existingContactForCtwa ||
      ((existingContactForCtwa.total_messages_received || 0) === 0 &&
        !existingContactForCtwa.last_message_received_at);
    if (hasReferral || isBrandNewContact) {
      extractedInboundText = await getConfiguredCtwaFallbackText(supabase, userId);
    } else {
      console.log('[WEBHOOK] Skipping CTWA fallback for existing contact', { waId, userId });
    }
  }

  if (message.type === 'image' || message.type === 'video' || message.type === 'ptv') {
    console.log(`[FLOW-LOG] Received ${message.type} from ${waId}. Resolving media ID...`);
  }

  if (!skipSave && message.id) {
     const { data: existingInbound } = await supabase
       .from('crm_messages')
       .select('id')
       .eq('meta_message_id', message.id)
       .eq('user_id', userId)
       .maybeSingle();

    if (existingInbound) {
      console.log(`[FLOW-LOG] Duplicate inbound message ${message.id} ignored for ${waId}`);
      return jsonResponse({ success: true, message: 'Duplicate inbound ignored' });
    }
  }

  // Metadados do clique em botão de template (resposta rápida) — gravados no
  // histórico para o CRM identificar contato, template, botão e horário.
  let templateButtonMeta: Record<string, any> | null = null;

  if (message.type === 'text') {
    text = extractedInboundText || message.text.body;
  } else if (message.type === 'interactive') {
    if (message.interactive.type === 'button_reply') {
      buttonId = message.interactive.button_reply.id;
      text = extractedInboundText || message.interactive.button_reply.title;
      templateButtonMeta = {
        interactive_button_id: message.interactive.button_reply.id || null,
        interactive_button_title: message.interactive.button_reply.title || null,
        template_context_message_id: message.context?.id || null,
      };
    }
  } else if (['image', 'video', 'ptv', 'audio', 'voice', 'sticker', 'document'].includes(message.type)) {
    const node = message[message.type] || {};
    mediaCaption = node?.caption || '';
    const mediaId = node?.id;
    if (mediaId) {
      try {
        const { data: mediaSettings } = await supabase
          .from('crm_settings')
          .select('meta_access_token')
          .eq('user_id', userId)
          .maybeSingle();
        const token = mediaSettings?.meta_access_token;
        if (token) {
          mediaUrlForSave = await fetchAndStoreIncomingMedia(
            supabase,
            token,
            mediaId,
            message.type === 'voice' ? 'audio' : (message.type === 'ptv' ? 'video' : message.type),
            `${waId}_${message.type}`,
            node?.mime_type
          );
        } else {
          console.warn('[WEBHOOK] No meta_access_token to fetch inbound media', { userId, waId });
        }
      } catch (err) {
        console.error('[WEBHOOK] Error resolving inbound media', err);
      }
    }
    text = extractedInboundText || mediaCaption || '';
  }
else if (message.type === "unsupported") {
    const error = message.errors?.[0];
    text = extractedInboundText || `[Formato não suportado pela Meta] ${error?.title || ""}: ${error?.message || ""}`.trim();
  } else if (message.type === "location") {
    text = `[Localização] Lat: ${message.location?.latitude}, Long: ${message.location?.longitude}`;
  } else if (message.type === "contacts") {
    text = `[Contato] ${message.contacts?.[0]?.name?.formatted_name || "Compartilhado"}`;
  } else if (message.type === "button") {
    // Clique em botão de RESPOSTA RÁPIDA de um template aprovado.
    // A Meta envia { button: { text, payload }, context: { id } } — o context
    // aponta para a mensagem de template que originou o clique.
    text = message.button?.text || "[Botão]";
    templateButtonMeta = {
      template_button_text: message.button?.text || null,
      template_button_payload: message.button?.payload || message.button?.text || null,
      template_context_message_id: message.context?.id || null,
      template_button_clicked_at: message?.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
    };
    try {
      if (message.context?.id) {
        const { data: originMessage } = await supabase
          .from('crm_messages')
          .select('id, metadata')
          .eq('meta_message_id', message.context.id)
          .eq('user_id', userId)
          .maybeSingle();
        if (originMessage) {
          templateButtonMeta.template_origin_message_id = originMessage.id;
          templateButtonMeta.template_name = originMessage.metadata?.template_name || null;
          templateButtonMeta.template_id = originMessage.metadata?.template_id || null;
        }
      }
    } catch (originErr) {
      console.warn('[WEBHOOK] Não foi possível localizar o template de origem do botão:', (originErr as any)?.message);
    }
    console.log('[WEBHOOK] Template quick reply recebido', { waId, button: templateButtonMeta.template_button_text, template: templateButtonMeta.template_name || null });
  } else if (message.type === "reaction") {
    text = `[Reação] ${message.reaction?.emoji || ""}`;
  }

   const variantsForSave = getBrazilianPhoneVariants(waId);
   let { data: contactForSave } = await scopeNumber(
     supabase
       .from('crm_contacts')
       .select('id, total_messages_received, last_message_received_at')
       .in('wa_id', variantsForSave)
       .eq('user_id', userId)
   )
     .order('last_message_received_at', { ascending: false, nullsFirst: true })
     .limit(1)
     .maybeSingle();

  if (!contactForSave && !skipSave) {
    const profileName = message?.profile?.name || message?.contacts?.[0]?.profile?.name || waId;

    // ATENÇÃO: NÃO usar .upsert() aqui.
    // Os índices únicos de crm_contacts são PARCIAIS
    // (WHERE whatsapp_number_id IS NOT NULL / IS NULL). O PostgREST envia
    // "ON CONFLICT (cols)" sem o predicado, e o Postgres não infere índice
    // parcial nesse caso -> erro "no unique or exclusion constraint matching
    // the ON CONFLICT specification", que fazia TODA mensagem recebida falhar.
    // Padrão seguro: insert direto e, em caso de corrida/duplicidade, releitura.
    const { data: newContact, error: createContactError } = await supabase
      .from('crm_contacts')
      .insert({
        // Sempre gravamos a forma canônica para nunca criar duas conversas
        // do mesmo contato (com e sem o 9º dígito).
        wa_id: canonicalBrazilianWaId(waId),
        user_id: userId,
        name: profileName,
        status: 'new',
        source_type: 'whatsapp_inbound',
        last_interaction: new Date().toISOString(),
        last_message_received_at: new Date().toISOString(),
        total_messages_received: 0,
        metadata: { source: 'meta_webhook', profile: message?.profile || null },
        ...numberPatch
      })
      .select('id, total_messages_received')
      .maybeSingle();

    if (createContactError || !newContact) {
      // Corrida entre entregas simultâneas da Meta: o contato já existe.
      const { data: retryContact } = await scopeNumber(
        supabase
          .from('crm_contacts')
          .select('id, total_messages_received, last_message_received_at')
          .in('wa_id', variantsForSave)
          .eq('user_id', userId)
      )
        .order('last_message_received_at', { ascending: false, nullsFirst: true })
        .limit(1)
        .maybeSingle();

      if (retryContact) {
        contactForSave = retryContact;
        console.log('[WEBHOOK] Contact duplicate resolved via retry', { waId, contact_id: contactForSave.id });
      } else {
        // Rede de segurança: em bancos onde a migração 091 ainda não rodou,
        // sobrevive o índice único crm_contacts_user_canon_wa_id_key
        // (user_id + canon_wa_id, SEM a caixa). Nesse caso o contato existe,
        // mas em OUTRA caixa do mesmo cadastro — a busca acima, escopada pelo
        // whatsapp_number_id, não o encontra e a mensagem era descartada com
        // HTTP 500. Aqui reaproveitamos o contato existente para não perder a
        // mensagem, e adotamos a caixa quando ela ainda está vazia.
        const { data: legacyContact } = await supabase
          .from('crm_contacts')
          .select('id, total_messages_received, last_message_received_at, whatsapp_number_id')
          .in('wa_id', variantsForSave)
          .eq('user_id', userId)
          .order('last_message_received_at', { ascending: false, nullsFirst: true })
          .limit(1)
          .maybeSingle();

        if (legacyContact) {
          contactForSave = legacyContact;
          if (inboundNumberId && !legacyContact.whatsapp_number_id) {
            await supabase
              .from('crm_contacts')
              .update({ whatsapp_number_id: inboundNumberId })
              .eq('id', legacyContact.id);
          }
          console.warn('[WEBHOOK] Contato reaproveitado de outra caixa (migração 091 pendente?)', {
            waId,
            userId,
            contact_id: legacyContact.id,
            caixa_do_contato: legacyContact.whatsapp_number_id,
            caixa_da_mensagem: inboundNumberId,
            error: createContactError?.message || null,
          });
        } else {
          console.error('[WEBHOOK] Failed to resolve contact creation', {
            waId,
            userId,
            whatsapp_number_id: inboundNumberId,
            error: createContactError?.message || 'insert returned no row',
          });
          return jsonResponse({ success: false, error: createContactError?.message || 'contact_create_failed' }, 500);
        }
      }

    } else {
      contactForSave = newContact;
      console.log('[WEBHOOK] Handled inbound contact (insert)', {
        waId,
        userId,
        whatsapp_number_id: inboundNumberId,
        contact_id: contactForSave?.id,
      });
    }
  }


  if (contactForSave && !skipSave) {
    // Capture state BEFORE update so we can evaluate triggers (first message, day, 24h)
    var __previousTotalReceived = contactForSave.total_messages_received || 0;
    var __previousLastReceivedAt: string | null = contactForSave.last_message_received_at || null;
     const { error: insertMessageError } = await supabase.from('crm_messages').insert({
       contact_id: contactForSave.id,
       direction: 'inbound',
       message_type: message.type === 'ptv' ? 'video' : message.type,
      content: text || extractedInboundText || `[${message.type}]`,
       status: 'received',
       meta_message_id: message.id,
       media_url: mediaUrlForSave,
      metadata: { raw: message, referral: getReferralFromWebhookMessage(message), ...(templateButtonMeta || {}) },
       user_id: userId,
       // Preserve real send order: webhook batches may arrive out-of-order, so
       // we honor Meta's per-message timestamp instead of the DB insertion time.
       created_at: message?.timestamp
         ? new Date(Number(message.timestamp) * 1000).toISOString()
         : new Date().toISOString()
     });
    if (insertMessageError) {
      console.error('[WEBHOOK] Failed to save inbound message', { waId, userId, error: insertMessageError.message });
      return jsonResponse({ success: false, error: insertMessageError.message }, 500);
    }
     const inboundMessageAt = message?.timestamp
       ? new Date(Number(message.timestamp) * 1000).toISOString()
       : new Date().toISOString();
     await supabase.from('crm_contacts').update({
       last_interaction: inboundMessageAt,
       last_message_received_at: inboundMessageAt,
      total_messages_received: (contactForSave.total_messages_received || 0) + 1,
      updated_at: new Date().toISOString(),
      countdown_trigger_sent_at: null,
      last_read_at: null // Reset last_read_at when new message arrives so it shows as unread
    }).eq('id', contactForSave.id).eq('user_id', userId);
    console.log('[WEBHOOK] Saved inbound message and reset last_read_at', { waId, userId, contact_id: contactForSave.id, meta_message_id: message.id });
  }


    // IMPORTANTE: este `contact` alimenta IA, gatilhos e fluxos abaixo.
    // Sem o escopo por número, um cadastro com 2 caixas usava o contato da
    // OUTRA caixa (a de last_message_received_at mais recente) — misturando
    // histórico e travando o envio. O escopo abaixo é obrigatório.
    const variants = getBrazilianPhoneVariants(waId);
    let { data: contact } = await scopeNumber(
      supabase
        .from('crm_contacts')
        .select('*')
        .in('wa_id', variants)
        .eq('user_id', userId)
    )
      .order('last_message_received_at', { ascending: false, nullsFirst: true })
      .limit(1)

      .maybeSingle();

  // CRITICAL: Ensure we capture messages for AI processing if the contact is in any AI-related state
  const isInAiNode = contact?.current_node_id?.includes('aiAgent');
  const isAiHandling = contact?.flow_state === 'ai_handling';
  const isAiActive = contact?.ai_active === true;
  const isWaitingResponse = contact?.flow_state === 'waiting_response';
  // Carrega as configurações do CRM deste usuário para saber se o Agente IA Global está ligado.
  // (Antes esta variável não existia neste escopo, o que quebrava o webhook com
  // "ReferenceError: settings is not defined" logo após salvar a mensagem recebida.)
  let webhookSettings: any = null;
  try {
    const { data: loadedSettings, error: loadedSettingsError } = await supabase
      .from('crm_settings')
      .select('ai_agent_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (loadedSettingsError) {
      console.error('[WEBHOOK] Failed to load crm_settings for AI check', loadedSettingsError.message);
    }
    webhookSettings = loadedSettings || null;
  } catch (settingsErr) {
    console.error('[WEBHOOK] Unexpected error loading crm_settings', settingsErr);
  }
  const isGlobalAiEnabled = webhookSettings?.ai_agent_enabled === true;
  webhookAiLog('eligibility_resolved', {
    contact_id: contact?.id || null,
    contact_ai_active: contact?.ai_active === true,
    global_enabled: isGlobalAiEnabled,
    flow_state: contact?.flow_state || null,
    current_flow_id: contact?.current_flow_id || null,
  });
  
  // Only treat as "active flow" when there's a flow AND the state is not idle/completed.
  // Without this, contacts whose previous flow ended but left `current_flow_id` set
  // would never trigger any new flow on inbound messages (silent stuck state).
  const _flowState = contact?.flow_state;
  const _isFlowEnded = !_flowState
    || _flowState === 'idle'
    || _flowState === 'completed'
    || _flowState === 'ended'
    || _flowState === 'finished';
  // SE O MODO GLOBAL ESTIVER ATIVO, consideramos que não há fluxo impedindo a IA, a menos que esteja no meio de um fluxo rodando
  const hasActiveFlow = !!contact?.current_flow_id && !_isFlowEnded && (!isGlobalAiEnabled || _flowState === 'running');

  if (contact?.current_flow_id && _isFlowEnded) {

    console.log(`[TRIGGER-GUARD] Contact ${contact.id} has stale current_flow_id with flow_state=${_flowState}. Clearing to allow new triggers.`);
    await supabase.from('crm_contacts').update({
      current_flow_id: null,
      current_node_id: null,
      flow_timeout_node_id: null,
      flow_timeout_minutes: null,
      next_execution_time: null,
    }).eq('id', contact.id);
    contact.current_flow_id = null;
    contact.current_node_id = null;
  }

  // Gatilhos exact_phrase/keyword devem ter prioridade sobre IA ativa (ai_active=true),
  // mesmo sem referral. Mensagens de anúncio (CTWA) podem chegar como "unsupported" (code 131060)
  // SEM referral — antes, o bloco só rodava com referral e a IA interceptava a mensagem,
  // fazendo o fluxo nunca iniciar. Agora avaliamos sempre que o contato está ocioso.
  if (contact && !hasActiveFlow && !isAiHandling) {
    try {
      const allCandidateTexts = collectInboundTriggerTexts(message, text);
      console.log(`[TRIGGER-CTWA] (ad-priority) waId=${waId} msgType=${message?.type} aiActive=${isAiActive} candidates=${JSON.stringify(allCandidateTexts)}`);
      const { data: triggeredFlows, error: triggeredFlowsError } = await supabase
        .from('crm_flows')
        .select('id, name, trigger_type, trigger_keywords, trigger_keyword, nodes, edges, user_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .in('trigger_type', ['exact_phrase', 'keyword']);

      if (triggeredFlowsError) throw triggeredFlowsError;

      const priority = ['exact_phrase', 'keyword'];
      let matchingTriggeredFlow = null;
      for (const triggerType of priority) {
        matchingTriggeredFlow = (triggeredFlows || []).find((flow: any) => {
          if (flow.trigger_type !== triggerType) return false;
          const matched = flowMatchesIncomingTrigger(flow, allCandidateTexts);
          console.log(`[TRIGGER-CTWA] (ad-priority) eval flow="${flow.name}" type=${flow.trigger_type} kws=${JSON.stringify(flow.trigger_keywords || [flow.trigger_keyword])} => matched=${matched}`);
          return matched;
        });
        if (matchingTriggeredFlow) break;
      }

      if (matchingTriggeredFlow) {
        console.log(`[TRIGGER] Starting ad flow ${matchingTriggeredFlow.id} (${matchingTriggeredFlow.name}) for ${waId} before AI handling`);
        await supabase.from('crm_scheduled_messages').delete().eq('contact_id', contact.id);
        let startNode = matchingTriggeredFlow.nodes?.find((n: any) => n.type === 'start' || n.data?.isStartNode);
        if (!startNode && matchingTriggeredFlow.nodes?.length > 0) {
          const targets = new Set((matchingTriggeredFlow.edges || []).map((e: any) => e.target));
          startNode = matchingTriggeredFlow.nodes.find((n: any) => !targets.has(n.id)) || matchingTriggeredFlow.nodes[0];
        }

        if (startNode) {
          await supabase.from('crm_contacts').update({
            current_flow_id: matchingTriggeredFlow.id,
            current_node_id: startNode.id,
            flow_state: 'running',
            ai_active: false,
            last_flow_interaction: new Date().toISOString(),
            next_execution_time: null
          }).eq('id', contact.id);

          let currentRes: any = await executeVisualNode(supabase, matchingTriggeredFlow, startNode, contact.id, waId);
          let iterations = 0;
          while (currentRes?.nextNodeId && iterations < 10) {
            iterations++;
            const nextInChain = matchingTriggeredFlow.nodes.find((n: any) => n.id === currentRes.nextNodeId);
            if (!nextInChain) break;
            currentRes = await executeVisualNode(supabase, matchingTriggeredFlow, nextInChain, contact.id, waId);
          }

          return jsonResponse({ success: true, triggered_flow: matchingTriggeredFlow.id, execution: currentRes });
        }
      } else {
        console.log(`[TRIGGER-CTWA] (ad-priority) no matching flow for ${waId}. candidates=${JSON.stringify(allCandidateTexts)}`);
      }
    } catch (adTriggerErr) {
      console.error('[TRIGGER-CTWA] Error evaluating ad-priority trigger:', adTriggerErr);
    }
  }

  // Mensagens vindas de anúncio podem chegar como texto + referral enquanto o contato
  // ainda está preso em um fluxo anterior aguardando resposta. Se existir um gatilho
  // exato/palavra-chave configurado para esse texto, ele deve iniciar o novo fluxo.
  if (contact && hasActiveFlow && isWaitingResponse && !isAiHandling && !isAiActive) {
    try {
      const allCandidateTexts = collectInboundTriggerTexts(message, text);
      const hasReferral = !!getReferralFromWebhookMessage(message);
      console.log(`[TRIGGER-CTWA] (waiting-flow) waId=${waId} msgType=${message?.type} hasReferral=${hasReferral} candidates=${JSON.stringify(allCandidateTexts)}`);
      const { data: triggeredFlows, error: triggeredFlowsError } = await supabase
        .from('crm_flows')
        .select('id, name, trigger_type, trigger_keywords, trigger_keyword, nodes, edges, user_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .in('trigger_type', ['exact_phrase', 'keyword'])
        .neq('id', contact.current_flow_id);

      if (triggeredFlowsError) throw triggeredFlowsError;

      console.log(`[TRIGGER-CTWA] (waiting-flow) ${triggeredFlows?.length || 0} candidate flow(s) loaded for user ${userId}`);
      const priority = ['exact_phrase', 'keyword'];
      let matchingTriggeredFlow = null;
      for (const triggerType of priority) {
        matchingTriggeredFlow = (triggeredFlows || []).find((flow: any) => {
          if (flow.trigger_type !== triggerType) return false;
          const matched = flowMatchesIncomingTrigger(flow, allCandidateTexts);
          console.log(`[TRIGGER-CTWA] (waiting-flow) eval flow="${flow.name}" type=${flow.trigger_type} kws=${JSON.stringify(flow.trigger_keywords || [flow.trigger_keyword])} => matched=${matched}`);
          return matched;
        });
        if (matchingTriggeredFlow) break;
      }

      if (matchingTriggeredFlow) {
        console.log(`[TRIGGER] Restarting from waiting flow ${contact.current_flow_id} to ${matchingTriggeredFlow.id} for ${waId}`);
        await supabase.from('crm_scheduled_messages').delete().eq('contact_id', contact.id);
        let startNode = matchingTriggeredFlow.nodes?.find((n: any) => n.type === 'start' || n.data?.isStartNode);
        if (!startNode && matchingTriggeredFlow.nodes?.length > 0) {
          const targets = new Set((matchingTriggeredFlow.edges || []).map((e: any) => e.target));
          startNode = matchingTriggeredFlow.nodes.find((n: any) => !targets.has(n.id)) || matchingTriggeredFlow.nodes[0];
        }

        if (startNode) {
          await supabase.from('crm_contacts').update({
            current_flow_id: matchingTriggeredFlow.id,
            current_node_id: startNode.id,
            flow_state: 'running',
            last_flow_interaction: new Date().toISOString(),
            next_execution_time: null
          }).eq('id', contact.id);

          let currentRes: any = await executeVisualNode(supabase, matchingTriggeredFlow, startNode, contact.id, waId);
          let iterations = 0;
          while (currentRes?.nextNodeId && iterations < 10) {
            iterations++;
            const nextInChain = matchingTriggeredFlow.nodes.find((n: any) => n.id === currentRes.nextNodeId);
            if (!nextInChain) break;
            currentRes = await executeVisualNode(supabase, matchingTriggeredFlow, nextInChain, contact.id, waId);
          }

          return jsonResponse({ success: true, triggered_flow: matchingTriggeredFlow.id, execution: currentRes });
        }
      }
    } catch (waitingTriggerErr) {
      console.error('[TRIGGER] Error evaluating waiting-flow incoming trigger:', waitingTriggerErr);
    }
  }

  // PRIORIDADE: Se houver um clique em botão de INTERACTIVE, SEMPRE tenta continuar o fluxo primeiro
  if (contact && hasActiveFlow && message.type === 'interactive' && isWaitingResponse) {
    console.log(`[FLOW-LOG] WEBHOOK: Continuing Flow via BUTTON for ${waId}. Current node: ${contact.current_node_id}, Button: ${buttonId}`);
    
    const { data: result, error: flowErr } = await supabase.functions.invoke('meta-whatsapp-crm', {
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}` },
      body: { 
        action: 'continueFlow', 
        contactId: contact.id, 
        waId, 
        buttonId: buttonId || null, 
        text, 
        sourceMessageId: message.id 
      }
    });

    if (flowErr) {
      console.error('[FLOW-LOG] ERROR in continueFlow (Button):', flowErr);
    } else {
      console.log('[FLOW-LOG] continueFlow (Button) successful invoke:', JSON.stringify(result));
    }
    return jsonResponse(result || { success: true });
  }

  // CRITICAL: Ensure we capture messages for AI processing
  // Check if contact is in an AI node or AI state
  if (contact && (isAiHandling || isAiActive || (hasActiveFlow && isInAiNode))) {
    webhookAiLog('dispatch_existing_ai_state', {
      is_ai_handling: isAiHandling,
      is_ai_active: isAiActive,
      is_ai_node: isInAiNode,
    });
    console.log(`[FLOW-LOG] WEBHOOK: Processing AI Agent for ${waId}. State: ${contact.flow_state}`);
    const result = await processAiAgentResponse(supabase, contact, waId, text || extractedInboundText, message.id, userId, inboundNumberId);
    return jsonResponse(result);
  }

  // NOVO: Se o contato está em um fluxo aguardando resposta e recebeu QUALQUER mensagem
  // (texto, áudio, imagem, vídeo, documento, sticker etc.), tenta continuar o fluxo.
  // Antes exigíamos `text`, o que travava o "Qualquer resposta" quando o cliente respondia
  // com áudio ou mídia — o fluxo ficava parado indefinidamente.
  if (contact && hasActiveFlow && isWaitingResponse && message?.type !== 'interactive') {
    console.log(`[FLOW-LOG] WEBHOOK: Received ${message?.type || 'message'} for flow ${contact.current_flow_id} node ${contact.current_node_id} from ${waId} (text="${(text || '').slice(0,60)}")`);
    const { data: result, error: flowErr } = await supabase.functions.invoke('meta-whatsapp-crm', {
      headers: { 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}` },
      body: { 
        action: 'continueFlow', 
        contactId: contact.id, 
        waId, 
        text: text || '', 
        sourceMessageId: message.id 
      }
    });

    if (flowErr) {
      console.error('[FLOW-LOG] ERROR in continueFlow (Text):', flowErr);
    } else {
      console.log('[FLOW-LOG] continueFlow (Text) result:', JSON.stringify(result));
    }
    
    // Se o fluxo conseguiu continuar através do texto, terminamos aqui. 
    // Caso contrário (ex: o texto não casou com nenhum botão e não tem "Qualquer Resposta"), 
    // o fluxo permanece no estado atual.
    if (result?.success && !result?.message?.includes('No matching edge')) {
       return jsonResponse(result);
    }
  }

  // ====== AUTO-TRIGGER FLOWS ON INBOUND MESSAGES ======
  // Only try to start a flow if there's no active flow and contact is not in AI handling
  if (contact && !hasActiveFlow && !isAiHandling && !isAiActive) {
    // Check if Global AI is enabled - it should trigger if no specific flow matches
    let flowTriggered = false;

    try {
      const { data: activeFlows } = await supabase
        .from('crm_flows')
        .select('id, name, trigger_type, trigger_keywords, trigger_keyword, nodes, edges, user_id')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (activeFlows && activeFlows.length > 0) {
        const allCandidateTexts = collectInboundTriggerTexts(message, text);
        const hasReferral = !!getReferralFromWebhookMessage(message);
        console.log(`[TRIGGER-AUTO] waId=${waId} msgType=${message?.type} hasReferral=${hasReferral} text="${(text || '').slice(0,80)}" candidates=${JSON.stringify(allCandidateTexts)} activeFlows=${activeFlows.length}`);
        const prevTotal = __previousTotalReceived;
        const prevLast = __previousLastReceivedAt;

        const now = new Date();
        
        // Verifica se existem mensagens inbound no histórico para este contato
        const { data: inboundMessages, count: inboundCount } = await supabase
          .from('crm_messages')
          .select('id, created_at', { count: 'exact' })
          .eq('contact_id', contact.id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false });
        
        // Se o usuário limpou o histórico, inboundCount será 0 ou 1, 
        // e prevLast pode ser nulo ou antigo.
        const effectiveIsFirstEver = (inboundCount || 0) <= 1;
        
        // Se o contato foi criado nos últimos 5 minutos e tem poucas mensagens, reforça a chance de ser primeira mensagem
        const isVeryRecentContact = contact.created_at && (new Date().getTime() - new Date(contact.created_at).getTime()) < 300000;
        const isNewAndFirst = isVeryRecentContact && (inboundCount || 0) <= 1;

        let isFirstEver = effectiveIsFirstEver || isNewAndFirst;
        let isFirstOfDay = isFirstEver || !prevLast;
        let isAfter24h = isFirstEver || !prevLast;

        if (isFirstEver) {
          console.log(`[TRIGGER] First message ever detected for contact ${contact.id} (inboundCount: ${inboundCount}, recent: ${isVeryRecentContact})`);
        } else if (prevLast || (inboundMessages && inboundMessages.length > 1)) {
          // Usa a data da mensagem anterior (a que veio ANTES da atual) se disponível, senão usa prevLast
          const lastDateStr = (inboundMessages && inboundMessages.length > 1) 
            ? inboundMessages[1].created_at 
            : prevLast;
            
          const lastDate = new Date(lastDateStr);
          const nowInSameTZ = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
          const lastInSameTZ = new Date(lastDate.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
          
          isFirstOfDay = lastInSameTZ.toLocaleDateString('pt-BR') !== nowInSameTZ.toLocaleDateString('pt-BR');
          isAfter24h = (now.getTime() - lastDate.getTime()) >= 24 * 60 * 60 * 1000;
          
          if (isAfter24h) isFirstOfDay = true;
        }

        const flowMatches = (flow: any): boolean => {
          const t = flow.trigger_type;
          const kws: string[] = Array.isArray(flow.trigger_keywords)
            ? flow.trigger_keywords.map((k: string) => normalizeTriggerText(k)).filter(Boolean)
            : (flow.trigger_keyword ? [normalizeTriggerText(flow.trigger_keyword)] : []);

          if (t === 'exact_phrase') {
            const m = kws.length > 0 && kws.some(k => allCandidateTexts.some(c => c === k || c.includes(k)));
            console.log(`[TRIGGER-AUTO] eval flow="${flow.name}" type=exact_phrase kws=${JSON.stringify(kws)} => matched=${m}`);
            return m;
          }
          if (t === 'keyword') {
            const m = kws.length > 0 && allCandidateTexts.length > 0 && kws.some(k => k && allCandidateTexts.some(c => c.includes(k)));
            console.log(`[TRIGGER-AUTO] eval flow="${flow.name}" type=keyword kws=${JSON.stringify(kws)} => matched=${m}`);
            return m;
          }
          if (t === 'first_message') return isFirstEver;
          if (t === 'first_message_day') return isFirstOfDay;
          if (t === 'after_24h') return isAfter24h;
          return false;
        };

        // Priority order: exact_phrase > keyword > first_message > first_message_day > after_24h
        const priority = ['exact_phrase', 'keyword', 'first_message', 'first_message_day', 'after_24h'];
        let chosen: any = null;
        for (const p of priority) {
          chosen = activeFlows.find((f: any) => f.trigger_type === p && flowMatches(f));
          if (chosen) break;
        }

        if (chosen) {
          console.log(`[TRIGGER] Auto-starting flow ${chosen.id} (${chosen.name}) for ${waId} via trigger=${chosen.trigger_type}`);
          
          // Execute starting the flow directly in this process
          let startNode = chosen.nodes?.find((n: any) => n.type === 'start' || n.data?.isStartNode);
          
          if (!startNode && chosen.nodes?.length > 0) {
            console.log(`[TRIGGER] No explicit start node found for flow ${chosen.id}. Falling back to node with no incoming edges.`);
            const targets = new Set((chosen.edges || []).map((e: any) => e.target));
            startNode = chosen.nodes.find((n: any) => !targets.has(n.id)) || chosen.nodes[0];
          }

          if (startNode) {
            // Garante que o estado do contato seja atualizado ANTES da execução
            await supabase.from('crm_contacts').update({
              current_flow_id: chosen.id,
              current_node_id: startNode.id,
              flow_state: 'running',
              last_flow_interaction: new Date().toISOString()
            }).eq('id', contact.id);
            
            // Re-fetch contact to ensure we have the most up-to-date object for executeVisualNode
            const { data: updatedContactTrigger } = await supabase.from('crm_contacts').select('*').eq('id', contact.id).single();

            // Trigger actual execution of the start node (usually message node)
            const executeRes = await executeVisualNode(supabase, chosen, startNode, contact.id, waId);
            
            // Loop de execução sequencial se o nó executado retornou nextNodeId (ex: após Delay ou nó de Mensagem simples)
            let currentRes = executeRes;
            let iterations = 0;
            const MAX_TRIGGER_ITERATIONS = 10;
            while (currentRes?.nextNodeId && iterations < MAX_TRIGGER_ITERATIONS) {
              console.log(`[TRIGGER-LOOP] Sequential node detected: ${currentRes.nextNodeId}. Executing iteration ${iterations + 1}...`);
              iterations++;
              const nextInChain = chosen.nodes.find((n: any) => n.id === currentRes.nextNodeId);
              if (nextInChain) {
                currentRes = await executeVisualNode(supabase, chosen, nextInChain, contact.id, waId);
              } else {
                break;
              }
            }
            
            console.log('[TRIGGER] Flow started and sequence executed. Result:', JSON.stringify(currentRes));
            flowTriggered = true;
            return jsonResponse({ success: true, triggered_flow: chosen.id, execution: currentRes });
          }
        } else {
          console.log(`[TRIGGER] No matching flow for ${waId}. candidates=${JSON.stringify(allCandidateTexts)} firstEver=${isFirstEver} firstDay=${isFirstOfDay} after24h=${isAfter24h}`);
          
          // Se não casou com nenhum fluxo e a IA Global está ativa, ativa a IA para este contato
          if (isGlobalAiEnabled && contact?.metadata?.manual_ai_off !== true) {
            console.log(`[TRIGGER-AI] No flow matched, activating Global AI for ${waId}`);
            await supabase.from('crm_contacts').update({ 
              ai_active: true,
              flow_state: 'ai_handling',
              last_interaction: new Date().toISOString()
            }).eq('id', contact.id);
            
            // Re-fetch e processa agora
            const { data: updatedContact } = await supabase.from('crm_contacts').select('*').eq('id', contact.id).single();
            const result = await processAiAgentResponse(supabase, updatedContact, waId, text || extractedInboundText, message.id, userId, inboundNumberId);
            return jsonResponse(result);
          }
        }
      }

    } catch (trigErr) {
      console.error('[TRIGGER] Error evaluating triggers:', trigErr);
    }
  }

  // MODIFICAÇÃO: Se o contato está ocioso mas o AGENTE IA GLOBAL está ativo, ou se o contato 
  // já tinha IA ativa, processa via processAiAgentResponse.
  // IMPORTANTE: Adicionado bypass de verificação de 'idle' se o global estiver ativo, 
  // para garantir que mesmo conversas novas ou recém-limpas sejam atendidas.
  const manualAiOff = contact?.metadata?.manual_ai_off === true;
  const shouldActivateAi = !manualAiOff && (isGlobalAiEnabled || (contact && contact.ai_active));
  
  // LOG PARA DEBUG: Verifica por que a IA não está disparando
  if (contact && shouldActivateAi) {
    const inboundText = text || extractedInboundText;
    console.log(`[WEBHOOK-AI-DEBUG] Contact ${waId} eligible for AI. ai_active=${contact.ai_active}, global_enabled=${isGlobalAiEnabled}, text="${inboundText?.slice(0,50)}..."`);
    
    // Se a IA ainda não estava ativa no contato mas o global está ligado, ativa agora.
    if (isGlobalAiEnabled && !contact.ai_active && !manualAiOff) {
       console.log(`[WEBHOOK-AI-DEBUG] Activating AI for contact ${waId} due to Global Mode.`);
       const { error: updateErr } = await supabase.from('crm_contacts').update({ 
         ai_active: true,
         flow_state: 'ai_handling',
         last_interaction: new Date().toISOString()
       }).eq('id', contact.id);
       
       if (updateErr) {
         console.error(`[WEBHOOK-AI-DEBUG] Error activating AI for contact ${waId}:`, updateErr);
       }
       
       // Update the local object so processAiAgentResponse knows it's active
       contact.ai_active = true;
       contact.flow_state = 'ai_handling';
    }

    // CRITICAL: processAiAgentResponse is async and will handle the reply.
    // Passamos o texto extraído para garantir que a IA tenha o input correto.
    console.log(`[WEBHOOK-AI-DEBUG] Calling processAiAgentResponse for ${waId} with messageId: ${message.id}`);
    webhookAiLog('dispatch_global_fallback', { inbound_text_length: inboundText?.length || 0 });
    const result = await processAiAgentResponse(supabase, contact, waId, inboundText, message.id, userId, inboundNumberId);
    return jsonResponse(result);
  } else if (contact) {
    webhookAiLog('skipped_not_eligible', { has_active_flow: hasActiveFlow });
    console.log(`[WEBHOOK-AI-DEBUG] Contact ${waId} NOT eligible for AI. ai_active=${contact.ai_active}, global_enabled=${isGlobalAiEnabled}, hasActiveFlow=${hasActiveFlow}`);
  }

  return jsonResponse({ success: true });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

async function processCountdownTriggers(supabase: any) {
  console.log('[COUNTDOWN] Checking for contacts near the 24h window limit...');
  const summary = { activeSettings: 0, eligibleContacts: 0, sent: 0, failed: 0 };

  const { data: activeSettings, error: settingsError } = await supabase
    .from('crm_settings')
    .select('*')
    .eq('countdown_trigger_enabled', true);

  if (settingsError) {
    console.error('[COUNTDOWN] Failed to load active settings:', settingsError.message);
    throw settingsError;
  }

  if (!activeSettings || activeSettings.length === 0) {
    console.log('[COUNTDOWN] No active countdown triggers');
    return summary;
  }

  summary.activeSettings = activeSettings.length;

  for (const settings of activeSettings) {
    const thresholdMinutes = Number(settings.countdown_trigger_threshold_minutes) || 60;
    const now = new Date();
    const windowLimitDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const triggerThresholdDate = new Date(now.getTime() - ((24 * 60 - thresholdMinutes) * 60 * 1000));

    let contactsQuery = supabase
      .from('crm_contacts')
      .select('*')
      .eq('user_id', settings.user_id)
      .gt('last_message_received_at', windowLimitDate.toISOString())
      .lt('last_message_received_at', triggerThresholdDate.toISOString())
      .is('countdown_trigger_sent_at', null);

    const statusFilter: string[] = Array.isArray(settings.countdown_trigger_status_filter)
      ? settings.countdown_trigger_status_filter
      : [];
    if (statusFilter.length > 0) {
      contactsQuery = contactsQuery.in('status', statusFilter);
    }

    // Escopo: 'once' = apenas contatos que nunca receberam o disparo em nenhum dia.
    const scope = settings.countdown_trigger_scope === 'once' ? 'once' : 'always';
    if (scope === 'once') {
      contactsQuery = contactsQuery.is('countdown_trigger_last_sent_at', null);
    }

    const { data: contacts, error: contactsError } = await contactsQuery;
    if (contactsError) {
      console.error('[COUNTDOWN] Failed to load eligible contacts:', {
        userId: settings.user_id,
        error: contactsError.message,
      });
      summary.failed += 1;
      continue;
    }

    const eligibleContacts = contacts || [];
    summary.eligibleContacts += eligibleContacts.length;

    if (eligibleContacts.length === 0) {
      console.log('[COUNTDOWN] No eligible contacts for user', settings.user_id);
      continue;
    }

    console.log(`[COUNTDOWN] Found ${eligibleContacts.length} contacts for user ${settings.user_id}`);

    for (const contact of eligibleContacts) {
      // Claim atômico: garante 1 envio por contato mesmo com execuções
      // simultâneas do cron (era a causa das 3 mensagens iguais).
      const nowIso = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from('crm_contacts')
        .update({
          countdown_trigger_sent_at: nowIso,
          countdown_trigger_last_sent_at: nowIso,
          countdown_trigger_total_sent: (contact.countdown_trigger_total_sent || 0) + 1,
        })
        .eq('id', contact.id)
        .is('countdown_trigger_sent_at', null)
        .select('id');

      if (claimError) {
        console.error('[COUNTDOWN] Claim failed', { waId: contact.wa_id, error: claimError.message });
        summary.failed += 1;
        continue;
      }
      if (!claimed || claimed.length === 0) {
        console.log('[COUNTDOWN] Skipped (already claimed by another run)', contact.wa_id);
        continue;
      }

      console.log(`[COUNTDOWN] Sending trigger to ${contact.wa_id}`);

      const payload: any = { to: contact.wa_id };
      if (settings.countdown_trigger_message_type === 'message') {
        payload.text = settings.countdown_trigger_content;
      } else if (settings.countdown_trigger_message_type === 'template') {
        payload.templateName = settings.countdown_trigger_template_id;
        payload.language = 'pt_BR';
      }

      try {
        if (settings.countdown_trigger_message_type === 'flow' && settings.countdown_trigger_flow_id) {
          const { data: flow, error: flowError } = await supabase
            .from('crm_flows')
            .select('*')
            .eq('id', settings.countdown_trigger_flow_id)
            .eq('user_id', settings.user_id)
            .single();

          if (flowError || !flow) {
            throw new Error(flowError?.message || 'Fluxo do disparador não encontrado');
          }

          if (!flow.nodes?.length) {
            throw new Error('Fluxo do disparador não possui nós configurados');
          }

          const targetNodeIds = new Set((flow.edges || []).map((edge: any) => edge.target));
          const startNode = flow.nodes.find((node: any) => node.type === 'start' || node.data?.isStartNode)
            || flow.nodes.find((node: any) => !targetNodeIds.has(node.id))
            || flow.nodes[0];

          await supabase.from('crm_contacts').update({
            current_flow_id: flow.id,
            current_node_id: startNode.id,
            flow_state: 'running',
          }).eq('id', contact.id);

          await executeVisualNode(supabase, flow, startNode, contact.id, contact.wa_id);
        } else {
          await handleInternalSendMessage(
            supabase,
            settings.meta_phone_number_id,
            settings.meta_access_token,
            payload,
            contact,
            settings.vps_transcoder_url,
            settings.user_id,
          );
        }
        summary.sent += 1;
      } catch (err) {
        summary.failed += 1;
        console.error(`[COUNTDOWN] Error sending to ${contact.wa_id}:`, err);
        // Libera o claim para nova tentativa no próximo ciclo (sem duplicar histórico).
        await supabase.from('crm_contacts').update({
          countdown_trigger_sent_at: null,
          countdown_trigger_last_sent_at: contact.countdown_trigger_last_sent_at || null,
          countdown_trigger_total_sent: contact.countdown_trigger_total_sent || 0,
        }).eq('id', contact.id);
      }
    }
  }

  console.log('[COUNTDOWN] Finished', summary);
  return summary;
}

// ---------------------------------------------------------------------------
// RECUPERADOR IA
// Reengaja conversas paradas (nenhuma mensagem nova por X minutos) usando o
// mesmo cerebro/token do Agente IA. Antes de recuperar, a IA avalia se o
// atendimento ja foi concluido; se sim, marca a conversa com a etiqueta
// "Finalizado agente IA" e nunca mais recupera.
// ---------------------------------------------------------------------------
const AI_RECOVERY_DEFAULT_LABEL = 'Finalizado agente IA';

async function ensureAiRecoveryStatus(supabase: any, userId: string, label: string) {
  try {
    const { data: existing } = await supabase
      .from('crm_statuses')
      .select('id')
      .eq('user_id', userId)
      .eq('label', label)
      .maybeSingle();
    if (existing?.id) return;
    await supabase.from('crm_statuses').insert({
      user_id: userId,
      label,
      value: 'ai_finalizado',
      color: '#16a34a',
      sort_order: 99,
    });
  } catch (err) {
    console.error('[AI-RECOVERY] Falha ao garantir etiqueta:', err);
  }
}

async function processAiRecoveryForAllUsers(supabase: any, onlyUserId?: string | null) {
  const summary = { users: 0, evaluated: 0, recovered: 0, finalized: 0 };

  let settingsQuery = supabase
    .from('crm_settings')
    .select('user_id, openai_api_key, meta_phone_number_id, meta_access_token, vps_transcoder_url, ai_agent_enabled, ai_recovery_enabled, ai_recovery_delay_minutes, ai_recovery_max_attempts, ai_recovery_finalized_status, ai_recovery_scope, business_description, ai_system_prompt')
    .eq('ai_agent_enabled', true)
    .eq('ai_recovery_enabled', true);

  if (onlyUserId) settingsQuery = settingsQuery.eq('user_id', onlyUserId);

  const { data: settingsRows, error: settingsError } = await settingsQuery;

  if (settingsError) {
    console.error('[AI-RECOVERY] Erro ao carregar settings:', settingsError);
    return summary;
  }

  for (const settings of settingsRows || []) {
    const apiKey = settings.openai_api_key || Deno.env.get('OPENAI_API_KEY');
    if (!apiKey || !settings.meta_phone_number_id || !settings.meta_access_token) continue;

    summary.users += 1;

    const delayMinutes = Math.max(5, Number(settings.ai_recovery_delay_minutes) || 60);
    const maxAttempts = Math.max(1, Number(settings.ai_recovery_max_attempts) || 2);
    const finalizedLabel = (settings.ai_recovery_finalized_status || '').trim() || AI_RECOVERY_DEFAULT_LABEL;
    // 'ai_only' (padrao): recupera apenas conversas que ja foram atendidas pelo Agente I.A.
    // 'all': recupera qualquer conversa dentro da janela de 24h.
    const recoveryScope = settings.ai_recovery_scope === 'all' ? 'all' : 'ai_only';

    await ensureAiRecoveryStatus(supabase, settings.user_id, finalizedLabel);

    const now = Date.now();
    const cutoffIso = new Date(now - delayMinutes * 60 * 1000).toISOString();
    // Janela de atendimento do WhatsApp (24h desde a ultima mensagem recebida).
    const windowStartIso = new Date(now - 23.5 * 60 * 60 * 1000).toISOString();

    const { data: contacts } = await supabase
      .from('crm_contacts')
      .select('*')
      .eq('user_id', settings.user_id)
      .not('last_message_received_at', 'is', null)
      .lt('last_message_received_at', cutoffIso)
      .gt('last_message_received_at', windowStartIso)
      .limit(40);

    for (const contact of contacts || []) {
      try {
        const metadata = (contact.metadata || {}) as Record<string, any>;

        if (metadata.ai_recovery_finalized === true) continue;
        // Nunca recuperar conversas com o Agente I.A. desligado manualmente.
        if (metadata.manual_ai_off === true) continue;
        // Escopo "somente I.A.": exige que a I.A. ja tenha conversado nesta janela.
        if (recoveryScope === 'ai_only') {
          const aiEngaged = metadata.ai_engaged === true;
          const aiOn = contact.ai_active === true || contact.flow_state === 'ai_handling';
          if (!aiEngaged || !aiOn) continue;
        }
        if (contact.status === finalizedLabel) continue;
        if (contact.flow_state && contact.flow_state !== 'idle') continue;

        const lastRecoveryAt = metadata.ai_recovery_last_at ? new Date(metadata.ai_recovery_last_at).getTime() : 0;
        if (lastRecoveryAt && now - lastRecoveryAt < delayMinutes * 60 * 1000) continue;

        const lastInboundAt = contact.last_message_received_at ? new Date(contact.last_message_received_at).getTime() : 0;
        // Se o cliente respondeu depois da ultima recuperacao, zera as tentativas.
        const attempts = lastInboundAt > lastRecoveryAt ? 0 : Number(metadata.ai_recovery_attempts || 0);
        if (attempts >= maxAttempts) continue;

        const { data: history } = await supabase
          .from('crm_messages')
          .select('content, direction, message_type, created_at')
          .eq('contact_id', contact.id)
          .order('created_at', { ascending: false })
          .limit(40);

        if (!history || history.length === 0) continue;

        const conversation = history
          .slice()
          .reverse()
          .map((m: any) => `${m.direction === 'inbound' ? 'Cliente' : 'Atendente'}: ${describeMessageForHistory(m)}`)
          .join('\n');

        summary.evaluated += 1;

        const evaluationPrompt = `Voce e o mesmo atendente humano que conduziu a conversa abaixo. A conversa esta parada ha ${delayMinutes} minutos.

CONTEXTO DO NEGOCIO:
${settings.business_description || 'Nao informado.'}

INSTRUCOES DE ATENDIMENTO (CEREBRO):
${settings.ai_system_prompt || 'Atenda com simpatia e objetividade.'}

TAREFA (em duas etapas):
1) AVALIE a conversa: ela ja foi FINALIZADA? Considere finalizada quando a venda/negocio foi fechado, o cliente recusou claramente, o assunto foi totalmente resolvido, o cliente pediu para nao receber mais mensagens, ou houve despedida final. Se ainda existe duvida em aberto, proposta sem resposta ou interesse nao resolvido, ela NAO esta finalizada.
2) Se NAO estiver finalizada, escreva UMA unica mensagem curta e natural de recuperacao, baseada exatamente no que ja foi conversado (ex: retomar a proposta, perguntar se ficou alguma duvida). Nunca se apresente de novo, nunca repita mensagens ja enviadas, nunca diga que e um agente/IA/sistema, nunca use markdown.

Responda SOMENTE com JSON valido no formato:
{"finalizada": true|false, "motivo": "curto", "mensagem": "texto da recuperacao ou vazio se finalizada"}

HISTORICO DA CONVERSA:
${conversation}`;

        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Voce avalia conversas de vendas e gera mensagens de recuperacao. Responda sempre em JSON valido.' },
              { role: 'user', content: evaluationPrompt },
            ],
            temperature: 0.6,
            response_format: { type: 'json_object' },
          }),
        });

        if (!aiRes.ok) {
          console.error('[AI-RECOVERY] OpenAI erro', aiRes.status, await aiRes.text());
          continue;
        }

        const aiData = await aiRes.json();
        let parsed: any = {};
        try {
          parsed = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');
        } catch {
          parsed = {};
        }

        const nowIso = new Date().toISOString();

        if (parsed.finalizada === true || !String(parsed.mensagem || '').trim()) {
          await supabase
            .from('crm_contacts')
            .update({
              status: finalizedLabel,
              metadata: {
                ...metadata,
                ai_recovery_finalized: true,
                ai_recovery_finalized_at: nowIso,
                ai_recovery_reason: parsed.motivo || 'conversa concluida',
              },
              updated_at: nowIso,
            })
            .eq('id', contact.id);
          summary.finalized += 1;
          console.log(`[AI-RECOVERY] Conversa ${contact.wa_id} marcada como "${finalizedLabel}".`);
          continue;
        }

        const recoveryText = String(parsed.mensagem).trim().slice(0, 900);

        await handleInternalSendMessage(
          supabase,
          settings.meta_phone_number_id,
          settings.meta_access_token,
          { to: contact.wa_id, text: recoveryText, metadata: { ai_recovery: true } },
          contact,
          settings.vps_transcoder_url,
          settings.user_id,
        );

        await supabase
          .from('crm_contacts')
          .update({
            metadata: {
              ...metadata,
              ai_recovery_attempts: attempts + 1,
              ai_recovery_last_at: nowIso,
            },
            updated_at: nowIso,
          })
          .eq('id', contact.id);

        summary.recovered += 1;
        console.log(`[AI-RECOVERY] Recuperacao enviada para ${contact.wa_id} (tentativa ${attempts + 1}/${maxAttempts}).`);
      } catch (err) {
        console.error('[AI-RECOVERY] Falha no contato', contact?.wa_id, err);
      }
    }
  }

  console.log('[AI-RECOVERY] Resumo:', JSON.stringify(summary));
  return summary;
}

const DEFAULT_GOOGLE_CLIENT_ID = '474898024942-7kagkoc25n5osu9pj1as5g1kod7op7m0.apps.googleusercontent.com';
const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

function isGoogleContactsFullError(errorBody: string) {
  return /MY_CONTACTS_OVERFLOW_COUNT|contact limit|too many contacts/i.test(errorBody);
}

// Google People API sometimes returns MY_CONTACTS_OVERFLOW_COUNT even when the
// account is NOT actually full (e.g. contacts recently deleted but still in
// Trash, or transient API state). Before we tell the UI the account is full
// we verify the real contact count. If it's clearly below the 25k limit we
// treat the overflow error as transient and DO NOT mark the account as full.
async function isGoogleAccountReallyFull(accessToken: string): Promise<boolean> {
  try {
    const resp = await fetch(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names&pageSize=1',
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    );
    if (!resp.ok) {
      // If we can't verify, assume NOT full so we don't stick the UI on a
      // false positive. The next sync attempt will surface the real error.
      const t = await resp.text().catch(() => '');
      console.warn('[GOOGLE-SYNC] Falha ao verificar total de contatos:', resp.status, t.slice(0, 200));
      return false;
    }
    const body = await resp.json().catch(() => ({} as any));
    const total = Number(body?.totalItems ?? body?.totalPeople ?? 0);
    console.log(`[GOOGLE-SYNC] Verificação de capacidade: totalItems=${total}`);
    // Google's hard limit is 25,000. Only treat as full when we're actually
    // near it (leave headroom for Trash-count skew).
    return total >= 24500;
  } catch (e) {
    console.warn('[GOOGLE-SYNC] Erro ao verificar total de contatos:', e);
    return false;
  }
}

async function loadGoogleContactsByCanonicalPhone(accessToken: string): Promise<Map<string, string>> {
  const contactsByPhone = new Map<string, string>();
  let nextPageToken: string | undefined;

  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', 'phoneNumbers');
    url.searchParams.set('pageSize', '1000');
    if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Falha ao conferir contatos existentes no Google [${response.status}]: ${details.slice(0, 200)}`);
    }

    const body = await response.json().catch(() => ({} as any));
    for (const person of body?.connections || []) {
      const resourceName = typeof person?.resourceName === 'string' ? person.resourceName : '';
      if (!resourceName) continue;
      for (const phone of person?.phoneNumbers || []) {
        const canonicalPhone = canonicalBrazilianWaId(String(phone?.canonicalForm || phone?.value || ''));
        if (canonicalPhone) contactsByPhone.set(canonicalPhone, resourceName);
      }
    }
    nextPageToken = body?.nextPageToken;
  } while (nextPageToken);

  return contactsByPhone;
}

function isGoogleInsufficientScopeError(errorBody: string) {
  return /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(errorBody);
}

const GOOGLE_CONTACTS_WRITE_SCOPE = 'https://www.googleapis.com/auth/contacts';

/**
 * Consulta os escopos realmente concedidos ao access token.
 * Retorna null quando não foi possível verificar (não bloqueia o fluxo).
 */
async function checkGoogleTokenScopes(accessToken: string): Promise<string[] | null> {
  try {
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => ({} as any));
    const scope = typeof body?.scope === 'string' ? body.scope : '';
    return scope ? scope.split(/\s+/).filter(Boolean) : [];
  } catch (_e) {
    return null;
  }
}

function hasGoogleContactsWriteScope(scopes: string[] | null): boolean | null {
  if (scopes === null) return null;
  return scopes.includes(GOOGLE_CONTACTS_WRITE_SCOPE);
}

/**
 * Circuit breaker: marca a conta como "precisa reconectar" e desliga o
 * auto_sync SÓ dela, para o cron parar de tentar em loop (403 infinito).
 */
async function markGoogleAccountReconnectRequired(
  supabase: any,
  accountId: string,
  errorCode: string,
  errorMessage: string,
) {
  try {
    const { error } = await supabase.from('crm_google_accounts').update({
      connection_status: 'reconnect_required',
      auto_sync: false,
      last_sync_error_code: errorCode,
      last_sync_error: String(errorMessage || '').slice(0, 500),
      last_sync_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', accountId);
    if (error) {
      // Instalação sem a migração 092: as colunas de saúde ainda não existem.
      // Ainda assim precisamos parar o loop de 403 — desligamos só o auto_sync.
      console.warn('[GOOGLE-SYNC] Update de saúde falhou, aplicando fallback:', error.message);
      await supabase.from('crm_google_accounts').update({
        auto_sync: false,
        updated_at: new Date().toISOString(),
      }).eq('id', accountId);
    }
  } catch (e) {
    console.warn('[GOOGLE-SYNC] Não foi possível marcar reconexão necessária:', (e as any)?.message);
  }

}


/**
 * Traduz o erro cru da Cloud API em um código estável + mensagem acionável.
 *
 * Importante: NÃO tratamos mais os códigos genéricos 10/100 como "saldo",
 * porque eles quase sempre são PERMISSÃO (app sem `whatsapp_business_messaging`,
 * número fora do portfólio/WABA do token, template não pertencente à WABA).
 * Isso levava contas com cartão válido a receber "saldo insuficiente".
 * O único código realmente financeiro da Meta é 131042 (e mensagens que citem
 * explicitamente payment/billing/balance/funding).
 */
function normalizeMetaSendError(result: any, fallback = 'Erro ao enviar mensagem pela Meta') {
  const metaError = result?.error || {};
  const rawMessage = String(metaError?.error_user_msg || metaError?.message || fallback);
  const rawCode = Number(metaError?.code);
  const rawSubcode = Number(metaError?.error_subcode);
  const rawType = String(metaError?.type || '');
  const errorData = metaError?.error_data?.details || metaError?.error_data?.messaging_product || '';
  const userTitle = metaError?.error_user_title || '';
  const fbtrace = metaError?.fbtrace_id || '';
  const lower = `${rawMessage} ${userTitle} ${errorData}`.toLowerCase();

  // Detalhe técnico completo — é isso que aparece em "Logs de falha" no CRM.
  const details = [
    rawMessage,
    userTitle ? `título: ${userTitle}` : '',
    errorData ? `details: ${errorData}` : '',
    Number.isFinite(rawCode) ? `code: ${rawCode}` : '',
    Number.isFinite(rawSubcode) ? `subcode: ${rawSubcode}` : '',
    rawType ? `type: ${rawType}` : '',
    fbtrace ? `fbtrace_id: ${fbtrace}` : '',
  ].filter(Boolean).join(' | ');

  const build = (code: string, message: string) => ({ code, message, details });

  if (rawCode === 133010 || lower.includes('account not registered')) {
    return build('WHATSAPP_DISCONNECTED', 'Você precisa reconectar seu WhatsApp.');
  }

  // Token expirado / app bloqueado / número não acessível por esse token.
  const isTokenOrAppBlocked =
    rawSubcode === 33 ||
    rawType === 'GraphMethodException' ||
    lower.includes('api access blocked') ||
    lower.includes('session has expired') ||
    lower.includes('access token') ||
    rawCode === 190;

  if (isTokenOrAppBlocked) {
    return build(
      'META_TOKEN_INVALID',
      '⚠️ A conexão com a Meta expirou ou o app perdeu acesso a este número. Vá em Configurações → Conectar com Facebook e refaça a conexão.',
    );
  }

  // ---- Financeiro REAL ----
  const isBilling =
    rawCode === 131042 ||
    lower.includes('payment') ||
    lower.includes('billing') ||
    lower.includes('balance') ||
    lower.includes('funding') ||
    lower.includes('credit line') ||
    lower.includes('forma de pagamento') ||
    lower.includes('saldo');

  if (isBilling) {
    return build(
      'META_BILLING_ERROR',
      '⚠️ A Meta recusou o envio por questão de pagamento nesta WABA (cartão recusado, limite de gastos atingido ou WABA sem método de pagamento vinculado). Confira em Gerenciador de Negócios → Central de Pagamentos se o cartão está ATIVO e vinculado exatamente a esta conta do WhatsApp.',
    );
  }

  // ---- Permissão / escopo (códigos 10, 200-299, 3) ----
  if (rawCode === 10 || rawCode === 3 || (rawCode >= 200 && rawCode <= 299) || lower.includes('missing permissions') || lower.includes('permission')) {
    return build(
      'META_PERMISSION_DENIED',
      '⚠️ Falta permissão no app da Meta (não é saldo). Normalmente: o token não tem `whatsapp_business_messaging`, o número/WABA não está no portfólio deste app, ou o template não pertence a esta WABA. Refaça a conexão pelo Facebook concedendo todas as permissões.',
    );
  }

  // ID inexistente para este token (número/template/WABA de outra conta)
  if (rawCode === 100 || lower.includes('does not exist') || lower.includes('unsupported get request')) {
    return build(
      'META_OBJECT_NOT_FOUND',
      '⚠️ A Meta não encontrou o número, template ou WABA usando este token (não é saldo). Verifique se o Phone Number ID e o template pertencem à MESMA conta conectada.',
    );
  }

  if (rawCode === 131031) {
    return build('META_ACCOUNT_RESTRICTED', '⚠️ Esta conta do WhatsApp Business está restrita/bloqueada pela Meta. Abra o Gerenciador de Negócios e verifique as restrições da WABA.');
  }

  if (rawCode === 131045) {
    return build('META_NUMBER_NOT_REGISTERED', '⚠️ O número não concluiu o registro na Cloud API. Reconecte o WhatsApp para refazer o registro.');
  }

  if (rawCode === 131047 || rawCode === 131051 || rawCode === 470) {
    return build('META_24H_WINDOW', 'Janela de 24h expirada: envie um template aprovado para reabrir a conversa.');
  }

  if (rawCode === 131049 || rawCode === 130472) {
    return build('META_QUALITY_LIMIT', 'A Meta limitou a entrega desta mensagem por qualidade/engajamento. Reduza o volume e melhore o conteúdo do template.');
  }

  if (rawCode === 131026) {
    return build('META_UNDELIVERABLE', 'Mensagem não entregue: o destinatário provavelmente não tem WhatsApp ativo ou não aceita mensagens de empresas.');
  }

  if (rawCode === 132000 || rawCode === 132001 || rawCode === 132005 || rawCode === 132007 || rawCode === 132012 || rawCode === 132015 || rawCode === 132016 || rawCode === 132068 || rawCode === 132069) {
    return build('META_TEMPLATE_ERROR', 'Problema com o template: nome/idioma inexistente, pausado, reprovado ou variáveis em quantidade diferente da aprovada.');
  }

  if (rawCode === 130429 || rawCode === 131048 || rawCode === 4) {
    return build('META_RATE_LIMIT', 'Limite de envio (rate limit) atingido. Aumente o intervalo entre mensagens e tente novamente mais tarde.');
  }

  if (rawCode === 135000) {
    return build('META_GENERIC_PARAM_ERROR', 'A Meta rejeitou os parâmetros da mensagem. Confira o payload/variáveis do template.');
  }

  return build(Number.isFinite(rawCode) ? `META_${rawCode}` : 'META_SEND_ERROR', rawMessage);
}


function getGoogleOAuthCredentials(settings?: any) {
  const envClientId = Deno.env.get('GOOGLE_CLIENT_ID')?.trim();
  const envClientSecret = (Deno.env.get('GOOGLE_CLIENT_SECRET') || Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET'))?.trim();
  const settingsClientId = settings?.google_client_id?.trim?.();
  const settingsClientSecret = settings?.google_client_secret?.trim?.();

  return {
    clientId: envClientId || settingsClientId || DEFAULT_GOOGLE_CLIENT_ID,
    clientSecret: envClientSecret || settingsClientSecret || '',
    source: envClientSecret ? 'backend-secret' : settingsClientSecret ? 'settings' : 'missing',
  };
}

async function pushPendingContactsToGoogle(supabase: any, userId: string, settings: any, accounts: any[], limit = 500) {
  if (!userId || userId === 'null') {
    throw new Error('Exportação Google recusada: usuário não identificado.');
  }
  // Claim pending rows atomically before calling Google. processScheduled can
  // overlap with a manual sync or a previous slow cron invocation; a plain
  // SELECT allowed both executions to create the same Google contact.
  const claimToken = crypto.randomUUID();
  const { data: claimedContacts, error: claimError } = await supabase.rpc(
    'claim_crm_contacts_for_google_sync',
    {
      p_user_id: userId,
      p_limit: Math.min(Math.max(limit, 1), 500),
      p_claim_token: claimToken,
    },
  );

  if (claimError) {
    throw new Error(`Não foi possível reservar os contatos pendentes: ${claimError.message}`);
  }

  if (!claimedContacts || claimedContacts.length === 0) {
    const { data: exportRows, error: exportRowsError } = await supabase
      .from('crm_contacts')
      .select('name, wa_id, google_sync_account_id, google_sync_claimed_at, metadata')
      .eq('user_id', userId)
      .or('google_sync_account_id.is.null,metadata->>google_dirty.eq.true')
      .limit(1000);
    const now = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    const pendingRows = exportRows || [];
    const namedRows = pendingRows.filter((contact: any) => {
      const name = String(contact.name || '').trim();
      return name.length > 0 && name !== String(contact.wa_id || '').trim();
    });
    const recentlyClaimed = pendingRows.filter((contact: any) => {
      const claimedAt = Date.parse(String(contact.google_sync_claimed_at || ''));
      return Number.isFinite(claimedAt) && now - claimedAt < tenMinutesMs;
    });
    if (exportRowsError) {
      console.warn(`[GOOGLE-SYNC] Falha ao diagnosticar fila vazia do usuário ${userId}: ${exportRowsError.message}`);
    }
    console.log(
      `[GOOGLE-SYNC] Nenhum contato CRM elegível para exportação. userId: ${userId}; `
      + `pendentesDoUsuario: ${pendingRows.length}; comNomeValido: ${namedRows.length}; `
      + `reservadosUltimos10min: ${recentlyClaimed.length}. Para trazer contatos do Google ao CRM use syncGoogleContacts.`,
    );
    return {
      success: true,
      pushed: 0,
      failed: 0,
      pending: 0,
      remaining: 0,
      lastError: null,
      accountFull: false,
      fullAccounts: [],
      requiresReconnect: false,
      reconnectAccounts: [],
    };
  }

  // Only accounts passed into this function are allowed to receive/update
  // Google contacts. A contact already linked to another Google account must
  // never be migrated to a newly connected Auto Sync account automatically.
  const activeAccountIds = new Set<string>((accounts || []).map((a: any) => a.id));

  // Contacts assigned to a Google account that is no longer active
  // (Auto Sync turned OFF, or the account was disconnected) would otherwise
  // be stuck forever. Treat them as unassigned so they get pushed to one of
  // the currently active Auto Sync accounts on this cycle.
  const uniqueClaimedContacts = Array.from(
    new Map(
      claimedContacts.map((contact: any) => [canonicalBrazilianWaId(contact.wa_id), contact]),
    ).values(),
  );

  let remaining = uniqueClaimedContacts
    .filter((c: any) => {
      const name = (c.name || '').trim();
      if (!name) return false;
      if (name === (c.wa_id || '').trim()) return false;
      return true;
    })
    .map((c: any) => {
      if (c.google_sync_account_id && !activeAccountIds.has(c.google_sync_account_id)) {
        // Detach from the inactive account so the loop below treats it as
        // "new" for the currently active account. We also strip the old
        // resourceName because it belongs to a different Google account
        // and would fail a batchDelete on this token.
        const nextMeta = { ...((c as any).metadata || {}) };
        delete nextMeta.google_resource_name;
        return { ...c, google_sync_account_id: null, metadata: nextMeta };
      }
      return c;
    });

  const totalPending = remaining.length;
  let pushed = 0;
  let failed = 0;
  let lastError: string | null = null;
  const fullAccounts: string[] = [];
  const reconnectAccounts: string[] = [];

  for (const account of accounts) {
    if (remaining.length === 0) break;

    // Push to THIS account:
    // - contacts with no google_sync_account_id (new)
    // - dirty contacts already on THIS account (re-upload)
    // Contacts linked to a different Google account stay with that account;
    // they are never migrated to the current account by Auto Sync.
    const forThisAccount = remaining.filter((c: any) =>
      !c.google_sync_account_id
        || c.google_sync_account_id === account.id
    );
    const skippedForOtherAccounts = remaining.filter((c: any) =>
      c.google_sync_account_id
        && c.google_sync_account_id !== account.id
    );
    if (forThisAccount.length === 0) {
      remaining = skippedForOtherAccounts;
      continue;
    }

    let accessToken = account.access_token;
    if (Date.now() >= (account.expiry_date || 0)) {
      const { clientId: googleClientId, clientSecret: googleClientSecret } = getGoogleOAuthCredentials(settings);
      if (googleClientSecret && account.refresh_token) {
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: googleClientId,
            client_secret: googleClientSecret,
            refresh_token: account.refresh_token,
            grant_type: 'refresh_token',
          }),
        });
        const refreshTokens = await refreshResponse.json();
        if (refreshResponse.ok) {
          accessToken = refreshTokens.access_token;
          await supabase.from('crm_google_accounts').update({
            access_token: accessToken,
            expiry_date: Date.now() + (refreshTokens.expires_in * 1000),
            updated_at: new Date().toISOString()
          }).eq('id', account.id);
        } else {
          console.error(`[GOOGLE-SYNC] Falha ao renovar token da conta ${account.email}:`, JSON.stringify(refreshTokens));
          lastError = `Token expirado (${account.email}). Reconecte esta conta.`;
          reconnectAccounts.push(account.email);
          await markGoogleAccountReconnectRequired(
            supabase,
            account.id,
            'REFRESH_FAILED',
            `Falha ao renovar token: ${refreshTokens?.error_description || refreshTokens?.error || 'erro desconhecido'}`,
          );
          continue;
        }
      } else {
        lastError = `Sem refresh token (${account.email}). Reconecte esta conta.`;
        reconnectAccounts.push(account.email);
        await markGoogleAccountReconnectRequired(
          supabase,
          account.id,
          'NO_REFRESH_TOKEN',
          'Conta sem refresh token. É necessário reconectar concedendo acesso aos Contatos.',
        );
        continue;
      }
    }

    // Idempotência real no destino: antes de criar, confira os telefones que já
    // existem nesta conta Google. Isso também protege instalações antigas nas
    // quais o contato foi criado, mas o resourceName não chegou a ser salvo.
    let googleContactsByPhone: Map<string, string>;
    try {
      googleContactsByPhone = await loadGoogleContactsByCanonicalPhone(accessToken);
    } catch (error: any) {
      lastError = error?.message || String(error);
      console.error(`[GOOGLE-SYNC] Não foi possível deduplicar a conta ${account.email}:`, lastError);
      // 403 por escopo insuficiente é permanente: o refresh_token salvo não
      // tem permissão de escrita em Contatos. Sem circuit breaker, o cron
      // repetiria esse erro a cada minuto para sempre.
      if (isGoogleInsufficientScopeError(lastError)) {
        reconnectAccounts.push(account.email);
        await markGoogleAccountReconnectRequired(
          supabase,
          account.id,
          'INSUFFICIENT_SCOPE',
          `Permissão de Contatos ausente (${account.email}). Reconecte a conta autorizando o acesso aos Contatos.`,
        );
      }
      // Segurança: se não foi possível conferir o Google, não crie nada. É
      // preferível manter pendente a duplicar milhares de contatos.
      continue;
    }

    // A conta respondeu bem: limpe qualquer marcação antiga de erro.
    if (account.connection_status && account.connection_status !== 'active') {
      await supabase.from('crm_google_accounts').update({
        connection_status: 'active',
        last_sync_error_code: null,
        last_sync_error: null,
        last_sync_error_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', account.id);
    }


    const alreadyOnGoogle = forThisAccount.filter((contact: any) =>
      googleContactsByPhone.has(canonicalBrazilianWaId(contact.wa_id))
    );
    if (alreadyOnGoogle.length > 0) {
      const nowIso = new Date().toISOString();
      await Promise.all(alreadyOnGoogle.map(async (contact: any) => {
        const canonicalPhone = canonicalBrazilianWaId(contact.wa_id);
        const resourceName = googleContactsByPhone.get(canonicalPhone) || null;
        const nextMeta = { ...((contact as any).metadata || {}), google_resource_name: resourceName };
        delete nextMeta.google_dirty;
        const { error: updateError } = await supabase.from('crm_contacts').update({
          google_sync_account_id: account.id,
          google_synced_at: nowIso,
          metadata: nextMeta,
          google_sync_claim_token: null,
          google_sync_claimed_at: null,
        })
          .eq('id', contact.id)
          .eq('google_sync_claim_token', claimToken);
        if (updateError) failed++; else pushed++;
      }));
    }

    const contactsToCreate = forThisAccount.filter((contact: any) =>
      !googleContactsByPhone.has(canonicalBrazilianWaId(contact.wa_id))
    );

    const dirtyResources = contactsToCreate
      .filter((c: any) => c.google_sync_account_id === account.id)
      .map((c: any) => c?.metadata?.google_resource_name)
      .filter((r: any) => typeof r === 'string' && r.length > 0);
    for (let i = 0; i < dirtyResources.length; i += 500) {
      const chunk = dirtyResources.slice(i, i + 500);
      try {
        const delResp = await fetch('https://people.googleapis.com/v1/people:batchDeleteContacts', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ resourceNames: chunk }),
        });
        if (!delResp.ok) {
          const t = await delResp.text().catch(() => '');
          console.warn('[GOOGLE-SYNC] batchDelete falhou (segue com create):', delResp.status, t.slice(0, 300));
        }
      } catch (e) {
        console.warn('[GOOGLE-SYNC] batchDelete erro:', e);
      }
    }

    const stillPending: any[] = [];
    let skipCurrentAccount = false;
    for (let i = 0; i < contactsToCreate.length; i += 200) {
      const chunk = contactsToCreate.slice(i, i + 200);
      if (skipCurrentAccount) {
        stillPending.push(...chunk);
        continue;
      }
      try {
        const resp = await fetch('https://people.googleapis.com/v1/people:batchCreateContacts', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contacts: chunk.map((c: any) => ({
              contactPerson: {
                names: [{ givenName: c.name || c.wa_id }],
                phoneNumbers: [{ value: c.wa_id, type: 'mobile' }],
              },
            })),
            readMask: 'names,phoneNumbers',
          }),
        });
        if (resp.ok) {
          const body = await resp.json().catch(() => ({} as any));
          const created: any[] = body?.createdPeople || [];
          const nowIso = new Date().toISOString();
          await Promise.all(chunk.map(async (c: any, idx: number) => {
            const resourceName = created[idx]?.person?.resourceName || null;
            const nextMeta = { ...((c as any).metadata || {}), google_resource_name: resourceName };
            delete nextMeta.google_dirty;
            const { error: upErr } = await supabase.from('crm_contacts').update({
              google_sync_account_id: account.id,
              google_synced_at: nowIso,
              metadata: nextMeta,
              google_sync_claim_token: null,
              google_sync_claimed_at: null,
            })
              .eq('id', c.id)
              .eq('google_sync_claim_token', claimToken);
            if (upErr) {
              console.error('[GOOGLE-SYNC] Erro ao marcar contato como sincronizado:', c.id, upErr.message);
              failed++;
            } else {
              pushed++;
            }
          }));
        } else {
          const t = await resp.text().catch(() => '');
          lastError = `HTTP ${resp.status} (${account.email}): ${t.slice(0, 200)}`;
          console.error('[GOOGLE-SYNC] batchCreate falhou:', lastError);
          stillPending.push(...chunk);
          if (isGoogleContactsFullError(t)) {
            // Verify against the real contact count before marking as full —
            // Google sometimes returns MY_CONTACTS_OVERFLOW_COUNT even when
            // the account is nowhere near the 25k limit (Trash skew, etc.).
            const reallyFull = await isGoogleAccountReallyFull(accessToken);
            if (reallyFull) {
              skipCurrentAccount = true;
              fullAccounts.push(account.email);
              console.warn(`[GOOGLE-SYNC] Conta ${account.email} cheia (25k). Pulando para próxima conta.`);
            } else {
              // False-positive overflow (usually caused by items in the
              // Google Contacts Trash or "Other contacts" pushing the shared
              // quota near the 25k limit). Batch create fails but Google
              // often still accepts one-at-a-time createContact calls.
              // Retry each pending contact individually as a fallback.
              console.warn(`[GOOGLE-SYNC] Conta ${account.email} respondeu OVERFLOW (total real=baixo). Tentando createContact 1x1 como fallback.`);
              const salvaged: any[] = [];
              let singleOverflowStreak = 0;
              for (const single of chunk) {
                try {
                  const singleResp = await fetch('https://people.googleapis.com/v1/people:createContact', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      names: [{ givenName: single.name || single.wa_id }],
                      phoneNumbers: [{ value: single.wa_id, type: 'mobile' }],
                    }),
                  });
                  if (singleResp.ok) {
                    const person = await singleResp.json().catch(() => ({} as any));
                    const resourceName = person?.resourceName || null;
                    const nextMeta = { ...((single as any).metadata || {}), google_resource_name: resourceName };
                    delete nextMeta.google_dirty;
                    const { error: upErr } = await supabase.from('crm_contacts').update({
                      google_sync_account_id: account.id,
                      google_synced_at: new Date().toISOString(),
                      metadata: nextMeta,
                      google_sync_claim_token: null,
                      google_sync_claimed_at: null,
                    })
                      .eq('id', single.id)
                      .eq('google_sync_claim_token', claimToken);
                    if (upErr) { failed++; } else { pushed++; }
                    singleOverflowStreak = 0;
                  } else {
                    const singleErr = await singleResp.text().catch(() => '');
                    salvaged.push(single);
                    if (isGoogleContactsFullError(singleErr)) {
                      singleOverflowStreak++;
                      // If 5 in a row hit overflow, give up on this account this cycle.
                      if (singleOverflowStreak >= 5) {
                        lastError = `Google recusou novos contatos em ${account.email}. Esvazie a Lixeira e "Outros contatos" em contacts.google.com para liberar espaço.`;
                        skipCurrentAccount = true;
                        break;
                      }
                    }
                  }
                } catch (e) {
                  salvaged.push(single);
                }
              }
              // Replace the chunk entry we already pushed into stillPending
              // with only the ones that still failed on the single-create path.
              for (let k = 0; k < chunk.length; k++) stillPending.pop();
              stillPending.push(...salvaged);
            }
          } else if (isGoogleInsufficientScopeError(t)) {
            skipCurrentAccount = true;
            reconnectAccounts.push(account.email);
            lastError = `Permissão insuficiente (${account.email}). Reconecte esta conta Google para liberar envio de contatos.`;
            console.warn(`[GOOGLE-SYNC] Conta ${account.email} sem escopo de escrita. Reconexão necessária.`);
          }
        }
      } catch (e: any) {
        lastError = e?.message || String(e);
        console.error('[GOOGLE-SYNC] batchCreate erro:', lastError);
        stillPending.push(...chunk);
      }
    }
    remaining = [...stillPending, ...skippedForOtherAccounts];
  }

  const accountFull = fullAccounts.length > 0 && remaining.length > 0;
  const requiresReconnect = reconnectAccounts.length > 0 && remaining.length > 0;
  if (accountFull) {
    lastError = `Contas cheias: ${fullAccounts.join(', ')}. Conecte outra conta Google para continuar.`;
  } else if (requiresReconnect) {
    lastError = `Reconecte a(s) conta(s) Google: ${[...new Set(reconnectAccounts)].join(', ')}. A permissão antiga era somente leitura.`;
  }

  // Release only this execution's unfinished claims. Successful rows already
  // cleared their claim above; failures can be retried by the next cycle.
  const { error: releaseError } = await supabase
    .from('crm_contacts')
    .update({ google_sync_claim_token: null, google_sync_claimed_at: null })
    .eq('user_id', userId)
    .eq('google_sync_claim_token', claimToken);
  if (releaseError) {
    console.error('[GOOGLE-SYNC] Falha ao liberar reservas pendentes:', releaseError.message);
  }

  console.log(`[GOOGLE-SYNC] Concluído: ${pushed} enviados, ${remaining.length} ainda pendentes de ${totalPending}.`);

  return {
    success: true,
    pushed,
    failed,
    pending: totalPending,
    remaining: remaining.length,
    lastError,
    accountFull,
    fullAccounts: [...new Set(fullAccounts)],
    requiresReconnect,
    reconnectAccounts: [...new Set(reconnectAccounts)],
  };
}

// Push named (renamed by user) CRM contacts up to active Google accounts.
// Runs in background so Google sync does not depend on an open browser tab.
async function autoPushGoogleContactsForAllUsers(supabase: any) {
  try {
    const { data: accounts } = await supabase
      .from('crm_google_accounts')
      .select('*')
      .eq('auto_sync', true)
      // Contas marcadas para reconexão ficam de fora até o usuário reconectar.
      .or('connection_status.is.null,connection_status.eq.active')

      .order('updated_at', { ascending: false });
    if (!accounts || accounts.length === 0) return;

    const byUser = new Map<string, any[]>();
    let orphanAccounts = 0;
    for (const account of accounts) {
      if (!account.user_id) {
        orphanAccounts++;
        continue;
      }
      const userAccounts = byUser.get(account.user_id) || [];
      userAccounts.push(account);
      byUser.set(account.user_id, userAccounts);
    }
    if (orphanAccounts > 0) {
      console.warn(`[GOOGLE-SYNC] ${orphanAccounts} conta(s) Google órfã(s) ignorada(s): user_id ausente.`);
    }

    for (const [userId, userAccounts] of byUser.entries()) {
      try {
        // Somente contas explicitamente habilitadas participam do Auto Sync.
        const ordered = [...userAccounts];
        const settings = await getCrmSettings(supabase, userId);
        await pushPendingContactsToGoogle(supabase, userId, settings, ordered, 500);
      } catch (e) {
        console.warn('[auto-google-push] user error', userId, (e as any)?.message);
      }
    }
  } catch (e) {
    console.warn('[auto-google-push] fatal', (e as any)?.message);
  }
}

/**
 * Multi-WhatsApp: cada número do cadastro (crm_whatsapp_numbers) tem
 * credenciais próprias e sua própria base de contatos/mensagens
 * (coluna whatsapp_number_id). Estes helpers garantem que o envio sempre
 * saia pelo número da conversa — enviar pelo número errado é o que gerava
 * o erro "Re-engagement message" da Meta.
 */
async function getWhatsAppNumberById(supabase: any, numberId?: string | null) {
  if (!numberId) return null;
  const { data, error } = await supabase
    .from('crm_whatsapp_numbers')
    .select('*')
    .eq('id', numberId)
    .maybeSingle();
  if (error) console.warn('[NUMBER] lookup by id failed', error.message);
  return data || null;
}

async function getWhatsAppNumberByPhoneId(
  supabase: any,
  phoneNumberId?: string | null,
  wabaId?: string | null,
) {
  if (!phoneNumberId && !wabaId) return null;
  // Ordenação determinística: se o mesmo phone_number_id estiver cadastrado
  // duas vezes (erro de configuração), sempre resolvemos para o número ativo
  // mais recente, em vez de uma linha arbitrária do banco.
  let query = supabase
    .from('crm_whatsapp_numbers')
    .select('*')
    .order('is_active', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(1);
  query = phoneNumberId
    ? query.eq('meta_phone_number_id', phoneNumberId)
    : query.eq('meta_waba_id', wabaId);

  const { data, error } = await query;
  if (error) console.warn('[NUMBER] lookup by phone failed', error.message);
  const row = Array.isArray(data) ? data[0] : null;
  return row || null;
}

/** Sobrepõe as credenciais de `crm_settings` com as do número informado. */
function applyNumberToSettings(settings: any, numberRow: any) {
  if (!numberRow?.meta_access_token || !numberRow?.meta_phone_number_id) return settings;
  return {
    ...(settings || {}),
    meta_access_token: numberRow.meta_access_token,
    meta_phone_number_id: numberRow.meta_phone_number_id,
    meta_waba_id: numberRow.meta_waba_id ?? settings?.meta_waba_id ?? null,
    meta_business_id: numberRow.meta_business_id ?? settings?.meta_business_id ?? null,
    meta_app_id: numberRow.meta_app_id ?? settings?.meta_app_id ?? null,
    meta_app_secret: numberRow.meta_app_secret ?? settings?.meta_app_secret ?? null,
    meta_display_phone_number:
      numberRow.meta_display_phone_number ?? settings?.meta_display_phone_number ?? null,
    meta_verified_name: numberRow.meta_verified_name ?? settings?.meta_verified_name ?? null,
  };
}

async function getCrmSettings(supabase: any, userId?: string | null) {
  if (userId) {
    const { data, error } = await supabase
      .from('crm_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) console.warn('[SETTINGS] user settings lookup failed', error);
    if (data) return data;
  }

  const { data, error } = await supabase
    .from('crm_settings')
    .select('*')
    .eq('id', '00000000-0000-0000-0000-000000000001')
    .maybeSingle();

  if (error) console.warn('[SETTINGS] legacy settings lookup failed', error);
  return data;
}

const normalizePhone = (raw: string) => {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  // Handle Brazilian numbers specifically: ensure they have the 13 digit format correctly (55 + DDD + 9? + number)
  // Meta sometimes requires removing the extra '9' for some regions, or keeping it.
  // Standardizing to ensure it's at least 12-13 digits for Meta.
  return digits
}

const getBrazilianPhoneVariants = (raw: string) => {
  const normalized = normalizePhone(raw)
  const variants = new Set<string>([normalized])

  // Lógica para números brasileiros (DDI 55)
  if (normalized.startsWith('55')) {
    // Caso 1: Tem 13 dígitos (formato 55 + DDD + 9 + número)
    if (normalized.length === 13) {
      const country = normalized.slice(0, 2)
      const areaCode = normalized.slice(2, 4)
      const localNumber = normalized.slice(4) // Começa com '9'

      // Se começa com 9, gera variante com 12 dígitos (sem o 9)
      if (localNumber.startsWith('9')) {
        variants.add(`${country}${areaCode}${localNumber.slice(1)}`)
      }
    }
    // Caso 2: Tem 12 dígitos (formato 55 + DDD + número)
    else if (normalized.length === 12) {
      const country = normalized.slice(0, 2)
      const areaCode = normalized.slice(2, 4)
      const localNumber = normalized.slice(4)

      // A Meta entrega números BR de celular sem o 9º dígito (55 + DDD + 8 dígitos).
      // O dígito seguinte ao DDD pode ser QUALQUER número (ex.: 5511 3436-8124 = 5511 93436-8124),
      // então sempre geramos a variante com o 9 para nunca criar dois contatos do mesmo número.
      variants.add(`${country}${areaCode}9${localNumber}`)
    }
  }

  return Array.from(variants)
}

/**
 * Forma canônica de um número brasileiro (sempre COM o 9º dígito).
 * Espelha exatamente a função `public.crm_canon_wa_id` do banco, que garante
 * unicidade de contato por usuário — 1 número = 1 conversa, sempre.
 */
const canonicalBrazilianWaId = (raw: string) => {
  const normalized = normalizePhone(raw)
  if (normalized.startsWith('55') && normalized.length === 12) {
    return `${normalized.slice(0, 4)}9${normalized.slice(4)}`
  }
  return normalized
}

async function syncOutboundStatusFromMeta(supabase: any, userId: string, statusEvent: any) {
  const metaMessageId = statusEvent?.id;
  if (!metaMessageId) return { updated: false, reason: 'missing_meta_message_id' };

  const metaStatus = String(statusEvent?.status || '').toLowerCase();
  const nextStatus = ['sent', 'delivered', 'read', 'failed'].includes(metaStatus) ? metaStatus : 'sent';
  const firstError = Array.isArray(statusEvent?.errors) ? statusEvent.errors[0] : null;

  const { data: existing, error: lookupError } = await supabase
    .from('crm_messages')
    .select('id, user_id, metadata, message_type, media_url, status')
    .eq('meta_message_id', metaMessageId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error('[META-STATUS] Falha ao buscar mensagem para status', { userId, metaMessageId, error: lookupError.message });
    return { updated: false, reason: lookupError.message };
  }

  if (!existing?.id) {
    console.warn('[META-STATUS] Status recebido, mas mensagem local não encontrada', { userId, metaMessageId, metaStatus, statusEvent });
    return { updated: false, reason: 'local_message_not_found' };
  }

  const updateData: any = {
    status: nextStatus,
    user_id: userId,
    metadata: {
      ...(existing.metadata || {}),
      last_meta_status: statusEvent,
      last_meta_status_at: new Date().toISOString(),
    },
  };

  if (firstError) {
    updateData.error_code = String(firstError.code || firstError.error_code || 'meta_failed');
    updateData.error_message = firstError.message || firstError.title || firstError.error_data?.details || 'Meta informou falha na entrega';
    console.error('[META-STATUS-ERROR] Falha assíncrona informada pela Meta', JSON.stringify({
      userId,
      metaMessageId,
      localId: existing.id,
      messageType: existing.message_type,
      mediaUrl: existing.media_url,
      error: firstError,
      statusEvent,
    }));
  }

  const { error: updateError } = await supabase
    .from('crm_messages')
    .update(updateData)
    .eq('id', existing.id);

  if (updateError) {
    console.error('[META-STATUS] Falha ao atualizar status local', { userId, metaMessageId, localId: existing.id, error: updateError.message });
    return { updated: false, reason: updateError.message };
  }

  const broadcastId = existing.metadata?.broadcast_id;
  if (broadcastId && nextStatus === 'failed' && existing.status !== 'failed') {
    const { error: broadcastError } = await supabase.rpc('increment_broadcast_failed', { b_id: broadcastId });
    if (broadcastError) {
      console.error('[META-STATUS] Falha ao atualizar contadores da campanha', {
        broadcastId,
        error: broadcastError.message,
      });
    }
  }

  console.log('[META-STATUS] Status atualizado no CRM', { userId, metaMessageId, localId: existing.id, status: nextStatus, error: updateData.error_message || null });
  return { updated: true, status: nextStatus };
}

// MIME por extensão para documentos — a Meta rejeita 'application/octet-stream'.
const DOC_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
  json: 'application/json', xml: 'application/xml',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
};

const guessDocumentMime = (fileName: string | undefined, declared?: string | null, urlHint?: string): string => {
  const normalized = (declared || '').split(';')[0].trim().toLowerCase();
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  const source = fileName || urlHint || '';
  const ext = (source.split('?')[0].split('.').pop() || '').toLowerCase();
  return DOC_MIME_BY_EXT[ext] || 'application/pdf';
};

const guessMedia = (params: any) => {
  if (params.audioUrl) return { type: 'audio', url: params.audioUrl, mime: 'audio/ogg; codecs=opus', fileName: 'audio.ogg' }
  if (params.imageUrl) return { type: 'image', url: params.imageUrl, mime: 'image/jpeg', fileName: 'image.jpg' }
  if (params.videoUrl) return { type: 'video', url: params.videoUrl, mime: 'video/mp4', fileName: 'video.mp4' }
  if (params.documentUrl) {
    const fileName = String(params.fileName || '').trim() || 'documento';
    return { type: 'document', url: params.documentUrl, mime: guessDocumentMime(fileName, params.mimeType, params.documentUrl), fileName }
  }
  return null
}

/**
 * Baixa a mídia com fallback para o Storage da VPS.
 * Áudios/imagens antigos salvos no Supabase gerenciado (`*.supabase.co/storage/...`)
 * deixaram de responder após a migração; nesse caso reaproveitamos o mesmo caminho
 * do bucket no Storage local antes de desistir.
 */
async function fetchMediaWithFallback(url: string) {
  let response: Response | null = null;
  try {
    response = await fetch(url);
  } catch (err: any) {
    console.warn(`[UPLOAD] Falha de rede ao baixar mídia (${url}):`, err?.message || err);
  }

  if (response?.ok) return response;


  const storageMatch = url.match(/\/storage\/v1\/object\/(?:public\/)?(.+)$/);
  const localBase = (Deno.env.get('PUBLIC_API_URL') || Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  if (storageMatch && localBase && !url.startsWith(localBase)) {
    const fallbackUrl = `${localBase}/storage/v1/object/public/${storageMatch[1]}`;
    console.log(`[UPLOAD] Tentando fallback no Storage local: ${fallbackUrl}`);
    try {
      const fallbackResponse = await fetch(fallbackUrl);
      if (fallbackResponse.ok) return fallbackResponse;
      console.error(`[UPLOAD] Fallback local também falhou (${fallbackResponse.status})`);
    } catch (err: any) {
      console.error('[UPLOAD] Erro no fallback local:', err?.message || err);
    }
  }

  throw new Error(`Falha ao baixar mídia (${response?.status ?? 'sem resposta'}) — arquivo pode ter ficado no Storage antigo: ${url}`);
}

async function uploadMediaToMeta(accessToken: string, phoneNumberId: string, media: { type: string; url: string; mime: string; fileName: string }) {
  console.log(`[UPLOAD] Baixando mídia: ${media.url}`);
  const mediaResponse = await fetchMediaWithFallback(media.url)
  
  const arrayBuffer = await mediaResponse.arrayBuffer();
  const responseContentType = mediaResponse.headers.get('content-type') || '';
  const responseContentLength = mediaResponse.headers.get('content-length') || '';
  
  let contentType = responseContentType || media.mime;
  let fileName = media.fileName;

  if (media.type === 'audio') {
    // IMPORTANTE: Para a Meta tratar como PTT (gravado na hora), o upload DEVE ter mime type 'audio/ogg' 
    // e o arquivo DEVE ter extensão '.ogg', contendo codec opus.
    const isWebm = contentType.includes('webm') || media.url.endsWith('.webm');
    
    if (isWebm) {
      console.log(`[UPLOAD-AUDIO] Webm detectado. Convertendo MIME para audio/ogg.`);
    }
    
    // Forçamos o tipo para audio/ogg com codec opus para garantir que a Meta aceite como PTT
    contentType = 'audio/ogg; codecs=opus';
    fileName = 'voice.ogg';
    
    console.log(`[UPLOAD-AUDIO] Enviando para Meta: type=audio, contentType=${contentType}, fileName=${fileName}`);
    
    const blob = new Blob([arrayBuffer], { type: contentType });
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', blob, fileName);
    
    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });
    
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[UPLOAD-AUDIO] Erro Meta status=${response.status}:`, JSON.stringify(result));
      throw new Error(result?.error?.message || 'Erro ao subir áudio na Meta');
    }
    return result.id;
  }

  // Vídeo: Meta só aceita video/mp4 ou video/3gpp. Se vier webm/octet-stream,
  // forçamos o MIME para video/mp4 (o conteúdo precisa estar em H.264/AAC —
  // a compressão no cliente já gera nesse formato quando suportado).
  if (media.type === 'video') {
    console.log('[UPLOAD-VIDEO-DIAG] Mídia baixada para upload Meta', JSON.stringify({
      url: media.url,
      responseContentType,
      responseContentLength,
      bytes: arrayBuffer.byteLength,
      originalMime: media.mime,
      originalFileName: media.fileName,
    }));
    if (arrayBuffer.byteLength > 16_000_000) {
      console.error(`[UPLOAD-VIDEO] Vídeo acima do limite oficial da Meta: ${arrayBuffer.byteLength} bytes`);
      throw new Error('Vídeo acima do limite de 16MB da Meta. Comprima ou corte mais um pouco antes de enviar.');
    }
    const lower = (contentType || '').toLowerCase();
    if (!lower.includes('mp4') && !lower.includes('3gpp')) {
      console.log(`[UPLOAD-VIDEO] contentType "${contentType}" não aceito pela Meta. Forçando video/mp4.`);
      contentType = 'video/mp4';
    } else {
      contentType = 'video/mp4';
    }
    if (!/\.mp4$/i.test(fileName)) {
      fileName = fileName.replace(/\.[^.]+$/, '') + '.mp4';
    }
  }

  // Documento: o Storage pode devolver 'application/octet-stream' (ou vazio) — a Meta
  // rejeita esse tipo. Resolve pelo MIME declarado no pedido ou pela extensão do nome.
  if (media.type === 'document') {
    contentType = guessDocumentMime(media.fileName, contentType || media.mime, media.url);
    if (arrayBuffer.byteLength > 100_000_000) {
      throw new Error('Documento acima do limite de 100MB da Meta.');
    }
  }
  // Imagem: a Meta aceita apenas image/jpeg e image/png
  if (media.type === 'image') {
    const lower = (contentType || '').toLowerCase();
    if (!lower.includes('jpeg') && !lower.includes('png')) contentType = 'image/jpeg';
    else contentType = lower.includes('png') ? 'image/png' : 'image/jpeg';
  }

  const blob = new Blob([arrayBuffer], { type: contentType })
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('file', blob, fileName)
  form.append('type', contentType)

  console.log(`[UPLOAD] Enviando mídia comum: type=${media.type}, contentType=${contentType}, fileName=${fileName}`);
  const uploadResponse = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  const uploadResult = await uploadResponse.json().catch(() => ({}))
  
  console.log('[UPLOAD-RESULT] Resposta do upload Meta', JSON.stringify({ mediaType: media.type, status: uploadResponse.status, ok: uploadResponse.ok, id: uploadResult?.id || null, error: uploadResult?.error || null }));
  if (!uploadResponse.ok) {
    console.error(`[UPLOAD] Erro Meta detalhado:`, JSON.stringify(uploadResult));
    const details = uploadResult?.error?.error_data?.details || '';
    const baseMsg = uploadResult?.error?.message || `Erro ${uploadResponse.status} ao subir mídia na Meta`;
    let friendly = baseMsg;
    if (/file too large/i.test(details) || /file too large/i.test(baseMsg)) {
      const limits: Record<string, string> = { video: '16MB', image: '5MB', audio: '16MB', document: '100MB' };
      const lim = limits[media.type] || '16MB';
      friendly = `Arquivo de ${media.type === 'video' ? 'vídeo' : media.type} muito grande. O WhatsApp aceita no máximo ${lim}. Comprima o arquivo e envie novamente.`;
    } else if (details) {
      friendly = `${baseMsg}: ${details}`;
    } else {
      const normalized = normalizeMetaSendError(uploadResult, baseMsg);
      if (normalized.code === 'META_TOKEN_INVALID' || normalized.code === 'WHATSAPP_DISCONNECTED') {
        friendly = normalized.message;
      }
    }
    throw new Error(friendly);
  }
  return uploadResult.id
}

async function handleInternalSendMessage(supabase: any, phoneNumberId: string, accessToken: string, params: any, contact: any, vpsTranscoderUrl?: string, userId?: string) {
  if (!phoneNumberId || !accessToken) {
    console.error('[SEND-MESSAGE] Falha: Credenciais ausentes', { phoneNumberId: !!phoneNumberId, accessToken: !!accessToken });
    throw new Error('Credenciais Meta não configuradas');
  }
  const to = normalizePhone(params.to);
  if (!to) {
    console.error('[SEND-MESSAGE] Falha: Telefone inválido', { to: params.to });
    throw new Error('Telefone inválido');
  }

  console.log(`[SEND-MESSAGE] Iniciando para ${to}. Action: ${params.action || 'default'}`);

  const media = guessMedia(params)
  const isVoice = params.isVoice === true || media?.type === 'audio';
  const payload: any = { messaging_product: 'whatsapp', recipient_type: 'individual', to }
  
  if (params.interactive) {
    console.log(`[SEND-MESSAGE] Prepare interactive payload for ${to}`);
    payload.type = 'interactive';
    // Deep clone and clean interactive payload
    const interactive = JSON.parse(JSON.stringify(params.interactive));
    
    // WhatsApp requires a body text for buttons
    if (!interactive.body || !interactive.body.text) {
      interactive.body = { text: params.text || "Escolha uma opção:" };
    }

    if (interactive.action) {
      // Remove numeric keys that might have been accidentally added by frontend or object mapping
      Object.keys(interactive.action).forEach(key => {
        if (/^\d+$/.test(key)) delete interactive.action[key];
      });
      
      // Ensure buttons array exists for 'button' type
      if (interactive.type === 'button' && (!interactive.action.buttons || !Array.isArray(interactive.action.buttons))) {
         console.warn(`[SEND-MESSAGE] Interactive type 'button' missing valid buttons array for ${to}`);
      }
    }
    payload.interactive = interactive;
  } else if (media) {
    console.log(`[MEDIA-DETECT] Tipo: ${media.type}, isVoice: ${isVoice}, VPS: ${vpsTranscoderUrl ? 'SIM' : 'NÃO'}`);
    if (media.type === 'video') {
      console.log('[MEDIA-VIDEO] Enviando vídeo por upload oficial da Meta e mensagem por media_id, não por link direto.');
    }
    if (media.type === 'audio' && vpsTranscoderUrl) {
      console.log(`[AUDIO-VPS] Usando Transcoder para enviar como gravado: ${vpsTranscoderUrl}`);
      try {
        const vpsUrl = vpsTranscoderUrl.replace(/\/$/, '');
        const vpsResponse = await fetch(`${vpsUrl}/send-voice`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: normalizePhone(params.to),
            audioUrl: media.url,
            metaToken: accessToken,
            phoneId: phoneNumberId,
            sendAsVoice: true
          })
        });
        
        const vpsResult = await vpsResponse.json().catch(() => ({}));
        if (vpsResponse.ok) {
          console.log(`[AUDIO-VPS] Sucesso via VPS:`, JSON.stringify(vpsResult));
          const msgId = vpsResult?.messageId || vpsResult?.messages?.[0]?.id || null;
          
          if (contact && !params.skipLocalSave) {
            await supabase.from('crm_messages').insert({
              contact_id: contact.id,
              user_id: contact.user_id || userId || null,
              direction: 'outbound',
              message_type: 'audio',
              content: '[Mensagem de Áudio]',
              media_url: media.url,
              status: 'accepted',
              meta_message_id: msgId,
              metadata: { source: 'vps_flow', is_voice: true }
            });
            await supabase.from('crm_contacts').update({ last_interaction: new Date().toISOString() }).eq('id', contact.id);
          }
          return jsonResponse({ success: true, messageId: msgId, result: vpsResult });
        }
        console.error(`[AUDIO-VPS] VPS retornou erro, tentando envio padrão:`, vpsResult);
      } catch (vpsErr) {
        console.error(`[AUDIO-VPS] Erro ao conectar com VPS, tentando envio padrão:`, vpsErr);
      }
    }

    if (!payload.type) {
    console.log(`[MEDIA] Iniciando upload de ${media.type} para Meta. URL: ${media.url}`);
    let mediaId;
    try {
      mediaId = await uploadMediaToMeta(accessToken, phoneNumberId, media);
      console.log(`[MEDIA] Upload concluído com sucesso. ID: ${mediaId}`);
    } catch (uploadError: any) {
      console.error(`[MEDIA] ERRO CRÍTICO NO UPLOAD: ${uploadError.message}`);
      throw uploadError;
    }
    
    // CRUCIAL: Para aparecer como "Gravado na hora" (PTT/Blue mic), a Meta Cloud API 
    // exige que o tipo da mensagem seja 'audio' E que ela seja enviada 
    // com um arquivo OGG/Opus sem legenda (caption).
    // O parâmetro 'ptt: true' é opcional mas recomendado em algumas versões. 
    // Se der erro 400 novamente, usaremos um fallback via VPS Transcoder se disponível.
    payload.type = media.type;
    if (media.type === 'audio') {
      payload.audio = { 
        id: mediaId,
        voice: true // Crucial: para aparecer como gravado (blue mic)
      };
      console.log(`[MEDIA-SEND] Enviando áudio ID: ${mediaId} como 'audio'. OGG/Opus detectado. voice=true`);
    } else if (media.type === 'video') {
      payload.video = { id: mediaId, ...(params.text ? { caption: String(params.text) } : {}) };
      console.log(`[MEDIA-SEND] Enviando vídeo ID: ${mediaId} como 'video' via media_id.`);
    } else if (media.type === 'document') {
      payload.document = { id: mediaId, filename: media.fileName };
    } else {
      payload[media.type] = { id: mediaId };
    }
    }
  } else {
    payload.type = 'text'
    payload.text = { preview_url: true, body: String(params.text || '') }
  }

  console.log(`[META-SEND] Enviar fetch para Meta. type=${payload.type}, to=${to}`);
  let response: Response;
  let result: any = {};
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      result = await response.json().catch(() => ({}));
    } catch (netErr) {
      console.error(`[META-SEND] Network error attempt ${attempt}:`, netErr);
      if (attempt < maxAttempts) {
        await wait(500 * Math.pow(2, attempt - 1));
        continue;
      }
      throw netErr;
    }
    const isTransient =
      result?.error?.is_transient === true ||
      result?.error?.code === 2 ||
      result?.error?.code === 1 ||
      (response.status >= 500 && response.status < 600);
    if (response.ok || !isTransient || attempt === maxAttempts) {
      if (!response.ok && isTransient) {
        console.warn(`[META-SEND] Transient error persisted after ${attempt} attempts`);
      }
      break;
    }
    const backoff = 600 * Math.pow(2, attempt - 1);
    console.warn(`[META-SEND] Transient Meta error (attempt ${attempt}/${maxAttempts}), retrying in ${backoff}ms. code=${result?.error?.code} msg=${result?.error?.message}`);
    await wait(backoff);
  }
  console.log(`[META-SEND] Resposta Meta status=${response!.status} ok=${response!.ok} body=${JSON.stringify(result)}`);
  if (!response.ok) {
    console.error(`[META-SEND] ERRO Meta status=${response.status} phoneId=${phoneNumberId} to=${to} payloadType=${payload.type} error=${JSON.stringify(result?.error)}`);
    const normalizedError = normalizeMetaSendError(result, `Erro ${response.status} ao enviar mensagem pela Meta`);

    if (contact && !params.skipLocalSave) {
      const messageType = params.interactive ? 'interactive' : (media?.type || 'text');
      const content = media ? (params.text || `[${media.type}]`) : (params.interactive?.body?.text || params.text || '');
      await supabase.from('crm_messages').insert({
        contact_id: contact.id,
        user_id: userId || contact.user_id || null,
        ...(params.whatsapp_number_id || contact.whatsapp_number_id ? { whatsapp_number_id: params.whatsapp_number_id || contact.whatsapp_number_id } : {}),
        direction: 'outbound',
        message_type: messageType,
        content,
        media_url: media?.url || null,
        status: 'failed',
        error_code: normalizedError.code,
        error_message: normalizedError.message,
        metadata: {
          ...(params.metadata || {}),
          meta_error: result?.error || null,
          meta_error_details: normalizedError.details,
        },
      });
      await supabase.from('crm_contacts').update({ last_interaction: new Date().toISOString() }).eq('id', contact.id);
    }

    return jsonResponse({ success: false, ...normalizedError, metaError: result?.error || null }, 200);
  }
  const sentMessageId = result?.messages?.[0]?.id || null;
  if (!sentMessageId) {
    // A Meta respondeu 200 mas sem ID de mensagem: NÃO houve envio real.
    console.error(`[META-SEND] Resposta 200 sem message id (envio não confirmado) to=${to} body=${JSON.stringify(result)}`);
    if (contact && !params.skipLocalSave) {
      const messageTypeNc = params.interactive ? 'interactive' : (media?.type || 'text');
      const contentNc = media ? (params.text || `[${media.type}]`) : (params.interactive?.body?.text || params.text || '');
      await supabase.from('crm_messages').insert({
        contact_id: contact.id,
        user_id: userId || contact.user_id || null,
        ...(params.whatsapp_number_id || contact.whatsapp_number_id ? { whatsapp_number_id: params.whatsapp_number_id || contact.whatsapp_number_id } : {}),
        direction: 'outbound',
        message_type: messageTypeNc,
        content: contentNc,
        media_url: media?.url || null,
        status: 'failed',
        error_code: 'no_message_id',
        error_message: 'A Meta não confirmou o envio (resposta sem ID de mensagem).',
        metadata: { ...(params.metadata || {}), meta_raw_response: result || null },
      });
    }
    return jsonResponse({
      success: false,
      code: 'no_message_id',
      message: 'A Meta não confirmou o envio (resposta sem ID de mensagem).',
      metaError: result?.error || null,
    }, 200);
  }
  console.log(`[META-SEND] OK messageId=${sentMessageId} to=${to} type=${payload.type}`);

  if (contact && !params.skipLocalSave) {
    const messageType = params.interactive ? 'interactive' : (media?.type || 'text');
    const content = media ? (params.text || `[${media.type}]`) : (params.interactive?.body?.text || params.text);
    
    console.log(`[FLOW-LOG] Saving outbound message to history: type=${messageType}, to=${to}`);
    
    // IMPORTANTE: Garantir que o userId esteja presente para aparecer na tela do usuário correto
    const finalUserId = userId || contact.user_id || null;
    // A mensagem precisa carregar a caixa (número) da conversa: todas as telas
    // escopadas por número filtram por whatsapp_number_id.
    const outboundNumberId = params.whatsapp_number_id || contact.whatsapp_number_id || null;

    const { data: savedMessage, error: insertError } = await supabase.from('crm_messages').insert({
      contact_id: contact.id,
      user_id: finalUserId,
      ...(outboundNumberId ? { whatsapp_number_id: outboundNumberId } : {}),
      direction: 'outbound',

      message_type: messageType,
      content: content,
      media_url: media?.url || null,
      status: 'accepted',
      meta_message_id: result?.messages?.[0]?.id || null,
      metadata: { 
        ...(media?.type === 'audio' ? { is_voice: !!params.isVoice } : {}),
        ...(media?.type === 'video' ? { media_send_strategy: 'meta_upload_id', media_payload: 'video.id' } : {}),
        interactive: params.interactive || null,
        ...(params.metadata || {}),
        flow_executor_node_id: params.nodeId || params.contact?.current_node_id || null
      },
    }).select().single()

    if (insertError) {
      console.error('[FLOW-LOG] CRITICAL: Erro ao salvar mensagem no histórico:', insertError)
    } else {
      console.log('[FLOW-LOG] Mensagem salva no histórico com sucesso:', savedMessage.id, 'User:', finalUserId);
    }

    await supabase.from('crm_contacts').update({ last_interaction: new Date().toISOString() }).eq('id', contact.id)
  }

  return jsonResponse({ success: true, result, messageId: result?.messages?.[0]?.id || null })
}

async function internalSendTemplate(
  supabase: any,
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  manualComponents: any[],
  contact: any,
  vpsTranscoderUrl?: string,
  providedContactId?: string,
  broadcastId?: string
) {
  let dbTemplate: any = null;
  // Linha do template no banco (id/idioma/componentes) — usada para validar a
  // estrutura enviada e registrar os parâmetros no histórico.
  let approvedTemplateRow: any = null;
  const normalizedTo = normalizePhone(to)
  
  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedTo,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: manualComponents || []
    }
  }

  // ---- GUARDA: a Meta só entrega template APROVADO ----
  // Enviar template PENDING/REJECTED/PAUSED/DISABLED retorna erros genéricos
  // (code 10/100/132001) que eram interpretados como "saldo insuficiente".
  // Bloqueamos antes de chamar a Graph API e explicamos o motivo real.
  try {
    const { data: statusRow } = await supabase
      .from('crm_templates')
      .select('id, status, language, components, is_carousel')
      .eq('name', templateName)
      .eq('user_id', contact?.user_id)
      .maybeSingle();
    approvedTemplateRow = statusRow || null;

    const tplStatus = String(statusRow?.status || '').toUpperCase();
    if (statusRow && tplStatus !== 'APPROVED') {
      const label = tplStatus || 'DESCONHECIDO';
      const normalizedError = {
        code: 'META_TEMPLATE_NOT_APPROVED',
        message: `O template "${templateName}" está com status ${label} na Meta. Só é possível disparar templates APROVADOS — aguarde a aprovação (ou corrija/reenvie o template) antes de tentar novamente.`,
        details: `template=${templateName} status=${label} (bloqueado localmente, sem chamada à Graph API)`,
      };

      if (contact) {
        await supabase.from('crm_messages').insert({
          contact_id: contact.id,
          user_id: contact.user_id || null,
          ...(contact.whatsapp_number_id ? { whatsapp_number_id: contact.whatsapp_number_id } : {}),
          direction: 'outbound',
          message_type: 'template',
          content: `[Template: ${templateName}]`,
          status: 'failed',
          error_code: normalizedError.code,
          error_message: normalizedError.message,
          metadata: {
            template_name: templateName,
            template_status: label,
            broadcast_id: broadcastId || null,
            meta_error_details: normalizedError.details,
          },
        });
      }

      console.warn(`[TEMPLATE-GUARD] Bloqueado envio de template não aprovado: ${templateName} (${label})`);
      return jsonResponse({ success: false, ...normalizedError }, 200);
    }
  } catch (guardErr) {
    console.warn('[TEMPLATE-GUARD] Não foi possível validar o status do template:', (guardErr as any)?.message);
  }

  // Se não houver componentes manuais, tentamos buscar no banco de dados para ver se há mídia salva (HEADER ou CAROUSEL)

  if (!manualComponents || manualComponents.length === 0) {
    const { data: templateData } = await supabase
      .from('crm_templates')
      .select('components, is_carousel')
      .eq('name', templateName)
      .eq('user_id', contact?.user_id)
      .single();
    
    dbTemplate = templateData;

    console.log(`[CAROUSEL-LOG] Template from DB: ${templateName}, is_carousel: ${dbTemplate?.is_carousel}`);

    if (dbTemplate?.components) {
      if (dbTemplate.is_carousel) {
        const carouselComponent = dbTemplate.components.find((c: any) => c.type === 'CAROUSEL');
        console.log(`[CAROUSEL-LOG] Carousel component found: ${!!carouselComponent}, cards: ${carouselComponent?.cards?.length}`);
        
        if (carouselComponent?.cards) {
          const cardsParams = await Promise.all(carouselComponent.cards.map(async (card: any, cardIdx: number) => {
            const cardComponents = [];
            const header = card.components?.find((c: any) => c.type === 'HEADER');
            const body = card.components?.find((c: any) => c.type === 'BODY');
            const buttons = card.components?.find((c: any) => c.type === 'BUTTONS');
            
            console.log(`[CAROUSEL-LOG] Processing card ${cardIdx}, header format: ${header?.format}`);
            
            // 1. HEADER (Mídia)
            if (header && (header.format === 'IMAGE' || header.format === 'VIDEO')) {
              let mediaUrl = header.example?.header_handle?.[0];
              
              // Se não encontrou no example, tenta ver se veio como direct link (fallback para templates manuais)
              if (!mediaUrl && header.image?.link) mediaUrl = header.image.link;
              if (!mediaUrl && header.video?.link) mediaUrl = header.video.link;
              mediaUrl = await resolveTemplateMediaUrl(supabase, accessToken, mediaUrl, header.format.toLowerCase(), `${templateName}_carousel_${cardIdx}`);
              
              console.log(`[CAROUSEL-LOG] Card ${cardIdx} media URL detected: ${mediaUrl}`);
              
              if (mediaUrl) {
                const fmt = header.format.toLowerCase();
                let mediaParam: any = { link: mediaUrl };

                // VIDEO em carrossel falha com link público (erro 131053 - Media upload error).
                // Solução: subir o vídeo para a Meta (/media) e enviar via id.
                if (fmt === 'video') {
                  try {
                    const ext = (mediaUrl.split('?')[0].split('.').pop() || 'mp4').toLowerCase();
                    const mime = ext === 'mov' ? 'video/quicktime' : 'video/mp4';
                    const mediaId = await uploadMediaToMeta(accessToken, phoneNumberId, {
                      type: 'video',
                      url: mediaUrl,
                      mime,
                      fileName: `${templateName}_card${cardIdx}.${ext}`,
                    });
                    if (mediaId) {
                      mediaParam = { id: mediaId };
                      console.log(`[CAROUSEL-LOG] Card ${cardIdx} video uploaded to Meta, id=${mediaId}`);
                    }
                  } catch (upErr) {
                    console.error(`[CAROUSEL-LOG] Card ${cardIdx} video upload failed, falling back to link:`, upErr);
                  }
                }

                cardComponents.push({
                  type: 'header',
                  parameters: [{
                    type: fmt,
                    [fmt]: mediaParam
                  }]
                });
              } else {
                console.log(`[CAROUSEL-LOG] Card ${cardIdx} skip header - NO MEDIA URL FOUND`);
              }
            }

            // 2. BODY (Texto do card)
            if (body) {
              const variableCount = (body.text?.match(/{{[0-9]+}}/g) || []).length;
              console.log(`[CAROUSEL-LOG] Card ${cardIdx} body text: ${body.text}, variables: ${variableCount}`);
              
              // Meta exige o componente body se houver texto, mesmo sem variáveis
              cardComponents.push({
                type: 'body',
                parameters: variableCount > 0 
                  ? Array(variableCount).fill({ type: 'text', text: '-' })
                  : [] // Se não tem variáveis, array vazio de parâmetros
              });
            }

            // 3. BUTTONS (Botões do card)
            if (buttons?.buttons) {
              buttons.buttons.forEach((btn: any, btnIdx: number) => {
                const buttonVariableCount = (btn.text?.match(/{{[0-9]+}}/g) || []).length;
                const hasVariable = buttonVariableCount > 0 || (btn.url?.includes('{{'));
                
                console.log(`[CAROUSEL-LOG] Card ${cardIdx} button ${btnIdx} type: ${btn.type}, hasVariable: ${hasVariable}`);
                
                // Sempre incluir o componente button se ele existir no card do carrossel
                cardComponents.push({
                  type: 'button',
                  sub_type: btn.type?.toLowerCase() === 'url' ? 'url' : 'quick_reply',
                  index: btnIdx.toString(),
                  parameters: hasVariable ? [{ type: 'text', text: '-' }] : []
                });
              });
            }
            
            return { card_index: cardIdx, components: cardComponents };
          }));
          
          payload.template.components = [{
            type: 'carousel',
            cards: cardsParams
          }];

          // Verificamos se existe um componente BODY global (fora dos cards) que pode ter variáveis
          const globalBody = dbTemplate.components.find((c: any) => c.type === 'BODY');
          if (globalBody && globalBody.text && globalBody.text.includes('{{')) {
             const variableCount = (globalBody.text.match(/{{[0-9]+}}/g) || []).length;
             if (variableCount > 0) {
               payload.template.components.push({
                 type: 'body',
                 parameters: Array(variableCount).fill({ type: 'text', text: '-' })
               });
             }
          }

          console.log(`[CAROUSEL-LOG] Final payload components:`, JSON.stringify(payload.template.components));
        }
      } else {
        // Lógica normal para templates não-carrossel
        const header = dbTemplate.components.find((c: any) => c.type === 'HEADER');
        const body = dbTemplate.components.find((c: any) => c.type === 'BODY');
        const buttons = dbTemplate.components.find((c: any) => c.type === 'BUTTONS');
        const components = [];

        if (header && (header.format === 'IMAGE' || header.format === 'VIDEO' || header.format === 'DOCUMENT')) {
          const mediaUrl = header.example?.header_handle?.[0];
          if (mediaUrl) {
            components.push({
              type: 'header',
              parameters: [{
                type: header.format.toLowerCase(),
                [header.format.toLowerCase()]: { link: mediaUrl }
              }]
            });
          }
        }

        if (body && body.text && body.text.includes('{{')) {
          const variableCount = (body.text.match(/{{[0-9]+}}/g) || []).length;
          components.push({
            type: 'body',
            parameters: Array(variableCount).fill({ type: 'text', text: '-' })
          });
        }

        if (buttons?.buttons) {
          buttons.buttons.forEach((btn: any, btnIdx: number) => {
            if (btn.text && btn.text.includes('{{')) {
              components.push({
                type: 'button',
                sub_type: btn.type?.toLowerCase() || 'url',
                index: btnIdx.toString(),
                parameters: [{ type: 'text', text: '-' }]
              });
            }
          });
        }

        if (components.length > 0) {
          payload.template.components = components;
        }
      }
    }
  }

  // ---- VALIDAÇÃO ESTRUTURAL: componentes enviados x estrutura aprovada ----
  // Só se aplica quando o app mandou componentes explicitamente (variáveis
  // preenchidas). O fallback legado (sem componentes) mantém o comportamento
  // anterior para fluxos e automações antigas.
  if (approvedTemplateRow && Array.isArray(manualComponents) && manualComponents.length > 0 && !approvedTemplateRow.is_carousel) {
    const schema = parseServerTemplateSchema(approvedTemplateRow.components);
    const structureIssues = validateComponentsAgainstSchema(schema, manualComponents);
    const approvedLanguage = String(approvedTemplateRow.language || '').trim();
    if (approvedLanguage && languageCode && approvedLanguage !== languageCode) {
      structureIssues.unshift({
        code: 'TEMPLATE_LANGUAGE_MISMATCH',
        message: `O idioma informado (${languageCode}) não corresponde ao idioma aprovado (${approvedLanguage}).`,
      });
    }
    if (structureIssues.length > 0) {
      const normalizedError = {
        code: structureIssues[0].code,
        message: structureIssues.map(i => i.message).join(' '),
        details: `template=${templateName} issues=${structureIssues.map(i => i.code).join(',')}`,
      };
      if (contact) {
        await supabase.from('crm_messages').insert({
          contact_id: contact.id,
          user_id: contact.user_id || null,
          ...(contact.whatsapp_number_id ? { whatsapp_number_id: contact.whatsapp_number_id } : {}),
          direction: 'outbound',
          message_type: 'template',
          content: `[Template: ${templateName}]`,
          status: 'failed',
          error_code: normalizedError.code,
          error_message: normalizedError.message,
          metadata: {
            template_name: templateName,
            template_id: approvedTemplateRow.id || null,
            language: languageCode,
            broadcast_id: broadcastId || null,
            ...summarizeSentComponents(manualComponents),
            validation_issues: structureIssues,
          },
        });
      }
      console.warn(`[TEMPLATE-VALIDATION] Bloqueado: ${normalizedError.details}`);
      return jsonResponse({ success: false, ...normalizedError }, 200);
    }
  }

  console.log(`[TEMPLATE] Sending template ${templateName} to ${normalizedTo}`);
  console.log(`[TEMPLATE-PAYLOAD]`, JSON.stringify(payload));

  const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const result = await response.json().catch(() => ({}))
  console.log(`[META-RESULT]`, JSON.stringify(result));

  if (!response.ok) {
    console.error(`[TEMPLATE] Error sending template:`, JSON.stringify(result));
    const normalizedError = normalizeMetaSendError(result, 'Erro ao enviar template pela Meta');

    if (contact) {
      await supabase.from('crm_messages').insert({
        contact_id: contact.id,
        user_id: contact.user_id || userId || null,
        ...(contact.whatsapp_number_id ? { whatsapp_number_id: contact.whatsapp_number_id } : {}),
        direction: 'outbound',
        message_type: 'template',
        content: `[Template: ${templateName}]`,
        status: 'failed',
        error_code: normalizedError.code,
        error_message: normalizedError.message,
        metadata: {
          template_name: templateName,
          source: 'api_automation',
            broadcast_id: broadcastId || null,
          meta_error: result?.error || null,
          meta_error_details: normalizedError.details,
        },
      });
      await supabase.from('crm_contacts').update({ last_interaction: new Date().toISOString() }).eq('id', contact.id);
    }

    return jsonResponse({ success: false, ...normalizedError, metaError: result?.error || null }, 200);
  }

  const templateMessageId = result?.messages?.[0]?.id || null;
  if (!templateMessageId) {
    console.error(`[TEMPLATE] Resposta 200 sem message id (envio não confirmado) to=${normalizedTo} body=${JSON.stringify(result)}`);
    if (contact) {
      await supabase.from('crm_messages').insert({
        contact_id: contact.id,
        user_id: contact.user_id || userId || null,
        ...(contact.whatsapp_number_id ? { whatsapp_number_id: contact.whatsapp_number_id } : {}),
        direction: 'outbound',
        message_type: 'template',
        content: `[Template: ${templateName}]`,
        status: 'failed',
        error_code: 'no_message_id',
        error_message: 'A Meta não confirmou o envio do template (resposta sem ID de mensagem).',
        metadata: { template_name: templateName, broadcast_id: broadcastId || null, meta_raw_response: result || null },
      });
    }
    return jsonResponse({
      success: false,
      code: 'no_message_id',
      message: 'A Meta não confirmou o envio do template (resposta sem ID de mensagem).',
      metaError: result?.error || null,
    }, 200);
  }

  if (contact) {
    const isCarousel = dbTemplate?.is_carousel || false;
    let carouselMetadata = null;

    if (isCarousel) {
      const carouselComponent = dbTemplate.components.find((c: any) => c.type === 'CAROUSEL');
      if (carouselComponent?.cards) {
        carouselMetadata = {
          carousel: {
            cards: await Promise.all(carouselComponent.cards.map(async (card: any, cardIdx: number) => {
              const header = card.components?.find((c: any) => c.type === 'HEADER');
              const body = card.components?.find((c: any) => c.type === 'BODY');
              const buttons = card.components?.find((c: any) => c.type === 'BUTTONS');
              
              // Extrair o link de mídia para salvar no histórico
              let mediaUrl = header?.example?.header_handle?.[0] || header?.image?.link || header?.video?.link;
              mediaUrl = await resolveTemplateMediaUrl(supabase, accessToken, mediaUrl, header?.format?.toLowerCase() || 'image', `${templateName}_history_${cardIdx}`);
              
              return {
                header: header ? { ...header, media_url: mediaUrl } : null,
                body: body,
                buttons: buttons
              };
            }))
          }
        };
      }
    }

    const { data: savedMessage, error: insertError } = await supabase.from('crm_messages').insert({
      contact_id: contact.id,
      user_id: contact.user_id || userId || null,
      ...(contact.whatsapp_number_id ? { whatsapp_number_id: contact.whatsapp_number_id } : {}),
      direction: 'outbound',
      message_type: isCarousel ? 'carousel' : 'template',
      content: `[Template: ${templateName}]`,
      status: 'accepted',
      meta_message_id: result?.messages?.[0]?.id || null,
      metadata: { 
        template_name: templateName,
        template_id: approvedTemplateRow?.id || null,
        language: languageCode,
        source: 'api_automation',
        broadcast_id: broadcastId || null,
        ...summarizeSentComponents(payload.template.components),
        meta_raw_response: result || null,
        ...(carouselMetadata || {})
      }
    }).select().single()

    if (insertError) {
      console.error('[TEMPLATE] Erro ao salvar template enviado no banco:', insertError)
    } else {
      console.log('[TEMPLATE] Template enviado salvo com sucesso:', savedMessage.id)
    }

    await supabase.from('crm_contacts').update({ last_interaction: new Date().toISOString() }).eq('id', contact.id)
  }

  return jsonResponse({ success: true, result, messageId: result?.messages?.[0]?.id || null })
}
async function getAppId(accessToken: string) {
  try {
    console.log('Fetching App ID from debug_token...');
    const response = await fetch(`https://graph.facebook.com/v18.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`);
    const data = await response.json();
    if (data.data?.app_id) {
      console.log('Successfully retrieved App ID:', data.data.app_id);
      return data.data.app_id;
    }
    console.error('App ID not found in debug_token response:', JSON.stringify(data));
    return null;
  } catch (err) {
    console.error('Error getting App ID:', err);
    return null;
  }
}

function getGlobalWebhookVerifyToken() {
  return Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || 'mro-crm-whatsapp-webhook-v1';
}

async function ensureMetaAppWebhookConfigured() {
  const APP_ID = Deno.env.get('FACEBOOK_APP_ID');
  const APP_SECRET = Deno.env.get('FACEBOOK_APP_SECRET');
  // Em self-hosted, SUPABASE_URL é interno (http://gateway:8000) e a Meta recusa
  // com "(#100) Param callback_url is not a valid URI". Usa a URL pública.
  const rawBaseUrl = Deno.env.get('PUBLIC_API_URL')
    || Deno.env.get('PUBLIC_FUNCTIONS_URL')
    || Deno.env.get('SUPABASE_URL');
  if (!APP_ID || !APP_SECRET || !rawBaseUrl) {
    console.warn('[META WEBHOOK] Missing app credentials or backend URL');
    return { success: false, error: 'missing_config' };
  }

  const baseUrl = rawBaseUrl.replace(/\/$/, '');
  if (!/^https:\/\//i.test(baseUrl)) {
    console.warn('[META WEBHOOK] Backend URL is not public HTTPS, skipping app subscription:', baseUrl);
    return { success: false, error: 'non_public_callback_url' };
  }

  const callbackUrl = `${baseUrl}/functions/v1/meta-whatsapp-crm`;

  // Coexistência (SMB) só entrega conversas se os campos smb_* estiverem assinados.
  // Alguns apps Meta não têm permissão para eles: se a Meta recusar o conjunto
  // completo, refazemos a inscrição apenas com "messages" — nunca deixamos o
  // recebimento das outras caixas quebrado por causa de um campo extra.
  const fieldSets = [
    'messages,smb_message_echoes,smb_app_state_sync,history,message_template_status_update',
    'messages,smb_message_echoes,smb_app_state_sync,history',
    'messages,smb_message_echoes',
    'messages',
  ];

  const subscribeWithFields = async (fields: string) => {
    const form = new URLSearchParams();
    form.set('object', 'whatsapp_business_account');
    form.set('callback_url', callbackUrl);
    form.set('fields', fields);
    form.set('verify_token', getGlobalWebhookVerifyToken());
    form.set('access_token', `${APP_ID}|${APP_SECRET}`);

    const res = await fetch(`https://graph.facebook.com/v25.0/${APP_ID}/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const json = await res.json().catch(() => ({}));
    console.log('[META WEBHOOK] app subscription response', {
      ok: res.ok,
      status: res.status,
      fields,
      success: json?.success || null,
      error: json?.error?.message || null,
    });
    return { ok: res.ok && json?.success !== false, status: res.status, json };
  };

  try {
    let last: { ok: boolean; status: number; json: any } | null = null;
    for (const fields of fieldSets) {
      last = await subscribeWithFields(fields);
      if (last.ok) {
        return {
          success: true,
          status: last.status,
          result: last.json,
          callback_url: callbackUrl,
          subscribed_fields: fields,
        };
      }
    }
    return {
      success: false,
      status: last?.status ?? 0,
      result: last?.json ?? {},
      callback_url: callbackUrl,
      subscribed_fields: null,
    };
  } catch (e: any) {
    console.error('[META WEBHOOK] app subscription failed', { message: e?.message || String(e) });
    return { success: false, error: e?.message || String(e) };
  }
}


function getWebhookRepairError(appWebhook: any, wabaSubscription: any) {
  const appError = appWebhook?.result?.error || {};
  const wabaError = wabaSubscription?.result?.error || {};
  const rawMessage = String(
    wabaError?.error_user_msg ||
    wabaError?.message ||
    appError?.error_user_msg ||
    appError?.message ||
    'Não foi possível ativar o recebimento de mensagens.'
  );

  const invalidWaba = Number(wabaError?.code) === 100 || Number(wabaError?.error_subcode) === 33;
  const invalidPermissions = /permission|permissions|permiss/i.test(rawMessage) || Number(appError?.error_subcode) === 1929002;

  if (invalidWaba || invalidPermissions) {
    return {
      error: 'Você precisa reconectar seu WhatsApp. A Meta recusou a inscrição de recebimento porque o WABA/número salvo não tem permissão ou não pertence mais ao token conectado.',
      requiresReconnect: true,
      details: rawMessage,
    };
  }

  return {
    error: rawMessage,
    requiresReconnect: false,
    details: rawMessage,
  };
}

async function ensureWabaSubscribed(wabaId?: string | null, accessToken?: string | null) {
  if (!wabaId || !accessToken) return { success: false, skipped: true };
  try {
    const subscribeRes = await fetch(`https://graph.facebook.com/v25.0/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const subscribeJson = await subscribeRes.json().catch(() => ({}));
    console.log('[META WEBHOOK] WABA subscribed_apps response', { ok: subscribeRes.ok, status: subscribeRes.status, success: subscribeJson?.success || null, error: subscribeJson?.error?.message || null });
    return { success: subscribeRes.ok, status: subscribeRes.status, result: subscribeJson };
  } catch (e: any) {
    console.warn('[META WEBHOOK] WABA subscribed_apps failed', { message: e?.message || String(e) });
    return { success: false, error: e?.message || String(e) };
  }
}

function getTemplateMediaFileName(mediaUrl: string, expectedFormat: string) {
  const fallbackByFormat: Record<string, string> = {
    IMAGE: 'template_sample.jpg',
    VIDEO: 'template_sample.mp4',
    DOCUMENT: 'template_sample.pdf',
  };

  try {
    const pathname = new URL(mediaUrl).pathname;
    const lastSegment = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    if (lastSegment && /\.[a-z0-9]{2,8}$/i.test(lastSegment)) return lastSegment;
  } catch (_) {
    // Fall back below when the input is not a valid URL.
  }

  return fallbackByFormat[expectedFormat] || 'template_sample.bin';
}

function getTemplateMediaContentType(mediaUrl: string, responseType: string, expectedFormat: string) {
  const lowerResponseType = String(responseType || '').split(';')[0].trim().toLowerCase();
  const path = (() => {
    try { return new URL(mediaUrl).pathname.toLowerCase(); } catch (_) { return mediaUrl.toLowerCase(); }
  })();

  if (expectedFormat === 'IMAGE') {
    if (lowerResponseType === 'image/jpeg' || lowerResponseType === 'image/png') return lowerResponseType;
    if (/\.(png)(\?|$)/i.test(path)) return 'image/png';
    if (/\.(jpe?g)(\?|$)/i.test(path)) return 'image/jpeg';
    return 'image/jpeg';
  }

  if (expectedFormat === 'VIDEO') {
    if (lowerResponseType === 'video/mp4' || lowerResponseType === 'video/3gpp') return lowerResponseType;
    if (/\.(3gp|3gpp)(\?|$)/i.test(path)) return 'video/3gpp';
    return 'video/mp4';
  }

  if (expectedFormat === 'DOCUMENT') {
    if (lowerResponseType && lowerResponseType !== 'application/octet-stream') return lowerResponseType;
    if (/\.(pdf)(\?|$)/i.test(path)) return 'application/pdf';
    return 'application/pdf';
  }

  return lowerResponseType || 'application/octet-stream';
}

function assertTemplateMediaIsValid(mediaUrl: string, expectedFormat: string, fileSize: number, fileType: string) {
  if (!/^https?:\/\//i.test(mediaUrl)) {
    throw new Error(`A mídia do template ${expectedFormat} precisa ser uma URL pública válida.`);
  }

  if (/example\.com|maisonline\.com\.br/i.test(mediaUrl)) {
    throw new Error(`Envie uma mídia real para o template ${expectedFormat}. A Meta não aceita URL de exemplo.`);
  }

  const limits: Record<string, number> = {
    IMAGE: 5_000_000,
    VIDEO: 16_000_000,
    DOCUMENT: 100_000_000,
  };
  if (limits[expectedFormat] && fileSize > limits[expectedFormat]) {
    const mb = Math.floor(limits[expectedFormat] / 1_000_000);
    throw new Error(`Arquivo ${expectedFormat} acima do limite da Meta para template (${mb}MB).`);
  }

  if (expectedFormat === 'IMAGE' && !['image/jpeg', 'image/png'].includes(fileType)) {
    throw new Error('Imagem de template precisa ser JPG ou PNG. Converta o arquivo e tente novamente.');
  }
  if (expectedFormat === 'VIDEO' && !['video/mp4', 'video/3gpp'].includes(fileType)) {
    throw new Error('Vídeo de template precisa ser MP4 ou 3GPP. Converta para MP4 e tente novamente.');
  }
}

async function getMetaHeaderHandle(accessToken: string, appId: string, mediaUrl: string, expectedFormat = 'IMAGE') {
  try {
    console.log(`Getting Meta header handle for media: ${mediaUrl}`);
    // 1. Download the media
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) throw new Error(`Failed to download media for template: ${mediaRes.status}`);
    const arrayBuffer = await mediaRes.arrayBuffer();
    const fileSize = arrayBuffer.byteLength;
    const fileType = getTemplateMediaContentType(mediaUrl, mediaRes.headers.get('content-type') || '', expectedFormat);
    const fileName = getTemplateMediaFileName(mediaUrl, expectedFormat);

    assertTemplateMediaIsValid(mediaUrl, expectedFormat, fileSize, fileType);

    // 2. Initialize upload
    console.log(`Initializing resumable upload for ${fileName} ${fileType} (${fileSize} bytes)...`);
    const initUrl = new URL(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${appId}/uploads`);
    initUrl.searchParams.set('file_name', fileName);
    initUrl.searchParams.set('file_length', String(fileSize));
    initUrl.searchParams.set('file_type', fileType);
    initUrl.searchParams.set('access_token', accessToken);

    const initRes = await fetch(initUrl.toString(), {
      method: 'POST',
    });
    const initData = await initRes.json();
    const uploadSessionId = initData.id;

    if (!uploadSessionId) {
      console.error('Failed to initialize Meta upload session:', JSON.stringify(initData));
      throw new Error(getMetaTemplateErrorMessage(initData));
    }

    // 3. Upload the actual data
    console.log(`Uploading file data to session ${uploadSessionId}...`);
    const uploadRes = await fetch(`https://graph.facebook.com/${META_GRAPH_API_VERSION}/${uploadSessionId}`, {
      method: 'POST',
      headers: {
        'Authorization': `OAuth ${accessToken}`,
        'file_offset': '0',
        'Content-Type': fileType,
      },
      body: arrayBuffer,
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.h) {
      console.error('Failed to get handle from upload:', JSON.stringify(uploadData));
      throw new Error(getMetaTemplateErrorMessage(uploadData));
    }
    
    console.log(`Successfully generated Meta handle: ${uploadData.h}`);
    return uploadData.h;
  } catch (err) {
    console.error('Error in getMetaHeaderHandle:', err);
    throw err;
  }
}

async function downloadAndStoreMetaMedia(supabase: any, accessToken: string, mediaUrl: string, type: string, name: string) {
  try {
    console.log(`Downloading Meta media for permanent storage: ${mediaUrl}`);
    const response = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      console.error(`Failed to download Meta media: ${response.status}`);
      return null;
    }

    const blob = await response.blob();
    const ext = type === 'image' ? 'jpg' : (type === 'video' ? 'mp4' : 'bin');
    const filePath = `templates/${name}_${Date.now()}.${ext}`;

    console.log(`Uploading to Supabase storage: ${filePath}`);
    const { error: uploadError } = await supabase.storage
      .from('crm-media')
      .upload(filePath, blob, { contentType: blob.type, upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('crm-media')
      .getPublicUrl(filePath);

    const finalUrl = toPublicMediaUrl(publicUrl);
    console.log(`Permanent URL generated: ${finalUrl}`);
    return finalUrl;
  } catch (err) {
    console.error('Error in downloadAndStoreMetaMedia:', err);
    return null;
  }
}

async function resolveTemplateMediaUrl(supabase: any, accessToken: string, mediaUrl: string | null | undefined, type: string, name: string) {
  if (!mediaUrl) return null;

  // Links scontent.whatsapp.net usados como exemplo do template expiram/retornam 403 para a Meta no envio.
  // Para envio real, baixamos com token e salvamos em URL pública própria.
  if (mediaUrl.includes('scontent.whatsapp.net')) {
    return await downloadAndStoreMetaMedia(supabase, accessToken, mediaUrl, type, name) || mediaUrl;
  }

  return mediaUrl;
}

// Baixa mídia recebida via webhook (image/video/audio/sticker/document) usando media_id
// e salva em storage público para que apareça na conversa do CRM.
async function fetchAndStoreIncomingMedia(
  supabase: any,
  accessToken: string,
  mediaId: string,
  type: string,
  name: string,
  mimeHint?: string
): Promise<string | null> {
  try {
    if (!mediaId || !accessToken) return null;
    // 1) Pega URL temporária via Graph API
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!metaRes.ok) {
      console.error('[INCOMING-MEDIA] Failed to resolve media id', mediaId, metaRes.status);
      return null;
    }
    const metaJson = await metaRes.json();
    const url = metaJson?.url;
    const mimeType = metaJson?.mime_type || mimeHint || 'application/octet-stream';
    if (!url) return null;

    // 2) Baixa o binário (precisa do Bearer token)
    const binRes = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!binRes.ok) {
      console.error('[INCOMING-MEDIA] Failed to download media', mediaId, binRes.status);
      return null;
    }
    const blob = await binRes.blob();

    // 3) Determina extensão
    let ext = 'bin';
    if (type === 'image') ext = mimeType.includes('png') ? 'png' : (mimeType.includes('webp') ? 'webp' : 'jpg');
    else if (type === 'sticker') ext = mimeType.includes('webp') ? 'webp' : 'png';
    else if (type === 'video') ext = mimeType.includes('quicktime') ? 'mov' : 'mp4';
    else if (type === 'audio') ext = mimeType.includes('mpeg') ? 'mp3' : (mimeType.includes('mp4') ? 'm4a' : 'ogg');
    else if (type === 'document') {
      const m = /\/([a-zA-Z0-9]+)/.exec(mimeType);
      ext = m?.[1] || 'pdf';
    }

    const filePath = `incoming/${name}_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('crm-media')
      .upload(filePath, blob, { contentType: mimeType, upsert: true });
    if (upErr) {
      console.error('[INCOMING-MEDIA] Upload failed', upErr);
      return null;
    }
    const { data: { publicUrl } } = supabase.storage.from('crm-media').getPublicUrl(filePath);
    const finalUrl = toPublicMediaUrl(publicUrl);
    console.log('[INCOMING-MEDIA] Stored', { mediaId, type, publicUrl: finalUrl });
    return finalUrl;
  } catch (err) {
    console.error('[INCOMING-MEDIA] Unexpected error', err);
    return null;
  }
}


 serve(async (req) => {
   if (req.method === 'OPTIONS') {
     return new Response('ok', { headers: corsHeaders })
   }
 
   const url = new URL(req.url);
   const webhookIdentifier = url.searchParams.get('id');
   
   const supabase = createClient(
     Deno.env.get('SUPABASE_URL') ?? '',
     Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
   )
 
   let userId: string | null = null;
   let userSettings: any = null;
    let trustedInternalRequest = false;
 
   // Handle Meta Webhook Verification (GET)
   if (req.method === 'GET') {
     const hubMode = url.searchParams.get('hub.mode');
     const hubChallenge = url.searchParams.get('hub.challenge');
     const hubVerifyToken = url.searchParams.get('hub.verify_token');

      if (hubMode === 'subscribe' && hubVerifyToken && !webhookIdentifier) {
        if (hubVerifyToken === getGlobalWebhookVerifyToken()) {
          return new Response(hubChallenge, { status: 200 });
        }
      }
 
     if (hubMode === 'subscribe' && hubVerifyToken && webhookIdentifier) {
       const { data: settings } = await supabase
         .from('crm_settings')
         .select('user_id, meta_waba_id, meta_access_token, webhook_verify_token')
         .eq('webhook_identifier', webhookIdentifier)
         .maybeSingle();
       
       if (settings && (settings.webhook_verify_token === hubVerifyToken || !settings.webhook_verify_token)) {
         console.log('[WEBHOOK-SETUP] Hub verification success for identifier', webhookIdentifier);
         if (settings.meta_waba_id && settings.meta_access_token) {
            // Auto-subscribe the WABA to our app to ensure we receive notifications
            await ensureWabaSubscribed(settings.meta_waba_id, settings.meta_access_token);
         }
         return new Response(hubChallenge, { status: 200 });
       } else {
         console.warn('[WEBHOOK-SETUP] Hub verification failed or token mismatch', { webhookIdentifier, hubVerifyToken });
       }
     }

     return new Response('Forbidden', { status: 403 });
   }
 
   // Identify User
   if (webhookIdentifier) {
     const { data: settings } = await supabase
       .from('crm_settings')
       .select('*')
       .eq('webhook_identifier', webhookIdentifier)
       .single();
     if (settings) {
       userId = settings.user_id;
       userSettings = settings;
     }
     } else {
       const authHeader = req.headers.get('Authorization');
       if (authHeader) {
         const token = authHeader.replace('Bearer ', '');
         const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
         if (serviceRoleKey && token === serviceRoleKey) {
           trustedInternalRequest = true;
           console.log('[AUTH-DEBUG] Trusted internal request detected');
           userId = null; // Will be resolved from params if needed
         } else {
           // Em self-hosted (VPS) o GoTrue pode ficar momentaneamente indisponível.
           // Nesse caso a exceção não pode derrubar a função inteira com HTTP 500.
           try {
             const { data: { user }, error: authError } = await supabase.auth.getUser(token);
             if (user) {
               userId = user.id;
             } else if (authError) {
               console.warn('[AUTH-DEBUG] getUser failed with token:', token.slice(0, 10) + '...', authError.message);
             }
           } catch (authEx: any) {
             console.error('[AUTH-DEBUG] getUser threw:', authEx?.message || authEx);
           }
         }
       } else {
         console.log('[AUTH-DEBUG] No Authorization header present');
       }
     }
 
    try {
      const rawBody = await req.text();
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch (e) {
        console.error('[REQUEST-DEBUG] Failed to parse body as JSON:', rawBody.slice(0, 200));
        return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const { action, ...params } = body;
      
      // Somente chamadas internas autenticadas pela service role podem resolver
      // o proprietário a partir do contato (continuação assíncrona de fluxos).
      if (!userId && trustedInternalRequest && params.contactId) {
        const { data: contact } = await supabase.from('crm_contacts').select('user_id').eq('id', params.contactId).maybeSingle();
        if (contact?.user_id) {
          userId = contact.user_id;
          console.log('[AUTH-DEBUG] Resolvido userId a partir do contactId:', userId);
        }
      } else if (!userId && trustedInternalRequest && params.waId) {
        // Fallback: tentar resolver userId pelo waId (telefone) do contato
        const normalizedWaId = normalizePhone(params.waId);
        const { data: contactByWaId } = await supabase.from('crm_contacts').select('user_id').eq('wa_id', normalizedWaId).limit(1).maybeSingle();
        if (contactByWaId?.user_id) {
          userId = contactByWaId.user_id;
          console.log('[AUTH-DEBUG] Resolvido userId a partir do waId:', userId);
        }
      }
      
      // Carregar configurações se o userId estiver disponível
      let settings: any = null;
      if (userId) {
        settings = await getCrmSettings(supabase, userId);
      } else if (!action) {
        // Para webhooks, o userId é resolvido antes (userSettings)
        settings = userSettings;
      }
      
      // ---- Escopo por número de WhatsApp -------------------------------
      // O app envia `whatsapp_number_id` (número aberto na tela). Em execuções
      // internas (fluxos/agendamentos) herdamos o número do próprio contato.
      let scopedNumberId: string | null = params.whatsapp_number_id || null;
      if (!scopedNumberId && params.contactId) {
        const { data: contactNumber } = await supabase
          .from('crm_contacts')
          .select('whatsapp_number_id')
          .eq('id', params.contactId)
          .maybeSingle();
        if (contactNumber?.whatsapp_number_id) scopedNumberId = contactNumber.whatsapp_number_id;
      }
      if (scopedNumberId) {
        const numberRow = await getWhatsAppNumberById(supabase, scopedNumberId);
        if (numberRow && (!userId || numberRow.user_id === userId)) {
          if (!userId) userId = numberRow.user_id;
          if (!settings) settings = await getCrmSettings(supabase, userId);
          settings = applyNumberToSettings(settings, numberRow);
          console.log('[NUMBER] Credenciais aplicadas do número aberto', {
            number_id: scopedNumberId,
            phone_number_id: numberRow.meta_phone_number_id,
          });
        } else {
          // Número inexistente ou de outro cadastro: nunca reaproveitamos.
          console.warn('[NUMBER] whatsapp_number_id ignorado (não pertence ao usuário)', scopedNumberId);
          scopedNumberId = null;
        }
      }

      // Se ainda não temos settings mas temos um contactId, tentamos buscar pelo user_id do contato
      if (!settings && trustedInternalRequest && params.contactId) {
        const { data: contactForId } = await supabase.from('crm_contacts').select('user_id').eq('id', params.contactId).maybeSingle();
        if (contactForId?.user_id) {
           userId = contactForId.user_id;
           settings = await getCrmSettings(supabase, userId);
           console.log('[AUTH-DEBUG] Settings resolved via contact user_id:', userId);
        }
      }
      
      // LOG CRUCIAL PARA DEBUG DE FLUXOS
      console.log(`[REQUEST-DEBUG] Method: ${req.method}, Action: ${action || 'Webhook'}, AuthUID: ${userId}, HasSettings: ${!!settings}`);
      if (action === 'sendMessage') {
        console.log(`[SEND-MESSAGE-DEBUG] To: ${params.to}, Text: ${params.text?.slice(0, 30)}..., HasIDs: ${!!settings?.meta_phone_number_id}`);
      }

      if (action && !userId && !trustedInternalRequest) {
        return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
      }

      if (action === 'getCloudSettings') {
        // PERMITIR getCloudSettings mesmo sem AuthUID para debug inicial, 
        // mas o ideal é que o frontend envie o token
        if (!userId) {
          console.warn('[AUTH-DEBUG] getCloudSettings called without userId');
          // Tentativa de fallback para o primeiro usuário se for ambiente de teste
          // return new Response(...)
        }

        let error = null;
        if (!settings) {
          const { data: fetchedSettings, error: fetchError } = await supabase
            .from('crm_settings')
            .select('*')
            .eq('user_id', userId || 'fallback-id')
            .maybeSingle()
          
          settings = fetchedSettings;
          error = fetchError;
        }

       if (!settings && !error && userId) {
         const created = await supabase
           .from('crm_settings')
           .insert({ user_id: userId, webhook_identifier: crypto.randomUUID() })
           .select('*')
           .maybeSingle()
         settings = created.data
         error = created.error
       }

       if (settings?.meta_waba_id && settings?.meta_access_token) {
         await ensureMetaAppWebhookConfigured();
         await ensureWabaSubscribed(settings.meta_waba_id, settings.meta_access_token);
       }

       return new Response(JSON.stringify({ success: !error, settings, error: error?.message || null }), {
         status: error ? 500 : 200,
         headers: { ...corsHeaders, 'Content-Type': 'application/json' },
       })
     }

     if (action === 'repairMetaWebhook') {
       if (!userId) {
         return new Response(JSON.stringify({ success: false, error: 'Usuário não autenticado' }), {
           status: 401,
           headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         })
       }

       const settings = await getCrmSettings(supabase, userId);
       if (!settings?.meta_waba_id || !settings?.meta_access_token) {
         return jsonResponse({ success: false, error: 'WhatsApp conectado não encontrado para este usuário' }, 400);
       }

       const appWebhook = await ensureMetaAppWebhookConfigured();
       const wabaSubscription = await ensureWabaSubscribed(settings.meta_waba_id, settings.meta_access_token);
       const success = !!appWebhook.success && !!wabaSubscription.success;
       const repairError = success ? null : getWebhookRepairError(appWebhook, wabaSubscription);

       return jsonResponse({
         success,
         error: repairError?.error || null,
         requiresReconnect: repairError?.requiresReconnect || false,
         appWebhook,
         wabaSubscription,
       }, 200);
     }

      if (!action && body.object === 'whatsapp_business_account' && !userSettings) {
        const value = body?.entry?.[0]?.changes?.[0]?.value || {};
        const webhookPhoneNumberId = value?.metadata?.phone_number_id;
        const webhookWabaId = body?.entry?.[0]?.id;
        // Primeiro tentamos o número exato que recebeu a mensagem: com dois
        // números no mesmo cadastro, `crm_settings` guarda só um deles e a
        // conversa do outro acabava sem dono (ou misturada).
        const inboundNumber = await getWhatsAppNumberByPhoneId(
          supabase,
          webhookPhoneNumberId,
          webhookWabaId,
        );
        if (inboundNumber?.user_id) {
          userId = inboundNumber.user_id;
          const baseSettings = await getCrmSettings(supabase, userId);
          userSettings = applyNumberToSettings(baseSettings, inboundNumber) || baseSettings;
          console.log('[WEBHOOK] Número de entrada resolvido', {
            user_id: userId,
            number_id: inboundNumber.id,
            phone_number_id: inboundNumber.meta_phone_number_id,
          });
        }
        if (!userSettings && (webhookPhoneNumberId || webhookWabaId)) {
          const settingsQuery = supabase
            .from('crm_settings')
            .select('*')
            .order('updated_at', { ascending: false, nullsFirst: false })
            .limit(1);
          const { data: settingsRows, error: resolveError } = webhookPhoneNumberId
            ? await settingsQuery.eq('meta_phone_number_id', webhookPhoneNumberId)
            : await settingsQuery.eq('meta_waba_id', webhookWabaId);
          if (resolveError) console.warn('[WEBHOOK] Could not resolve settings from Meta payload', resolveError);
          const resolvedSettings = Array.isArray(settingsRows) ? settingsRows[0] : null;
          if (resolvedSettings) {
            userId = resolvedSettings.user_id;
            userSettings = resolvedSettings;
            console.log('[WEBHOOK] Resolved CRM settings from Meta payload', { user_id: userId, phone_number_id: webhookPhoneNumberId || null, waba_id: webhookWabaId || null });
          }
        }
      }
 
     // Handle Meta POST (Webhook Events)
     if (!action && body.object === 'whatsapp_business_account' && userSettings) {
       return await handleProcessWebhook(supabase, body.entry, false, userId);
     }
      if (!action && body.object === 'whatsapp_business_account') {
        return await handleProcessWebhook(supabase, body.entry, false, userId || undefined);
      }
      if (!action && Array.isArray(body.entry)) {
        return await handleProcessWebhook(supabase, body.entry, false, userId || undefined);
      }
    if (action === 'processScheduled') {
      console.log(`[BACKGROUND-LOG] Background processing for action: ${action}`);
      const now = new Date().toISOString();
      
      // Buscar apenas contatos REALMENTE elegíveis (timeout pronto OU delay pronto)
      // Evita que o limite de 50 contatos "presos" em waiting_response indefinido
      // bloqueie a execução de um timeout que já venceu.
      const nowDate = new Date();
      const [waitingRes, delayRes] = await Promise.all([
        supabase
          .from('crm_contacts')
          .select('id, wa_id, user_id, current_flow_id, current_node_id, flow_timeout_minutes, flow_timeout_node_id, last_flow_interaction, flow_state, next_execution_time, last_message_received_at')
          .eq('flow_state', 'waiting_response')
          .not('current_flow_id', 'is', null)
          .limit(500),
        supabase
          .from('crm_contacts')
          .select('id, wa_id, user_id, current_flow_id, current_node_id, flow_timeout_minutes, flow_timeout_node_id, last_flow_interaction, flow_state, next_execution_time, last_message_received_at')
          .neq('flow_state', 'idle')
          .neq('flow_state', 'waiting_response')
          .not('next_execution_time', 'is', null)
          .lte('next_execution_time', now)
          .limit(200),
      ]);

      if (waitingRes.error) throw waitingRes.error;
      if (delayRes.error) throw delayRes.error;

      const contactsToProcess = [...(waitingRes.data || []), ...(delayRes.data || [])];
      const results: any[] = [];
      const flowCache = new Map<string, any>();
      if (contactsToProcess.length > 0) {
        for (const contact of contactsToProcess) {
          // 1. Process Timeout (se aplicável)
          if (contact.flow_state === 'waiting_response') {
            let effectiveTimeoutNodeId = contact.flow_timeout_node_id;
            let effectiveTimeoutMinutes = Number(contact.flow_timeout_minutes);
            let flowForTimeout: any = null;

            // Compatibilidade/auto-correção: alguns contatos antigos ficaram parados
            // no nó de pergunta anterior ao bloco "Aguardar Resposta", com
            // flow_timeout_* nulo. Se esse nó aponta para um waitResponse, usamos o
            // tempo e a saída "timeout" configurados nele, sem reiniciar o relógio.
            if ((!effectiveTimeoutNodeId || !effectiveTimeoutMinutes || effectiveTimeoutMinutes <= 0) && contact.current_flow_id) {
              if (!flowCache.has(contact.current_flow_id)) {
                const { data: cachedFlow } = await supabase
                  .from('crm_flows')
                  .select('*')
                  .eq('id', contact.current_flow_id)
                  .eq('user_id', contact.user_id)
                  .maybeSingle();
                flowCache.set(contact.current_flow_id, cachedFlow || null);
              }
              flowForTimeout = flowCache.get(contact.current_flow_id);
              const currentNode = flowForTimeout?.nodes?.find((n: any) => n.id === contact.current_node_id);
              const currentIsWait = currentNode?.type === 'waitResponse' || currentNode?.type === 'wait_response';
              const linkedWaitEdge = !currentIsWait
                ? (flowForTimeout?.edges || []).find((e: any) => {
                    if (e.source !== contact.current_node_id) return false;
                    const handle = e.sourceHandle;
                    if (handle && handle !== 'any_response' && handle !== 'responded' && handle !== 'next') return false;
                    const targetNode = flowForTimeout?.nodes?.find((n: any) => n.id === e.target);
                    return targetNode?.type === 'waitResponse' || targetNode?.type === 'wait_response';
                  })
                : null;
              const waitNode = currentIsWait
                ? currentNode
                : (linkedWaitEdge ? flowForTimeout?.nodes?.find((n: any) => n.id === linkedWaitEdge.target) : null);
              const timeoutEdge = waitNode
                ? (flowForTimeout?.edges || []).find((e: any) => e.source === waitNode.id && e.sourceHandle === 'timeout')
                : null;
              const configuredMinutes = Number(waitNode?.data?.timeout);

              if (timeoutEdge?.target && Number.isFinite(configuredMinutes) && configuredMinutes > 0) {
                effectiveTimeoutNodeId = timeoutEdge.target;
                effectiveTimeoutMinutes = configuredMinutes;
                await supabase.from('crm_contacts').update({
                  current_node_id: waitNode.id,
                  flow_timeout_minutes: effectiveTimeoutMinutes,
                  flow_timeout_node_id: effectiveTimeoutNodeId,
                  next_execution_time: null,
                }).eq('id', contact.id).eq('flow_state', 'waiting_response');
                console.log(`[TIMEOUT-REPAIRED] Contact ${contact.wa_id}: using wait node ${waitNode.id}, ${effectiveTimeoutMinutes}min -> ${effectiveTimeoutNodeId}`);
              }
            }

            // Se o fluxo não tem um nó de timeout configurado, aguarda indefinidamente
            // pela resposta do cliente (sem expirar/cair sozinho).
            if (!effectiveTimeoutNodeId || !effectiveTimeoutMinutes || effectiveTimeoutMinutes <= 0) {
              continue;
            }
            const lastInteractionRaw = contact.last_flow_interaction || new Date().toISOString();
            const lastInteraction = new Date(lastInteractionRaw);
            const timeoutThreshold = new Date(lastInteraction.getTime() + effectiveTimeoutMinutes * 60000);

            if (nowDate >= timeoutThreshold) {
              // === Verificação da janela de 24h do WhatsApp ===
              // Se a última mensagem recebida do cliente está fora da janela de 24h,
              // cancelamos o fluxo inteiro (não conseguiríamos enviar mensagem livre).
              const lastUserMsgRaw = (contact as any).last_message_received_at;
              if (lastUserMsgRaw) {
                const lastUserMsg = new Date(lastUserMsgRaw);
                const hoursSince = (nowDate.getTime() - lastUserMsg.getTime()) / (1000 * 60 * 60);
                if (hoursSince >= 24) {
                  console.log(`[TIMEOUT-24H-EXPIRED] Contact ${contact.wa_id}: janela de 24h expirou (${hoursSince.toFixed(1)}h). Cancelando fluxo.`);
                  await supabase.from('crm_contacts').update({
                    flow_state: 'idle',
                    current_flow_id: null,
                    current_node_id: null,
                    flow_timeout_minutes: null,
                    flow_timeout_node_id: null,
                    next_execution_time: null,
                  }).eq('id', contact.id).eq('flow_state', 'waiting_response');
                  continue;
                }
              }

              console.log(`[TIMEOUT-EXPIRED] Contact ${contact.wa_id} timed out.`);
              // Tenta atualizar de forma atômica para evitar duplicidade
              const { data: updated } = await supabase.from('crm_contacts').update({ 
                flow_state: 'running',
                current_node_id: effectiveTimeoutNodeId,
                next_execution_time: null,
                flow_timeout_minutes: null,
                flow_timeout_node_id: null
              }).eq('id', contact.id).eq('flow_state', 'waiting_response').select();

               if (updated && updated.length > 0) {
                 const flow = flowForTimeout || (flowCache.has(contact.current_flow_id)
                   ? flowCache.get(contact.current_flow_id)
                   : (await supabase.from('crm_flows').select('*').eq('id', contact.current_flow_id).eq('user_id', contact.user_id).single()).data);
                 const nextNode = flow?.nodes?.find((n: any) => n.id === effectiveTimeoutNodeId);
                 if (nextNode) {
                   const res = await executeVisualNode(supabase, flow, nextNode, contact.id, contact.wa_id);
                   results.push({ contactId: contact.id, result: res });
                 }
               }
            }
            continue; // Importante: se era waiting_response, já processamos (ou ignoramos se ainda estiver esperando)
          }

          // 2. Process Scheduled Delays
          if (contact.next_execution_time && new Date(contact.next_execution_time) <= new Date()) {
            console.log(`[DELAY-READY] Contato ${contact.wa_id} pronto para execução.`);
            
            // Tenta atualizar de forma atômica para garantir que APENAS UM processo execute este nó
            const { data: updated, error: updateError } = await supabase.from('crm_contacts').update({ 
              next_execution_time: null,
              flow_state: 'running'
            })
            .eq('id', contact.id)
            .eq('next_execution_time', contact.next_execution_time) // Garante atomicidade baseada no timestamp exato
            .select();

            if (updateError || !updated || updated.length === 0) {
               console.log(`[DUPLICATION-PREVENTED] Contact ${contact.wa_id} already being processed.`);
               continue;
            }

            const { data: flow } = await supabase.from('crm_flows').select('*').eq('id', contact.current_flow_id).single();
            const currentNode = flow?.nodes?.find((n: any) => n.id === contact.current_node_id);
            
            if (flow && currentNode) {
              const res: any = await executeVisualNode(supabase, flow, currentNode, contact.id, contact.wa_id);
              results.push({ contactId: contact.id, result: res });

              // Se o nó executado foi um Agente IA, processamos a resposta imediatamente
                if (res?.message?.includes('AI handling state')) {
                console.log(`[SCHEDULED] Node resulted in AI handling state. Triggering AI response for ${contact.wa_id}`);
                // Re-fetch contact to get updated flow_state and metadata from executeVisualNode
                const { data: updatedContact } = await supabase.from('crm_contacts').select('*').eq('id', contact.id).single();
                 if (updatedContact) {
                     // Adicionamos um pequeno delay para garantir que a mensagem de abertura foi entregue antes da IA responder
                     await new Promise(r => setTimeout(r, 2000));
                     await processAiAgentResponse(supabase, updatedContact, contact.wa_id, undefined, undefined, contact.user_id, (contact as any).whatsapp_number_id || null);
                 }
              }
            } else {
              await supabase.from('crm_contacts').update({ flow_state: 'idle' }).eq('id', contact.id);
            }
          }
        }
      }

      // Auto-push named CRM contacts to Google for every user with a connected account.
      // Fire-and-forget so cron stays fast and never blocks flow processing.
      try {
        // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
        if (typeof EdgeRuntime !== 'undefined' && (EdgeRuntime as any).waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(autoPushGoogleContactsForAllUsers(supabase));
        } else {
          autoPushGoogleContactsForAllUsers(supabase).catch(() => {});
        }
      } catch (_) { /* ignore */ }

      let countdownResult = null;
      try {
        countdownResult = await processCountdownTriggers(supabase);
      } catch (countdownError) {
        console.error('[COUNTDOWN] processScheduled failed:', countdownError);
      }

      return jsonResponse({ success: true, processed: results.length, countdown: countdownResult });
    }

    if (action === 'updateSettings') {
      const { ...newSettings } = params
      const query = supabase
        .from('crm_settings')
        .update({ ...newSettings, updated_at: new Date().toISOString() })
      const { error } = userId
        ? await query.eq('user_id', userId)
        : await query.eq('id', '00000000-0000-0000-0000-000000000001')
      
      return new Response(JSON.stringify({ success: !error, error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Exchange Embedded Signup auth code for a business-scoped access token
    // and persist WABA/Phone IDs returned by the FB SDK callback.
    if (action === 'exchangeEmbeddedSignupCode') {
      try {
        const { code, waba_id, phone_number_id, business_id, signup_event } = params || {}
        const APP_ID = Deno.env.get('FACEBOOK_APP_ID')
        const APP_SECRET = Deno.env.get('FACEBOOK_APP_SECRET')
        console.log('[Embedded Signup] exchange started', {
          has_code: !!code,
          waba_id: waba_id || null,
          phone_number_id: phone_number_id || null,
          business_id: business_id || null,
          signup_event: signup_event || null,
          user_id: userId || null,
        })
        if (!code) throw new Error('Missing code')
        if (!APP_ID || !APP_SECRET) throw new Error('FACEBOOK_APP_ID / FACEBOOK_APP_SECRET not configured')

        // 1) Trocar code por access_token (business-scoped, long-lived)
        const tokenUrl = `https://graph.facebook.com/v25.0/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&code=${encodeURIComponent(code)}`
        const tokenRes = await fetch(tokenUrl)
        const tokenJson = await tokenRes.json()
        console.log('[Embedded Signup] token exchange response', { ok: tokenRes.ok, status: tokenRes.status, has_access_token: !!tokenJson?.access_token, error: tokenJson?.error?.message || null })
        if (!tokenRes.ok || !tokenJson.access_token) {
          console.error('Token exchange failed:', tokenJson)
          return new Response(JSON.stringify({ success: false, error: tokenJson?.error?.message || 'Token exchange failed', details: tokenJson }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        const access_token = tokenJson.access_token as string
        let resolvedPhoneNumberId = phone_number_id
        let resolvedDisplayPhone: string | null = null
        let resolvedVerifiedName: string | null = null

        // Alguns fluxos v4 retornam apenas o WABA no postMessage. Quando isso acontecer,
        // buscamos o primeiro número conectado para liberar o CRM sem preenchimento manual.
        if (waba_id) {
          try {
            const phonesRes = await fetch(`https://graph.facebook.com/v25.0/${waba_id}/phone_numbers?fields=id,display_phone_number,verified_name`, {
              headers: { 'Authorization': `Bearer ${access_token}` }
            })
            const phonesJson = await phonesRes.json().catch(() => ({}))
            console.log('[Embedded Signup] phone lookup response', { ok: phonesRes.ok, status: phonesRes.status, count: Array.isArray(phonesJson?.data) ? phonesJson.data.length : 0, error: phonesJson?.error?.message || null })
            if (phonesRes.ok && Array.isArray(phonesJson?.data) && phonesJson.data.length > 0) {
              const match = phonesJson.data.find((p: any) => p.id === resolvedPhoneNumberId) || phonesJson.data[0]
              if (!resolvedPhoneNumberId) resolvedPhoneNumberId = match.id
              resolvedDisplayPhone = match.display_phone_number || null
              resolvedVerifiedName = match.verified_name || null
              console.log('[Embedded Signup] resolved phone', { id: resolvedPhoneNumberId, display: resolvedDisplayPhone, verified_name: resolvedVerifiedName })
            } else {
              console.warn('Could not resolve phone from WABA:', phonesJson)
            }
          } catch (e) { console.warn('phone_numbers lookup failed', e) }
        }

        // 2) Subscrever o app à WABA (necessário para receber webhooks)
        await ensureMetaAppWebhookConfigured()
        if (waba_id) {
          await ensureWabaSubscribed(waba_id, access_token)
        }

        // 3) Registrar phone number na Cloud API apenas no fluxo padrão.
        // No Coexistence (WhatsApp Business app onboarding) a Meta já registra o número.
        if (resolvedPhoneNumberId && signup_event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
          try {
            const registerRes = await fetch(`https://graph.facebook.com/v25.0/${resolvedPhoneNumberId}/register`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', pin: '000000' })
            })
            const registerJson = await registerRes.json().catch(() => ({}))
            console.log('[Embedded Signup] phone register response', { ok: registerRes.ok, status: registerRes.status, success: registerJson?.success || null, error: registerJson?.error?.message || null })
          } catch (e) { console.warn('register phone failed', e) }
        }

        // 4) Persistir nas configurações
        const patch: any = { meta_access_token: access_token }
        if (waba_id) patch.meta_waba_id = waba_id
        if (resolvedPhoneNumberId) patch.meta_phone_number_id = resolvedPhoneNumberId
        if (resolvedDisplayPhone) patch.meta_display_phone_number = resolvedDisplayPhone
        if (resolvedVerifiedName) patch.meta_verified_name = resolvedVerifiedName
        // business_id é informativo (não há coluna dedicada)

        let updErr: any = null
        if (userId) {
          // Atualiza primeiro pelo id existente. Isso mantém o OAuth funcional
          // até mesmo durante rollout em uma VPS que ainda não aplicou a UNIQUE
          // de user_id; a migração 085 garante a unicidade para os próximos
          // upserts e elimina registros legados duplicados.
          const { data: existingSettings, error: lookupErr } = await supabase
            .from('crm_settings')
            .select('id, webhook_identifier')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (lookupErr) {
            updErr = lookupErr
          } else if (existingSettings?.id) {
            const result = await supabase
              .from('crm_settings')
              .update({
                ...patch,
                webhook_identifier: existingSettings.webhook_identifier || crypto.randomUUID(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingSettings.id)
              .eq('user_id', userId)
            updErr = result.error
          } else {
            const result = await supabase
              .from('crm_settings')
              .insert({
                ...patch,
                user_id: userId,
                webhook_identifier: crypto.randomUUID(),
                updated_at: new Date().toISOString(),
              })
            updErr = result.error
          }
          console.log('[Embedded Signup] settings upsert result', { ok: !updErr, error: updErr?.message || null, user_id: userId })
        } else {
          const result = await supabase
            .from('crm_settings')
            .update(patch)
            .eq('id', '00000000-0000-0000-0000-000000000001')
          updErr = result.error
          console.log('[Embedded Signup] legacy settings update result', { ok: !updErr, error: updErr?.message || null })
        }

        return new Response(JSON.stringify({ success: !updErr, error: updErr?.message, access_token_preview: access_token.slice(0, 12) + '...', waba_id, phone_number_id: resolvedPhoneNumberId, display_phone_number: resolvedDisplayPhone, verified_name: resolvedVerifiedName, business_id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (e: any) {
        console.error('exchangeEmbeddedSignupCode error', e)
        return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Get Meta Settings (already resolved at the top, but ensure we have it)
    if (!settings && userId) {
      settings = await getCrmSettings(supabase, userId);
    }
    console.log(`[SETTINGS-DEBUG] userId: ${userId}, hasSettings: ${!!settings}, meta_phone_number_id: ${settings?.meta_phone_number_id}`);

    const meta_access_token = settings?.meta_access_token;
    const meta_phone_number_id = settings?.meta_phone_number_id;

    if (action === 'getTemplates') {
      if (!meta_access_token) throw new Error('Meta API credentials not configured');
      const { meta_waba_id } = settings
      console.log(`Fetching templates for WABA ${meta_waba_id}...`);
      
      let data: any = { data: [] };
      let retryCount = 0;
      const maxRetries = 3;
      let lastError = null;

      while (retryCount < maxRetries) {
        try {
          const response = await fetch(
            `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${meta_waba_id}/message_templates?limit=500`, // Reduced limit to be safer
            {
              headers: { 'Authorization': `Bearer ${meta_access_token}` },
            }
          )
          
          if (!response.ok) {
            const errorData = await response.json();
            console.error('Meta API Error fetching templates:', errorData);
            throw new Error(`Meta API error: ${errorData.error?.message || response.statusText}`);
          }
          
          data = await response.json();
          break; // Success
        } catch (err: any) {
          retryCount++;
          lastError = err;
          console.warn(`Attempt ${retryCount} failed to fetch templates: ${err.message}. Retrying in 2s...`);
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      if (retryCount === maxRetries && !data.data?.length && lastError) {
        throw lastError;
      }
      
      if (data.data) {
        console.log(`Found ${data.data.length} templates on Meta.`);
        const metaTemplateIds = data.data.map((t: any) => t.id);
        
        for (const template of data.data) {
          // Process components to find and store media permanently
          const processedComponents = [...(template.components || [])];
          for (const component of processedComponents) {
            if (component.type === 'HEADER' && (component.format === 'IMAGE' || component.format === 'VIDEO')) {
              const mediaUrl = component.example?.header_handle?.[0];
              if (mediaUrl && mediaUrl.includes('scontent.whatsapp.net')) {
                console.log(`Storing template media permanently: ${template.name} - ${component.format}`);
                try {
                  const permanentUrl = await downloadAndStoreMetaMedia(supabase, meta_access_token, mediaUrl, component.format.toLowerCase(), `${template.name}_header`);
                  if (permanentUrl) {
                    component.example.header_handle = [permanentUrl];
                  }
                } catch (mediaErr) {
                  console.error(`Error storing media for template ${template.name}:`, mediaErr);
                }
              }
            }
            if (component.type === 'CAROUSEL' && component.cards) {
              for (const [cardIdx, card] of component.cards.entries()) {
                const headerComp = card.components?.find((c: any) => c.type === 'HEADER');
                if (headerComp && (headerComp.format === 'IMAGE' || headerComp.format === 'VIDEO')) {
                  const mediaUrl = headerComp.example?.header_handle?.[0];
                  if (mediaUrl && mediaUrl.includes('scontent.whatsapp.net')) {
                    const permanentUrl = await downloadAndStoreMetaMedia(supabase, meta_access_token, mediaUrl, headerComp.format.toLowerCase(), `${template.name}_carousel_${cardIdx}`);
                    if (permanentUrl) headerComp.example.header_handle = [permanentUrl];
                  }
                }
              }
            }
          }

          const { data: existingTemplate } = await supabase
            .from('crm_templates')
            .select('category, status')
            .eq('id', template.id)
            .eq('user_id', userId)
            .maybeSingle();

          const metaStatus = String(template.status || '').toUpperCase();
          const shouldTrustMetaCategory = metaStatus === 'APPROVED';
          const categoryToStore = shouldTrustMetaCategory || !existingTemplate?.category
            ? template.category
            : existingTemplate.category;

          if (existingTemplate?.category && existingTemplate.category !== template.category) {
            console.warn('[TEMPLATE-CATEGORY-SYNC]', {
              template_id: template.id,
              template_name: template.name,
              local_category_before_sync: existingTemplate.category,
              meta_category_returned: template.category,
              local_status_before_sync: existingTemplate.status || null,
              meta_status_returned: template.status || null,
              source: 'meta_getTemplates',
              action: shouldTrustMetaCategory ? 'APPROVED_UPDATING_TO_META_CATEGORY' : 'PENDING_KEEPING_LOCAL_CATEGORY',
            });
          }

          // Enquanto a Meta ainda está revisando, mantemos a categoria escolhida
          // pelo usuário (ex.: UTILITY). Só após APPROVED a Meta vira fonte de
          // verdade, pois aí a reclassificação final já foi concluída.

          await supabase.from('crm_templates').upsert({
            id: template.id,
            name: template.name,
            category: categoryToStore,
            language: template.language,
            status: template.status,
            components: processedComponents,
            user_id: userId,
            updated_at: new Date().toISOString()
          })
        }
        
        // Remove local templates that are no longer on Meta
        if (metaTemplateIds.length > 0) {
          await supabase.from('crm_templates').delete().eq('user_id', userId).not('id', 'in', metaTemplateIds)
        }
      }
      
      return new Response(JSON.stringify({ success: true, templates: data.data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'createTemplate') {
      const { meta_waba_id } = settings
      const { name, category, language, components, contactId, waId } = params;
      
      // Auto-save contact to Google if enabled
      if (action === 'sendMessage' || action === 'sendTemplate') {
        // Logic to sync back would go here, but focusing on the requested parts first
      }

      const requestedCategory = firstNonEmptyString(category).toUpperCase();
      validateTemplateForMeta(name, requestedCategory, language, components);
      console.log('[TEMPLATE-CATEGORY-CREATE-REQUEST]', {
        template_name: name,
        requested_category: requestedCategory,
        original_category_value: category,
        allow_category_change: false,
      });

      console.log(`Creating template ${name}...`);

      // --- PRE-CHECK: a Meta trava a categoria por NOME de template.
      // Se já existe qualquer idioma desse nome com outra categoria, o POST falha
      // com "category does not match". Consultamos antes e logamos o estado real.
      let existingTemplateCategories: string[] = [];
      try {
        const preRes = await fetch(
          `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${meta_waba_id}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,language,category,status&limit=50`,
          { headers: { 'Authorization': `Bearer ${meta_access_token}` } }
        );
        const preData = await preRes.json();
        console.log('[TEMPLATE-PRECHECK-META]', JSON.stringify({
          http_status: preRes.status,
          template_name: name,
          requested_category: requestedCategory,
          existing: (preData?.data || []).map((t: any) => ({
            id: t?.id, name: t?.name, language: t?.language, category: t?.category, status: t?.status,
          })),
          error: preData?.error || null,
        }, null, 2));
        existingTemplateCategories = [...new Set(
          (preData?.data || [])
            .filter((t: any) => String(t?.name) === String(name))
            .map((t: any) => String(t?.category || '').toUpperCase())
            .filter(Boolean)
        )] as string[];
      } catch (preErr) {
        console.warn('[TEMPLATE-PRECHECK-FAILED]', String(preErr));
      }

      const conflictingCategory = existingTemplateCategories.find((c) => c !== requestedCategory);
      if (conflictingCategory) {
        const suggestion = `${String(name).slice(0, 500)}_${requestedCategory.toLowerCase().slice(0, 4)}2`;
        console.error('[TEMPLATE-CATEGORY-CONFLICT]', {
          template_name: name,
          requested_category: requestedCategory,
          existing_categories: existingTemplateCategories,
          suggested_name: suggestion,
        });
        return new Response(JSON.stringify({
          success: false,
          error: `O nome "${name}" já existe na sua conta Meta com a categoria ${conflictingCategory}. A Meta não permite trocar a categoria de um nome já usado (nem depois de excluir, por ~4 semanas). Use outro nome, por exemplo: "${suggestion}".`,
          details: { existing_categories: existingTemplateCategories, suggested_name: suggestion },
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }


      // 1. Process components to get Meta handles for media examples
      const processedComponents = [...components];
      
      let appId = settings.meta_app_id;
      if (!appId && meta_access_token) {
        console.log('App ID not found in settings, attempting to debug token...');
        appId = await getAppId(meta_access_token);
      }
      if (!appId) {
        appId = Deno.env.get('FACEBOOK_APP_ID') || null;
        if (appId) console.log('Using FACEBOOK_APP_ID env fallback for media upload:', appId);
      }

      for (const component of processedComponents) {
        // Handle standard Header media
        if (component.type === 'HEADER' && (component.format === 'IMAGE' || component.format === 'VIDEO' || component.format === 'DOCUMENT')) {
          const mediaUrl = component.example?.header_handle?.[0];
          
          if (mediaUrl && (mediaUrl.startsWith('http') || mediaUrl.startsWith('https'))) {
            console.log(`Processing media header example for ${name}...`);
            if (appId) {
              const handle = await getMetaHeaderHandle(meta_access_token, appId, mediaUrl, component.format);
              if (handle) {
                console.log(`Generated Meta handle for ${name}: ${handle}`);
                component.example.header_handle = [handle];
              } else {
                throw new Error(`Falha ao gerar handle Meta para o cabeçalho ${component.format}. Verifique se a URL da mídia é acessível publicamente e tente novamente.`);
              }
            } else {
              throw new Error('Meta App ID não encontrado. Configure meta_app_id em crm_settings ou defina a secret FACEBOOK_APP_ID.');
            }
          } else {
            throw new Error(`Cabeçalho ${component.format} exige que você faça upload de uma mídia antes de enviar o template.`);
          }
        }
        
        // Handle Carousel cards media
        if (component.type === 'CAROUSEL' && component.cards) {
          console.log(`Processing carousel cards for ${name}...`);
          for (const card of component.cards) {
            const headerComp = card.components?.find((c: any) => c.type === 'HEADER');
            if (headerComp && (headerComp.format === 'IMAGE' || headerComp.format === 'VIDEO')) {
              const mediaUrl = headerComp.example?.header_handle?.[0];
              if (mediaUrl && (mediaUrl.startsWith('http') || mediaUrl.startsWith('https'))) {
                console.log(`Processing carousel card media (${headerComp.format}) example for ${name}...`);
                if (appId) {
                  const handle = await getMetaHeaderHandle(meta_access_token, appId, mediaUrl, headerComp.format);
                  if (handle) {
                    console.log(`Generated Meta handle for carousel card: ${handle}`);
                    headerComp.example.header_handle = [handle];
                  } else {
                    throw new Error(`Falha ao gerar handle Meta para o cartão do carrossel (${headerComp.format}). Verifique a URL da mídia.`);
                  }
                } else {
                  throw new Error('Meta App ID não encontrado para upload de mídia do carrossel.');
                }
              } else {
                throw new Error(`Cada cartão do carrossel exige upload de uma mídia ${headerComp.format} antes de enviar.`);
              }
            }
          }
        }
      }
      
      const createTemplatePayload = {
        name,
        category: requestedCategory,
        language,
        components: processedComponents,
        // Impede a Meta de reclassificar automaticamente (ex.: UTILITY -> MARKETING).
        // Se a Meta julgar que a categoria está incorreta, a aprovação será negada
        // em vez de mudar a categoria sem avisar.
        allow_category_change: false,
      };

      console.log('[TEMPLATE-CATEGORY-META-PAYLOAD]', {
        template_name: name,
        category_sent_to_meta: createTemplatePayload.category,
        allow_category_change_sent_to_meta: createTemplatePayload.allow_category_change,
      });

      let response = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${meta_waba_id}/message_templates`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${meta_access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createTemplatePayload),
        }
      )

      let result = await response.json()

      // Fallback: nome em janela de exclusão (4 semanas). Tenta novamente com sufixo único.
      // error_subcode 2388023 = "Message template language is being deleted"
      if (!response.ok && result?.error?.error_subcode === 2388023) {
        const suffix = `_v${Date.now().toString(36).slice(-5)}`;
        const retryName = `${String(name).slice(0, 512 - suffix.length)}${suffix}`;
        console.warn('[TEMPLATE-RETRY-LANG-DELETING]', { original: name, retryName });
        const retryPayload = { ...createTemplatePayload, name: retryName };
        response = await fetch(
          `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${meta_waba_id}/message_templates`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${meta_access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(retryPayload),
          }
        );
        result = await response.json();
        if (response.ok) {
          result.__renamed_from = name;
          result.__renamed_to = retryName;
          console.log('[TEMPLATE-RETRY-OK]', { original: name, retryName });
        }
      }

      if (!response.ok) {
        console.error('[TEMPLATE-CREATE-META-ERROR]', JSON.stringify({
          http_status: response.status,
          template_name: name,
          requested_category: requestedCategory,
          language,
          payload_sent: { ...createTemplatePayload, components: processedComponents },
          meta_error: result?.error || result,
        }, null, 2));
        let friendly = getMetaTemplateErrorMessage(result);
        if (result?.error?.error_subcode === 2388023) {
          friendly = 'A Meta está bloqueando este nome de template porque o anterior (mesmo nome em pt_BR) ainda está em janela de exclusão (~4 semanas). Tente um nome diferente, ex.: adicione "_v2" ao final.';
        }
        const rawMsg = `${result?.error?.error_user_msg || ''} ${result?.error?.message || ''} ${result?.error?.error_user_title || ''}`.toLowerCase();
        if (rawMsg.includes('categor')) {
          const suggestion = `${String(name).slice(0, 500)}_${requestedCategory.toLowerCase().slice(0, 4)}2`;
          friendly = `A Meta trava a categoria pelo NOME do template. O nome "${name}" já está registrado com outra categoria, então não é possível recriá-lo como ${requestedCategory}. Crie com um nome novo, por exemplo: "${suggestion}". (Meta: ${result?.error?.fbtrace_id || 'sem trace'})`;
        }

        return new Response(JSON.stringify({
          success: false,
          error: friendly,
          details: result,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      
      console.log('[TEMPLATE-CATEGORY-META-RESPONSE]', {
        template_name: name,
        requested_category: requestedCategory,
        meta_response_category: result?.category || null,
        meta_response_status: result?.status || null,
        meta_template_id: result?.id || null,
      });

      if (result.id) {
        const { is_pix, pix_code, is_carousel } = params;
        await supabase.from('crm_templates').upsert({
          id: result.id,
          name,
          category: requestedCategory,
          language,
          status: 'PENDING',
          components: processedComponents,
          user_id: userId,
          is_pix: is_pix || false,
          pix_code: pix_code || null,
          is_carousel: is_carousel || false,
          updated_at: new Date().toISOString()
        })
      }
      
      return new Response(JSON.stringify({ success: true, result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'deleteTemplate') {
      const { meta_waba_id } = settings
      const { name } = params
      
      console.log(`Deleting template ${name} from Meta WABA ${meta_waba_id}...`);
      
      const response = await fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${meta_waba_id}/message_templates?name=${encodeURIComponent(name)}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${meta_access_token}` },
        }
      )
      
      const result = await response.json()
      console.log('Meta Deletion Result:', JSON.stringify(result));
      
      // Even if Meta returns an error (like template not found), we should allow deleting it locally
      // if it's no longer on Meta or if there's a mismatch.
      // Meta returns { success: true } on success.
      
      // Logic to check both success and specific Meta error codes for "not found"
      const isDeletedOrNotFound = result.success || 
                                 (result.error && (
                                   result.error.code === 100 || 
                                   result.error.error_subcode === 2388044 ||
                                   result.error.message?.includes('does not exist')
                                 ));

      if (isDeletedOrNotFound) {
        console.log(`Template ${name} confirmed deleted from Meta or not found. Removing from local database...`);
        const { error: dbError } = await supabase.from('crm_templates').delete().eq('name', name).eq('user_id', userId);
        if (dbError) console.error('Local DB Deletion Error:', dbError);
      } else if (result.error) {
        // If there's an error and it's NOT a "not found" error, we shouldn't delete locally yet
        // but the user wants it gone, so we force local deletion if Meta fails for other reasons
        // to keep UI in sync, but log it.
        console.warn(`Meta deletion failed for ${name}, but forcing local deletion as requested:`, result.error);
        await supabase.from('crm_templates').delete().eq('name', name).eq('user_id', userId);
      }
      
      return new Response(JSON.stringify({ 
        success: true, // Return success true to frontend so it updates UI
        meta_result: result 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'sendTemplate') {
      const { to, templateName, languageCode } = params
      let manualComponents: any[] | undefined = Array.isArray(params.components) ? params.components : undefined;
      const normalizedTo = normalizePhone(to);
      const variants = getBrazilianPhoneVariants(normalizedTo);

      // Multi-número: o template pertence à caixa que está enviando.
      const templatePhoneNumberId =
        meta_phone_number_id || settings?.meta_phone_number_id || params.meta_phone_number_id;
      let templateNumberId: string | null = scopedNumberId;
      if (!templateNumberId && templatePhoneNumberId) {
        const numberRowForTemplate = await getWhatsAppNumberByPhoneId(supabase, templatePhoneNumberId);
        if (numberRowForTemplate && (!userId || numberRowForTemplate.user_id === userId)) {
          templateNumberId = numberRowForTemplate.id;
        }
      }
      const templateScope = <T,>(query: T): T =>
        templateNumberId ? ((query as any).eq('whatsapp_number_id', templateNumberId) as T) : query;
      const templateNumberPatch = templateNumberId ? { whatsapp_number_id: templateNumberId } : {};

      const { data: existingContact, error: contactLookupError } = await templateScope(
        supabase
          .from('crm_contacts')
          .select('*')
          .in('wa_id', variants)
          .eq('user_id', userId)
      )
        .order('last_message_received_at', { ascending: false, nullsFirst: true })
        .limit(1)
        .maybeSingle();

      if (contactLookupError) {
        console.error('[TEMPLATE] Falha ao localizar contato:', contactLookupError.message);
      }

      // Listas frias podem conter números que ainda não existem no CRM. O envio
      // de template é permitido fora da janela de 24h, portanto criamos o
      // contato antes de chamar a Meta para manter histórico e logs de falha.
      let contact = existingContact;
      if (!contact && userId) {
        const { data: createdContact, error: createContactError } = await supabase
          .from('crm_contacts')
          .insert({
            wa_id: canonicalBrazilianWaId(normalizedTo),
            name: canonicalBrazilianWaId(normalizedTo),
            user_id: userId,
            status: 'new',
            source_type: 'broadcast',
            ...templateNumberPatch,
          })
          .select('*')
          .maybeSingle();

        if (createContactError) {
          console.error('[TEMPLATE] Falha ao criar contato da lista fria:', createContactError.message);

          // Proteção para uma possível criação concorrente do mesmo número.
          const { data: concurrentContact } = await templateScope(
            supabase
              .from('crm_contacts')
              .select('*')
              .in('wa_id', variants)
              .eq('user_id', userId)
          )
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          contact = concurrentContact;
        } else {
          contact = createdContact;
          console.log('[TEMPLATE] Contato da lista fria criado para o envio:', normalizedTo);
        }
      }

      if (!contact) {
        return jsonResponse({
          success: false,
          error: 'Não foi possível preparar o contato para o envio do template',
          code: 'CONTACT_PREPARATION_FAILED',
        }, 200);
      }

      // Agendamentos/automações podem mandar `templateConfig` (mídia + valores
      // das variáveis com campos do contato). Montamos os componentes aqui,
      // já resolvidos para o contato real do envio.
      if ((!manualComponents || manualComponents.length === 0) && params.templateConfig && typeof params.templateConfig === 'object') {
        const { data: templateRowForConfig } = await supabase
          .from('crm_templates')
          .select('components, is_carousel, language')
          .eq('name', templateName)
          .eq('user_id', contact.user_id || userId)
          .maybeSingle();
        if (templateRowForConfig?.components && !templateRowForConfig.is_carousel) {
          const schema = parseServerTemplateSchema(templateRowForConfig.components);
          manualComponents = buildServerTemplateComponents(schema, params.templateConfig, contact);
          console.log(`[TEMPLATE] Componentes montados a partir de templateConfig para ${normalizedTo}:`, manualComponents.length);
        }
      }

      const { contactId: providedContactId, broadcastId } = params;
      const response = await internalSendTemplate(
        supabase, 
        templatePhoneNumberId,
        meta_access_token || settings?.meta_access_token || params.meta_access_token, 
        to, 
        templateName, 
        languageCode || 'pt_BR', 
        manualComponents || [], 
        { ...contact, whatsapp_number_id: contact.whatsapp_number_id || templateNumberId || null },
        null,
        providedContactId,
        broadcastId
      );


      return response;
    }

    if (action === 'sendMessage') {
      console.log(`[ACTION] sendMessage iniciado para: ${params.to}. HasInteractive: ${!!params.interactive}`);
      const normalizedTo = normalizePhone(params.to);
      const variants = getBrazilianPhoneVariants(normalizedTo);

      // Multi-número: a conversa pertence a UMA caixa. Se o app não mandou o
      // número aberto, resolvemos pelo phone_number_id que será usado no envio.
      // Sem isso, um cadastro com 2 números gravava a mensagem no contato da
      // outra caixa e ela nunca aparecia no chat aberto.
      const sendPhoneNumberId =
        meta_phone_number_id || settings?.meta_phone_number_id || params.meta_phone_number_id;
      let sendNumberId: string | null = scopedNumberId;
      if (!sendNumberId && sendPhoneNumberId) {
        const numberRowForSend = await getWhatsAppNumberByPhoneId(supabase, sendPhoneNumberId);
        if (numberRowForSend && (!userId || numberRowForSend.user_id === userId)) {
          sendNumberId = numberRowForSend.id;
        }
      }
      const sendScope = <T,>(query: T): T =>
        sendNumberId ? ((query as any).eq('whatsapp_number_id', sendNumberId) as T) : query;
      const sendNumberPatch = sendNumberId ? { whatsapp_number_id: sendNumberId } : {};

      const { data: contactRows } = await sendScope(
        supabase
          .from('crm_contacts')
          .select('*')
          .in('wa_id', variants)
          .eq('user_id', userId)
      )
        .order('last_message_received_at', { ascending: false, nullsFirst: true })
        .limit(1);
      let contact: any = contactRows && contactRows.length > 0 ? contactRows[0] : null;

      if (!contact && userId) {
        const insertResult = await supabase
          .from('crm_contacts')
          .insert({ wa_id: canonicalBrazilianWaId(normalizedTo), name: canonicalBrazilianWaId(normalizedTo), user_id: userId, status: 'new', source_type: 'manual_send', ...sendNumberPatch })
          .select('*')
          .maybeSingle();
        if (insertResult.error) {
          // Pode ser corrida ou variante já existente — reaproveita a conversa existente.
          const { data: retryRows } = await sendScope(
            supabase
              .from('crm_contacts')
              .select('*')
              .in('wa_id', variants)
              .eq('user_id', userId)
          ).limit(1);
          contact = retryRows && retryRows.length > 0 ? retryRows[0] : null;
          if (!contact) console.error('[ACTION] Failed to create contact:', insertResult.error.message);
        } else {
          contact = insertResult.data;
          console.log('[ACTION] Created contact for sendMessage');
        }
      }

      if (!contact) {
        console.warn('[ACTION] Contact not found. Proceeding anyway.');
      }
        
      const finalUserId = userId || contact?.user_id || null;
      console.log(`[ACTION] Usando userId ${finalUserId} para sendMessage`, {
        whatsapp_number_id: sendNumberId,
        contact_id: contact?.id || null,
      });

      const response = await handleInternalSendMessage(
        supabase, 
        sendPhoneNumberId,
        meta_access_token || settings?.meta_access_token || params.meta_access_token, 
        { ...params, whatsapp_number_id: sendNumberId || params.whatsapp_number_id || null },
        contact, 
        settings?.vps_transcoder_url,
        finalUserId
      );

      console.log(`[ACTION] sendMessage finalizado para ${params.to}. Status: ${response.status}`);
      return response;
    }

    if (action === 'startFlow') {
      const { flowId, contactId, waId } = params
      if (!userId) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
      
      const { data: currentContact, error: contactError } = await supabase
        .from('crm_contacts')
        .select('flow_state, current_flow_id, status, user_id, wa_id')
        .eq('id', contactId)
        .eq('user_id', userId)
        .maybeSingle();

      if (contactError) throw new Error(`Falha ao carregar o contato: ${contactError.message}`);
      if (!currentContact) throw new Error('Contato não encontrado nesta conta');

      const flow = await loadFlowForUser(supabase, flowId, userId);
      
      await supabase.from('crm_scheduled_messages').delete().eq('contact_id', contactId);

      if (flow.nodes && flow.nodes.length > 0) {
        // Encontra o nó inicial (nó que não é alvo de nenhuma aresta) ou o primeiro nó se não houver um óbvio
        const nodeIdsWithTarget = new Set(flow.edges?.map((e: any) => e.target) || [])
        const startNode = flow.nodes.find((n: any) => !nodeIdsWithTarget.has(n.id)) || flow.nodes[0]
        
        console.log(`[START-FLOW] Setting contact ${contactId} to running state for flow ${flowId}, start node ${startNode.id}`);
        const updateData: any = {
          current_flow_id: flowId,
          current_node_id: startNode.id,
          flow_state: 'running',
          last_flow_interaction: new Date().toISOString(),
          next_execution_time: null,
          status: (flow.trigger_tag && flow.trigger_tag !== 'none') ? flow.trigger_tag : (currentContact?.status || 'new'),
          ai_active: startNode.type === 'aiAgent'
        };

        // Se o nó inicial for Agente IA, já salvamos o prompt no contato
        if (startNode.type === 'aiAgent' && startNode.data?.prompt) {
          updateData.ai_agent_prompt = startNode.data.prompt;
        }

        const { error: updateError } = await supabase.from('crm_contacts').update(updateData).eq('id', contactId).eq('user_id', userId);
        
        if (updateError) {
          console.error(`[START-FLOW] Error updating contact ${contactId}:`, updateError);
          throw updateError;
        }
        
        console.log(`[START-FLOW] Executing initial node ${startNode.id} for contact ${contactId}`);
        const res: any = await executeVisualNode(supabase, flow, startNode, contactId, waId);
        console.log(`[START-FLOW] executeVisualNode result:`, JSON.stringify(res));
        
        // IMPORTANTE: Se o fluxo começou em um nó de Agente IA ou foi para ai_handling, processamos a resposta imediatamente
        const { data: contactAfterExec } = await supabase.from('crm_contacts').select('*').eq('id', contactId).single();
        if (contactAfterExec?.flow_state === 'ai_handling' || contactAfterExec?.ai_active || res?.message?.includes('AI handling state')) {
          console.log(`[START-FLOW] Started or moved to AI handling state. Checking wait_response for ${waId}`);
          
          // Se o prompt não estiver no contato, tentamos forçar a atualização a partir do nó
          if (!contactAfterExec.ai_agent_prompt && startNode.type === 'aiAgent' && startNode.data?.prompt) {
             console.log(`[START-FLOW] Force updating prompt from node to contact ${contactId}`);
             await supabase.from('crm_contacts').update({ ai_agent_prompt: startNode.data.prompt }).eq('id', contactId);
             contactAfterExec.ai_agent_prompt = startNode.data.prompt;
          }
          
          // Se o nó IA está configurado para aguardar resposta antes da primeira interação
          const waitBeforeStart = contactAfterExec.metadata?.wait_response_before_start === true;
          if (waitBeforeStart) {
             console.log(`[START-FLOW] AI Agent configured to wait for first response. Setting state for ${waId}.`);
             await supabase.from('crm_contacts').update({ 
               flow_state: 'waiting_response',
               metadata: { ...contactAfterExec.metadata, has_waited_initial_response: true }
             }).eq('id', contactId);
          } else {
             // Dispara a IA mesmo sem texto do cliente para que ela se apresente
             await processAiAgentResponse(supabase, contactAfterExec, waId, params.text || "Inicie o atendimento se apresentando.", params.sourceMessageId, contactAfterExec.user_id || userId, contactAfterExec.whatsapp_number_id || params.whatsapp_number_id || null);
          }
        }

        
        return jsonResponse(res)
      } else {
        await supabase.from('crm_contacts').update({
          current_flow_id: flowId,
          current_step_index: 0,
          flow_state: 'running',
          last_flow_interaction: new Date().toISOString()
        }).eq('id', contactId)
        
        const { data: step } = await supabase
          .from('crm_flow_steps')
          .select('*')
          .eq('flow_id', flowId)
          .eq('step_order', 0)
          .single()
        
        if (step) return await processStep(supabase, step, contactId, waId)
      }
      
      return new Response(JSON.stringify({ success: true, message: 'Flow started' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'continueFlow') {
      const { contactId, waId, buttonId, nextNodeId, text, sourceMessageId } = params
      
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('*')
        .eq('id', contactId)
        .single()
      
      if (!contact || !contact.current_flow_id) {
        return new Response(JSON.stringify({ success: false, message: 'No active flow' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: flow } = await supabase
        .from('crm_flows')
        .select('*')
        .eq('id', contact.current_flow_id)
        .single()

      if (flow && flow.nodes && flow.nodes.length > 0) {
        let nextNode = null;

        if (nextNodeId) {
          nextNode = flow.nodes.find((n: any) => n.id === nextNodeId)
        } else {
          const currentNode = flow.nodes.find((n: any) => n.id === contact.current_node_id)
          if (!currentNode) return new Response(JSON.stringify({ error: 'Current node not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

          // Find next node based on buttonId or standard connection
          let nextEdge = null;
          if (buttonId) {
            console.log(`[FLOW-LOG] Matching buttonId: ${buttonId} in node ${currentNode.id}`);
            // Priority 1: Match specific button ID (exato ou prefixado ou index)
            nextEdge = flow.edges.find((e: any) => {
              if (e.source !== currentNode.id) return false;
              const handle = e.sourceHandle;
              // Compatibilidade com múltiplos formatos de handle de botões
              return handle === buttonId || handle === `btn_${buttonId}` || handle?.includes(buttonId) || handle === `button_${buttonId}`;
            });
          }
          
          // Priority 1.5: Match text against button labels
          if (!nextEdge && text && currentNode.data?.buttons) {
            console.log(`[FLOW-LOG] Attempting text match for: "${text}" in node ${currentNode.id}`);
            const matchedButtonIdx = currentNode.data.buttons.findIndex((b: any) => {
              const bText = (b.label || b.text || "").toLowerCase().trim();
              const receivedText = text.toLowerCase().trim();
              
              const match = bText === receivedText || 
                     (bText.length > 20 && receivedText === (bText.substring(0, 17) + "...").toLowerCase()) ||
                     (receivedText.length > 3 && bText.includes(receivedText)) ||
                     (receivedText.includes('[button reply]') && receivedText.includes(bText)) ||
                     (bText.length > 3 && receivedText.includes(bText)) ||
                     (receivedText.length > 2 && bText.startsWith(receivedText)) ||
                     (bText.length > 2 && receivedText.startsWith(bText));
              
              if (match) console.log(`[FLOW-LOG] Text match found with button: "${bText}"`);
              return match;
            });
            
            if (matchedButtonIdx !== -1) {
              const b = currentNode.data.buttons[matchedButtonIdx];
              // Tenta encontrar a aresta pelo ID do botão ou pelo handle sequencial
              const possibleHandles = [b.id, `btn_${matchedButtonIdx}`, `btn-${matchedButtonIdx}`, matchedButtonIdx.toString(), `btn-${matchedButtonIdx}-handle` ];
              nextEdge = flow.edges.find((e: any) => e.source === currentNode.id && (possibleHandles.includes(e.sourceHandle) || e.sourceHandle === b.id));
              
              if (nextEdge) {
                console.log(`[FLOW-LOG] Matched text "${text}" to button index ${matchedButtonIdx}. Found edge to: ${nextEdge.target}`);
              } else {
                console.warn(`[FLOW-LOG] Matched text "${text}" to button index ${matchedButtonIdx}, but NO EDGE found for handles:`, possibleHandles);
              }
            }
          }

          // Para nós de "Aguardar Resposta" (wait_response/waitResponse/question/followup),
          // quando o contato RESPONDE, só devemos seguir se houver aresta ligada explicitamente
          // no handle "Se responder" (id='responded' ou 'any_response'). Se o usuário não
          // ligou nada nesse handle, o fluxo deve ENCERRAR — nunca cair no handle 'timeout'
          // nem em uma aresta genérica sem handle.
          const isWaitLikeNode =
            currentNode.type === 'wait_response' ||
            currentNode.type === 'waitResponse' ||
            currentNode.type === 'question' ||
            currentNode.type === 'followup';

          if (!nextEdge) {
            if (isWaitLikeNode) {
              // Só segue se o handle "responded"/"any_response" estiver conectado
              nextEdge = flow.edges.find((e: any) =>
                e.source === currentNode.id &&
                (e.sourceHandle === 'responded' || e.sourceHandle === 'any_response')
              );
            } else {
              // Priority 2: Match generic "responded"/"any_response"/"next" handles
              nextEdge = flow.edges.find((e: any) => e.source === currentNode.id && (e.sourceHandle === 'responded' || e.sourceHandle === 'any_response' || e.sourceHandle === 'next' || !e.sourceHandle));
            }
          }

          // Priority 3: Match standard transition (no handle) or "next" handle — NUNCA para nós de espera
          if (!nextEdge && !isWaitLikeNode) {
            nextEdge = flow.edges.find((e: any) => e.source === currentNode.id && (!e.sourceHandle || e.sourceHandle === 'next'));
          }


          if (nextEdge) {
            nextNode = flow.nodes.find((n: any) => n.id === nextEdge.target);
          }

        }

        if (nextNode) {
            const updateData: any = { 
              current_node_id: nextNode.id, 
              last_flow_interaction: new Date().toISOString(),
              flow_state: 'running'
            };

            // Se o próximo nó for Agente IA, atualizamos o prompt e o estado ai_active
            if (nextNode.type === 'aiAgent') {
              updateData.ai_active = true;
              if (nextNode.data?.prompt) {
                updateData.ai_agent_prompt = nextNode.data.prompt;
              }
            }

            await supabase
              .from('crm_contacts')
              .update(updateData)
              .eq('id', contactId)
          
          let res: any = await executeVisualNode(supabase, flow, nextNode, contactId, waId);
          
          // Iterative execution loop to handle sequential nodes without recursion/timeouts
          let currentRes = res;
          let iterations = 0;
          const MAX_ITERATIONS = 5;
          
          while (currentRes?.nextNodeId && iterations < MAX_ITERATIONS) {
            console.log(`[CONTINUE-FLOW] Sequential node detected: ${currentRes.nextNodeId}. Executing...`);
            iterations++;
            const nextInChain = flow.nodes.find((n: any) => n.id === currentRes.nextNodeId);
            if (nextInChain) {
              currentRes = await executeVisualNode(supabase, flow, nextInChain, contactId, waId);
            } else {
              break;
            }
          }
          
          res = currentRes;
          
          // Se o próximo nó é um Agente IA, verificamos se ele deve responder agora ou esperar.
          // O Agente IA só responde automaticamente se NÃO houver uma mensagem de pergunta/botões ativa.
          if (res?.message?.includes('AI handling state') && text) {
            // Se o nó de IA foi ativado por uma resposta do cliente (o que o 'text' indica),
            // então ele deve processar a resposta agora.
            console.log(`[CONTINUE-FLOW] Moved to AI handling state. Processing AI response safely for ${waId}. Source: ${sourceMessageId}`);
            // Não use setTimeout desacoplado aqui: o Edge Runtime pode encerrar o
            // worker assim que a resposta HTTP termina. Aguardar mantém a execução
            // na nuvem confiável mesmo com o navegador fechado.
            await (async () => {
              const { data: updatedContact } = await supabase.from('crm_contacts').select('*').eq('id', contactId).single();
              if (updatedContact) {
                // Se o nó IA está configurado para aguardar resposta antes da primeira interação
                // Verificamos o metadata do contato ou diretamente os dados do nó se estiverem acessíveis
                const waitBeforeStart = updatedContact.metadata?.wait_response_before_start === true;
                const hasWaited = updatedContact.metadata?.has_waited_initial_response === true;

                if (waitBeforeStart && !hasWaited) {
                   console.log(`[AI-AGENT] Wait response before start is enabled. Setting waiting_response for ${waId}.`);
                   await supabase.from('crm_contacts').update({ 
                     flow_state: 'waiting_response',
                     metadata: { 
                       ...(updatedContact.metadata || {}), 
                       has_waited_initial_response: true 
                     }
                   }).eq('id', contactId);
                   return;
                }

                // Determinar o texto a processar (transcrição ou texto puro)
                let finalAiText = text;
                if (sourceMessageId) {
                  const { data: currentInbound } = await supabase
                    .from('crm_messages')
                    .select('id, content, message_type, media_url')
                    .eq('meta_message_id', sourceMessageId)
                    .maybeSingle();

                  const resolvedText = await resolveInboundMessageText(supabase, OPENAI_API_KEY, currentInbound);
                  if (resolvedText) finalAiText = resolvedText;
                }

                // Delay para parecer mais natural
                await new Promise(resolve => setTimeout(resolve, 3000));
                await processAiAgentResponse(supabase, updatedContact, waId, finalAiText, sourceMessageId, updatedContact.user_id, updatedContact.whatsapp_number_id || null);
              }
            })();
          } else if (res?.message?.includes('AI handling state') && !text) {
            // Se NÃO há texto (foi uma transição automática do nó anterior para o IA),
            // colocamos o estado em 'waiting_response' para que o IA responda apenas após a próxima mensagem do cliente.
            console.log(`[CONTINUE-FLOW] AI Agent reached via auto-transition. Setting state to waiting_response for ${waId}`);
            await supabase.from('crm_contacts').update({ 
              flow_state: 'waiting_response',
              ai_active: true 
            }).eq('id', contactId);
          }
          
          return jsonResponse(res)
        }

        // No more nodes, finish flow
        await supabase.from('crm_contacts').update({ 
          flow_state: 'idle', 
          current_flow_id: null, 
          current_node_id: null 
        }).eq('id', contactId)

        return new Response(JSON.stringify({ success: true, message: 'Flow completed' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    
    if (action === 'getGoogleAuthUrl') {
      const { clientId } = getGoogleOAuthCredentials(settings);
      const google_client_id = clientId;
      if (!google_client_id) {
        throw new Error('Google Client ID não configurado nas configurações');
      }

       console.log(`[OAUTH-DEBUG] Action: getGoogleAuthUrl, Origin: ${req.headers.get('origin')}`);
       const origin = req.headers.get('origin') || 'https://zapmro.com.br';
       // Usamos sempre zapmro.com.br/google-callback para consistência SaaS
       const redirectUri = 'https://zapmro.com.br/google-callback';
      const scope = GOOGLE_CONTACTS_SCOPES;
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${google_client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;

      return new Response(JSON.stringify({ success: true, authUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

     if (action === 'exchangeGoogleCode') {
       const { code, redirectUri: paramsRedirectUri } = params;
       const { clientId: google_client_id, clientSecret: google_client_secret, source: credentialSource } = getGoogleOAuthCredentials(settings);
       if (!google_client_secret) {
         throw new Error('Google Client Secret não configurado no backend');
       }
       
       // CRITICAL: Google is very strict about the Redirect URI matching EXACTLY what was sent in the auth request.
       const finalRedirectUri = 'https://zapmro.com.br/google-callback';
       
       console.log(`[OAUTH] Exchange Attempt - ClientID: ${google_client_id.trim()}`);
       console.log(`[OAUTH] Force using fixed redirectUri: ${finalRedirectUri}`);
       console.log(`[OAUTH] Received paramsRedirectUri was: ${paramsRedirectUri}`);
       console.log(`[OAUTH] Using Google credentials source: ${credentialSource}`);

      console.log(`[OAUTH] Fetching token from Google with grant_type: authorization_code`);
      // Use standard Form Data approach which is more reliable for OAuth tokens
      const formData = new URLSearchParams();
      formData.append('code', code);
      formData.append('client_id', google_client_id.trim());
      formData.append('client_secret', google_client_secret.trim());
      formData.append('redirect_uri', finalRedirectUri.trim());
      formData.append('grant_type', 'authorization_code');
      
      console.log(`[OAUTH-DEBUG] Payload to Google: client_id=${google_client_id.trim()}, redirect_uri=${finalRedirectUri.trim()}`);

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: formData.toString(),
      });

      const tokens = await response.json();
      console.log(`[OAUTH-DEBUG] Tokens Response Status: ${response.status}`);
      if (!response.ok) {
        console.error(`[OAUTH-ERROR] Google OAuth error response:`, JSON.stringify(tokens));
        throw new Error(`Google OAuth error: ${tokens.error_description || tokens.error} (Status: ${response.status})`);
      }

      // Get user info to identify the account
      console.log("[OAUTH] Fetching user info...");
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` },
      });
      const userInfo = await userResponse.json();
      const email = userInfo.email;
      console.log(`[OAUTH] Connected email: ${email}`);

       const { data: existingAccount } = await supabase
         .from('crm_google_accounts')
         .select('id, refresh_token, auto_sync')
         .eq('user_id', userId)
         .eq('email', email)
         .maybeSingle();

       // Valide os escopos REALMENTE concedidos. Sem isso, uma conta sem
       // permissão de Contatos é salva como "conectada" e depois falha com
       // 403 a cada minuto no cron.
       const grantedScopes = await checkGoogleTokenScopes(tokens.access_token);
       const hasContactsWrite = hasGoogleContactsWriteScope(grantedScopes);
       const scopeOk = hasContactsWrite !== false; // null = não verificável

       // Store in crm_google_accounts. Google may omit refresh_token on repeated consent,
       // so preserve the previous one instead of overwriting it with null/undefined.
       const accountPayload = {
           email,
           access_token: tokens.access_token,
           refresh_token: tokens.refresh_token || existingAccount?.refresh_token || null,
           expiry_date: Date.now() + (tokens.expires_in * 1000),
           updated_at: new Date().toISOString(),
           user_id: userId,
           auto_sync: scopeOk ? (existingAccount?.auto_sync ?? true) : false,
           connection_status: scopeOk ? 'active' : 'reconnect_required',
           granted_scopes: grantedScopes ? grantedScopes.join(' ') : null,
           last_sync_error_code: scopeOk ? null : 'INSUFFICIENT_SCOPE',
           last_sync_error: scopeOk
             ? null
             : 'A permissão de Contatos do Google não foi concedida. Reconecte e marque a caixa de acesso aos Contatos.',
           last_sync_error_at: scopeOk ? null : new Date().toISOString(),
         };

       // Sem depender da UNIQUE(user_id,email) (migration 094): se a conta já
       // existe, atualiza pelo id; senão insere. Evita o erro
       // "no unique or exclusion constraint matching the ON CONFLICT specification".
       let account: Record<string, unknown> | null = null;
       if (existingAccount?.id) {
         const { data, error } = await supabase
           .from('crm_google_accounts')
           .update(accountPayload)
           .eq('id', existingAccount.id)
           .select()
           .single();
         if (error) throw error;
         account = data;
       } else {
         const { data, error } = await supabase
           .from('crm_google_accounts')
           .insert(accountPayload)
           .select()
           .single();
         if (error) throw error;
         account = data;
       }

      if (!scopeOk) {
        console.error(`[OAUTH] Conta ${email} conectada SEM escopo de Contatos. Escopos: ${grantedScopes?.join(' ')}`);
        return new Response(JSON.stringify({
          success: false,
          requiresReconnect: true,
          account,
          error: 'A permissão de Contatos do Google não foi concedida. Reconecte a conta e autorize o acesso aos Contatos.',
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true, account }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });


    }

    if (action === 'syncGoogleContacts') {
      const { accountId } = params;
      let account;
      
      console.log(`[SYNC] Invocando syncGoogleContacts. accountId: ${accountId || 'recente'}`);
      
        if (accountId) {
          const { data, error: accountError } = await supabase.from('crm_google_accounts').select('*').eq('id', accountId).eq('user_id', userId).single();
          if (accountError) throw new Error(`Conta Google não encontrada: ${accountError.message}`);
         account = data;
       } else {
          const { data, error: accountError } = await supabase.from('crm_google_accounts').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1).single();
          if (accountError) throw new Error(`Conta Google não encontrada: ${accountError.message}`);
         account = data;
       }

      if (!account) {
        console.error('[SYNC] Nenhuma conta Google conectada encontrada.');
        throw new Error('Nenhuma conta Google conectada');
      }

      console.log(`[SYNC] Usando conta: ${account.email}`);

      // Refresh token if expired
      let accessToken = account.access_token;
      if (Date.now() >= (account.expiry_date || 0)) {
        console.log("[SYNC] Refreshing Google token...");
        const { clientId: googleClientId, clientSecret: googleClientSecret } = getGoogleOAuthCredentials(settings);
        if (!googleClientSecret) {
          throw new Error('Google Client Secret não configurado no backend');
        }
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: googleClientId,
            client_secret: googleClientSecret,
            refresh_token: account.refresh_token,
            grant_type: 'refresh_token',
          }),
        });
        const refreshTokens = await refreshResponse.json();
        if (refreshResponse.ok) {
          accessToken = refreshTokens.access_token;
          console.log("[SYNC] Token atualizado com sucesso.");
          await supabase.from('crm_google_accounts').update({
            access_token: accessToken,
            expiry_date: Date.now() + (refreshTokens.expires_in * 1000),
            updated_at: new Date().toISOString()
          }).eq('id', account.id);
        } else {
          const refreshMessage = refreshTokens?.error_description || refreshTokens?.error || `HTTP ${refreshResponse.status}`;
          console.error("[SYNC] Falha ao atualizar token:", refreshMessage);
          await supabase.from('crm_google_accounts').update({
            connection_status: 'reconnect_required',
            last_sync_error_code: 'TOKEN_REFRESH_FAILED',
            last_sync_error: String(refreshMessage).slice(0, 500),
            last_sync_error_at: new Date().toISOString(),
          }).eq('id', account.id);
          throw new Error('A autorização do Google expirou. Reconecte a conta e tente novamente.');
        }
      }

      let count = 0;
      let totalFetched = 0;
      let linkedExisting = 0;
      let nextPageToken = null;

      // Conjunto canônico (com 9º dígito) dos números já existentes para este usuário.
      // Sem isto, a sincronização criava DUAS conversas para o mesmo contato
      // (uma com o 9º dígito e outra sem).
      const existingCanonWaIds = new Set<string>();
      const existingContactsByCanon = new Map<string, { id: string; wa_id: string; name: string | null; source_type: string | null }>();
      {
        let from = 0;
        const pageSize = 1000;
        while (true) {
          const { data: existingRows, error: existingErr } = await supabase
            .from('crm_contacts')
            .select('id, wa_id, name, source_type')
            .eq('user_id', userId)
            .range(from, from + pageSize - 1);
          if (existingErr) {
            console.error('[SYNC] Falha ao carregar contatos existentes:', existingErr.message);
            break;
          }
          for (const row of existingRows || []) {
            const canonicalWaId = canonicalBrazilianWaId(row.wa_id);
            existingCanonWaIds.add(canonicalWaId);
            if (!existingContactsByCanon.has(canonicalWaId)) {
              existingContactsByCanon.set(canonicalWaId, row);
            }
          }
          if (!existingRows || existingRows.length < pageSize) break;
          from += pageSize;
        }
      }
      
      console.log("[SYNC] Iniciando busca de contatos na People API...");
      
      do {
        const url = new URL('https://people.googleapis.com/v1/people/me/connections');
        url.searchParams.set('personFields', 'names,phoneNumbers');
        url.searchParams.set('pageSize', '1000');
        if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);

        const contactsResponse = await fetch(url.toString(), {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        
        if (!contactsResponse.ok) {
          const err = await contactsResponse.json().catch(() => ({}));
          const apiMessage = err?.error?.message || `HTTP ${contactsResponse.status}`;
          console.error('[SYNC] People API Error:', { status: contactsResponse.status, message: apiMessage });
          await supabase.from('crm_google_accounts').update({
            connection_status: contactsResponse.status === 401 || contactsResponse.status === 403 ? 'reconnect_required' : 'error',
            last_sync_error_code: `PEOPLE_API_${contactsResponse.status}`,
            last_sync_error: String(apiMessage).slice(0, 500),
            last_sync_error_at: new Date().toISOString(),
          }).eq('id', account.id);
          throw new Error(`Google Contatos recusou a sincronização: ${apiMessage}`);
        }

        const contactsData = await contactsResponse.json();
        nextPageToken = contactsData.nextPageToken;

        const connections = contactsData.connections || [];
        totalFetched += connections.length;
        console.log(`[SYNC] Página buscada: ${connections.length} conexões. Total até agora: ${totalFetched}`);

        if (connections.length > 0) {
          const upsertBatch = [];
          const existingUpdateById = new Map<string, Record<string, unknown>>();
          const seenWaIds = new Set();
          
          for (const person of connections) {
            const name = person.names?.[0]?.displayName;
            const phoneNumbers = person.phoneNumbers || [];
            
            for (const p of phoneNumbers) {
              let phone = p.value?.replace(/\D/g, '');
              if (!phone) continue;
              
              // Basic validation for WhatsApp format (at least 10 digits)
              if (phone.length < 10) continue;
              
              // Normalize Brazilian numbers
              if (phone.length === 10 || phone.length === 11) {
                if (!phone.startsWith('55')) phone = `55${phone}`;
              }

              // Um único registro por contato: sempre a forma canônica do número.
              const canonPhone = canonicalBrazilianWaId(phone);

              // Já existe no banco: vincula à conta Google e aproveita o nome,
              // sem criar uma segunda conversa para o mesmo telefone.
              const existingContact = existingContactsByCanon.get(canonPhone);
              if (existingContact) {
                if (!seenWaIds.has(canonPhone)) {
                  existingUpdateById.set(existingContact.id, {
                    id: existingContact.id,
                    wa_id: existingContact.wa_id,
                    user_id: userId,
                    name: name || existingContact.name,
                    source_type: existingContact.source_type || 'system',
                    google_sync_account_id: account.id,
                    updated_at: new Date().toISOString(),
                  });
                }
                seenWaIds.add(canonPhone);
                continue;
              }

              // Já entrou neste lote ou foi inserido por uma página anterior.
              if (existingCanonWaIds.has(canonPhone) || seenWaIds.has(canonPhone)) {
                continue;
              }
              seenWaIds.add(canonPhone);

              upsertBatch.push({
                wa_id: canonPhone,
                name: name || null,
                google_sync_account_id: account.id,
                user_id: userId,
                source_type: 'google',
                updated_at: new Date().toISOString()
              });
            }
          }

          const existingUpdateBatch = Array.from(existingUpdateById.values());
          if (existingUpdateBatch.length > 0) {
            const { error: updateError } = await supabase
              .from('crm_contacts')
              .upsert(existingUpdateBatch, { onConflict: 'id' });
            if (updateError) {
              console.error('[SYNC] Existing contact link error:', updateError);
              throw new Error(`Não foi possível vincular os contatos existentes ao Google: ${updateError.message}`);
            }
            linkedExisting += existingUpdateBatch.length;
            count += existingUpdateBatch.length;
          }

          if (upsertBatch.length > 0) {
            // Não usar upsert ON CONFLICT (wa_id,user_id): essa constraint foi
            // removida pela migration 089 para permitir o mesmo contato em
            // caixas WhatsApp diferentes. O conjunto canônico acima elimina
            // existentes e duplicados antes da inserção.
            console.log(`[SYNC] Inserindo lote com ${upsertBatch.length} registros únicos...`);
            const { error: insertError } = await supabase.from('crm_contacts').insert(upsertBatch);
            if (insertError) {
              console.error('[SYNC] Insert Error:', insertError);
              await supabase.from('crm_google_accounts').update({
                connection_status: 'error',
                last_sync_error_code: insertError.code || 'CONTACT_INSERT_FAILED',
                last_sync_error: String(insertError.message || insertError).slice(0, 500),
                last_sync_error_at: new Date().toISOString(),
              }).eq('id', account.id);
              throw new Error(`Não foi possível gravar os contatos Google: ${insertError.message}`);
            }
            for (const inserted of upsertBatch) existingCanonWaIds.add(inserted.wa_id);
            count += upsertBatch.length;
          }
        }
      } while (nextPageToken);

      console.log(`[SYNC] Finalizado. Conexões People API: ${totalFetched}. Processados: ${count}. Existentes vinculados: ${linkedExisting}.`);

      await supabase.from('crm_google_accounts').update({
        connection_status: 'active',
        last_sync_error_code: null,
        last_sync_error: null,
        last_sync_error_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', account.id);

      return new Response(JSON.stringify({ success: true, count, totalFetched, linkedExisting }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'processAiAgent') {
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('*')
        .eq('id', params.contactId)
        .single();
        
      if (!contact) return jsonResponse({ success: false, error: 'Contact not found' });
      
       const result = await processAiAgentResponse(supabase, contact, params.to || params.waId, params.text, params.sourceMessageId, contact.user_id, contact.whatsapp_number_id || params.whatsapp_number_id || null);
      return jsonResponse(result);
    }

    if (action === 'saveToGoogle') {
      // Never create a Google contact directly here. The previous direct path
      // did not persist google_sync_account_id/resourceName, so Auto Sync saw
      // the same row as pending and created it again. Route manual requests
      // through the same atomic claim + bookkeeping used by Auto Sync.
      const { contactId, accountId } = params;
      const { data: contact, error: contactError } = await supabase
        .from('crm_contacts')
        .select('id, google_sync_account_id')
        .eq('id', contactId)
        .eq('user_id', userId)
        .single();

      if (contactError || !contact) {
        return jsonResponse({ success: false, error: 'Contato não encontrado' }, 404);
      }

      if (contact.google_sync_account_id) {
        return jsonResponse({ success: true, alreadySynced: true, pushed: 0 });
      }

      const { data: connectedAccounts } = await supabase
        .from('crm_google_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      const selectedAccounts = (connectedAccounts || []).filter((account: any) =>
        accountId ? account.id === accountId : true
      );
      if (selectedAccounts.length === 0) {
        return jsonResponse({ success: false, error: 'Nenhuma conta Google vinculada a este contato' }, 400);
      }

      const orderedAccounts = [...selectedAccounts].sort(
        (a: any, b: any) => Number(!!b.auto_sync) - Number(!!a.auto_sync)
      );
      const result = await pushPendingContactsToGoogle(supabase, userId, settings, orderedAccounts, 500);
      return jsonResponse(result);
    }

    if (action === 'syncPendingToGoogle') {
      if (!userId) {
        return jsonResponse({ success: false, error: 'Usuário não identificado para exportar contatos ao Google.' }, 401);
      }
      const targetAccountId: string | undefined = params?.targetAccountId;
      console.log(`[GOOGLE-SYNC] Solicitação de exportação recebida. targetAccountId: ${targetAccountId || 'automático'}`);
      // Push contacts that are NOT yet on Google up to active Google accounts.
      // Does NOT pull from Google (avoid duplication caused by re-importing).
      const { data: accounts } = await supabase
        .from('crm_google_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (!accounts || accounts.length === 0) {
        console.warn('[GOOGLE-SYNC] Exportação recusada: nenhuma conta Google conectada para o usuário.');
        return jsonResponse({ success: false, error: 'Nenhuma conta Google conectada' });
      }

      // Prioriza contas com Auto Sync ligado; as demais contas conectadas
      // funcionam como destino extra quando a principal enche ou falha.
      const scoped = targetAccountId
        ? accounts.filter((a: any) => a.id === targetAccountId)
        : accounts;
      if (scoped.length === 0) {
        console.warn(`[GOOGLE-SYNC] Exportação recusada: conta de destino ${targetAccountId || 'não informada'} não encontrada.`);
        return jsonResponse({ success: false, error: 'Conta Google de destino não encontrada' }, 400);
      }
      const ordered = [...scoped].sort(
        (a: any, b: any) => Number(!!b.auto_sync) - Number(!!a.auto_sync)
      );

      const result = await pushPendingContactsToGoogle(supabase, userId, settings, ordered, 500);
      return jsonResponse(result);
    }

    // Reenviar contatos JÁ sincronizados pela ferramenta para OUTRA conta Google.
    // Estratégia: soltar o vínculo atual (account id + resourceName + timestamp)
    // para que a rotina padrão de push trate esses contatos como pendentes,
    // e então empurrar apenas para a conta de destino escolhida.
    if (action === 'resendGoogleContacts') {
      const targetAccountId: string | undefined = params?.targetAccountId;
      const contactIds: string[] = Array.isArray(params?.contactIds) ? params.contactIds : [];
      const sourceAccountId: string | undefined = params?.sourceAccountId;

      if (!targetAccountId) {
        return jsonResponse({ success: false, error: 'Selecione a conta Google de destino' }, 400);
      }

      const { data: accounts } = await supabase
        .from('crm_google_accounts')
        .select('*')
        .eq('user_id', userId);

      const target = (accounts || []).find((a: any) => a.id === targetAccountId);
      if (!target) {
        return jsonResponse({ success: false, error: 'Conta Google de destino não encontrada' }, 400);
      }

      // Seleciona os contatos que já foram salvos/sincronizados pelo sistema.
      let query = supabase
        .from('crm_contacts')
        .select('id, metadata, google_sync_account_id')
        .eq('user_id', userId)
        .not('google_sync_account_id', 'is', null);

      if (contactIds.length > 0) query = query.in('id', contactIds);
      else if (sourceAccountId) query = query.eq('google_sync_account_id', sourceAccountId);

      const { data: rows, error: rowsError } = await query.limit(5000);
      if (rowsError) {
        return jsonResponse({ success: false, error: rowsError.message }, 500);
      }

      const selected = (rows || []).filter((r: any) => r.google_sync_account_id !== targetAccountId);
      let detached = 0;

      for (const row of selected) {
        const nextMeta = { ...((row as any).metadata || {}) };
        delete nextMeta.google_resource_name;
        nextMeta.google_dirty = true;
        const { error: updErr } = await supabase
          .from('crm_contacts')
          .update({
            google_sync_account_id: null,
            google_synced_at: null,
            metadata: nextMeta,
          })
          .eq('id', row.id)
          .eq('user_id', userId);
        if (!updErr) detached++;
      }

      const result = await pushPendingContactsToGoogle(supabase, userId, settings, [target], 500);
      return jsonResponse({ ...result, detached, targetAccountId });
    }
    // Legacy action block removed to prevent duplication with main processScheduled at line 332

    if (action === 'processWebhook') {
      const { entry, skipSave } = params;
      return await handleProcessWebhook(supabase, entry, skipSave, userId || params.userId);
    }


    if (action === 'processInactivity') {
      console.log('Checking for inactive contacts in flows...');
      const { data: inactiveContacts } = await supabase
        .from('crm_contacts')
        .select('*')
        .eq('flow_state', 'waiting_response')
        .not('flow_timeout_node_id', 'is', null);

      if (inactiveContacts) {
        for (const contact of inactiveContacts) {
          const lastInteraction = new Date(contact.last_flow_interaction || contact.updated_at).getTime();
          const timeoutMs = (contact.flow_timeout_minutes || 20) * 60 * 1000;
          
          if (Date.now() - lastInteraction > timeoutMs) {
            console.log(`Contact ${contact.wa_id} timed out. Moving to node ${contact.flow_timeout_node_id}`);
            const { data: flow } = await supabase.from('crm_flows').select('*').eq('id', contact.current_flow_id).single();
            if (flow) {
              const nextNode = flow.nodes?.find((n: any) => n.id === contact.flow_timeout_node_id);
              if (nextNode) {
                await supabase.from('crm_contacts').update({
                  current_node_id: nextNode.id,
                  flow_state: 'running',
                  flow_timeout_node_id: null,
                  last_flow_interaction: new Date().toISOString()
                }).eq('id', contact.id);
                await executeVisualNode(supabase, flow, nextNode, contact.id, contact.wa_id);
              }
            }
          }
        }
      }
      return jsonResponse({ success: true });
    }

    if (action === 'processAiRecovery') {
      const recoveryResult = await processAiRecoveryForAllUsers(supabase, params?.userId || userId || null);
      return jsonResponse({ success: true, recovery: recoveryResult });
    }

    if (action === 'processCountdownTriggers') {
      const countdownResult = await processCountdownTriggers(supabase);
      return jsonResponse({ success: true, countdown: countdownResult });
    }


    if (action === 'update-contacts-bulk') {
      const { contactIds, name } = params;
      if (!contactIds || !Array.isArray(contactIds)) throw new Error('contactIds must be an array');
      
      const results = [];
      for (let i = 0; i < contactIds.length; i++) {
        const finalName = contactIds.length > 1 ? `${name} ${i + 1}` : name;
        const { error } = await supabase
          .from('crm_contacts')
          .update({ name: finalName, updated_at: new Date().toISOString() })
          .eq('id', contactIds[i]);
        
        results.push({ id: contactIds[i], success: !error });
      }
      
      return jsonResponse({ success: true, results });
    }

    /**
     * Valida a chave da OpenAI ANTES de salvar.
     * Era a causa de "IA ativada mas não responde": a chave errada só falhava
     * lá no webhook (401 invalid_api_key), invisível para o usuário.
     */
    if (action === 'validateOpenAiKey') {
      const submittedKey = String(params?.api_key ?? '').trim();
      const looksMasked = /[*•]/.test(submittedKey) || /^sk-[.]{3,}/i.test(submittedKey);
      const persistedKey = String(settings?.openai_api_key ?? '').trim();
      const rawKey = looksMasked && persistedKey ? persistedKey : submittedKey;
      const keySource = looksMasked && persistedKey ? 'persisted' : 'submitted';

      // Log em UMA linha (JSON) para o grep do deploy/logs-agente-ia.sh não
      // truncar o objeto. Nunca registra a chave — apenas tamanho e sufixo.
      const keyLog = (extra: Record<string, unknown>) =>
        JSON.stringify({
          user_id: userId,
          source: keySource,
          length: rawKey.length,
          suffix: rawKey.slice(-4),
          ...extra,
        });
      console.log('[AI-KEY-VALIDATION] Solicitação recebida', keyLog({}));

      if (!rawKey) {
        return jsonResponse({
          success: true,
          valid: false,
          code: 'empty',
          message: 'Informe a chave da OpenAI (começa com "sk-").',
        });
      }
      if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(rawKey)) {
        return jsonResponse({
          success: true,
          valid: false,
          code: 'malformed',
          message: 'Formato inválido. A chave da OpenAI começa com "sk-" e não contém espaços.',
        });
      }

      /**
       * Mapeia a resposta de erro da OpenAI para um código estável.
       * `insufficient_quota` / `credit_balance_exhausted` chegam com HTTP 429,
       * mas são SALDO ZERADO — precisa avisar diferente de "limite de uso".
       */
      const mapOpenAiError = (status: number, body: any) => {
        const errCode = String(body?.error?.code || body?.error?.type || '');
        if (
          status === 429 &&
          /insufficient_quota|credit_balance_exhausted|billing_hard_limit/i.test(errCode)
        ) {
          return {
            code: 'no_credits',
            message:
              'SEM SALDO na OpenAI: a chave é válida, mas a conta está sem créditos. Adicione créditos em platform.openai.com/settings/organization/billing.',
          };
        }
        const codeMap: Record<number, { code: string; message: string }> = {
          401: { code: 'invalid_api_key', message: 'API ERRADA: a OpenAI recusou esta chave (401). Gere uma nova em platform.openai.com/api-keys.' },
          403: { code: 'forbidden', message: 'API sem permissão (403): a chave existe mas não pode usar este modelo/projeto.' },
          404: { code: 'model_not_available', message: 'A chave é válida, mas o projeto não tem acesso ao modelo gpt-4o-mini.' },
          429: { code: 'rate_limit', message: 'Limite de uso atingido agora (429). Aguarde alguns instantes e teste de novo.' },
        };
        return (
          codeMap[status] || {
            code: 'provider_error',
            message: `A OpenAI respondeu com erro (${status}). Tente novamente em instantes.`,
          }
        );
      };

      try {
        const check = await fetch('https://api.openai.com/v1/models/gpt-4o-mini', {
          headers: { Authorization: `Bearer ${rawKey}` },
        });

        if (!check.ok) {
          const body = await check.json().catch(() => ({} as any));
          const mapped = mapOpenAiError(check.status, body);
          console.warn('[AI-KEY-VALIDATION] Consulta de modelo recusada', keyLog({ status: check.status, code: mapped.code }));
          return jsonResponse({
            success: true,
            valid: false,
            code: mapped.code,
            status: check.status,
            message: mapped.message,
            provider_message: body?.error?.message || `HTTP ${check.status}`,
          });
        }

        /**
         * A listagem de modelos funciona mesmo com saldo zerado — por isso
         * fazemos uma geração mínima (1 token) para detectar falta de crédito
         * ANTES de salvar, e não só no webhook.
         */
        const probe = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${rawKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });

        if (probe.ok) {
          console.log('[AI-KEY-VALIDATION] Token válido e com saldo', keyLog({ model: 'gpt-4o-mini' }));
          return jsonResponse({
            success: true,
            valid: true,
            code: 'ok',
            message: 'API correta — chave válida, com acesso ao gpt-4o-mini e com saldo disponível.',
          });
        }

        const probeBody = await probe.json().catch(() => ({} as any));
        const mapped = mapOpenAiError(probe.status, probeBody);
        console.warn('[AI-KEY-VALIDATION] Teste de saldo/modelo recusado', keyLog({ status: probe.status, code: mapped.code }));
        return jsonResponse({
          success: true,
          valid: false,
          code: mapped.code,
          status: probe.status,
          message: mapped.message,
          provider_message: probeBody?.error?.message || `HTTP ${probe.status}`,
        });
      } catch (err: any) {
        console.error('[AI-KEY-VALIDATION] Falha de rede ao consultar OpenAI', keyLog({ message: err?.message || String(err) }));
        return jsonResponse({
          success: true,
          valid: false,
          code: 'network_error',
          message: 'Não foi possível falar com a OpenAI para validar agora. Verifique a internet do servidor.',
          provider_message: err?.message || String(err),
        });
      }
    }


    if (action === 'improvePrompt') {
      const { prompt } = params;
      if (!prompt) throw new Error('Prompt is required');

      const { data: settings } = await supabase.from('crm_settings').select('openai_api_key').eq('user_id', userId).maybeSingle();
      const apiKey = settings?.openai_api_key || Deno.env.get('OPENAI_API_KEY');

      if (!apiKey) throw new Error('OpenAI API Key not configured');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: 'Você é um especialista em engenharia de prompt. Melhore o prompt do sistema fornecido para torná-lo mais eficaz, claro e profissional para um agente de atendimento no WhatsApp. Mantenha o idioma original.' 
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
        }),
      });

      const aiData = await response.json();
      if (!response.ok) throw new Error(aiData.error?.message || 'Erro na API da OpenAI');

      return jsonResponse({ success: true, improvedPrompt: aiData.choices?.[0]?.message?.content });
    }

    if (action === 'convertToUtility') {
      const { message } = params;
      if (!message || !String(message).trim()) throw new Error('Mensagem é obrigatória');

      const { data: settings } = await supabase.from('crm_settings').select('openai_api_key').eq('user_id', userId).maybeSingle();
      const apiKey = settings?.openai_api_key || Deno.env.get('OPENAI_API_KEY');
      if (!apiKey) throw new Error('Nenhum token vinculado ao Agente I.A. Salve seu token no Agente I.A para usar o conversor.');

      const systemPrompt = `# FUNÇÃO
Você é um especialista em aprovação de templates do WhatsApp Business (Meta), com profundo conhecimento das categorias de templates da plataforma.
Sua única função é reescrever a mensagem enviada pelo usuário para que ela tenha a maior probabilidade possível de ser aprovada pela Meta como um template da categoria UTILITY, preservando o objetivo original da mensagem.
A intenção principal é transformar qualquer mensagem em uma versão que transmita claramente um contexto de atendimento, acompanhamento, atualização ou continuidade de uma interação já iniciada pelo usuário.
Você NÃO deve explicar o que foi alterado. Você NÃO deve comentar a mensagem. Você NÃO deve responder perguntas. Você NÃO deve utilizar markdown. Você deve retornar SOMENTE a mensagem completamente reescrita.

# OBJETIVO PRINCIPAL
Transforme a mensagem enviada em um template com características de Utility. A mensagem final deve parecer parte de um atendimento já existente, uma solicitação anterior, um cadastro efetuado, uma conversa em andamento, uma atualização importante ou um processo iniciado anteriormente pelo próprio usuário. O objetivo NÃO é criar propaganda disfarçada.

# REGRAS OBRIGATÓRIAS
Sempre transmita contexto: continuidade de atendimento, acompanhamento, atualização, solicitação realizada anteriormente, interesse previamente demonstrado, cadastro realizado, conversa iniciada, processo em andamento, atendimento disponível, retorno referente ao contato anterior.
Nunca use linguagem promocional, chamadas de vendas, incentivo a compra direta, ofertas, gatilhos comerciais, prospecção fria, urgência comercial ou emojis em excesso. Nunca altere completamente o objetivo da mensagem.

# PALAVRAS PROIBIDAS
promoção, oferta, desconto, imperdível, oportunidade, últimas vagas, últimos dias, compre, garanta, adquira, clique agora, não perca, campanha, exclusivo, aproveite, venda, marketing, mais barato, melhor preço, condição especial.

# RESTRIÇÕES
Nunca invente informações inexistentes (protocolos, pedidos, números, datas, horários, compras, contratos, pagamentos, agendamentos). Nunca utilize placeholders como {{1}}, {{2}}, {{3}}. Nunca solicite informações pessoais que não existam na mensagem original.

# ESTRUTURA RECOMENDADA
1. Contextualize que existe um atendimento, solicitação, cadastro ou contato anterior.
2. Informe o motivo do retorno.
3. Reescreva a informação principal da mensagem original.
4. Finalize informando que o atendimento continua disponível caso o usuário queira dar continuidade.

# SAÍDA
Retorne apenas a mensagem completamente convertida. Não explique. Não faça observações. Não escreva comentários. Não coloque aspas. Não utilize markdown.`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `A mensagem abaixo deve ser completamente convertida para um formato Utility com foco em aumentar as chances de aprovação pela Meta.\n\nMENSAGEM:\n\n${message}` },
          ],
          temperature: 0.9,
        }),
      });

      const aiData = await response.json();
      if (!response.ok) throw new Error(aiData.error?.message || 'Erro na API da OpenAI');

      const converted = (aiData.choices?.[0]?.message?.content || '').trim();
      if (!converted) throw new Error('Não foi possível converter a mensagem');

      return jsonResponse({ success: true, converted });
    }

    if (action === 'clearHistory') {
      const { contactId } = params;
      if (!contactId) throw new Error('contactId is required');
      if (!userId) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);

      const { data: ownedContact } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('id', contactId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!ownedContact) return jsonResponse({ success: false, error: 'Contact not found' }, 404);

      console.log(`[CLEAR-HISTORY] Clearing message history for contact ${contactId}`);

      const { error: deleteError } = await supabase
        .from('crm_messages')
        .delete()
        .eq('contact_id', contactId)
        .eq('user_id', userId);

      if (deleteError) {
        console.error(`[CLEAR-HISTORY] Error deleting messages:`, deleteError);
        throw deleteError;
      }

      // Reset flow state and AI active status to ensure it restarts as a fresh conversation
      await supabase
        .from('crm_contacts')
        .update({
          flow_state: 'idle',
          ai_active: false,
          current_flow_id: null,
          current_node_id: null,
          last_message_received_at: null,
          last_interaction: null,
          last_flow_interaction: null,
          ai_agent_prompt: null,
          total_messages_received: 0, // CRUCIAL: Reseta o contador de mensagens
          metadata: {
            has_waited_initial_response: false,
            last_processed_message_id: null
          }
        })
        .eq('id', contactId)
        .eq('user_id', userId);

      return jsonResponse({ success: true, message: 'Histórico limpo com sucesso' });
    }

    if (!action) {
      console.warn('[REQUEST-DEBUG] POST ignored because it had no action and was not a resolvable webhook');
      return jsonResponse({ success: true, ignored: 'no_action' });
    }

    throw new Error(`Unhandled action: ${action}`);
  } catch (error: any) {
    console.error('Error in Edge Function:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});


