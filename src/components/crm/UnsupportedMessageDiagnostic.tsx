import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Activity } from 'lucide-react';

/**
 * Log de diagnóstico exibido ao lado de mensagens "Conteúdo não disponível".
 * Mostra exatamente o que a Meta entregou no webhook (somente leitura, sem tokens),
 * para identificar a causa de cada ocorrência.
 */
interface MetaError { code?: number; title?: string; message?: string; error_data?: { details?: string } }
interface DiagnosticMessage {
  id?: string;
  created_at?: string;
  meta_message_id?: string;
  message_type?: string;
  metadata?: Record<string, unknown> | null;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function diagnose(m: DiagnosticMessage) {
  const meta = asRecord(m.metadata);
  const raw = asRecord(meta.raw);
  const errors = Array.isArray(raw.errors) ? (raw.errors as MetaError[]) : [];
  const err = errors[0] || {};
  const referral = raw.referral || asRecord(raw.unsupported).referral || meta.ad_referral || meta.referral;
  const code = err.code ? String(err.code) : '';
  const details = String(err.error_data?.details || err.message || '').trim();
  const unsupportedType = String(asRecord(raw.unsupported).type || '');
  const hasContext = Boolean(raw.context);

  let cause = 'A Meta enviou a mensagem sem conteúdo legível. Nenhum dado adicional foi informado.';
  if (code === '131060' || /unavailable/i.test(details)) {
    cause = referral
      ? 'Código 131060 com dados de anúncio: a Meta registrou o clique no anúncio, mas reteve o conteúdo da mensagem. Acontece em números em coexistência (app + API) e em anúncios com formato não suportado pela API.'
      : 'Código 131060 sem dados de anúncio: a Meta reteve o conteúdo. Causas comuns: mensagem enviada de recurso novo do WhatsApp (visualização única, enquete, evento, edição), aparelho do cliente desatualizado, ou anúncio em número em coexistência.';
  } else if (code === '131051') {
    cause = 'Código 131051: tipo de mensagem não suportado pela API da Meta.';
  } else if (unsupportedType) {
    cause = `A Meta informou o tipo "${unsupportedType}", que a API ainda não entrega ao CRM.`;
  }

  return {
    cause,
    rows: [
      ['Recebida em', m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : '—'],
      ['ID Meta', m.meta_message_id || String(raw.id || '—')],
      ['Tipo informado', String(raw.type || m.message_type || '—')],
      ['Subtipo', unsupportedType || '—'],
      ['Código de erro', code || '—'],
      ['Título', err.title || '—'],
      ['Detalhe', details || '—'],
      ['Veio de anúncio', referral ? 'Sim (referral recebido)' : 'Não informado pela Meta'],
      ['Resposta a outra mensagem', hasContext ? 'Sim' : 'Não'],
      ['Origem do registro', String(meta.source || 'webhook')],
    ] as Array<[string, string]>,
    rawJson: JSON.stringify(raw, null, 2),
  };
}

export function UnsupportedMessageDiagnostic({ message }: { message: DiagnosticMessage }) {
  const [open, setOpen] = useState(false);
  const d = diagnose(message);
  const copy = () => {
    const text = `${d.rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\nCausa provável: ${d.cause}\n\nPayload:\n${d.rawJson}`;
    void navigator.clipboard?.writeText(text);
  };
  return (
    <div className="mt-2 rounded-md border border-border/40 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-foreground"
        aria-expanded={open}
      >
        <Activity className="h-3 w-3" /> Log do erro
        {open ? <ChevronUp className="ml-auto h-3 w-3" /> : <ChevronDown className="ml-auto h-3 w-3" />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/30 px-2 py-2 text-[10.5px]">
          <p className="text-foreground"><span className="font-semibold">Causa provável:</span> {d.cause}</p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
            {d.rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-all text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <details>
            <summary className="cursor-pointer text-muted-foreground">Dados brutos da Meta</summary>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-1.5">{d.rawJson}</pre>
          </details>
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-primary">
            <Copy className="h-3 w-3" /> Copiar log
          </button>
        </div>
      )}
    </div>
  );
}
