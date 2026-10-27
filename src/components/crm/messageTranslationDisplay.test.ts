import { describe, expect, test } from 'bun:test';
import { getMessageTranslationDisplay } from '../../lib/messageTranslationDisplay';

describe('translated message content selection', () => {
  test('foreign text is replaced by its original and translation pair', () => {
    expect(getMessageTranslationDisplay({ message_type: 'text', content: 'Hello' }, { original_text: 'Hello', translated_text: 'Olá' })).toEqual({ original: 'Hello', translated: 'Olá', showPair: true, replaceBody: true });
  });
  test('text already in the configured language keeps the ordinary body', () => {
    expect(getMessageTranslationDisplay({ message_type: 'text', content: 'Olá' }, { original_text: 'Olá', translated_text: 'Olá' }).replaceBody).toBe(false);
  });
  test('whitespace-only changes do not replace the ordinary body', () => {
    expect(getMessageTranslationDisplay({ message_type: 'text' }, { original_text: 'Olá  João', translated_text: ' Olá João\n' }).showPair).toBe(false);
  });
  test('failed or pending translations never remove the original message', () => {
    expect(getMessageTranslationDisplay({ message_type: 'text', content: 'Hello' }).replaceBody).toBe(false);
    expect(getMessageTranslationDisplay({ message_type: 'text', content: 'Hello' }, { original_text: 'Hello', translated_text: '' }).replaceBody).toBe(false);
  });
  test('audio keeps its player alongside the translated transcript', () => {
    expect(getMessageTranslationDisplay({ message_type: 'audio' }, { original_text: 'Hello', translated_text: 'Olá' })).toMatchObject({ showPair: true, replaceBody: false });
  });
  test('template bodies and manually translated sends follow the same rule', () => {
    expect(getMessageTranslationDisplay({ message_type: 'template', content: 'Hello' }, { original_text: 'Hello', translated_text: 'Olá' }).replaceBody).toBe(true);
    expect(getMessageTranslationDisplay({ message_type: 'text', content: 'Hello', metadata: { translation_original: 'Olá' } }).replaceBody).toBe(true);
  });
});