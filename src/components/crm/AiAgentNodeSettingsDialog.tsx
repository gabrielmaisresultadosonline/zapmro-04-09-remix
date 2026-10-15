import { BrainCircuit, Tags, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type PromptSource = "node" | "global" | "both";
export type InheritMode = "global" | "on" | "off";
export type AlertMode = "global" | "custom" | "off";

export interface AiAgentNodeSettings {
  promptSource?: PromptSource;
  prompt?: string;
  kanbanMode?: InheritMode;
  humanAlertMode?: AlertMode;
  humanAlertPhone?: string;
}

export interface AiAgentNodeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: AiAgentNodeSettings;
  onChange: (patch: AiAgentNodeSettings) => void;
}

interface Option<T extends string> { value: T; title: string; desc: string }

function OptionGrid<T extends string>({ options, value, onSelect }: { options: Option<T>[]; value: T; onSelect: (v: T) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onSelect(opt.value)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === opt.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-muted/30 hover:bg-muted",
          )}
        >
          <span className="block text-xs font-bold text-foreground">{opt.title}</span>
          <span className="block text-[11px] text-muted-foreground">{opt.desc}</span>
        </button>
      ))}
    </div>
  );
}

/** Configuração do bloco "Atendente e Vendedor I.A" dentro do fluxo. */
export function AiAgentNodeSettingsDialog({ open, onOpenChange, data, onChange }: AiAgentNodeSettingsDialogProps) {
  const promptSource: PromptSource = data.promptSource === "global" || data.promptSource === "both" ? data.promptSource : "node";
  const kanbanMode: InheritMode = data.kanbanMode ?? "global";
  const alertMode: AlertMode = data.humanAlertMode ?? "global";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border p-4 sm:p-5">
          <DialogTitle className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-primary" /> Configurar Agente I.A. deste bloco</DialogTitle>
          <DialogDescription>Escolha o que vem do Agente I.A. geral e o que vale só aqui neste fluxo.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5">
          <section className="space-y-2">
            <Label className="text-sm font-bold">Qual prompt usar?</Label>
            <OptionGrid<PromptSource>
              value={promptSource}
              onSelect={(v) => onChange({ promptSource: v })}
              options={[
                { value: "global", title: "Prompt original", desc: "O prompt geral do Agente I.A." },
                { value: "node", title: "Prompt novo", desc: "Só o prompt escrito neste bloco" },
                { value: "both", title: "Juntar os dois", desc: "Geral + bloco (o bloco tem prioridade)" },
              ]}
            />
            {promptSource !== "global" && (
              <Textarea
                className="min-h-[160px] text-sm"
                placeholder="Instruções de venda e atendimento deste bloco..."
                value={data.prompt || ""}
                onChange={(e) => onChange({ prompt: e.target.value })}
                aria-label="Prompt deste bloco"
              />
            )}
            <p className="text-[11px] text-muted-foreground">Se o prompt escolhido estiver vazio, a I.A. usa o outro automaticamente.</p>
          </section>

          <section className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-bold"><Tags className="h-4 w-4 text-primary" /> Qualificar o cliente no CRM (Kanban)</Label>
            <OptionGrid<InheritMode>
              value={kanbanMode}
              onSelect={(v) => onChange({ kanbanMode: v })}
              options={[
                { value: "global", title: "Igual ao geral", desc: "Segue a chave do Agente I.A." },
                { value: "on", title: "Ligado", desc: "Frio, quente, cliente ou humano" },
                { value: "off", title: "Desligado", desc: "Não mexe na etapa do contato" },
              ]}
            />
          </section>

          <section className="space-y-2">
            <Label className="flex items-center gap-2 text-sm font-bold"><UserRound className="h-4 w-4 text-primary" /> Avisar atendente humano ao transferir</Label>
            <OptionGrid<AlertMode>
              value={alertMode}
              onSelect={(v) => onChange({ humanAlertMode: v })}
              options={[
                { value: "global", title: "Igual ao geral", desc: "Usa o número salvo no Agente I.A." },
                { value: "custom", title: "Outro número", desc: "Avisa um atendente só deste bloco" },
                { value: "off", title: "Não avisar", desc: "Transfere sem mandar aviso" },
              ]}
            />
            {alertMode === "custom" && (
              <div className="space-y-1">
                <Input
                  inputMode="tel"
                  placeholder="Número do atendente com DDD (ex.: 51 99999-9999)"
                  value={data.humanAlertPhone || ""}
                  onChange={(e) => onChange({ humanAlertPhone: e.target.value })}
                  aria-label="Número do atendente deste bloco"
                />
                <p className="text-[11px] text-muted-foreground">Esse atendente também precisa mandar um "oi" para este WhatsApp para liberar os avisos.</p>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-border p-4">
          <Button type="button" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default AiAgentNodeSettingsDialog;
