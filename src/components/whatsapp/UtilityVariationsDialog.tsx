import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, Send, Check, X, Trash2, PencilLine } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/** Uma variação Utility gerada pela I.A. */
export interface UtilityVariation {
  title: string;
  name: string;
  body: string;
  values: Record<string, string>;
  status?: 'idle' | 'sending' | 'sent' | 'failed';
  error?: string;
}

export interface SaveTemplateResult { success: boolean; id?: string; error?: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMessage: string;
  baseName: string;
  /** Monta os componentes do template mantendo cabeçalho, rodapé e botões atuais. */
  buildComponents: (body: string, values: Record<string, string>) => any[];
  /** Mídia do cabeçalho atual (salva no preset para o disparo). */
  headerMediaUrl?: string;
  language: string;
  onSaveTemplate: (template: any, opts?: { silent?: boolean }) => Promise<SaveTemplateResult | void> | void;
  onUseInEditor: (body: string, values: Record<string, string>) => void;
  extra: { is_pix: boolean; pix_code: string };
}

const VAR = /\{\{(\d+)\}\}/g;
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 480);

/** Valida as regras da Meta para o corpo; retorna mensagem ou null. */
export const validateUtilityBody = (body: string): string | null => {
  const t = body.trim();
  if (!t) return 'Texto vazio.';
  if (/^\{\{\d+\}\}/.test(t)) return 'Não pode começar com variável.';
  if (/\{\{\d+\}\}[\s.!?,:;]*$/.test(t)) return 'Não pode terminar com variável.';
  const idx = Array.from(new Set(Array.from(t.matchAll(VAR), m => Number(m[1])))).sort((a, b) => a - b);
  if (!idx.every((n, i) => n === i + 1)) return 'Variáveis precisam ser {{1}}, {{2}}... em sequência.';
  return null;
};

const fill = (body: string, values: Record<string, string>) => body.replace(VAR, (_m, n) => values[n] || `{{${n}}}`);

const UtilityVariationsDialog: React.FC<Props> = ({ open, onOpenChange, initialMessage, baseName, buildComponents, headerMediaUrl, language, onSaveTemplate, onUseInEditor, extra }) => {
  const { toast } = useToast();
  const [message, setMessage] = useState(initialMessage);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [variations, setVariations] = useState<UtilityVariation[]>([]);
  const [lastInitial, setLastInitial] = useState(initialMessage);

  // Ressincroniza o texto ao reabrir com outro corpo (sem useEffect).
  if (open && initialMessage !== lastInitial) { setLastInitial(initialMessage); if (!variations.length) setMessage(initialMessage); }

  const base = slug(baseName) || 'atendimento';
  const done = variations.filter(v => v.status === 'sent' || v.status === 'failed').length;

  const generate = async () => {
    if (!message.trim()) { toast({ title: 'Escreva a mensagem completa', variant: 'destructive' }); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'utilityVariations', message, count: 5 } });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha ao gerar variações');
      const stamp = Date.now().toString(36).slice(-4);
      setVariations((data.variations as any[]).map((v, i) => ({
        title: v.title, body: v.body, values: v.values || {}, name: `${base}_u${stamp}_${i + 1}`, status: 'idle',
      })));
    } catch (e: any) {
      toast({ title: 'Não deu para gerar', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const update = (i: number, patch: Partial<UtilityVariation>) => setVariations(prev => prev.map((v, k) => k === i ? { ...v, ...patch } : v));

  const updateBody = (i: number, body: string) => {
    const keys = Array.from(new Set(Array.from(body.matchAll(VAR), m => m[1])));
    const old = variations[i].values;
    const values: Record<string, string> = {};
    keys.forEach(k => { values[k] = old[k] || ''; });
    update(i, { body, values });
  };

  const saveAll = async () => {
    const invalid = variations.findIndex(v => validateUtilityBody(v.body) || Object.values(v.values).some(x => !x.trim()) || !slug(v.name));
    if (invalid >= 0) {
      const v = variations[invalid];
      toast({ title: `Revise "${v.title}"`, description: validateUtilityBody(v.body) || 'Preencha o nome e todos os valores das variáveis.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    let ok = 0;
    for (let i = 0; i < variations.length; i++) {
      const v = variations[i];
      if (v.status === 'sent') { ok++; continue; }
      update(i, { status: 'sending', error: undefined });
      const name = slug(v.name);
      const res = (await onSaveTemplate({ name, category: 'UTILITY', language, components: buildComponents(v.body, v.values), ...extra, is_carousel: false }, { silent: true })) as SaveTemplateResult | undefined;
      if (res?.success) {
        ok++;
        update(i, { status: 'sent' });
        if (res.id) {
          // Valores das variáveis ficam só no nosso sistema e preenchem o disparo automaticamente.
          await (supabase as any).from('crm_template_variable_presets').insert({
            template_id: res.id, template_name: name, name: 'Gerado pela I.A.', is_default: true,
            config: { bodyValues: v.values, ...(headerMediaUrl ? { headerMediaUrl } : {}) },
          });
        }
      } else {
        update(i, { status: 'failed', error: res?.error || 'Falha ao enviar' });
      }
      await new Promise(r => setTimeout(r, 800));
    }
    setSaving(false);
    toast({ title: `${ok} de ${variations.length} templates enviados para aprovação`, description: 'Os valores das variáveis ficaram salvos e já aparecem no disparo.' });
  };

  return (
    <Dialog open={open} onOpenChange={o => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Criar 5 variações Utility</DialogTitle>
          <DialogDescription>
            Cole a mensagem inteira que o cliente deve ler. A I.A. esconde dentro das variáveis o que parece marketing e cria 5 templates diferentes. Imagem, rodapé e botões continuam iguais em todos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Mensagem completa (exemplo do que você quer enviar)</Label>
          <Textarea rows={6} value={message} onChange={e => setMessage(e.target.value)} placeholder="Ex.: Oi! Hoje a mensalidade está com 30% off, só R$ 89..." disabled={loading || saving} />
          <Button onClick={generate} disabled={loading || saving} className="w-full sm:w-auto">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {variations.length ? 'Gerar 5 novas variações' : 'Gerar 5 variações'}
          </Button>
        </div>

        {variations.length > 0 && (
          <div className="space-y-4 mt-2">
            {variations.map((v, i) => {
              const err = validateUtilityBody(v.body);
              return (
                <div key={`${v.name}-${i}`} className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="secondary">#{i + 1}</Badge>
                      <Input value={v.title} onChange={e => update(i, { title: e.target.value })} className="h-8 font-semibold" disabled={saving} aria-label="Título da variação" />
                    </div>
                    <div className="flex items-center gap-1">
                      {v.status === 'sending' && <Badge><Loader2 className="w-3 h-3 mr-1 animate-spin" />Enviando</Badge>}
                      {v.status === 'sent' && <Badge className="bg-primary"><Check className="w-3 h-3 mr-1" />Enviado</Badge>}
                      {v.status === 'failed' && <Badge variant="destructive"><X className="w-3 h-3 mr-1" />Falhou</Badge>}
                      <Button size="sm" variant="outline" onClick={() => { onUseInEditor(v.body, v.values); onOpenChange(false); }} disabled={saving}><PencilLine className="w-3.5 h-3.5 mr-1" />Usar no editor</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setVariations(p => p.filter((_, k) => k !== i))} disabled={saving} aria-label="Remover variação"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nome do template</Label>
                    <Input value={v.name} onChange={e => update(i, { name: e.target.value })} className="h-8 font-mono text-xs" disabled={saving || v.status === 'sent'} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Texto do template (vai para a Meta)</Label>
                      <Textarea rows={7} value={v.body} onChange={e => updateBody(i, e.target.value)} disabled={saving || v.status === 'sent'} />
                      {err && <p className="text-xs text-destructive">{err}</p>}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Valores das variáveis (ficam salvos só no sistema)</Label>
                      <div className="space-y-1.5">
                        {Object.keys(v.values).sort((a, b) => Number(a) - Number(b)).map(k => (
                          <div key={k} className="flex items-center gap-2">
                            <span className="text-xs font-mono w-10 shrink-0 text-muted-foreground">{`{{${k}}}`}</span>
                            <Input value={v.values[k]} onChange={e => update(i, { values: { ...v.values, [k]: e.target.value } })} className="h-8 text-xs" disabled={saving || v.status === 'sent'} />
                          </div>
                        ))}
                      </div>
                      <Label className="text-xs pt-2 block">Como o cliente vai ler</Label>
                      <div className="rounded-lg bg-muted/50 p-2 text-xs whitespace-pre-wrap break-words">{fill(v.body, v.values)}</div>
                    </div>
                  </div>
                  {v.error && <p className="text-xs text-destructive">{v.error}</p>}
                </div>
              );
            })}

            <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t pt-3 pb-1 space-y-2">
              {saving && (
                <div className="space-y-1">
                  <Progress value={(done / variations.length) * 100} />
                  <p className="text-xs text-muted-foreground">Enviando para a Meta como Utility: {done} de {variations.length}</p>
                </div>
              )}
              <Button onClick={saveAll} disabled={saving || loading || variations.length === 0} className="w-full">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                SALVAR TEMPLATES ({variations.length})
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default UtilityVariationsDialog;
