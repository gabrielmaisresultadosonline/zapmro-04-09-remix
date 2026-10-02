/**
 * Versão servidor (Deno) da camada de variáveis de templates.
 * Espelha `src/lib/templateVariables.ts`: mesma resolução de campos do contato
 * e mesma montagem dos `components` da Cloud API, para que agendamentos e
 * automações possam enviar `templateConfig` em vez de componentes prontos.
 */

export interface TemplateSendConfig {
  headerMediaUrl?: string;
  headerDocumentFilename?: string;
  headerValues?: Record<string, string>;
  bodyValues?: Record<string, string>;
  buttonValues?: Record<string, string>;
}

export interface ServerTemplateSchema {
  headerKind: string;
  headerVariables: number[];
  bodyVariables: number[];
  urlButtonIndexes: number[];
  isCarousel: boolean;
}

const VARIABLE_PATTERN = /\{\{(\d+)\}\}/g;

const uniqueSortedVariables = (text: unknown): number[] =>
  Array.from(new Set(Array.from(String(text || '').matchAll(VARIABLE_PATTERN), m => Number(m[1])))).sort((a, b) => a - b);

export function parseServerTemplateSchema(components: unknown): ServerTemplateSchema {
  const list: any[] = Array.isArray(components) ? components : [];
  const header = list.find(c => c?.type === 'HEADER');
  const body = list.find(c => c?.type === 'BODY');
  const buttons = list.find(c => c?.type === 'BUTTONS')?.buttons;
  const headerKind = String(header?.format || 'NONE').toUpperCase();
  return {
    headerKind,
    headerVariables: headerKind === 'TEXT' ? uniqueSortedVariables(header?.text) : [],
    bodyVariables: uniqueSortedVariables(body?.text),
    urlButtonIndexes: Array.isArray(buttons)
      ? buttons.map((b: any, i: number) => ({ b, i })).filter(({ b }) => String(b?.type || '').toUpperCase() === 'URL' && /\{\{1\}\}/.test(String(b?.url || ''))).map(({ i }) => i)
      : [],
    isCarousel: list.some(c => c?.type === 'CAROUSEL'),
  };
}

export const isMediaHeader = (kind: string) => kind === 'IMAGE' || kind === 'VIDEO' || kind === 'DOCUMENT';

const readMetadataField = (contact: any, keys: string[]): string => {
  const metadata = (contact?.metadata && typeof contact.metadata === 'object') ? contact.metadata : {};
  for (const key of keys) {
    const value = metadata[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
};

export function resolveContactTokens(raw: string, contact: any): string {
  const now = new Date();
  const name = String(contact?.name || '').trim();
  const phone = String(contact?.wa_id || '').trim();
  const displayName = name && name !== phone ? name : phone;
  const map: Record<string, string> = {
    nome: displayName,
    primeiro_nome: displayName.split(/\s+/)[0] || displayName,
    telefone: phone,
    email: readMetadataField(contact, ['email', 'e-mail', 'Email']),
    codigo: readMetadataField(contact, ['codigo', 'código', 'code']),
    pedido: readMetadataField(contact, ['pedido', 'order', 'order_id']),
    protocolo: readMetadataField(contact, ['protocolo', 'protocol', 'ticket']),
    empresa: readMetadataField(contact, ['empresa', 'company']),
    etiqueta: String(contact?.status || ''),
    data: now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
  };
  return String(raw ?? '').replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, (full, key: string) => {
    const normalized = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, normalized) ? map[normalized] : full;
  });
}

export const sanitizeParameterText = (value: string): string =>
  String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, '    ').trim();

/** Monta `components` a partir de uma configuração salva e do contato destino. */
export function buildServerTemplateComponents(schema: ServerTemplateSchema, config: TemplateSendConfig, contact: any): any[] {
  const components: any[] = [];
  const resolve = (raw: string | undefined) => sanitizeParameterText(resolveContactTokens(raw ?? '', contact));
  const headerValues = config.headerValues || {};
  const bodyValues = config.bodyValues || {};
  const buttonValues = config.buttonValues || {};

  if (isMediaHeader(schema.headerKind) && config.headerMediaUrl) {
    const key = schema.headerKind.toLowerCase();
    const media: Record<string, unknown> = { link: String(config.headerMediaUrl).trim() };
    if (schema.headerKind === 'DOCUMENT' && config.headerDocumentFilename) media.filename = config.headerDocumentFilename;
    components.push({ type: 'header', parameters: [{ type: key, [key]: media }] });
  } else if (schema.headerKind === 'TEXT' && schema.headerVariables.length > 0) {
    components.push({ type: 'header', parameters: schema.headerVariables.map(v => ({ type: 'text', text: resolve(headerValues[String(v)]) || '-' })) });
  }
  if (schema.bodyVariables.length > 0) {
    components.push({ type: 'body', parameters: schema.bodyVariables.map(v => ({ type: 'text', text: resolve(bodyValues[String(v)]) || '-' })) });
  }
  schema.urlButtonIndexes.forEach(index => {
    components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: resolve(buttonValues[String(index)]) || '-' }] });
  });
  return components;
}

export interface TemplateStructureIssue {
  code: string;
  message: string;
}

/**
 * Garante que os componentes enviados correspondem à estrutura aprovada.
 * Retorna a lista de problemas; vazia significa "pode enviar".
 */
export function validateComponentsAgainstSchema(schema: ServerTemplateSchema, components: any[]): TemplateStructureIssue[] {
  const issues: TemplateStructureIssue[] = [];
  if (schema.isCarousel) return issues; // carrossel tem montagem própria
  const list = Array.isArray(components) ? components : [];
  const header = list.find(c => String(c?.type || '').toLowerCase() === 'header');
  const body = list.find(c => String(c?.type || '').toLowerCase() === 'body');
  const buttons = list.filter(c => String(c?.type || '').toLowerCase() === 'button');

  if (isMediaHeader(schema.headerKind)) {
    const key = schema.headerKind.toLowerCase();
    const media = header?.parameters?.[0]?.[key];
    if (!media?.link && !media?.id) {
      issues.push({ code: 'TEMPLATE_HEADER_MEDIA_REQUIRED', message: `O template exige ${key === 'image' ? 'uma imagem' : key === 'video' ? 'um vídeo' : 'um documento'} no cabeçalho.` });
    }
  } else if (schema.headerVariables.length > 0) {
    const count = Array.isArray(header?.parameters) ? header.parameters.length : 0;
    if (count !== schema.headerVariables.length) {
      issues.push({ code: 'TEMPLATE_HEADER_PARAMS_MISMATCH', message: `O cabeçalho exige ${schema.headerVariables.length} variável(is); recebidas ${count}.` });
    }
  }

  const bodyCount = Array.isArray(body?.parameters) ? body.parameters.length : 0;
  if (bodyCount !== schema.bodyVariables.length) {
    issues.push({ code: 'TEMPLATE_BODY_PARAMS_MISMATCH', message: `O corpo exige ${schema.bodyVariables.length} variável(is); recebidas ${bodyCount}.` });
  } else if (Array.isArray(body?.parameters)) {
    body.parameters.forEach((p: any, i: number) => {
      const text = String(p?.text ?? '').trim();
      if (!text || text === '-' || text === '---') {
        issues.push({ code: 'TEMPLATE_BODY_PARAM_EMPTY', message: `A variável {{${schema.bodyVariables[i]}}} do corpo está vazia.` });
      }
    });
  }

  schema.urlButtonIndexes.forEach(index => {
    const button = buttons.find(b => String(b?.index) === String(index));
    const value = String(button?.parameters?.[0]?.text ?? '').trim();
    if (!value || value === '-') {
      issues.push({ code: 'TEMPLATE_BUTTON_PARAM_REQUIRED', message: `O botão de link #${index + 1} exige um parâmetro dinâmico.` });
    }
  });

  return issues;
}

/** Resumo dos parâmetros realmente enviados, para o histórico da conversa. */
export function summarizeSentComponents(components: any[]) {
  const list = Array.isArray(components) ? components : [];
  const header = list.find(c => String(c?.type || '').toLowerCase() === 'header');
  const body = list.find(c => String(c?.type || '').toLowerCase() === 'body');
  const headerParam = header?.parameters?.[0];
  const headerMedia = headerParam ? (headerParam.image?.link || headerParam.video?.link || headerParam.document?.link || null) : null;
  return {
    header_media: headerMedia,
    header_parameters: headerMedia ? [] : (header?.parameters || []).map((p: any) => p?.text ?? ''),
    body_parameters: (body?.parameters || []).map((p: any) => p?.text ?? ''),
    button_parameters: list
      .filter(c => String(c?.type || '').toLowerCase() === 'button')
      .map(c => ({ index: Number(c?.index ?? 0), sub_type: c?.sub_type || 'url', value: c?.parameters?.[0]?.text ?? c?.parameters?.[0]?.payload ?? '' })),
  };
}

/**
 * Reproduz para o histórico o texto efetivamente enviado pela Cloud API.
 * O esquema aprovado fornece o texto fixo; os componentes do envio fornecem
 * os valores já resolvidos para aquele destinatário.
 */
export function renderSentTemplateContent(templateComponents: unknown, sentComponents: unknown): string {
  const approved = Array.isArray(templateComponents) ? templateComponents : [];
  const sent = Array.isArray(sentComponents) ? sentComponents : [];
  const findApproved = (type: string) => approved.find(component => String(component?.type || '').toUpperCase() === type);
  const findSent = (type: string) => sent.find(component => String(component?.type || '').toLowerCase() === type.toLowerCase());
  const fill = (text: unknown, parameters: unknown): string => {
    const values = Array.isArray(parameters) ? parameters : [];
    return String(text || '').replace(VARIABLE_PATTERN, (_match, index: string) => {
      const parameter = values[Number(index) - 1];
      return String(parameter?.text ?? parameter?.payload ?? `{{${index}}}`);
    });
  };

  const header = findApproved('HEADER');
  const body = findApproved('BODY');
  const footer = findApproved('FOOTER');
  const sentHeader = findSent('header');
  const sentBody = findSent('body');
  const parts: string[] = [];

  if (String(header?.format || '').toUpperCase() === 'TEXT' && header?.text) {
    parts.push(fill(header.text, sentHeader?.parameters));
  }
  if (body?.text) parts.push(fill(body.text, sentBody?.parameters));
  if (footer?.text) parts.push(String(footer.text));

  return parts.map(part => part.trim()).filter(Boolean).join('\n\n');
}
