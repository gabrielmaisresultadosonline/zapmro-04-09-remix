import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarClock, Wallet, Mic, ShieldCheck, MessageCircle, BarChart3 } from "lucide-react";

/** Página de vendas do Acessor (rota /acessor). */
const features = [
  { icon: Mic, title: "Manda áudio, ele entende", text: "Fale “gasolina 80 reais” e o Acessor anota sozinho no lugar certo." },
  { icon: Wallet, title: "Financeiro organizado", text: "Gastos, entradas e investimentos separados por categoria, sem planilha." },
  { icon: CalendarClock, title: "Agenda automática", text: "“Reunião amanhã 15h” vira compromisso no seu painel na hora." },
  { icon: MessageCircle, title: "Tudo pelo WhatsApp", text: "API oficial da Meta. Você usa o WhatsApp que já usa todo dia." },
  { icon: BarChart3, title: "Painel com tudo somado", text: "Totais do mês, próximos compromissos e histórico completo." },
  { icon: ShieldCheck, title: "Só o seu número responde", text: "Apenas números ativados no seu cadastro conversam com o agente." },
];

const AcessorLanding = () => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <span className="text-lg font-bold tracking-tight">Acessor</span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><Link to="/acessor/login">Entrar</Link></Button>
          <Button asChild size="sm"><Link to="/acessor/login?cadastro=1">Testar 2 dias</Link></Button>
        </div>
      </div>
    </header>

    <main>
      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <p className="mb-3 text-sm font-medium text-muted-foreground">Agente de agendamentos e organização financeira</p>
        <h1 className="text-3xl font-bold leading-tight md:text-5xl">
          Mande um áudio no WhatsApp. O resto o Acessor organiza.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Gastos, entradas, investimentos e compromissos anotados automaticamente a partir das suas
          mensagens — com painel próprio para acompanhar tudo.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg"><Link to="/acessor/login?cadastro=1">Começar teste de 2 dias</Link></Button>
          <Button asChild size="lg" variant="outline"><Link to="/acessor/login">Já tenho cadastro</Link></Button>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl grid-cols-1 gap-4 px-4 pb-16 md:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <Card key={title}>
            <CardContent className="p-5">
              <Icon className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
              <h2 className="mb-1 font-semibold">{title}</h2>
              <p className="text-sm text-muted-foreground">{text}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-2xl font-bold">Como funciona</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              "Crie seu cadastro e ganhe 2 dias de teste.",
              "Ative o seu número de WhatsApp no painel.",
              "Fale com o agente e veja tudo organizado.",
            ].map((step, index) => (
              <li key={step} className="rounded-lg border border-border bg-background p-4">
                <span className="text-sm font-semibold text-primary">Passo {index + 1}</span>
                <p className="mt-1 text-sm text-muted-foreground">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>

    <footer className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-muted-foreground">
      Acessor — agente com WhatsApp API oficial da Meta.
    </footer>
  </div>
);

export default AcessorLanding;
