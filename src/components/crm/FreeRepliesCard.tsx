import { HelpCircle, MessageCircleReply } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Franquia mensal de respostas (Service) por número — regra da Meta a partir de 01/10/2026. */
export const FREE_REPLIES_PER_MONTH = 1000;
/** Valor por resposta processada após a franquia. */
export const PAID_REPLY_COST = 0.035;

export interface FreeRepliesCardProps {
  /** Respostas enviadas com sucesso pela API oficial no mês (falhas e celular excluídos). */
  used: number;
  /** Abre a guia Regras. */
  onHelp: () => void;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function FreeRepliesCard({ used, onHelp }: FreeRepliesCardProps) {
  const safeUsed = Math.max(0, Math.floor(used || 0));
  const remaining = Math.max(0, FREE_REPLIES_PER_MONTH - safeUsed);
  const extra = Math.max(0, safeUsed - FREE_REPLIES_PER_MONTH);
  const pct = Math.min(100, (remaining / FREE_REPLIES_PER_MONTH) * 100);
  const exhausted = remaining === 0;

  return (
    <Card className="relative overflow-hidden border border-white/5 bg-[#0c1317] shadow-xl rounded-2xl p-1">
      <CardHeader className="flex flex-row items-center justify-between pb-1 px-5 pt-5 space-y-0">
        <CardDescription className="font-black text-[11px] md:text-xs uppercase tracking-[0.2em] text-sky-400/80">
          Respostas grátis (mês)
        </CardDescription>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-sky-300 hover:bg-sky-500/10 hover:text-sky-200"
            onClick={onHelp}
            aria-label="Entender como funcionam as respostas grátis"
            title="Como funciona? Ver Regras"
          >
            <HelpCircle className="w-4 h-4" />
          </Button>
          <MessageCircleReply className="w-5 h-5 text-sky-500" aria-hidden />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="flex items-baseline gap-1.5">
          <span className={cn('text-3xl md:text-5xl font-black tracking-tighter font-mono', exhausted ? 'text-red-400' : 'text-white')}>
            {remaining.toLocaleString('pt-BR')}
          </span>
          <span className="text-xs text-white/50">/ {FREE_REPLIES_PER_MONTH.toLocaleString('pt-BR')}</span>
        </div>
        <div className="mt-3 h-1.5 w-full bg-sky-500/10 rounded-full overflow-hidden">
          <div className={cn('h-full transition-all duration-1000', exhausted ? 'bg-red-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[11px] text-white/50">
          {safeUsed.toLocaleString('pt-BR')} usada(s) pela API oficial. Respostas pelo celular e na janela de anúncio (72h) não contam.
        </p>
        {extra > 0 && (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
            <strong>{extra.toLocaleString('pt-BR')}</strong> resposta(s) além da franquia × {brl(PAID_REPLY_COST)} ={' '}
            <strong>{brl(extra * PAID_REPLY_COST)}</strong>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
