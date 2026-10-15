import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Lock, Sparkles, Check, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import AccessLockOverlay from "@/components/crm/AccessLockOverlay";
import { PlanModeContext } from "@/lib/planAccess";
import OnlinePresence from "@/components/crm/OnlinePresence";


type Status =
  | { kind: "loading" }
  | { kind: "no-auth" }
  | { kind: "allowed"; mode: "admin" | "paid" | "trial" | "grandfathered"; daysLeft?: number }
  | { kind: "blocked"; reason: "trial" | "paid" };

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>(() => {
    // Um acesso vindo do Admin Central precisa começar obrigatoriamente em
    // loading. Caso contrário, um "no-auth" antigo salvo neste domínio pode
    // redirecionar para /crm/login antes que o token seja validado.
    const hasAdminToken = new URLSearchParams(window.location.search).has("admin_token");
    if (hasAdminToken) return { kind: "loading" };

    // Tenta recuperar estado cacheado para evitar flash verde em refreshes
    try {
      const cached = localStorage.getItem('crm_access_status');
      if (cached) {
        const parsed = JSON.parse(cached) as Status;
        // Estados de autenticação ausente ou carregamento nunca devem persistir
        // entre navegações. A sessão real será conferida no efeito abaixo.
        if (parsed.kind === "allowed" || parsed.kind === "blocked") return parsed;
      }
    } catch {}
    return { kind: "loading" };
  });

  useEffect(() => {
    // Persiste somente decisões de acesso. Salvar "no-auth" criava um redirect
    // síncrono na próxima abertura e impedia o login administrativo por token.
    try {
      if (status.kind === "allowed" || status.kind === "blocked") {
        localStorage.setItem('crm_access_status', JSON.stringify(status));
      } else {
        localStorage.removeItem('crm_access_status');
      }
    } catch {}
  }, [status]);

  useEffect(() => {
    let cancel = false;
    async function check() {
      try {
        // O acesso administrativo chega diretamente no domínio oficial com um
        // token de uso único. Ele precisa ser validado antes da checagem normal,
        // pois este componente envolve o CRM e é montado antes da página.
        const params = new URLSearchParams(window.location.search);
        const adminToken = params.get("admin_token");
        if (adminToken) {
          await supabase.auth.signOut({ scope: "local" });
          // generateLink({ type: "magiclink" }) produz um token que deve ser
          // confirmado como magiclink. Usar "email" aqui rejeitava o token e
          // o AccessGate enviava o administrador para /crm/login.
          let verification = await supabase.auth.verifyOtp({
            type: "magiclink",
            token_hash: adminToken,
          });
          // Compatibilidade com tokens gerados por versões anteriores do Auth.
          if (verification.error) {
            verification = await supabase.auth.verifyOtp({
              type: "email",
              token_hash: adminToken,
            });
          }
          if (verification.error || !verification.data.session) {
            throw verification.error || new Error("Sessão administrativa não foi criada");
          }

          params.delete("admin_token");
          const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
          window.history.replaceState({}, "", cleanUrl);
        }

        // Use the already validated login session here. Calling /user on every
        // route entry could hang the whole screen when that endpoint was slow.
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
          if (!cancel) setStatus({ kind: "no-auth" });
          return;
        }
        const profileResult = await Promise.race([
          supabase
            .from("crm_profiles")
            .select("role, trial_ends_at, access_until, is_paid")
            .eq("user_id", user.id)
            .maybeSingle(),
          new Promise<{ data: null; error: null }>((resolve) => {
            window.setTimeout(() => resolve({ data: null, error: null }), 3000);
          }),
        ]);
        const { data: profile, error: profileError } = profileResult;

        if (profileError) {
          console.error("[AccessGate] Erro ao carregar perfil:", profileError);
          // Se houver erro no banco, permitimos acesso temporário ou forçamos logout se for fatal
          // Aqui vamos assumir grandfathered se não conseguirmos ler, para não travar o usuário
        }

        if (profile?.role === "super_admin" || profile?.role === "admin") {
          if (!cancel) setStatus({ kind: "allowed", mode: "admin" });
          return;
        }

        const now = Date.now();
        const accessUntil = profile?.access_until ? new Date(profile.access_until).getTime() : 0;
        const trialEnds = profile?.trial_ends_at ? new Date(profile.trial_ends_at).getTime() : 0;

        if (profile?.is_paid && accessUntil > now) {
          const daysLeft = Math.ceil((accessUntil - now) / 86400000);
          if (!cancel) setStatus({ kind: "allowed", mode: "paid", daysLeft });
          return;
        }
        if (profile?.is_paid && accessUntil <= now && accessUntil > 0) {
          if (!cancel) setStatus({ kind: "blocked", reason: "paid" });
          return;
        }
        if (!profile?.trial_ends_at) {
          // Grandfathered (registered before trial system)
          if (!cancel) setStatus({ kind: "allowed", mode: "grandfathered" });
          return;
        }
        if (trialEnds > now) {
          const daysLeft = Math.ceil((trialEnds - now) / 86400000);
          if (!cancel) setStatus({ kind: "allowed", mode: "trial", daysLeft });
          return;
        }
        if (!cancel) setStatus({ kind: "blocked", reason: "trial" });
      } catch (err) {
        console.error("[AccessGate] Erro crítico no check:", err);
        // Fallback para não travar na tela verde se algo quebrar no código
        if (!cancel) setStatus({ kind: "no-auth" });
      }
    }
    check();
    return () => { cancel = true; };
  }, []);

  if (status.kind === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0FDF4]">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (status.kind === "no-auth") {
    if (typeof window !== "undefined") window.location.replace("/crm/login");
    return null;
  }

  if (status.kind === "blocked") {
    const plans = [
      { name: "Mensal", price: "R$ 97", per: "/mês", href: "/vendas#precos", highlight: false },
      { name: "6 Meses", price: "R$ 77", per: "/mês", href: "/vendas#precos", highlight: true, badge: "Mais popular" },
      { name: "Anual", price: "R$ 61", per: "/mês", href: "/vendas#precos", highlight: false, badge: "Melhor preço" },
    ];
    return (
      <div className="relative min-h-screen">
        {/* CRM continua renderizando ao fundo, mas travado */}
        <div
          aria-hidden
          className="pointer-events-none select-none"
          style={{ filter: "blur(10px) brightness(0.35)" }}
        >
          {children}
        </div>
        {/* Overlay bloqueando toda interação */}
        <div
          className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.preventDefault()}
        />
        {/* Popup central */}
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-red-200 my-8 overflow-hidden">
            <div className="bg-gradient-to-r from-red-600 to-orange-500 text-white p-6 text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-white/20 backdrop-blur mb-3">
                <Lock className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl md:text-3xl font-black mb-1">
                🔒 Seu acesso foi travado
              </h1>
              <p className="text-white/90 text-sm md:text-base">
                {status.reason === "trial"
                  ? "Seus 2 dias de teste grátis terminaram."
                  : "Seu plano venceu."}{" "}
                Para continuar usando o CRM, escolha um plano abaixo ou fale com o administrador.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {plans.map((p) => (
                  <a
                    key={p.name}
                    href={p.href}
                    className={`relative rounded-2xl border-2 p-4 text-center transition hover:scale-[1.02] ${
                      p.highlight
                        ? "border-green-500 bg-green-50 shadow-lg"
                        : "border-slate-200 bg-white hover:border-green-400"
                    }`}
                  >
                    {p.badge && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                        {p.badge}
                      </span>
                    )}
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {p.name}
                    </div>
                    <div className="mt-1">
                      <span className="text-2xl font-black text-slate-900">{p.price}</span>
                      <span className="text-xs text-slate-500">{p.per}</span>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-600 flex items-center justify-center gap-1">
                      <Check className="w-3 h-3 text-green-600" /> API oficial WhatsApp
                    </div>
                  </a>
                ))}
              </div>

              <Button
                onClick={() => (window.location.href = "/vendas#precos")}
                size="lg"
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold text-base"
              >
                <Sparkles className="w-5 h-5 mr-2" /> Ver todos os planos e comprar agora
              </Button>

              <a
                href={`https://wa.me/555192835863?text=${encodeURIComponent('Ola estou usando o zapmro API oficial, meu acesso foi TRAVADO !')}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full text-center rounded-md border-2 border-green-600 text-green-700 hover:bg-green-50 font-semibold py-2.5"
              >
                <MessageCircle className="w-4 h-4" /> Falar com o administrador no WhatsApp
              </a>

              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/crm/login";
                }}
                className="w-full text-xs text-slate-400 hover:text-slate-600 pt-1"
              >
                Sair da conta
              </button>

              <p className="text-[11px] text-center text-slate-400 pt-1">
                Já pagou? Aguarde alguns instantes — a liberação é automática após o pagamento.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PlanModeContext.Provider value={status.mode}>
      <AccessLockOverlay />
      <OnlinePresence />
      {status.mode === "trial" && (

        <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-center text-sm font-semibold py-2 px-4 shadow">
          🎁 Teste grátis: {status.daysLeft} dia{status.daysLeft === 1 ? "" : "s"} restante{status.daysLeft === 1 ? "" : "s"} —{" "}
          <a href="/vendas#precos" className="underline">assine agora</a> para não perder o acesso.
        </div>
      )}
      {status.mode === "paid" && status.daysLeft !== undefined && status.daysLeft <= 3 && (
        <div className="fixed top-0 inset-x-0 z-50 bg-orange-500 text-white text-center text-sm font-semibold py-2 px-4 shadow">
          ⚠️ Seu plano vence em {status.daysLeft} dia{status.daysLeft === 1 ? "" : "s"} —{" "}
          <a href="/vendas#precos" className="underline">renove agora</a> para não travar o CRM.
        </div>
      )}
      <div
        className={
          status.mode === "trial" || (status.mode === "paid" && (status.daysLeft ?? 999) <= 3)
            ? "pt-9"
            : ""
        }
      >
        {children}
      </div>
    </PlanModeContext.Provider>
  );
}