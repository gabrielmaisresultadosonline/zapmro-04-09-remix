// Detecção local e barata de idioma: evita gastar tokens traduzindo uma
// mensagem que já está no idioma escolhido (ex.: português → português).
const STOPWORDS: Record<string, string[]> = {
  pt: ['de','que','não','nao','uma','um','para','com','você','voce','vc','é','está','esta','tá','ta','obrigado','obrigada','sim','olá','ola','oi','bom','dia','tudo','bem','meu','minha','quero','pode','por','favor','isso','mas','também','tambem','aqui','como','então','entao','já','ja','ok','blz','beleza'],
  en: ['the','and','you','is','are','to','of','for','with','this','that','what','hello','hi','thanks','thank','please','yes','can','have','my','your','not','do','how','want','good','morning'],
  es: ['el','la','los','las','que','de','y','usted','tú','es','está','gracias','hola','sí','por','favor','para','con','quiero','puede','buenos','días','bien','pero','muy','también','como','qué','yo'],
  fr: ['le','la','les','et','vous','est','je','bonjour','merci','oui','pour','avec','que','pas','une','des','très','bien','comment'],
  de: ['der','die','das','und','ich','sie','ist','nicht','danke','hallo','ja','bitte','mit','für','ein','eine','wie','gut'],
  it: ['il','lo','la','che','di','e','sono','grazie','ciao','sì','per','con','non','una','buongiorno','bene','come','vorrei'],
};
const SCRIPTS: Record<string, RegExp> = {
  ar: /[\u0600-\u06FF]/g, ja: /[\u3040-\u30FF]/g, zh: /[\u4E00-\u9FFF]/g,
  ru: /[\u0400-\u04FF]/g, ko: /[\uAC00-\uD7AF]/g, hi: /[\u0900-\u097F]/g,
};

/** Retorna true quando o texto claramente já está no idioma alvo. */
export function isAlreadyInLanguage(text: string, lang: string): boolean {
  const input = String(text || '').trim();
  if (!input) return false;
  const letters = input.replace(/[\s\d\p{P}\p{S}]/gu, '');
  // Só emoji, números ou pontuação: não há o que traduzir.
  if (!letters) return true;
  if (SCRIPTS[lang]) return (input.match(SCRIPTS[lang])?.length || 0) / letters.length > 0.5;
  if (/[^\u0000-\u024F\u1E00-\u1EFF]/.test(letters)) return false; // outro alfabeto
  const words = input.toLowerCase().match(/[\p{L}]+/gu) || [];
  if (!words.length) return true;
  const score = (l: string) => words.filter((w) => STOPWORDS[l].includes(w)).length;
  const target = STOPWORDS[lang] ? score(lang) : 0;
  if (!target) return false;
  const best = Math.max(...Object.keys(STOPWORDS).filter((l) => l !== lang).map(score));
  // pt/es compartilham palavras; exige vantagem clara do idioma alvo.
  return target > best || (words.length <= 2 && target >= best && target > 0 && lang === 'pt' && best === 0);
}
