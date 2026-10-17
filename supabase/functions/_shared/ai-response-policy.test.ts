import { describe, expect, it } from 'bun:test';
import { resolveAiResponseDecision } from './ai-response-policy.ts';

describe('contextual acknowledgment response policy', () => {
  it('permits no response after the company already replied', () => {
    expect(resolveAiResponseDecision('[[NAO_RESPONDER]]', true)).toEqual({ silent: true, reply: '' });
  });
  it('does not silence a first contact without a company response', () => {
    expect(resolveAiResponseDecision('[[NAO_RESPONDER]]', false).silent).toBe(false);
  });
  it('allows internal classification without sending another acknowledgment', () => {
    expect(resolveAiResponseDecision('[[NAO_RESPONDER]] [[KANBAN:cliente]] [[ETIQUETA:Aguardando]]', true))
      .toEqual({ silent: true, reply: '[[KANBAN:cliente]] [[ETIQUETA:Aguardando]]' });
  });
  it('preserves answers to new requests even if the model mixes control and text', () => {
    expect(resolveAiResponseDecision('[[NAO_RESPONDER]] O prazo é amanhã.', true))
      .toEqual({ silent: false, reply: 'O prazo é amanhã.' });
  });
  it('does not swallow a pending file delivery', () => {
    expect(resolveAiResponseDecision('[[NAO_RESPONDER]] [[ENVIAR:contrato]]', true))
      .toEqual({ silent: false, reply: '[[ENVIAR:contrato]]' });
  });
  it('does not swallow a confirmed human transfer', () => {
    expect(resolveAiResponseDecision('[[NAO_RESPONDER]] [[TRANSFER_TO_HUMAN]]', true))
      .toEqual({ silent: false, reply: '[[TRANSFER_TO_HUMAN]]' });
  });
  it('does not suppress ok by keyword when a response is needed', () => {
    expect(resolveAiResponseDecision('Ok, vou confirmar sua contratação.', true))
      .toEqual({ silent: false, reply: 'Ok, vou confirmar sua contratação.' });
  });
});