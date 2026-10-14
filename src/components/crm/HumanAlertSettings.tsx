import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getActiveWhatsAppNumberId } from "@/lib/activeNumberContext";
import { getConversationWindow } from "@/lib/conversationWindow";

export interface HumanAlertSettingsProps {
  enabled: boolean;
  phone: string;
  onSave: (patch: { ai_human_alert_enabled: boolean; ai_human_alert_phone: string }) => Promise<void>;
}

/** Variações do número (com/sem 55, com/sem o nono dígito). */
function phoneVariants(value: string): string[] {
  const raw = value.replace(/\D/g, "");
  if (!raw) return [];
  const out = new Set<string>([raw]);
  const local = raw.startsWith("55") && raw.length >= 12 ? raw.slice(2) : raw;
  if (local.length === 10 || local.length === 11) {
    const ddd = local.slice(0, 2);
    const last8 = local.slice(-8);
    [`55${ddd}9${last8}`, `55${ddd}${last8}`].forEach((v) => out.add(v));
  }
  return Array.from(out);
}

type Status = { kind: "none" } | { kind: "never" } | { kind: "open"; until: string } | { kind: "closed" };

/** Número do atendente humano que recebe o aviso de ATENDIMENTO HUMANO. */
export function HumanAlertSettings({ enabled, phone, onSave }: HumanAlertSettingsProps) {
  const [draft, setDraft] = useState(phone || "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "none" });

  useEffect(() => setDraft(phone || ""), [phone]);

  useEffect(() => {
    const numberId = getActiveWhatsAppNumberId();
    const variants = phoneVariants(phone || "");
    if (!numberId || variants.length === 0) { setStatus({ kind: "none" }); return; }
    let cancelled = false;
    supabase
      .from("crm_contacts")
      .select("last_message_received_at")
      .eq("whatsapp_number_id", numberId)
      .in("wa_id", variants)
      .order("last_message_received_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (!data?.last_message_received_at) return setStatus({ kind: "never" });
        const win = getConversationWindow({ last_message_received_at: data.last_message_received_at });
        setStatus(win.is_open && win.expires_at ? { kind: "open", until: win.expires_at } : { kind: "closed" });
      });
    return () => { cancelled = true; };
  }, [phone]);

  const save = async (nextEnabled: boolean) => {
    setSaving(true);
    try {
      await onSave({ ai_human_alert_enabled: nextEnabled, ai_human_alert_phone: draft.replace(/\D/g, "") });
    } finally {
      setSaving(false);
    }
  };

  const statusText: Record<Status["kind"], string> = {
    none: "Salve o número do atendente para ver a situação.",
    never: "O atendente ainda não mandou mensagem para este WhatsApp. Peça para ele enviar um \"oi\" para liberar os avisos.",
    open: status.kind === "open" ? `Avisos liberados até ${new Date(status.until).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. 6h antes, ele recebe o botão ACEITAR para renovar.` : "",
    closed: "As 24h do atendente acabaram. Peça para ele mandar qualquer mensagem para este WhatsApp.",
  };

  return (
    <Card className="rounded-lg shadow-sm border">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="ai-human-alert" className="text-sm font-bold flex items-center gap-2">
              <UserRound className="w-4 h-4 text-primary shrink-0" /> Avisar atendente humano
            </Label>
            <p className="text-xs text-muted-foreground">
              Quando um cliente pedir atendimento humano ou for transferido, a I.A. manda para este número uma mensagem
              com *ATENDIMENTO HUMANO*, o número do cliente e um resumo da conversa.
            </p>
          </div>
          <Switch id="ai-human-alert" checked={enabled} disabled={saving} onCheckedChange={(v) => save(v)} aria-label="Ativar aviso ao atendente humano" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            inputMode="tel"
            placeholder="Número do atendente com DDD (ex.: 51 99999-9999)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Número do atendente humano"
          />
          <Button type="button" disabled={saving} onClick={() => save(enabled)}>Salvar número</Button>
        </div>
        <p className="text-xs text-muted-foreground border-t border-border pt-2">{statusText[status.kind]}</p>
      </CardContent>
    </Card>
  );
}

export default HumanAlertSettings;
