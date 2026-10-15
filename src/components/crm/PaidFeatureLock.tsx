import { Crown, Lock, Megaphone, Bot, Check, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PaidFeatureLockProps {
  feature: "broadcast" | "ai";
}

const COPY = {
  broadcast: {
    icon: Megaphone,
    title: "Disparo em massa",
    text: "Envie templates, mensagens e fluxos para centenas de contatos de uma vez, com pausa, retomada e histórico completo.",
  },
  ai: {
    icon: Bot,
    title: "Agente I.A.",
    text: "Um atendente e vendedor inteligente respondendo seus clientes 24h, com seu prompt, arquivos e aviso de atendimento humano.",
  },
} as const;

/** Aviso exibido no lugar de recursos exclusivos dos planos pagos durante o teste grátis. */
export function PaidFeatureLock({ feature }: PaidFeatureLockProps) {
  const { icon: Icon, title, text } = COPY[feature];
  return (
    <div className="flex-1 overflow-auto p-4 md:p-8 bg-muted/5">
      <div className="max-w-xl mx-auto mt-4 md:mt-12 rounded-3xl border bg-card shadow-sm overflow-hidden">
        <div className="bg-primary/10 px-6 py-8 text-center space-y-3">
          <div className="relative mx-auto w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center">
            <Icon className="w-8 h-8 text-primary" aria-hidden />
            <span className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
            </span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            <Crown className="w-3.5 h-3.5" aria-hidden /> Exclusivo dos planos pagos
          </span>
          <h2 className="text-xl md:text-2xl font-bold text-foreground">{title} não está incluso no teste grátis</h2>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm font-semibold text-foreground">No teste grátis você já pode usar:</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {["Conversas e atendimento pelo CRM", "Fluxos automáticos e templates", "Contatos, etiquetas e Kanban"].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check className="w-4 h-4 text-primary" aria-hidden /> {t}</li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Disparo em massa e Agente I.A. são liberados automaticamente assim que você assina qualquer plano pago.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button asChild className="flex-1">
              <a href="/vendas#precos"><Crown className="w-4 h-4 mr-2" /> Ver planos e liberar agora</a>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <a href="https://wa.me/555192835863?text=Quero%20liberar%20o%20plano%20pago%20do%20zapmro" target="_blank" rel="noreferrer">
                <MessageCircle className="w-4 h-4 mr-2" /> Falar com a equipe
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PaidFeatureLock;
