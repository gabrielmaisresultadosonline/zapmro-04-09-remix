import { AlertTriangle, CheckCircle2, Clock, FileCheck2, Megaphone, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConversationPricingGuide from "./ConversationPricingGuide";

interface RuleItem {
  icon: typeof Clock;
  title: string;
  description: string;
}

const RULE_ITEMS: RuleItem[] = [
  {
    icon: Clock,
    title: "Conversa comum: janela de 24 horas",
    description:
      "Quando o cliente envia uma mensagem, abre-se uma janela de 24 horas. Dentro desse período, você pode responder com mensagens livres pela ferramenta. Cada nova mensagem recebida do cliente reinicia a contagem de 24 horas.",
  },
  {
    icon: Megaphone,
    title: "Anúncio Click-to-WhatsApp: janela de 72 horas",
    description:
      "Quando a conversa começa por um anúncio Click-to-WhatsApp, a Meta pode liberar uma janela especial de 72 horas a partir da entrada pelo anúncio. O sistema identifica essa origem automaticamente. Se também houver uma mensagem recente do cliente, vale a janela que terminar mais tarde. Nessas 72 horas as mensagens da empresa não são cobradas pela Meta e não consomem as 1.000 respostas grátis do mês.",
  },
  {
    icon: FileCheck2,
    title: "Fora da janela: use um template aprovado",
    description:
      "Quando o prazo termina, mensagens livres ficam bloqueadas. Para iniciar ou retomar a conversa pela API oficial, é necessário usar um template aprovado pela Meta, sujeito à cobrança aplicável à categoria da mensagem.",
  },
];

export function ConversationRulesGuide() {
  return (
    <main className="flex-1 overflow-y-auto bg-muted/20">
      <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 pb-20 sm:px-6 md:py-10">
        <header className="space-y-4 border-b border-border pb-6">
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            Regras da API oficial da Meta
          </Badge>
          <div className="max-w-3xl space-y-2">
            <h2 className="text-2xl font-bold text-foreground md:text-3xl">Janelas de atendimento do WhatsApp</h2>
            <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
              Estas regras definem quando você pode enviar uma mensagem livre, quando precisa usar um template aprovado
              e quanto cada envio custa. Elas são determinadas pela Meta e valem para qualquer ferramenta conectada à
              API oficial do WhatsApp.
            </p>
          </div>
        </header>

        <section aria-labelledby="regras-principais" className="space-y-4">
          <h3 id="regras-principais" className="text-lg font-bold text-foreground">Como funciona</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {RULE_ITEMS.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="border-border shadow-sm">
                <CardHeader className="space-y-3 p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <CardTitle className="text-base leading-snug">{title}</CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 pt-0">
                  <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section aria-labelledby="indicadores-da-janela" className="space-y-4">
          <div>
            <h3 id="indicadores-da-janela" className="text-lg font-bold text-foreground">Onde conferir o tempo disponível</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Você encontra o indicador em dois lugares: na lista de conversas, abaixo do contato, e no topo da conversa aberta.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-bold text-foreground">Indicador com horas disponíveis</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  A janela está aberta. Você pode enviar mensagens livres pela ferramenta durante o tempo mostrado.
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-bold text-foreground">Indicador vermelho: janela expirada</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  O tempo terminou. Pela API oficial, envie um template aprovado ou use o celular no modo de coexistência.
                </p>
              </div>
            </div>
          </div>
        </section>

        <ConversationPricingGuide />

        <section aria-labelledby="coexistencia" className="rounded-lg border border-accent/30 bg-accent/10 p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent-foreground">
              <Smartphone className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-3">
              <h3 id="coexistencia" className="text-lg font-bold text-foreground">Como usar a coexistência a seu favor</h3>
              <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
                Se você usa o WhatsApp Business no celular junto com a API oficial, pode iniciar a conversa normalmente pelo
                aplicativo. Depois, aguarde o cliente responder. Assim que qualquer resposta dele chegar, uma nova janela de
                24 horas será aberta e você poderá continuar o atendimento pela nossa ferramenta com mensagens livres.
              </p>
              <p className="text-sm font-semibold leading-relaxed text-foreground">
                Importante: enviar uma mensagem pelo celular não abre a janela sozinho. A contagem começa quando o cliente responde.
              </p>
            </div>
          </div>
        </section>

        <footer className="flex gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="leading-relaxed">
            Mensagens enviadas pela empresa não prolongam a janela. Somente uma nova mensagem recebida do cliente reinicia o prazo de 24 horas.
          </p>
        </footer>
      </div>
    </main>
  );
}

export default ConversationRulesGuide;