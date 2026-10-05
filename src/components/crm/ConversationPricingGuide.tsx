import { ArrowRightLeft, CheckCircle2, CircleDollarSign, Info, Lightbulb, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PriceRow {
  label: string;
  freeTier: string;
  paidTier: string;
  note: string;
}

const PRICE_ROWS: PriceRow[] = [
  {
    label: "Resposta normal (Service)",
    freeTier: "1.000 mensagens grátis por número, a cada mês",
    paidTier: "R$ 0,0350 por mensagem a partir da 1.001ª",
    note: "É a resposta livre que você envia dentro da janela de 24 horas.",
  },
  {
    label: "Utilidade (Utility)",
    freeTier: "entra na mesma franquia mensal do número",
    paidTier: "passou a ser cobrada em 01/10/2026, mesmo dentro da janela de 24h",
    note: "Avisos de pedido, entrega, confirmação e lembrete.",
  },
  {
    label: "Marketing",
    freeTier: "sem franquia gratuita",
    paidTier: "cobrado por mensagem enviada",
    note: "Ofertas e promoções. Confira a Calculadora de Custo antes de disparar.",
  },
];

/** Explica a cobrança por mensagem em vigor desde 1º de outubro de 2026. */
export function ConversationPricingGuide() {
  return (
    <section aria-labelledby="custo-mensagens" className="space-y-4">
      <div className="space-y-3">
        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
          Cobrança da Meta a partir de 01/10/2026
        </Badge>
        <div className="max-w-3xl space-y-2">
          <h3 id="custo-mensagens" className="text-lg font-bold text-foreground md:text-xl">
            Quanto custa cada mensagem
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
            Desde 1º de outubro de 2026 a Meta cobra <b className="text-foreground">por mensagem enviada pela API</b>,
            e não mais por conversa de 24 horas. A janela continua existindo: ela decide <i>se</i> você pode responder
            sem template. A cobrança decide <i>quanto</i> cada resposta custa.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PRICE_ROWS.map((row) => (
          <Card key={row.label} className="border-border shadow-sm">
            <CardHeader className="space-y-2 p-5 pb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CircleDollarSign className="h-5 w-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-base leading-snug">{row.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-5 pb-5">
              <p className="flex gap-2 text-sm font-semibold leading-relaxed text-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {row.freeTier}
              </p>
              <p className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
                <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                {row.paidTier}
              </p>
              <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">{row.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          A franquia é contada <b className="text-foreground">por número e por mês</b>: cada WhatsApp conectado tem
          suas 1.000 mensagens gratuitas e o contador recomeça no início de cada mês.
        </p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/10 p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <Lightbulb className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-3">
            <h4 className="text-lg font-bold text-foreground">Use o mínimo de respostas possível</h4>
            <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
              Cada resposta processada e enviada pela ferramenta conta para a franquia mensal. Responda de forma
              objetiva, junte as informações em uma única mensagem e evite confirmações desnecessárias:
              ficando dentro das 1.000 mensagens do número, o custo pela API é <b className="text-foreground">R$ 0</b>.
              Passou das 1.000, cada resposta passa a custar R$ 0,0350.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent/10 p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
            <Smartphone className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="space-y-3">
            <h4 className="text-lg font-bold text-foreground">O que sai do celular não é cobrado pela API</h4>
            <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
              Uma mensagem que o atendente escreve e envia manualmente pelo WhatsApp Business App não é uma chamada
              de envio da Cloud API. Por isso, ela não entra na contagem nem na cobrança da API: você pode responder
              o quanto quiser pelo celular sem pagar por isso.
            </p>
            <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Cloud API</p>
                <p className="mt-1 text-sm font-semibold text-foreground">Templates, automações e mensagens da ferramenta</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Contam para a franquia de 1.000 e são cobrados quando ela termina.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/60 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">WhatsApp Business App</p>
                <p className="mt-1 text-sm font-semibold text-foreground">Atendente respondendo pelo celular</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Não é envio da Cloud API: não é cobrado pela API.
                </p>
              </div>
            </div>
            <p className="text-sm font-semibold leading-relaxed text-foreground">
              Lembre: responder pelo celular não abre a janela de 24 horas sozinho. A janela começa quando o cliente responde.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ConversationPricingGuide;
