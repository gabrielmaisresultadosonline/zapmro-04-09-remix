import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AccessGate from "./components/crm/AccessGate";
import Sales from "./pages/Sales";

/**
 * Code splitting por rota.
 *
 * A página /vendas (entrada pública e rota fallback) continua no bundle
 * principal para abrir instantaneamente. Todas as demais — em especial o CRM,
 * que é o maior módulo do projeto — passam a ser baixadas sob demanda,
 * reduzindo drasticamente o JS inicial no celular.
 */
const CRM = lazy(() => import("./pages/CRM"));
const CRMLogin = lazy(() => import("./pages/CRMLogin"));
const AdminCentral = lazy(() => import("./pages/AdminCentral"));
const GoogleContactsCallback = lazy(() => import("./pages/GoogleContactsCallback"));
const SalesTutoriais = lazy(() => import("./pages/SalesTutoriais"));
const PortfolioVerification = lazy(() => import("./pages/PortfolioVerification"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const ConverterVideo = lazy(() => import("./pages/ConverterVideo"));
const ShortLinkRedirect = lazy(() => import("./pages/ShortLinkRedirect"));
// Módulo /acessor (projeto separado: agendamentos + organização financeira).
const AcessorLanding = lazy(() => import("./pages/acessor/AcessorLanding"));
const AcessorLogin = lazy(() => import("./pages/acessor/AcessorLogin"));
const AcessorDashboard = lazy(() => import("./pages/acessor/AcessorDashboard"));
const AcessorAdmin = lazy(() => import("./pages/acessor/AcessorAdmin"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Evita refetch agressivo ao alternar abas no celular.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** Placeholder leve exibido enquanto o chunk da rota é baixado. */
const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#111b21]">
    <div className="h-8 w-8 rounded-full border-2 border-[#00a884] border-t-transparent animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/vendas" replace />} />
            <Route path="/crm" element={<AccessGate><CRM /></AccessGate>} />
            <Route path="/crm/login" element={<CRMLogin />} />
            <Route path="/admincentral" element={<AdminCentral />} />
            <Route path="/administracao" element={<AdminCentral />} />
            <Route path="/vendas" element={<Sales />} />
            <Route path="/vendas/tutoriais" element={<SalesTutoriais />} />
            <Route path="/vendas/verificar-portfolio" element={<PortfolioVerification />} />
            <Route path="/google-callback" element={<GoogleContactsCallback />} />
            <Route path="/google-callback2" element={<GoogleContactsCallback />} />
            <Route path="/br/politicadeprivacidade" element={<PrivacyPolicy />} />
            <Route path="/br/termosdoservico" element={<TermsOfService />} />
            <Route path="/converter-video" element={<ConverterVideo />} />
            <Route path="/l/:code" element={<ShortLinkRedirect />} />
            <Route path="/acessor" element={<AcessorLanding />} />
            <Route path="/acessor/login" element={<AcessorLogin />} />
            <Route path="/acessor/dashboard" element={<AcessorDashboard />} />
            <Route path="/acessor/admin" element={<AcessorAdmin />} />
            <Route path="*" element={<Sales />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
