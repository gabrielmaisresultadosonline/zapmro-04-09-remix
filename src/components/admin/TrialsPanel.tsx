import { useEffect, useRef, useState } from "react";
import {
  adminCall,
  adminErrorMessage,
  adminRead,
  isUnconfirmed,
  newRequestId,
  type AdminCreds,
} from "@/lib/adminCentralApi";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RefreshCw, Clock, Lock, CheckCircle2, Mail, Ban } from "lucide-react";

interface Trial {
  id: string;
  email: string;
  full_name: string | null;
  whatsapp_number: string | null;
  trial_ends_at: string | null;
  access_until: string | null;
  is_paid: boolean;
  plan: string | null;
  status: "paid" | "trial_active" | "trial_expired" | "no_trial";
  hours_left: number;
  created_at: string;
}

interface Props {
  creds: AdminCreds;
}


const PLAN_OPTIONS = [
  { value: "mensal", label: "Mensal (30d)", days: 30 },
  { value: "semestral", label: "6 Meses (180d)", days: 180 },
  { value: "anual", label: "Anual (365d)", days: 365 },
  { value: "custom", label: "Personalizado", days: 0 },
];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function countdown(hours: number) {
  if (hours <= 0) return "expirado";
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h`;
}

export default function TrialsPanel({ creds }: Props) {
  const [loading, setLoading] = useState(false);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [filter, setFilter] = useState<"all" | "no_trial" | "trial_active" | "trial_expired" | "paid">("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resendId, setResendId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const [selectedPlan, setSelectedPlan] = useState<Record<string, string>>({});
  const [customDays, setCustomDays] = useState<Record<string, string>>({});
  /**
   * Porquê: por padrão liberar o plano NÃO mexe na senha do cliente — ele já tem
   * a dele. Só troca quando o admin marcar explicitamente nesta linha.
   */
  const [resetPw, setResetPw] = useState<Record<string, boolean>>({});

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /**
   * `silent` é usado pela atualização automática: se a rede falhar de fundo, não
   * enche a tela de avisos — e o loader sempre termina.
   */
  const load = async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const data = await adminRead<{ trials?: Trial[] }>("list_trials", creds);
      if (!mountedRef.current) return;
      setTrials(data.trials || []);
    } catch (e) {
      if (!mountedRef.current || silent) return;
      toast.error(adminErrorMessage(e, "Erro ao carregar cadastros"));
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const approve = async (t: Trial) => {
    const plan = selectedPlan[t.id] || "mensal";
    const willResetPassword = resetPw[t.id] === true;
    const senhaAviso = willResetPassword
      ? "Será enviado um email de liberação com email e uma NOVA senha de acesso."
      : "Será enviado um email de liberação SEM trocar a senha — o cliente continua com a senha dele.";
    let days: number | undefined;
    let planToSend = plan;
    if (plan === "custom") {
      const raw = customDays[t.id];
      days = Number(raw);
      if (!days || days < 1 || days > 3650) {
        toast.error("Informe uma quantidade válida de dias (1 a 3650)");
        return;
      }
      // backend requires a valid plan key; use "mensal" as label placeholder for custom durations
      planToSend = "mensal";
      if (!confirm(`Liberar ${days} dia(s) para ${t.email}?\n\n${senhaAviso}`)) return;
    } else {
      if (!confirm(`Liberar ${plan.toUpperCase()} para ${t.email}?\n\n${senhaAviso}`)) return;
    }
    setBusyId(t.id);
    // requestId estável: se o navegador desistir da resposta, repetir a ação
    // não gera dois planos nem duas senhas novas.
    const requestId = newRequestId();
    try {
      const data = await adminCall<{ accessUntil?: string; emailQueued?: boolean }>(
        "grant_access",
        creds,
        {
          email: t.email,
          plan: planToSend,
          days,
          // envia junto no email de liberação uma senha nova de acesso
          resetPassword: true,
          requestId,
        }
      );
      // Aplica o resultado na hora: a lista não espera a releitura para mostrar
      // que o plano entrou.
      setTrials((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? {
                ...x,
                is_paid: true,
                plan: plan === "custom" ? x.plan : planToSend,
                access_until: data.accessUntil ?? x.access_until,
                status: "paid",
              }
            : x
        )
      );
      toast.success(
        plan === "custom"
          ? `Acesso liberado por ${days} dia(s) para ${t.email}`
          : `Acesso liberado (${plan}) para ${t.email}`
      );
      void load(true);
    } catch (e) {
      if (isUnconfirmed(e)) {
        toast.error("Liberação não confirmada. Atualize a lista para verificar antes de repetir.");
        void load(true);
      } else {
        toast.error(adminErrorMessage(e, "Erro ao liberar acesso"));
      }
    } finally {
      setBusyId(null);
    }
  };

  const resendEmail = async (t: Trial) => {
    if (resendId) return;
    setResendId(t.id);
    const requestId = newRequestId();
    try {
      await adminCall("resend_access_email", creds, { email: t.email, requestId });
      toast.success(`Email reenviado para ${t.email}`);
    } catch (e) {
      if (isUnconfirmed(e)) {
        toast.error("Reenvio não confirmado. Verifique a caixa do cliente antes de repetir.");
      } else {
        toast.error(adminErrorMessage(e, "Erro ao reenviar email"));
      }
    } finally {
      setResendId(null);
    }
  };

  const cancelPlan = async (t: Trial) => {
    if (
      !confirm(
        `Cancelar o plano de ${t.email}?\n\nO acesso será travado imediatamente (popup pedindo pagamento).\nNada será desconectado — o WhatsApp continua conectado.`
      )
    )
      return;
    setCancelId(t.id);
    try {
      await adminCall("cancel_access", creds, { email: t.email });
      setTrials((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, is_paid: false, status: "trial_expired", hours_left: 0 } : x))
      );
      toast.success(`Plano cancelado — ${t.email} está travado até pagar novamente`);
      void load(true);
    } catch (e) {
      if (isUnconfirmed(e)) {
        toast.error("Cancelamento não confirmado. Atualize a lista para verificar.");
        void load(true);
      } else {
        toast.error(adminErrorMessage(e, "Erro ao cancelar plano"));
      }
    } finally {
      setCancelId(null);

    }
  };


  const counts = {
    all: trials.length,
    no_trial: trials.filter((t) => t.status === "no_trial").length,
    trial_active: trials.filter((t) => t.status === "trial_active").length,
    trial_expired: trials.filter((t) => t.status === "trial_expired").length,
    paid: trials.filter((t) => t.status === "paid").length,
  };

  const filtered = trials.filter((t) => {
    if (filter !== "all" && t.status !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !t.email?.toLowerCase().includes(s) &&
        !(t.full_name || "").toLowerCase().includes(s) &&
        !(t.whatsapp_number || "").includes(s)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          {(["all", "no_trial", "trial_active", "trial_expired", "paid"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={filter === k ? "default" : "outline"}
              onClick={() => setFilter(k)}
              className={filter === k ? "bg-[#25D366] hover:bg-[#128C7E] text-white" : ""}
            >
              {k === "all" && `Todos (${counts.all})`}
              {k === "no_trial" && `Aguardando WhatsApp (${counts.no_trial})`}
              {k === "trial_active" && `Em teste (${counts.trial_active})`}
              {k === "trial_expired" && `Travados (${counts.trial_expired})`}
              {k === "paid" && `Pagos (${counts.paid})`}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Buscar email, nome, número"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#F5FBF8] text-[#075E54]">
              <tr>
                <th className="text-left p-3">Usuário</th>
                <th className="text-left p-3">Cadastro</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Teste até / Acesso até</th>
                <th className="text-left p-3">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    {loading ? "Carregando..." : "Nenhum cadastro encontrado"}
                  </td>
                </tr>
              )}
              {filtered.map((t) => (
                <tr key={t.id} className="border-t hover:bg-[#F5FBF8]/60">
                  <td className="p-3">
                    <div className="font-medium">{t.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{t.email}</div>
                    {t.whatsapp_number && (
                      <div className="text-xs text-muted-foreground">{t.whatsapp_number}</div>
                    )}
                  </td>
                  <td className="p-3 text-xs">{fmtDate(t.created_at)}</td>
                  <td className="p-3">
                    {t.status === "paid" && (
                      <Badge className="bg-emerald-100 text-emerald-800 border-0">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Pago · {t.plan}
                      </Badge>
                    )}
                    {t.status === "trial_active" && (
                      <Badge className="bg-amber-100 text-amber-800 border-0">
                        <Clock className="w-3 h-3 mr-1" />
                        Teste · {countdown(t.hours_left)}
                      </Badge>
                    )}
                    {t.status === "trial_expired" && (
                      <Badge className="bg-red-100 text-red-800 border-0">
                        <Lock className="w-3 h-3 mr-1" />
                        Travado
                      </Badge>
                    )}
                    {t.status === "no_trial" && (
                      <Badge className="bg-slate-100 text-slate-700 border-0">
                        Aguardando WhatsApp
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    <div>Teste: {fmtDate(t.trial_ends_at)}</div>
                    <div>Acesso: {fmtDate(t.access_until)}</div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={selectedPlan[t.id] || "mensal"}
                        onValueChange={(v) => setSelectedPlan((p) => ({ ...p, [t.id]: v }))}
                      >
                        <SelectTrigger className="w-36 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PLAN_OPTIONS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedPlan[t.id] === "custom" && (
                        <Input
                          type="number"
                          min={1}
                          max={3650}
                          placeholder="dias"
                          value={customDays[t.id] || ""}
                          onChange={(e) =>
                            setCustomDays((p) => ({ ...p, [t.id]: e.target.value }))
                          }
                          className="w-20 h-8 text-xs"
                        />
                      )}
                      <Button
                        size="sm"
                        onClick={() => approve(t)}
                        disabled={busyId === t.id}
                        className="bg-[#25D366] hover:bg-[#128C7E] text-white h-8"
                      >
                        {busyId === t.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Liberar"
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resendEmail(t)}
                        disabled={resendId === t.id}
                        className="h-8"
                        title="Reenviar email de acesso"
                      >
                        {resendId === t.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Mail className="w-4 h-4 mr-1" />
                            Reenviar
                          </>
                        )}
                      </Button>
                      {t.status !== "trial_expired" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => cancelPlan(t)}
                          disabled={cancelId === t.id}
                          className="h-8 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                          title="Cancelar plano e travar o acesso (sem desconectar o WhatsApp)"
                        >
                          {cancelId === t.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Ban className="w-4 h-4 mr-1" />
                              Cancelar plano
                            </>
                          )}
                        </Button>
                      )}

                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Os 2 dias de teste só começam a contar quando o usuário conecta o WhatsApp no CRM.
        Antes disso ele fica em "Aguardando WhatsApp". Depois de expirar, o CRM bloqueia
        com popup até liberar um plano (manual aqui ou automático via webhook InfinitePay).
      </p>
    </div>
  );
}