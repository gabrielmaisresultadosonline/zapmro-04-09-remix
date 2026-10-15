import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getActiveWhatsAppNumberId } from '@/lib/activeNumberContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Check, Copy, RefreshCcw, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "Gerar prompt pelos meus atendimentos": o servidor lê as conversas dos
 * últimos 5 dias do WhatsApp aberto (inclui áudios transcritos), separa
 * cliente x atendente e escreve o prompt. Roda em segundo plano: a tela só
 * acompanha o progresso e pode ser fechada a qualquer momento.
 */

interface PromptJob {
  id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  phase: 'reading' | 'writing' | 'done';
  cursor: number;
  total: number;
  message_count: number;
  audio_count: number;
  low_volume: boolean;
  result_prompt: string | null;
  error: string | null;
}

export interface PromptFromConversationsProps {
  onApply: (prompt: string) => void;
}

async function callJob(mode: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
    body: { action: 'promptJob', mode, whatsapp_number_id: getActiveWhatsAppNumberId(), ...extra },
  });
  if (error) throw error;
  return data as { success: boolean; job?: PromptJob | null; code?: string; conversations?: number; messages?: number; error?: string };
}

export function PromptFromConversations({ onApply }: PromptFromConversationsProps) {
  const [job, setJob] = useState<PromptJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [lowVolume, setLowVolume] = useState<{ conversations: number; messages: number } | null>(null);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await callJob('status');
      if (res?.success) setJob(res.job || null);
    } catch { /* tenta de novo na próxima volta */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const running = job?.status === 'running';
  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => { void refresh(); }, 3000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, refresh]);

  const start = async (force = false) => {
    setStarting(true);
    try {
      const res = await callJob('start', { force });
      if (res?.code === 'LOW_VOLUME') {
        setLowVolume({ conversations: res.conversations || 0, messages: res.messages || 0 });
        return;
      }
      if (!res?.success) { toast.error(res?.error || 'Não foi possível começar.'); return; }
      setLowVolume(null);
      setJob(res.job || null);
      toast.success('Lendo seus atendimentos em segundo plano. Pode navegar pelo CRM.');
    } catch (e: any) {
      toast.error(e?.message || 'Não foi possível começar.');
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    try { const res = await callJob('cancel'); setJob(res?.job || null); } catch { /* ignore */ }
  };

  const pct = !job ? 0 : job.status === 'done' ? 100
    : job.phase === 'writing' ? 95
    : Math.round(5 + (job.total ? (job.cursor / job.total) * 85 : 0));

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-primary" /> Gerar prompt pelos meus atendimentos</p>
          <p className="text-xs text-muted-foreground">Lê as conversas dos últimos 5 dias deste WhatsApp, ouve os áudios e monta um prompt completo no seu jeito de vender.</p>
        </div>
        {!running && (
          <Button size="sm" onClick={() => start(false)} disabled={starting} className="h-8 gap-1.5 text-xs">
            {starting ? <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {job?.status === 'done' ? 'Gerar de novo' : 'Gerar prompt'}
          </Button>
        )}
      </div>

      {lowVolume && (
        <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            Você tem poucos atendimentos neste WhatsApp nos últimos 5 dias ({lowVolume.conversations} conversa(s), {lowVolume.messages} mensagens). Faça mais atendimentos para o Agente aprender melhor e performar melhor.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => start(true)} disabled={starting}>Gerar mesmo assim</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setLowVolume(null)}>Agora não</Button>
          </div>
        </div>
      )}

      {running && job && (
        <div className="space-y-2">
          <Progress value={pct} />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{job.phase === 'writing'
              ? 'Escrevendo o prompt final com tudo que foi lido...'
              : `Lendo conversa ${Math.min(job.cursor + 1, job.total)} de ${job.total} · ${job.message_count} mensagens · ${job.audio_count} áudios ouvidos`}</span>
            <Button size="sm" variant="ghost" className="h-6 gap-1 text-xs" onClick={cancel}><X className="h-3 w-3" /> Cancelar</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Roda no servidor: pode sair desta tela, abrir conversas e voltar depois.</p>
        </div>
      )}

      {job?.status === 'failed' && (
        <p className="text-xs text-destructive">Não deu para terminar: {job.error || 'erro desconhecido'}</p>
      )}

      {job?.status === 'done' && job.result_prompt && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Prompt gerado a partir de {job.total} conversa(s), {job.message_count} mensagens e {job.audio_count} áudio(s). Fica salvo aqui.</p>
          <Textarea readOnly rows={8} value={job.result_prompt} className="resize-y bg-background font-mono text-xs" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onApply(job.result_prompt as string)}>
              <Check className="h-3.5 w-3.5" /> Usar como Prompt do System
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
              onClick={() => { void navigator.clipboard.writeText(job.result_prompt || ''); toast.success('Prompt copiado.'); }}>
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
