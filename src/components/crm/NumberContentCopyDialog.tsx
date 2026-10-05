import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Copy, FileText, Loader2, Workflow, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  copyFlowsToNumber,
  describeNumber,
  fetchUserFlows,
  fetchUserTemplates,
  isNumberConnected,
  type SavedFlowSummary,
  type SavedTemplateSummary,
  type WhatsAppNumberRecord,
} from "@/lib/whatsappNumbers";

export interface NumberContentCopyDialogProps {
  userId: string;
  source: WhatsAppNumberRecord;
  numbers: WhatsAppNumberRecord[];
  onClose: () => void;
}

interface TemplateCopyResult {
  id: string;
  name: string;
  success: boolean;
  message: string;
}

export function NumberContentCopyDialog({ userId, source, numbers, onClose }: NumberContentCopyDialogProps) {
  const [flows, setFlows] = useState<SavedFlowSummary[]>([]);
  const [templates, setTemplates] = useState<SavedTemplateSummary[]>([]);
  const [selectedFlows, setSelectedFlows] = useState<Set<string>>(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<TemplateCopyResult[]>([]);

  const targets = useMemo(
    () => numbers.filter((number) => number.id !== source.id && isNumberConnected(number)),
    [numbers, source.id],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([fetchUserFlows(userId), fetchUserTemplates(userId)]).then(([allFlows, allTemplates]) => {
      if (!active) return;
      const sourceFlows = allFlows.filter((flow) => flow.whatsapp_number_id === source.id);
      const sourceTemplates = allTemplates.filter((template) => template.whatsapp_number_id === source.id);
      setFlows(sourceFlows);
      setTemplates(sourceTemplates);
      setTargetId(targets[0]?.id ?? "");
      setLoading(false);
    });
    return () => { active = false; };
  }, [source.id, targets, userId]);

  const toggle = (setter: Dispatch<SetStateAction<Set<string>>>, id: string) => {
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copySelected = async () => {
    if (!targetId || (selectedFlows.size === 0 && selectedTemplates.size === 0)) return;
    setSaving(true);
    setResults([]);

    if (selectedFlows.size > 0) {
      const flowResult = await copyFlowsToNumber(userId, [...selectedFlows], targetId);
      if (!flowResult.success) {
        toast.error(flowResult.error || "Não foi possível copiar os fluxos");
        setSaving(false);
        return;
      }
      toast.success(`${flowResult.count} fluxo(s) copiado(s) e mantido(s) desligado(s)`);
    }

    const templateResults: TemplateCopyResult[] = [];
    for (const template of templates.filter((item) => selectedTemplates.has(item.id))) {
      try {
        const { data, error } = await supabase.functions.invoke("meta-whatsapp-crm", {
          body: {
            action: "createTemplate",
            whatsapp_number_id: targetId,
            name: template.name,
            category: template.category,
            language: template.language,
            components: template.components,
            is_pix: template.is_pix,
            pix_code: template.pix_code,
            is_carousel: template.is_carousel,
          },
        });
        if (error || data?.success === false) {
          templateResults.push({
            id: template.id,
            name: template.name,
            success: false,
            message: data?.error || error?.message || "A Meta recusou a solicitação",
          });
        } else {
          templateResults.push({ id: template.id, name: template.name, success: true, message: "Enviado para análise da Meta" });
        }
      } catch (error) {
        templateResults.push({
          id: template.id,
          name: template.name,
          success: false,
          message: error instanceof Error ? error.message : "Erro inesperado",
        });
      }
    }
    setResults(templateResults);
    const successful = templateResults.filter((item) => item.success).length;
    if (successful > 0) toast.success(`${successful} template(s) enviado(s) para aprovação`);
    setSaving(false);
    setSelectedFlows(new Set());
    setSelectedTemplates(new Set());
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-background/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-bold">Copiar conteúdos</h2>
            <p className="mt-1 text-xs text-muted-foreground">Origem: {describeNumber(source)}. Nada será removido deste WhatsApp.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <>
              <div>
                <label htmlFor="copy-target" className="mb-1.5 block text-xs font-bold text-muted-foreground">Copiar para</label>
                <select id="copy-target" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {targets.length === 0 && <option value="">Nenhum outro WhatsApp conectado</option>}
                  {targets.map((number) => <option key={number.id} value={number.id}>{describeNumber(number)}</option>)}
                </select>
              </div>

              <ContentSection
                title="Fluxos"
                icon={Workflow}
                empty="Este WhatsApp não possui fluxos salvos."
                items={flows.map((flow) => ({ id: flow.id, label: flow.name || "Fluxo sem nome", detail: "A cópia chegará desligada" }))}
                selected={selectedFlows}
                onToggle={(id) => toggle(setSelectedFlows, id)}
                onSelectAll={() => setSelectedFlows(new Set(selectedFlows.size === flows.length ? [] : flows.map((flow) => flow.id)))}
              />
              <ContentSection
                title="Templates"
                icon={FileText}
                empty="Este WhatsApp não possui templates salvos."
                items={templates.map((template) => ({ id: template.id, label: template.name, detail: `${template.language || "Idioma não informado"} • ${template.status || "Status desconhecido"}` }))}
                selected={selectedTemplates}
                onToggle={(id) => toggle(setSelectedTemplates, id)}
                onSelectAll={() => setSelectedTemplates(new Set(selectedTemplates.size === templates.length ? [] : templates.map((template) => template.id)))}
              />

              {results.length > 0 && (
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-sm font-bold">Resultado dos templates</h3>
                  {results.map((result) => (
                    <div key={result.id} className={`rounded-md border p-3 text-xs ${result.success ? "border-primary/30 bg-primary/10" : "border-destructive/30 bg-destructive/10"}`}>
                      <p className="font-bold text-foreground">{result.name}</p>
                      <p className="mt-1 text-muted-foreground">{result.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted">Fechar</button>
          <button type="button" onClick={copySelected} disabled={saving || !targetId || (selectedFlows.size === 0 && selectedTemplates.size === 0)} className="flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {saving ? "Copiando..." : "Copiar selecionados"}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface ContentSectionProps {
  title: string;
  icon: typeof Workflow;
  empty: string;
  items: Array<{ id: string; label: string; detail: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}

function ContentSection({ title, icon: Icon, empty, items, selected, onToggle, onSelectAll }: ContentSectionProps) {
  return (
    <section className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <h3 className="flex items-center gap-2 text-sm font-bold"><Icon className="h-4 w-4 text-primary" />{title} ({items.length})</h3>
        {items.length > 0 && <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-primary hover:underline">{selected.size === items.length ? "Desmarcar todos" : "Selecionar todos"}</button>}
      </div>
      {items.length === 0 ? <p className="p-4 text-xs text-muted-foreground">{empty}</p> : (
        <div className="max-h-52 divide-y divide-border overflow-y-auto">
          {items.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/50">
              <input type="checkbox" checked={selected.has(item.id)} onChange={() => onToggle(item.id)} className="mt-0.5 h-4 w-4 accent-primary" />
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.label}</span><span className="block text-xs text-muted-foreground">{item.detail}</span></span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

export default NumberContentCopyDialog;