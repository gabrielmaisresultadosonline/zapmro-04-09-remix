import { useEffect, useState } from "react";
import { Loader2, Lock, MessageSquare, Plus, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  activateNumber,
  describeNumber,
  fetchUserNumbers,
  isNumberUnlocked,
  setNumberPin,
  type WhatsAppNumberRecord,
} from "@/lib/whatsappNumbers";
import { DisconnectedNumbersHistory } from "@/components/crm/DisconnectedNumbersHistory";

/** Contato do administrador para liberação de números extras. */
const SUPPORT_WHATSAPP_URL =
  "https://wa.me/5551992835863?text=" +
  encodeURIComponent(
    "Vim pelo site, estou precisando cadastrar mais um numero no ZAPMRO OFICIAL"
  );

export interface WhatsAppNumberSelectorProps {
  userId: string;
  maxNumbers: number;
  /** Chamado após aplicar as credenciais do número escolhido. */
  onSelected: (record: WhatsAppNumberRecord) => void;
  /** Inicia o Embedded Signup da Meta para conectar mais um número. */
  onConnectNew: () => void;
}

/**
 * Tela inicial dos cadastros com mais de um número liberado:
 * lista os WhatsApps conectados, pede a senha quando houver e
 * permite conectar mais um número dentro do mesmo cadastro.
 */
export function WhatsAppNumberSelector({
  userId,
  maxNumbers,
  onSelected,
  onConnectNew,
}: WhatsAppNumberSelectorProps) {
  const [numbers, setNumbers] = useState<WhatsAppNumberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<WhatsAppNumberRecord | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [newPinTarget, setNewPinTarget] = useState<WhatsAppNumberRecord | null>(null);
  const [newPinValue, setNewPinValue] = useState("");
  const [showLimit, setShowLimit] = useState(false);

  const load = async () => {
    setLoading(true);
    setNumbers(await fetchUserNumbers(userId));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const enter = async (record: WhatsAppNumberRecord) => {
    setBusyId(record.id);
    const result = await activateNumber(userId, record);
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error || "Não foi possível abrir este WhatsApp");
      return;
    }
    onSelected(record);
  };

  const handleOpen = (record: WhatsAppNumberRecord) => {
    if (record.access_pin && !isNumberUnlocked(userId, record.id)) {
      setPinTarget(record);
      setPinValue("");
      return;
    }
    void enter(record);
  };

  const confirmPin = async () => {
    if (!pinTarget) return;
    if (pinValue.trim() !== (pinTarget.access_pin || "")) {
      toast.error("Senha incorreta para este WhatsApp");
      return;
    }
    const target = pinTarget;
    setPinTarget(null);
    await enter(target);
  };

  const savePin = async () => {
    if (!newPinTarget) return;
    const result = await setNumberPin(newPinTarget.id, newPinValue);
    if (!result.success) {
      toast.error(result.error || "Falha ao salvar a senha");
      return;
    }
    toast.success(newPinValue.trim() ? "Senha definida" : "Senha removida");
    setNewPinTarget(null);
    setNewPinValue("");
    void load();
  };

  const canConnectMore = numbers.length < maxNumbers;


  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-[#0c1317] via-[#111b21] to-[#0c1317] p-4 sm:p-6">
      <div className="w-full max-w-xl bg-[#202c33] rounded-2xl shadow-2xl border border-white/5 p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#00a884]/10 flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-[#00a884]" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">Qual WhatsApp você quer abrir?</h1>
          <p className="text-white/50 text-sm mt-2">
            {maxNumbers > 1
              ? `Seu plano tem ${maxNumbers} números liberados. Escolha um para entrar nas conversas.`
              : "Seu cadastro tem 1 número liberado. Escolha-o para entrar nas conversas."}
          </p>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-6 h-6 text-[#00a884] animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {numbers.length === 0 && (
              <p className="text-center text-white/40 text-sm py-6">
                Nenhum WhatsApp conectado ainda. Conecte o primeiro abaixo.
              </p>
            )}

            {numbers.map((record) => (
              <div
                key={record.id}
                className="rounded-xl border border-white/10 bg-[#111b21] p-4 flex items-center gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-[#00a884]/15 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5 text-[#00a884]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">
                    {describeNumber(record)}
                  </p>
                  <p className="text-white/40 text-xs truncate">
                    {record.label || record.meta_verified_name || "WhatsApp Business"}
                    {record.access_pin ? " • protegido por senha" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    title={record.access_pin ? "Alterar senha" : "Definir senha"}
                    onClick={() => {
                      setNewPinTarget(record);
                      setNewPinValue(record.access_pin || "");
                    }}
                    className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition"
                  >
                    <Lock className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpen(record)}
                    disabled={busyId === record.id}
                    className="h-9 px-4 rounded-lg bg-[#00a884] hover:bg-[#02916f] text-white text-sm font-semibold flex items-center gap-2 transition disabled:opacity-60"
                  >
                    {busyId === record.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                    Abrir
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => {
                if (canConnectMore) {
                  onConnectNew();
                  return;
                }
                setShowLimit(true);
              }}
              className={cn(
                "w-full h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition",
                canConnectMore
                  ? "bg-[#1877F2] hover:bg-[#1465c8] text-white"
                  : "bg-white/5 text-white/40 hover:bg-white/10"
              )}
            >
              {canConnectMore ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {canConnectMore
                ? "Conectar mais um WhatsApp"
                : "Cadastrar número (limite atingido)"}
            </button>

            <DisconnectedNumbersHistory userId={userId} numbers={numbers} />
          </div>
        )}
      </div>

      {showLimit && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#202c33] rounded-2xl border border-white/10 p-6 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
              <Lock className="w-6 h-6 text-white/60" />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Limite do seu cadastro</h2>
            <p className="text-white/60 text-sm mb-5">
              Seu cadastro está disponível para {maxNumbers} número(s). Para liberar mais números,
              entre em contato com nosso administrador.
            </p>
            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-11 rounded-xl bg-[#00a884] hover:bg-[#02916f] text-white text-sm font-semibold flex items-center justify-center gap-2 transition"
            >
              <MessageSquare className="w-4 h-4" />
              Falar no WhatsApp
            </a>
            <button
              type="button"
              onClick={() => setShowLimit(false)}
              className="w-full h-10 mt-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-semibold"
            >
              Fechar
            </button>
          </div>
        </div>
      )}


      {pinTarget && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#202c33] rounded-2xl border border-white/10 p-6">
            <h2 className="text-white font-bold text-lg mb-1">Senha do WhatsApp</h2>
            <p className="text-white/50 text-xs mb-4">{describeNumber(pinTarget)}</p>
            <input
              type="password"
              value={pinValue}
              autoFocus
              onChange={(e) => setPinValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmPin()}
              className="w-full h-11 rounded-lg bg-[#111b21] border border-white/10 px-3 text-white text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
              placeholder="Digite a senha"
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPinTarget(null)}
                className="flex-1 h-10 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmPin}
                className="flex-1 h-10 rounded-lg bg-[#00a884] hover:bg-[#02916f] text-white text-sm font-semibold"
              >
                Entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {newPinTarget && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#202c33] rounded-2xl border border-white/10 p-6">
            <h2 className="text-white font-bold text-lg mb-1">Senha deste WhatsApp</h2>
            <p className="text-white/50 text-xs mb-4">
              Deixe em branco para remover a senha. {describeNumber(newPinTarget)}
            </p>
            <input
              type="text"
              value={newPinValue}
              autoFocus
              onChange={(e) => setNewPinValue(e.target.value)}
              className="w-full h-11 rounded-lg bg-[#111b21] border border-white/10 px-3 text-white text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#00a884]"
              placeholder="Nova senha"
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setNewPinTarget(null)}
                className="flex-1 h-10 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={savePin}
                className="flex-1 h-10 rounded-lg bg-[#00a884] hover:bg-[#02916f] text-white text-sm font-semibold"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WhatsAppNumberSelector;
