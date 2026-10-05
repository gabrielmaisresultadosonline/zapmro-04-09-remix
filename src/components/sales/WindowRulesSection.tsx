import { Clock, Megaphone, FileCheck2, Ban } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface RuleCard {
  icon: typeof Clock;
  title: string;
  text: string;
}

const RULES: RuleCard[] = [
  {
    icon: Clock,
    title: "Janela de 24 horas",
    text: "Quando o cliente manda mensagem, você tem 24h para responder livremente. Cada nova mensagem dele reinicia o prazo.",
  },
  {
    icon: Megaphone,
    title: "72 horas para anúncios",
    text: "Clientes que chegam por anúncio Click-to-WhatsApp abrem uma janela especial de 72h, identificada automaticamente.",
  },
  {
    icon: Ban,
    title: "Fora da janela, sem mensagem livre",
    text: "Depois que o prazo acaba, o sistema bloqueia mensagens comuns em todos os módulos: chat, fluxos, IA e disparos.",
  },
  {
    icon: FileCheck2,
    title: "Template aprovado",
    text: "Para retomar o contato, envie um template aprovado pela Meta. Mensagens enviadas pela empresa não reabrem a janela.",
  },
];

/** Seção da página de vendas explicando as regras da API oficial. */
export function WindowRulesSection() {
  return (
    <section id="janela-atendimento" className="py-24 bg-white">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-14">
          <Badge className="mb-4 bg-green-100 text-green-700 hover:bg-green-100 border-green-200">Novas regras da API oficial</Badge>
          <h2 className="text-3xl md:text-5xl font-bold mb-4 text-slate-900">Janela de atendimento sob controle</h2>
          <p className="text-slate-600 text-lg">
            O CRM segue as regras da WhatsApp Business Platform automaticamente: mostra em cada conversa a origem,
            a última mensagem do cliente, o tipo de janela (24h ou 72h), quando ela expira e se está aberta ou expirada.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {RULES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-3xl border border-slate-100 bg-slate-50 p-6">
              <div className="w-12 h-12 rounded-2xl bg-green-100 text-green-700 flex items-center justify-center mb-4">
                <Icon className="w-6 h-6" aria-hidden />
              </div>
              <h3 className="font-bold text-lg mb-2 text-slate-900">{title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default WindowRulesSection;
