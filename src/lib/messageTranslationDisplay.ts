type TranslationMessage = {
  message_type: string;
  content?: string | null;
  isOptimistic?: boolean;
  metadata?: { translation_original?: string } | null;
};
type TranslationResult = { original_text: string; translated_text: string };

export function getMessageTranslationDisplay(message: TranslationMessage, translation?: TranslationResult) {
  const original = translation?.original_text || message.metadata?.translation_original || '';
  const translated = translation?.translated_text || message.content || '';
  const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ');
  const showPair = !message.isOptimistic && Boolean(original.trim() && translated.trim()) && normalize(original) !== normalize(translated);
  return {
    original,
    translated,
    showPair,
    replaceBody: showPair && ['text', 'template'].includes(message.message_type),
  };
}