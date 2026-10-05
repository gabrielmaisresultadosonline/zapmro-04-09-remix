import { Check, MessageCircle, ShieldCheck, Zap, BarChart3, Bot, Clock, Users, ArrowRight, Star, Layout, Smartphone, BrainCircuit, Sparkles, MessageSquareQuote, MousePointerClick, Columns, Send, BadgeCheck, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/Logo";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import PurchaseDialog, { type PlanKey } from "@/components/sales/PurchaseDialog";
import SalesTutorials from "@/components/sales/SalesTutorials";
import WindowRulesSection from "@/components/sales/WindowRulesSection";
import { useState } from "react";
 import whatsappGirlBgImg from "@/assets/whatsapp-meta-hero.png";
 const metaBgImg = "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&q=80&w=2000";
const professionalButtonsImg = "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&q=80&w=800";
const interactiveChatImg = "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&q=80&w=800";
const productCarouselImg = "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=800";
const appDashboardImg = "https://images.unsplash.com/photo-1675271591211-126ad94e495d?auto=format&fit=crop&q=80&w=800";
 
  const Sales = () => {
     const [buyOpen, setBuyOpen] = useState(false);
     const [buyPlan, setBuyPlan] = useState<PlanKey>("mensal");
      const [menuOpen, setMenuOpen] = useState(false);
     const openBuy = (p: PlanKey) => { setBuyPlan(p); setBuyOpen(true); };
   const features = [
     {
       icon: <MessageCircle className="w-6 h-6 text-green-500" />,
       title: "API Oficial Meta",
       description: "Conecte-se diretamente com a infraestrutura oficial do WhatsApp para maior estabilidade e segurança."
     },
     {
       icon: <Bot className="w-6 h-6 text-green-500" />,
       title: "Agente de IA",
       description: "Automação inteligente com GPT para responder seus clientes 24/7 de forma humanizada."
     },
     {
       icon: <Zap className="w-6 h-6 text-green-500" />,
       title: "Fluxos de Automação",
       description: "Crie sequências de mensagens e funis de vendas complexos de forma visual e intuitiva."
     },
     {
       icon: <BarChart3 className="w-6 h-6 text-green-500" />,
       title: "Métricas Detalhadas",
       description: "Acompanhe conversas pagas, ativas e o ROI de suas campanhas em tempo real."
     },
     {
       icon: <Users className="w-6 h-6 text-green-500" />,
       title: "Gestão de Contatos",
       description: "CRM completo com Kanban, tags e sincronização automática com Google Contacts."
     },
     {
       icon: <Clock className="w-6 h-6 text-green-500" />,
       title: "Agendamentos",
       description: "Programe envios em massa ou individuais para datas e horários específicos."
     }
   ];
 
   const brands = ["Claro", "Vivo", "Magazine Luiza", "Benoit"];
 
   return (
     <div className="min-h-screen bg-white font-sans text-slate-900">
        {/* Header */}
         <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-slate-100">
           <div className="container mx-auto px-4 py-3 md:h-16 flex items-center justify-between gap-3">
             {/* Mobile menu button (replaces logo on mobile) */}
             <Button
               variant="ghost"
               size="icon"
               className="md:hidden shrink-0"
               onClick={() => setMenuOpen(o => !o)}
               aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
             >
               {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
             </Button>

             {/* Logo visible only on desktop header */}
             <Link to="/vendas" className="hidden md:block bg-[#050508] p-2 rounded-xl">
               <Logo size="sm" />
             </Link>

             {/* Desktop nav */}
             <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
               <Link to="/vendas/tutoriais" className="whitespace-nowrap hover:text-green-600 transition-colors">Tutoriais</Link>
               <Link to="/vendas/verificar-portfolio" className="whitespace-nowrap hover:text-green-600 transition-colors text-orange-600 font-semibold">
                 Precisa verificar seu portfólio?
               </Link>
               <a href="#precos" className="whitespace-nowrap hover:text-green-600 transition-colors">Preços</a>
             </nav>

             <Link to="/crm/login">
               <Button className="bg-green-600 hover:bg-green-700 text-white rounded-full px-6">
                 Entrar no CRM
               </Button>
             </Link>
           </div>

           {/* Mobile dropdown menu */}
           {menuOpen && (
             <div className="md:hidden border-t border-slate-100 bg-white/95 backdrop-blur-md">
               <nav className="container mx-auto px-4 py-4 flex flex-col gap-3 text-sm font-medium">
                 <Link to="/vendas/tutoriais" onClick={() => setMenuOpen(false)} className="py-2 hover:text-green-600 transition-colors">Tutoriais</Link>
                 <Link to="/vendas/verificar-portfolio" onClick={() => setMenuOpen(false)} className="py-2 hover:text-green-600 transition-colors text-orange-600 font-semibold">
                   Precisa verificar seu portfólio?
                 </Link>
                 <a href="#precos" onClick={() => setMenuOpen(false)} className="py-2 hover:text-green-600 transition-colors">Preços</a>
               </nav>
             </div>
           )}
          </header>

          {/* Hero Section */}
        <section className="pt-28 md:pt-32 pb-20 bg-gradient-to-b from-green-50 to-white">
          <div className="container mx-auto px-4 text-center">
            {/* Mobile logo + badge centered */}
            <div className="md:hidden flex flex-col items-center mb-4">
              <Link to="/vendas" className="bg-[#050508] p-3 rounded-2xl mb-4">
                <Logo size="sm" />
              </Link>
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none px-4 py-1">
                🚀 API Oficial WhatsApp Business
              </Badge>
            </div>
            {/* Desktop badge */}
            <Badge className="hidden md:inline-flex mb-4 bg-green-100 text-green-700 hover:bg-green-100 border-none px-4 py-1">
              🚀 API Oficial WhatsApp Business
            </Badge>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 max-w-4xl mx-auto leading-tight">
              WhatsApp API Oficial
            </h1>
            <p className="text-xl md:text-2xl text-slate-700 mb-6 max-w-3xl mx-auto leading-relaxed">
              Não perca nunca mais o seu número! Utilize a forma correta para não ter problema. <span className="font-semibold text-green-600">Teste grátis 2 dias.</span>
            </p>
           <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto">
             Atenda seus clientes de forma profissional, automatize suas vendas e tenha a segurança de uma conexão oficial sem riscos de bloqueio.
           </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
               <Button
                 size="lg"
                 onClick={() => document.getElementById("precos")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                 className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white text-lg px-8 py-6 rounded-2xl w-full sm:w-auto shadow-lg shadow-green-200 group"
               >
                 Escolher meu plano
                 <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
               </Button>
             <Link to="/crm/login?mode=register">
               <Button size="lg" className="bg-green-600 hover:bg-green-700 text-white text-lg px-8 py-6 rounded-2xl w-full sm:w-auto shadow-lg shadow-green-200 group">
                 Teste grátis por 2 dias
                 <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
               </Button>
             </Link>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                 Sem cartão • Acesso trava após 2 dias
              </div>
            </div>


            {/* Info CTA - Como Funciona */}
            {/* Main Banner / Hero Image */}
            <div className="mt-16 relative max-w-5xl mx-auto group">
              <div className="absolute -inset-1 bg-gradient-to-r from-green-600 to-blue-600 rounded-[2.5rem] blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
               <div className="relative aspect-[16/9] md:aspect-[21/9] bg-slate-900 rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
                  <img
                    src={whatsappGirlBgImg}
                    alt="WhatsApp CRM em uso real"
                    className="w-full h-full object-contain bg-slate-900 transform transition duration-500 group-hover:scale-105"
                  />
                 <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/40 to-transparent flex items-end">
                  <div className="p-8 text-left w-full">
                    <div className="flex items-center gap-5">
                        <div className="flex flex-col md:flex-row items-center gap-6 bg-white/5 backdrop-blur-2xl p-6 rounded-[2rem] border border-white/20 shadow-2xl relative overflow-hidden group/meta">
                          {/* Meta Background Image */}
                          <div className="absolute inset-0 opacity-20 group-hover/meta:opacity-30 transition-opacity duration-700">
                            <img 
                              src={metaBgImg} 
                              alt="Meta Background" 
                              className="w-full h-full object-cover"
                            />
                          </div>
                          
                          <div className="relative shrink-0 z-10">
                            <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl border-2 border-blue-500 shadow-2xl bg-white flex items-center justify-center">
                              <ShieldCheck className="w-12 h-12 text-blue-600" />
                            </div>
                         </div>
                         
                          <div className="text-center md:text-left z-10">
                           <div className="flex items-center justify-center md:justify-start gap-3 mb-2">
                             <div className="bg-white px-3 py-1.5 rounded-lg shadow-sm flex items-center gap-3">
                               <img 
                                 src="https://upload.wikimedia.org/wikipedia/commons/7/7b/Meta_Platforms_Inc._logo.svg" 
                                 alt="Meta" 
                                 className="h-4 w-auto"
                               />
                               <div className="w-px h-3 bg-slate-200"></div>
                               <img 
                                 src="https://upload.wikimedia.org/wikipedia/commons/0/05/Facebook_Logo_%282019%29.png" 
                                 alt="Facebook" 
                                 className="h-4 w-auto"
                               />
                             </div>
                             <Badge className="bg-green-500 hover:bg-green-500 text-white border-none text-[10px] font-bold uppercase tracking-wider">
                               Oficial
                             </Badge>
                           </div>
                           <h3 className="text-white font-black text-2xl md:text-3xl tracking-tight">Plataforma Oficial Meta</h3>
                           <p className="text-green-400 font-semibold flex items-center justify-center md:justify-start gap-2">
                             <ShieldCheck className="w-5 h-5" />
                             Segurança e estabilidade garantida pela Meta
                           </p>
                         </div>
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
         </div>
       </section>
 
         {/* Meta Integration & Brands */}
         <section className="py-20 bg-white border-y border-slate-100 overflow-hidden relative">
           <div className="container mx-auto px-4">
             <div className="flex flex-col lg:flex-row items-center justify-between gap-12 mb-16">
                <div className="flex flex-col md:flex-row items-center gap-8 bg-slate-50/50 backdrop-blur-sm p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                 <div className="flex items-center gap-6">
                   <img 
                     src="https://upload.wikimedia.org/wikipedia/commons/7/7b/Meta_Platforms_Inc._logo.svg" 
                     alt="Meta" 
                     className="h-10 w-auto" 
                   />
                   <div className="w-px h-8 bg-slate-300"></div>
                   <img 
                     src="https://upload.wikimedia.org/wikipedia/commons/0/05/Facebook_Logo_%282019%29.png" 
                     alt="Facebook" 
                     className="h-10 w-auto" 
                   />
                 </div>
                 <div className="hidden md:block w-px h-12 bg-slate-200"></div>
                  <div className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-100">
                    <div className="bg-green-500 rounded-full p-2 shadow-sm shadow-green-200">
                      <ShieldCheck className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Parceiro</p>
                      <p className="text-sm font-black text-slate-900">Verificado</p>
                    </div>
                 </div>
               </div>
 
               <div className="flex flex-col items-center lg:items-end gap-4">
                 <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Empresas que confiam em nossa tecnologia</p>
                 <div className="flex flex-wrap justify-center lg:justify-end items-center gap-8 md:gap-12 opacity-40 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-700">
                   {brands.map(brand => (
                     <span key={brand} className="text-xl md:text-2xl font-black text-slate-800 tracking-tighter">{brand}</span>
                   ))}
                 </div>
               </div>
             </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="font-bold text-sm">Anti-Banimento</p>
                  <p className="text-xs text-slate-500">API Oficial Meta</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
                  <Zap className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="font-bold text-sm">Escalabilidade</p>
                  <p className="text-xs text-slate-500">Milhares de envios/dia</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center shrink-0">
                  <Bot className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="font-bold text-sm">I.A Nativa</p>
                  <p className="text-xs text-slate-500">ChatGPT Integrado</p>
                </div>
              </div>
              <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center shrink-0">
                  <MousePointerClick className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <p className="font-bold text-sm">Botões CTA</p>
                  <p className="text-xs text-slate-500">Alta Conversão</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Mass Sending Deep Dive */}
        <section className="py-20 md:py-24 bg-gradient-to-b from-white to-slate-50 border-y border-slate-100 overflow-hidden relative">
          <div className="container mx-auto px-4 relative z-10">
            <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
              <Badge className="mb-4 bg-orange-100 text-orange-700 hover:bg-orange-100 border-none px-4 py-1">
                <Send className="w-3.5 h-3.5 mr-2" />
                Envio em Massa Inteligente
              </Badge>
              <h2 className="text-3xl md:text-5xl font-bold mb-6 text-slate-900 leading-tight">
                Disparos em massa
              </h2>
              <p className="text-xl md:text-2xl text-slate-700 leading-relaxed mb-4">
                Envios sem bloquear o número. A partir de <span className="font-bold text-green-600">R$0,04</span>.
              </p>
              <p className="text-lg text-slate-600 leading-relaxed">
                Existem <span className="font-semibold text-slate-900">3 formas de envio em massa</span> dentro da API Oficial do WhatsApp. A mais barata hoje é <span className="font-bold text-green-600">R$0,04 centavos</span> por mensagem.
              </p>
            </div>


            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
              {/* Utility */}
              <Card className="border-2 border-green-500/20 shadow-lg shadow-green-100/50 overflow-hidden bg-white">
                <CardHeader className="pb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center mb-4">
                    <Send className="w-6 h-6 text-green-600" />
                  </div>
                  <CardTitle className="text-xl text-slate-900">Templates Utility</CardTitle>
                  <CardDescription className="text-slate-600">Notificações, lembretes e atualizações</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-3xl font-black text-green-600">R$0,04</span>
                    <span className="text-sm text-slate-500">/envio</span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    A forma mais barata de envio em massa. Ideal para avisar clientes, confirmar pedidos e enviar lembretes automáticos sem bloquear o número.
                  </p>
                </CardContent>
                <CardFooter className="pt-0">
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-none">Mais econômico</Badge>
                </CardFooter>
              </Card>

              {/* Marketing */}
              <Card className="border border-slate-200 shadow-sm overflow-hidden bg-white">
                <CardHeader className="pb-4">
                  <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center mb-4">
                    <Sparkles className="w-6 h-6 text-orange-600" />
                  </div>
                  <CardTitle className="text-xl text-slate-900">Templates Marketing</CardTitle>
                  <CardDescription className="text-slate-600">Campanhas, promoções e ofertas</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-3xl font-black text-orange-600">R$0,33</span>
                    <span className="text-sm text-slate-500">/envio</span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Envie campanhas promocionais para sua base de contatos com botões interativos, carrossel e alta taxa de entrega.
                  </p>
                </CardContent>
              </Card>

              {/* Multimedia */}
              <Card className="border border-slate-200 shadow-sm overflow-hidden bg-white">
                <CardHeader className="pb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mb-4">
                    <Smartphone className="w-6 h-6 text-blue-600" />
                  </div>
                  <CardTitle className="text-xl text-slate-900">Mídia + Botões</CardTitle>
                  <CardDescription className="text-slate-600">Imagens, vídeos e carrossel interativo</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-black text-blue-600 whitespace-nowrap">A partir de R$0,04</span>
                    <span className="text-sm text-slate-500">/envio</span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Envie imagens, vídeos, carrossel de produtos e botões interativos para engajar seus clientes de forma profissional.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* AI Agent Deep Dive */}

         <section id="funcionalidades" className="py-24 bg-slate-950 text-white overflow-hidden relative">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,rgba(34,197,94,0.1),transparent_50%)]"></div>
          <div className="container mx-auto px-4 relative z-10">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              <div className="lg:w-1/2">
                <Badge className="mb-6 bg-green-500/20 text-green-400 hover:bg-green-500/20 border-green-500/30 px-4 py-1">
                  <Sparkles className="w-3.5 h-3.5 mr-2" />
                  Inteligência Artificial Ilimitada
                </Badge>
                <h2 className="text-4xl md:text-5xl font-bold mb-8 leading-tight">
                  Agente de I.A Completo <br/>
                  <span className="text-green-500 italic">Integrado ao ChatGPT</span>
                </h2>
                <p className="text-slate-400 text-lg mb-8 leading-relaxed">
                  Dê vida ao seu atendimento com um cérebro digital que não dorme. Nosso agente de I.A é treinado com o conhecimento do seu negócio para responder, qualificar e vender sem limites.
                </p>
                
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center shrink-0 border border-white/10">
                      <BrainCircuit className="w-6 h-6 text-green-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xl mb-1">Cérebro Sem Limites</h4>
                      <p className="text-slate-400">Processamento ilimitado de mensagens utilizando a tecnologia GPT mais avançada do mercado.</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center shrink-0 border border-white/10">
                      <MessageSquareQuote className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xl mb-1">Integração Total com Templates</h4>
                      <p className="text-slate-400">A I.A identifica a necessidade e envia automaticamente templates com botões interativos para fechar a venda.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-12">
                  <Link to="/crm/login?mode=register">
                    <Button size="lg" className="bg-green-600 hover:bg-green-700 text-white rounded-2xl px-8 h-14 font-bold shadow-xl shadow-green-500/20">
                      Testar I.A Agora Grátis
                    </Button>
                  </Link>
                </div>
              </div>
              
              <div className="lg:w-1/2 relative">
                {/* Mockup do Chat com IA */}
                <div className="bg-[#0b141a] rounded-[2.5rem] p-6 shadow-2xl border border-white/5 max-w-sm mx-auto relative animate-float">
                  <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                    <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                      <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-white">Assistente I.A</div>
                      <div className="text-[10px] text-green-500 flex items-center gap-1">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
                        Online e Processando
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="bg-white/5 rounded-2xl p-3 max-w-[85%]">
                      <p className="text-xs text-slate-300">Olá! Gostaria de saber os preços dos planos anuais.</p>
                    </div>
                    <div className="bg-green-900/40 rounded-2xl p-3 max-w-[85%] ml-auto border border-green-500/20">
                      <p className="text-xs text-white">Com certeza! Nosso plano anual está com 77% de desconto por apenas R$ 397/ano. Posso te enviar o link para assinatura?</p>
                    </div>
                    <div className="bg-green-900/20 rounded-2xl p-2 border border-green-500/10 flex flex-col gap-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 h-8 text-[10px] text-white font-bold">ASSINAR AGORA</Button>
                      <Button size="sm" variant="outline" className="h-8 text-[10px] text-white border-white/10 hover:bg-white/5">Falar com Humano</Button>
                    </div>
                  </div>
                </div>
                
                {/* Decorative labels */}
                <div className="absolute -top-4 -right-4 bg-blue-600 p-4 rounded-2xl shadow-xl hidden md:block rotate-12">
                  <div className="text-xs font-black">ChatGPT 4.0</div>
                </div>
                <div className="absolute -bottom-8 -left-4 bg-purple-600 p-4 rounded-2xl shadow-xl hidden md:block -rotate-12">
                  <div className="text-xs font-black">100% Automatizado</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Message Types / Formatos de Mensagem */}
        <section className="py-24 bg-white">
          <div className="container mx-auto px-4">
            <div className="text-center mb-16">
              <Badge className="mb-4 bg-blue-100 text-blue-700 hover:bg-blue-100 border-none px-4 py-1">
                ✨ Experiência Interativa
              </Badge>
              <h2 className="text-3xl md:text-5xl font-bold mb-4">Envie mensagens que convertem</h2>
              <p className="text-slate-600 max-w-2xl mx-auto">
                Utilize os formatos mais modernos e interativos do WhatsApp para engajar seus clientes de forma profissional.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 mb-16">
              {/* Templates com Botões */}
              <div className="bg-white rounded-[2.5rem] p-8 border border-green-100 shadow-xl shadow-green-500/5 relative overflow-hidden group scale-105 z-10">
                <h3 className="text-2xl font-bold mb-4">Templates com Botões</h3>
                <p className="text-slate-600 mb-6">
                  Passe uma imagem muito mais profissional. Esqueça o texto comum e use botões de ação imediata.
                </p>
              </div>

               {/* Respostas Rápidas */}
               <div className="bg-white rounded-[2.5rem] p-8 border border-blue-100 shadow-xl shadow-blue-500/5 relative overflow-hidden group">
                 <h3 className="text-2xl font-bold mb-4">Respostas Rápidas (Sim / Não)</h3>
                 <p className="text-slate-600 mb-6">
                   O cliente responde com 1 toque. A I.A já qualifica e direciona automaticamente para o próximo passo da venda.
                 </p>
               </div>

              {/* Carrossel de Mensagens */}
              <div className="bg-white rounded-[2.5rem] p-8 border border-purple-100 shadow-xl shadow-purple-500/5 relative overflow-hidden group">
                <h3 className="text-2xl font-bold mb-4">Carrossel de Produtos</h3>
                <p className="text-slate-600 mb-6">
                  A forma mais profissional de exibir seu catálogo. Permita que seus clientes deslizem entre suas melhores ofertas.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard Preview / Prompts Section */}
        <section className="py-24 bg-white overflow-hidden">
          <div className="container mx-auto px-4">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              <div className="lg:w-1/2">
                <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight text-slate-900">
                  Configure sua I.A e seus <span className="text-green-600">Prompts de Vendas</span> em segundos
                </h2>
                <p className="text-slate-600 text-lg mb-8">
                  Tenha controle total sobre como o Agente de I.A se comporta. Defina a personalidade, o tom de voz e as regras de negócio para um atendimento impecável.
                </p>
                <div className="space-y-4 mb-8">
                  {[
                    "Definição de Personagem Personalizada",
                    "Instruções Estratégicas para Conversão",
                    "Integração com sua Base de Conhecimento",
                    "Disparo Automático de Templates com Botão"
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                        <Check className="w-4 h-4 text-green-600" />
                      </div>
                      <span className="font-medium text-slate-700">{text}</span>
                    </div>
                  ))}
                </div>
                <Link to="/crm/login?mode=register">
                  <Button className="bg-[#050508] text-white hover:bg-slate-800 rounded-2xl px-8 py-6 h-auto font-bold">
                    Começar Agora
                  </Button>
                </Link>
              </div>
              <div className="lg:w-1/2 relative">
                <div className="relative rounded-[2rem] overflow-hidden shadow-2xl border border-slate-200 bg-slate-100 max-w-sm mx-auto">
                  <img src={appDashboardImg} alt="Dashboard CRM no celular" className="w-full h-auto hover:scale-105 transition-transform duration-700 object-cover" />
                </div>
                <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-3xl shadow-xl border border-slate-100 hidden md:block max-w-[240px]">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-2xl flex items-center justify-center">
                      <BrainCircuit className="w-6 h-6 text-blue-600" />
                    </div>
                    <span className="font-bold text-sm">IA Treinada</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">Sua inteligência artificial configurada com a expertise dos seus melhores vendedores.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CRM Kanban & Mass Messaging Sections */}
         <section id="crm-kanban" className="py-24 bg-slate-50 overflow-hidden">
          <div className="container mx-auto px-4">
            {/* Kanban CRM */}
            <div className="flex flex-col lg:flex-row items-center gap-16 mb-32">
              <div className="lg:w-1/2 order-2 lg:order-1">
                <div className="relative">
                  <div className="absolute -inset-4 bg-green-500/10 blur-3xl rounded-full"></div>
                  <div className="relative bg-white p-4 rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
                    <div className="grid grid-cols-3 gap-4 h-[300px]">
                      <div className="bg-slate-50 rounded-xl p-3 border-t-4 border-blue-500">
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-3">Leads</div>
                        <div className="space-y-2">
                          <div className="h-12 bg-white rounded-lg shadow-sm border border-slate-100 p-2">
                            <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2"></div>
                            <div className="w-1/2 h-1 bg-slate-50 rounded-full"></div>
                          </div>
                          <div className="h-12 bg-white rounded-lg shadow-sm border border-slate-100 p-2">
                            <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2"></div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border-t-4 border-yellow-500">
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-3">Em Negociação</div>
                        <div className="space-y-2">
                          <div className="h-12 bg-white rounded-lg shadow-sm border border-slate-100 p-2">
                            <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2"></div>
                          </div>
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border-t-4 border-green-500">
                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-3">Fechado</div>
                        <div className="space-y-2">
                          <div className="h-12 bg-white rounded-lg shadow-sm border border-slate-100 p-2">
                            <div className="w-full h-1.5 bg-slate-100 rounded-full mb-2"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute -bottom-8 -right-8 bg-green-600 p-6 rounded-3xl shadow-xl border-4 border-white hidden md:block">
                    <Columns className="w-8 h-8 text-white" />
                  </div>
                </div>
              </div>
              <div className="lg:w-1/2 order-1 lg:order-2">
                <Badge className="mb-4 bg-green-100 text-green-700 hover:bg-green-100 border-none px-4 py-1">
                  📈 Gestão Comercial
                </Badge>
                <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
                  Organize suas vendas com um <span className="text-green-600">CRM Kanban</span> completo
                </h2>
                <p className="text-slate-600 text-lg mb-8 leading-relaxed">
                  Transforme conversas em vendas com nossa visualização em colunas. Arraste e solte seus contatos, organize por etapas de fechamento e tenha o controle total do seu funil comercial. Nunca mais esqueça de um cliente no meio do processo.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {["Arrastar e Soltar", "Tags Personalizadas", "Funil de Vendas", "Histórico de Conversas"].map(item => (
                    <li key={item} className="flex items-center gap-3">
                      <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                        <Check className="w-4 h-4 text-green-600" />
                      </div>
                      <span className="font-semibold text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

             {/* Mass Messaging & Scheduling */}
             <div id="disparos" className="flex flex-col lg:flex-row items-center gap-16 pt-32">
              <div className="lg:w-1/2">
                <Badge className="mb-4 bg-blue-100 text-blue-700 hover:bg-blue-100 border-none px-4 py-1">
                  🚀 Escala Máxima
                </Badge>
                <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
                  Disparos em Massa e <span className="text-blue-600">Agendamento Inteligente</span>
                </h2>
                <p className="text-slate-600 text-lg mb-8 leading-relaxed">
                  Alcance mais de <span className="font-bold text-slate-900">1.000 pessoas por dia</span> com segurança total e sem riscos de bloqueio através da API Oficial. Agende mensagens para datas específicas e automatize seu pós-venda para converter mais.
                </p>
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-xl mb-8">
                  <div className="flex items-center gap-6 mb-6">
                    <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
                      <Send className="w-7 h-7 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xl">+1.000 Disparos/Dia</h4>
                      <p className="text-slate-500">Sem limites e com entrega garantida.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center shrink-0">
                      <Clock className="w-7 h-7 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-xl">Agendamento Preciso</h4>
                      <p className="text-slate-500">Defina o dia e a hora exata para o envio.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="lg:w-1/2">
                <div className="relative">
                  <div className="absolute -inset-4 bg-blue-500/10 blur-3xl rounded-full"></div>
                  <div className="relative bg-slate-900 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden border border-white/10">
                    <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-6">
                      <div className="text-white font-bold">Relatório de Envio</div>
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Processando</Badge>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <div className="flex justify-between text-xs text-slate-400 mb-2">
                          <span>Progresso do Disparo</span>
                          <span>842 / 1000</span>
                        </div>
                        <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
                          <div className="w-[84%] h-full bg-blue-500"></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                          <div className="text-[10px] text-slate-400 uppercase mb-1">Enviadas</div>
                          <div className="text-2xl font-bold text-white">842</div>
                        </div>
                        <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                          <div className="text-[10px] text-slate-400 uppercase mb-1">Abertas</div>
                          <div className="text-2xl font-bold text-green-500">712</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}

       <section id="precos" className="py-24 bg-slate-50">
         <div className="container mx-auto px-4">
           <div className="text-center mb-16">
             <h2 className="text-3xl md:text-4xl font-bold mb-4">Planos que cabem no seu bolso</h2>
             <p className="text-slate-600">Escolha o plano ideal para a escala do seu negócio</p>
           </div>
           <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
             {/* Mensal */}
             <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow flex flex-col">
               <CardHeader className="p-8 text-center pb-0">
                 <CardTitle className="text-2xl">Mensal</CardTitle>
                 <CardDescription>Para quem está começando</CardDescription>
                 <div className="mt-6">
                    <span className="text-4xl font-bold">R$ 97</span>
                    <span className="text-slate-500 ml-2">/mês</span>
                 </div>
                  <p className="mt-2 text-xs text-slate-500">por número</p>
               </CardHeader>
               <CardContent className="p-8 flex-1">
                 <ul className="space-y-3">
                   {["API Oficial Meta", "Dashboard Completo", "Agente de IA", "Kanban CRM", "Suporte Prioritário"].map(item => (
                     <li key={item} className="flex items-center gap-3">
                       <Check className="w-5 h-5 text-green-500 shrink-0" />
                       <span className="text-slate-600">{item}</span>
                     </li>
                   ))}
                 </ul>
               </CardContent>
               <CardFooter className="p-8 pt-0">
                 <Button onClick={() => openBuy("mensal")} variant="outline" className="w-full py-6 rounded-xl border-green-600 text-green-600 hover:bg-green-50">
                   Assinar Mensal
                 </Button>
               </CardFooter>
             </Card>

             {/* 6 meses - destaque */}
             <Card className="rounded-3xl border-green-500 overflow-hidden shadow-2xl relative md:scale-105 z-10 bg-white text-slate-900 flex flex-col">
               <div className="absolute top-0 right-0 bg-green-500 text-white text-xs font-bold px-4 py-1 rounded-bl-xl uppercase tracking-wider">
                 Mais Popular
               </div>
               <CardHeader className="p-8 text-center pb-0">
                 <CardTitle className="text-2xl text-slate-900">6 Meses</CardTitle>
                 <CardDescription>Equilíbrio ideal</CardDescription>
                 <div className="mt-6">
                    <span className="text-sm text-slate-500 block">à vista</span>
                    <span className="text-4xl font-bold text-green-600">R$ 397</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-green-700 bg-green-50 py-2 rounded-lg">
                    Ou em até 6x de <span className="text-lg font-bold">R$ 77</span> por número
                  </p>
               </CardHeader>
               <CardContent className="p-8 flex-1">
                 <ul className="space-y-3">
                   {["Tudo do plano Mensal", "Economia de ~52%", "Suporte VIP", "Onboarding guiado", "Acesso a novidades"].map(item => (
                     <li key={item} className="flex items-center gap-3">
                       <Check className="w-5 h-5 text-green-500 shrink-0" />
                       <span className="text-slate-700 font-medium">{item}</span>
                     </li>
                   ))}
                 </ul>
               </CardContent>
               <CardFooter className="p-8 pt-0">
                 <Button onClick={() => openBuy("semestral")} className="w-full py-6 rounded-xl bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-200">
                   Assinar 6 Meses
                 </Button>
               </CardFooter>
             </Card>

             {/* Anual */}
             <Card className="rounded-3xl border-slate-200 overflow-hidden shadow-xl hover:shadow-2xl transition-shadow flex flex-col">
               <CardHeader className="p-8 text-center pb-0">
                 <CardTitle className="text-2xl">Anual (1 ano)</CardTitle>
                 <CardDescription>Melhor custo-benefício</CardDescription>
                 <div className="mt-6">
                    <span className="text-sm text-slate-500 block">à vista</span>
                    <span className="text-4xl font-bold text-green-600">R$ 597</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-green-700 bg-green-50 py-2 rounded-lg">
                    Ou em até 12x de <span className="text-lg font-bold">R$ 61</span> por número
                  </p>
               </CardHeader>
               <CardContent className="p-8 flex-1">
                 <ul className="space-y-3">
                   {["Tudo do 6 Meses", "Economia máxima", "Treinamento VIP", "Prioridade total", "Selos de verificação"].map(item => (
                     <li key={item} className="flex items-center gap-3">
                       <Check className="w-5 h-5 text-green-500 shrink-0" />
                       <span className="text-slate-600">{item}</span>
                     </li>
                   ))}
                 </ul>
               </CardContent>
               <CardFooter className="p-8 pt-0">
                 <Button onClick={() => openBuy("anual")} variant="outline" className="w-full py-6 rounded-xl border-green-600 text-green-600 hover:bg-green-50">
                   Assinar Anual
                 </Button>
               </CardFooter>
             </Card>
           </div>
         </div>
       </section>
 
       {/* Security/Meta Integration */}
       <section id="seguranca" className="py-24">
         <div className="container mx-auto px-4">
           <div className="bg-[#050508] text-white rounded-[3rem] p-8 md:p-16 flex flex-col lg:flex-row items-center gap-12 overflow-hidden relative">
             <div className="absolute top-0 right-0 w-96 h-96 bg-green-600/20 blur-[120px] rounded-full"></div>
             <div className="lg:w-1/2 relative z-10">
               <Badge className="mb-4 bg-green-600/20 text-green-400 hover:bg-green-600/20 border-green-600/30">Segurança Total</Badge>
               <h2 className="text-3xl md:text-5xl font-bold mb-6">Integração Direta com a Meta</h2>
               <p className="text-slate-400 text-lg mb-8">
                 Ao contrário de extensões de navegador ou APIs não-oficiais que podem banir seu número a qualquer momento, nosso CRM utiliza a infraestrutura em nuvem da própria Meta.
               </p>
               <div className="grid grid-cols-2 gap-6">
                 <div className="flex items-start gap-3">
                   <ShieldCheck className="w-6 h-6 text-green-500 shrink-0" />
                   <div>
                     <div className="font-bold">Sem Banimentos</div>
                     <div className="text-sm text-slate-500">Conexão via Business API</div>
                   </div>
                 </div>
                 <div className="flex items-start gap-3">
                   <Zap className="w-6 h-6 text-green-500 shrink-0" />
                   <div>
                     <div className="font-bold">Rapidez</div>
                     <div className="text-sm text-slate-500">Mensagens entregues na hora</div>
                   </div>
                 </div>
               </div>
             </div>
             <div className="lg:w-1/2 flex justify-center">
               <div className="relative">
                 <div className="absolute -inset-4 bg-green-500/20 blur-2xl rounded-full animate-pulse"></div>
                 <div className="bg-white/10 backdrop-blur-xl p-8 rounded-full border border-white/10">
                   <img 
                     src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" 
                     alt="WhatsApp" 
                     className="w-32 h-32 md:w-48 md:h-48"
                   />
                 </div>
               </div>
             </div>
           </div>
         </div>
       </section>

        <WindowRulesSection />
 
         {/* Tutoriais movidos para /vendas/tutoriais */}

        {/* Footer */}
       <footer className="py-12 border-t border-slate-100">
         <div className="container mx-auto px-4">
           <div className="flex flex-col md:flex-row items-center justify-between gap-8">
             <div className="bg-[#050508] p-2 rounded-xl">
               <Logo size="sm" />
             </div>
             <div className="text-slate-400 text-sm">
               © 2026 I.A MRO. Todos os direitos reservados. 
               <span className="mx-2">|</span>
               Plataforma de Automação de WhatsApp.
             </div>
             <div className="flex gap-6">
               <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
               <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
               <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
               <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
               <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
             </div>
           </div>
         </div>
       </footer>
        <PurchaseDialog open={buyOpen} onOpenChange={setBuyOpen} plan={buyPlan} />

     </div>
   );
 };
 
 export default Sales;