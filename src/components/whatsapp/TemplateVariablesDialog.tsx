import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  AlertCircle, Braces, Check, Eye, Image as ImageIcon, Link2, Loader2, MousePointer2, Save, Star, Trash2, Upload, Video, FileText,
} from 'lucide-react';
import TemplatePreview from './TemplatePreview';
import {
  CONTACT_FIELD_TOKENS,
  TemplateContactLike,
  TemplateSendConfig,
  createDefaultSendConfig,
  isMediaHeader,
  normalizeSendConfig,
  parseTemplateSchema,
  renderTemplatePreview,
  resolveContactTokens,
  sanitizeParameterText,
  validateTemplateSendConfig,
} from '@/lib/templateVariables';

export interface TemplateVariablesTemplate {
  id: string;
  name: string;
  language?: string | null;
  status?: string | null;
  category?: string | null;
  components?: unknown;
}

export interface TemplateVariablePreset {
  id: string;
  name: string;
  config: TemplateSendConfig;
  is_default: boolean;
}

export interface TemplateVariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateVariablesTemplate | null;
  /** Configuração atual (ex.: já editada nesta campanha). */
  initialConfig?: TemplateSendConfig | null;
  /** Contatos disponíveis para escolher uma amostra na prévia. */
  contacts?: TemplateContactLike[];
  /** Contato fixo (envio individual). */
  contact?: TemplateContactLike | null;
  /** Chamado ao confirmar — recebe a configuração validada. */
  onApply: (config: TemplateSendConfig) => void;
  applyLabel?: string;
}

const PRESETS_TABLE = 'crm_template_variable_presets';
const presetsTable = () => (supabase as any).from(PRESETS_TABLE);

/** Carrega os presets salvos de um template (usado também fora do diálogo). */
export async function loadDefaultTemplatePreset(templateId: string): Promise<TemplateSendConfig | null> {
  try {
    const { data, error } = await presetsTable()
      .select('config')
      .eq('template_id', templateId)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();
    if (error || !data?.config) return null;
    return data.config as TemplateSendConfig;
  } catch {
    return null;
  }
}

interface VariableFieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  previewValue?: string;
}

/** Campo de uma variável com botão para inserir campos do contato. */
const VariableField: React.FC<VariableFieldProps> = ({ id, label, hint, value, onChange, previewValue }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const insertToken = (token: string) => {
    const input = inputRef.current;
    if (!input) { onChange(`${value}${token}`); return; }
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      const cursor = start + token.length;
      input.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs font-semibold">{label}</Label>
        {hint && <span className="text-[10px] text-muted-foreground truncate max-w-[55%]" title={hint}>{hint}</span>}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          ref={inputRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Texto fixo ou {{nome}}, {{pedido}}..."
          className="h-10 rounded-xl text-sm"
          maxLength={1024}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-xl shrink-0" aria-label={`Inserir campo do contato em ${label}`}>
              <Braces className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1.5 rounded-xl">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground font-bold">Campos do contato</p>
            <div className="max-h-64 overflow-y-auto">
              {CONTACT_FIELD_TOKENS.map(field => (
                <button
                  key={field.token}
                  type="button"
                  onClick={() => insertToken(field.token)}
                  className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{field.label}</span>
                    <code className="text-[10px] text-primary">{field.token}</code>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">{field.description}</p>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {previewValue !== undefined && (
        <p className="text-[10px] text-muted-foreground truncate">
          Prévia: <span className={cn('font-medium', previewValue ? 'text-foreground' : 'text-destructive')}>{previewValue || '(vazio)'}</span>
        </p>
      )}
    </div>
  );
};

/**
 * Editor de variáveis de um template aprovado.
 *
 * Separa CONFIGURAÇÃO DO TEMPLATE (estrutura aprovada, imutável) de DADOS DO
 * ENVIO (mídia, parâmetros do corpo, parâmetros de URL). A prévia à direita
 * mostra exatamente como a mensagem chegará para o contato de amostra.
 */
export const TemplateVariablesDialog: React.FC<TemplateVariablesDialogProps> = ({
  open, onOpenChange, template, initialConfig, contacts = [], contact, onApply, applyLabel = 'Aplicar nesta campanha',
}) => {
  const { toast } = useToast();
  const schema = useMemo(() => parseTemplateSchema(template?.components), [template]);
  const [config, setConfig] = useState<TemplateSendConfig>(() => createDefaultSendConfig(schema));
  const [presets, setPresets] = useState<TemplateVariablePreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sampleContactId, setSampleContactId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sampleContact: TemplateContactLike | null = useMemo(() => {
    if (contact) return contact;
    if (sampleContactId) return contacts.find(c => c.id === sampleContactId) || null;
    return contacts[0] || { name: 'Gabriel', wa_id: '5511999999999', status: 'new', metadata: {} };
  }, [contact, contacts, sampleContactId]);

  // Recarrega a configuração sempre que o diálogo abre para outro template.
  useEffect(() => {
    if (!open || !template) return;
    let cancelled = false;
    const bootstrap = async () => {
      setLoadingPresets(true);
      setPresetName('');
      try {
        const { data, error } = await presetsTable()
          .select('id, name, config, is_default')
          .eq('template_id', template.id)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false });
        if (cancelled) return;
        const list: TemplateVariablePreset[] = error ? [] : (data || []);
        setPresets(list);
        const fallback = initialConfig || list.find(p => p.is_default)?.config || null;
        setConfig(normalizeSendConfig(fallback, schema));
      } finally {
        if (!cancelled) setLoadingPresets(false);
      }
    };
    bootstrap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id]);

  const preview = useMemo(() => renderTemplatePreview(schema, config, sampleContact), [schema, config, sampleContact]);
  const issues = useMemo(() => validateTemplateSendConfig(schema, config, null, template?.status), [schema, config, template?.status]);
  const sampleIssues = useMemo(
    () => (sampleContact ? validateTemplateSendConfig(schema, config, sampleContact, null).filter(i => !issues.some(x => x.field === i.field)) : []),
    [schema, config, sampleContact, issues],
  );

  /** Valor final de um campo para o contato de amostra. */
  const resolvedValue = (raw: string | undefined) => sanitizeParameterText(resolveContactTokens(raw ?? '', sampleContact));

  const updateBody = (variable: number, value: string) =>
    setConfig(prev => ({ ...prev, bodyValues: { ...prev.bodyValues, [String(variable)]: value } }));
  const updateHeader = (variable: number, value: string) =>
    setConfig(prev => ({ ...prev, headerValues: { ...prev.headerValues, [String(variable)]: value } }));
  const updateButton = (index: number, value: string) =>
    setConfig(prev => ({ ...prev, buttonValues: { ...prev.buttonValues, [String(index)]: value } }));

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 16 * 1024 * 1024 && schema.headerKind !== 'DOCUMENT') {
      toast({ title: 'Arquivo muito grande', description: 'A Meta aceita imagens até 5 MB e vídeos até 16 MB.', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      // Deduplicação por hash: a mesma imagem de template não é reenviada.
      const uploaded = await uploadDedupedMedia({
        bucket: 'crm-media',
        folder: 'template-media',
        file,
        contentType: file.type || undefined,
        extension: ext,
      });
      setConfig(prev => ({ ...prev, headerMediaUrl: uploaded.url, headerDocumentFilename: schema.headerKind === 'DOCUMENT' ? file.name : prev.headerDocumentFilename }));

      toast({ title: 'Mídia enviada', description: 'Ela será usada apenas neste envio/campanha.' });
    } catch (err: any) {
      toast({ title: 'Erro no upload', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const savePreset = async (asDefault: boolean) => {
    if (!template) return;
    const name = presetName.trim() || (asDefault ? 'Padrão' : `Configuração ${presets.length + 1}`);
    setSavingPreset(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) throw new Error('Sessão expirada. Entre novamente.');
      if (asDefault) {
        await presetsTable().update({ is_default: false }).eq('template_id', template.id).eq('is_default', true);
      }
      const { data, error } = await presetsTable()
        .insert({ user_id: userId, template_id: template.id, template_name: template.name, name, config, is_default: asDefault })
        .select('id, name, config, is_default')
        .single();
      if (error) throw error;
      setPresets(prev => [data as TemplateVariablePreset, ...prev.map(p => (asDefault ? { ...p, is_default: false } : p))]);
      setPresetName('');
      toast({ title: asDefault ? 'Salvo como padrão do template' : 'Configuração salva', description: 'Você pode reutilizá-la nos próximos envios.' });
    } catch (err: any) {
      toast({ title: 'Não foi possível salvar', description: err?.message || 'Verifique se a migration 096 foi aplicada.', variant: 'destructive' });
    } finally {
      setSavingPreset(false);
    }
  };

  const setPresetAsDefault = async (preset: TemplateVariablePreset) => {
    if (!template) return;
    try {
      await presetsTable().update({ is_default: false }).eq('template_id', template.id).eq('is_default', true);
      const { error } = await presetsTable().update({ is_default: true }).eq('id', preset.id);
      if (error) throw error;
      setPresets(prev => prev.map(p => ({ ...p, is_default: p.id === preset.id })));
      toast({ title: `"${preset.name}" agora é o padrão deste template.` });
    } catch (err: any) {
      toast({ title: 'Erro ao definir padrão', description: err?.message, variant: 'destructive' });
    }
  };

  const deletePreset = async (preset: TemplateVariablePreset) => {
    try {
      const { error } = await presetsTable().delete().eq('id', preset.id);
      if (error) throw error;
      setPresets(prev => prev.filter(p => p.id !== preset.id));
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err?.message, variant: 'destructive' });
    }
  };

  const handleApply = () => {
    if (issues.length > 0) {
      toast({ title: 'Complete as variáveis', description: issues[0].message, variant: 'destructive' });
      return;
    }
    onApply(config);
    onOpenChange(false);
  };

  if (!template) return null;

  const HeaderIcon = schema.headerKind === 'VIDEO' ? Video : schema.headerKind === 'DOCUMENT' ? FileText : ImageIcon;
  const urlButtons = schema.buttons.filter(b => b.hasUrlVariable);
  const quickReplies = schema.buttons.filter(b => b.type === 'QUICK_REPLY');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-5xl p-0 gap-0 rounded-2xl overflow-hidden max-h-[95vh] flex flex-col">
        <DialogHeader className="p-4 md:p-5 border-b space-y-1">
          <DialogTitle className="text-base md:text-lg flex items-center gap-2">
            <Braces className="w-5 h-5 text-primary" /> Variáveis do template
            <Badge variant="secondary" className="font-mono text-[10px]">{template.name}</Badge>
            <Badge variant="outline" className="text-[10px]">{template.language || 'pt_BR'}</Badge>
          </DialogTitle>
          <DialogDescription className="text-xs">
            O texto aprovado pela Meta não muda. Aqui você só preenche os campos dinâmicos: mídia do cabeçalho, variáveis do corpo e parâmetros de link.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr] flex-1 min-h-0">
          <ScrollArea className="min-h-0 max-h-[60vh] md:max-h-[70vh]">
            <div className="p-4 md:p-5 space-y-5">
              {issues.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 space-y-1" role="alert">
                  {issues.slice(0, 4).map(issue => (
                    <p key={issue.field} className="text-[11px] text-destructive flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {issue.message}
                    </p>
                  ))}
                </div>
              )}

              {isMediaHeader(schema.headerKind) && (
                <section className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <HeaderIcon className="w-3.5 h-3.5" /> Cabeçalho — {schema.headerKind === 'IMAGE' ? 'imagem' : schema.headerKind === 'VIDEO' ? 'vídeo' : 'documento'} deste envio
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={config.headerMediaUrl || ''}
                      onChange={e => setConfig(prev => ({ ...prev, headerMediaUrl: e.target.value }))}
                      placeholder="https://... (URL pública)"
                      className="h-10 rounded-xl text-sm"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept={schema.headerKind === 'IMAGE' ? 'image/jpeg,image/png' : schema.headerKind === 'VIDEO' ? 'video/mp4' : '*/*'}
                      onChange={handleUpload}
                    />
                    <Button type="button" variant="outline" className="h-10 rounded-xl shrink-0" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      <span className="hidden sm:inline ml-1.5">Enviar</span>
                    </Button>
                  </div>
                  {schema.headerKind === 'DOCUMENT' && (
                    <Input
                      value={config.headerDocumentFilename || ''}
                      onChange={e => setConfig(prev => ({ ...prev, headerDocumentFilename: e.target.value }))}
                      placeholder="Nome do arquivo exibido (ex.: boleto.pdf)"
                      className="h-9 rounded-xl text-xs"
                    />
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    A imagem usada na aprovação serve só de exemplo. Cada campanha pode usar uma mídia diferente, desde que continue coerente com o template aprovado.
                  </p>
                </section>
              )}

              {schema.headerVariables.length > 0 && (
                <section className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Cabeçalho — variáveis</Label>
                  {schema.headerVariables.map(v => (
                    <VariableField
                      key={`h-${v}`}
                      id={`tpl-header-${v}`}
                      label={`{{${v}}} do cabeçalho`}
                      value={config.headerValues[String(v)] || ''}
                      onChange={value => updateHeader(v, value)}
                      previewValue={resolvedValue(config.headerValues[String(v)])}
                    />
                  ))}
                </section>
              )}

              {schema.bodyVariables.length > 0 && (
                <section className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Corpo — variáveis</Label>
                  <div className="rounded-xl bg-muted/40 border p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
                    {schema.bodyText.split(/(\{\{\d+\}\})/g).map((part, i) =>
                      /^\{\{\d+\}\}$/.test(part)
                        ? <span key={i} className="px-1 rounded bg-primary/15 text-primary font-mono font-bold">{part}</span>
                        : <React.Fragment key={i}>{part}</React.Fragment>,
                    )}
                  </div>
                  {schema.bodyVariables.map((v, position) => (
                    <VariableField
                      key={`b-${v}`}
                      id={`tpl-body-${v}`}
                      label={`Variável {{${v}}}`}
                      hint={schema.bodyExamples[position] && schema.bodyExamples[position] !== 'Exemplo' ? `Exemplo aprovado: ${schema.bodyExamples[position]}` : undefined}
                      value={config.bodyValues[String(v)] || ''}
                      onChange={value => updateBody(v, value)}
                      previewValue={resolvedValue(config.bodyValues[String(v)])}
                    />
                  ))}
                </section>
              )}

              {urlButtons.length > 0 && (
                <section className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5" /> Botões de link — parâmetro dinâmico
                  </Label>
                  {urlButtons.map(button => (
                    <VariableField
                      key={`u-${button.index}`}
                      id={`tpl-button-${button.index}`}
                      label={`"${button.text}" → ${button.url}`}
                      value={config.buttonValues[String(button.index)] || ''}
                      onChange={value => updateButton(button.index, value)}
                      previewValue={preview.buttons[button.index]?.url}
                    />
                  ))}
                </section>
              )}

              {quickReplies.length > 0 && (
                <section className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <MousePointer2 className="w-3.5 h-3.5" /> Respostas rápidas (somente exibição)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {quickReplies.map(b => <Badge key={b.index} variant="outline" className="rounded-lg">{b.text}</Badge>)}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Quando o cliente tocar, a resposta entra na conversa com o nome do botão e o template de origem registrados.</p>
                </section>
              )}

              {sampleIssues.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                  {sampleIssues.slice(0, 3).map(issue => (
                    <p key={issue.field} className="text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {issue.message}
                    </p>
                  ))}
                </div>
              )}

              <section className="space-y-2 pt-3 border-t">
                <Label className="text-xs font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <Save className="w-3.5 h-3.5" /> Salvar esta configuração no CRM
                </Label>
                <div className="flex gap-2">
                  <Input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Nome (ex.: Campanha setembro)" className="h-9 rounded-xl text-xs" maxLength={80} />
                  <Button type="button" size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => savePreset(false)} disabled={savingPreset || issues.length > 0}>
                    {savingPreset ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  </Button>
                  <Button type="button" size="sm" className="h-9 rounded-xl" onClick={() => savePreset(true)} disabled={savingPreset || issues.length > 0}>
                    <Star className="w-3.5 h-3.5 mr-1" /> Padrão
                  </Button>
                </div>
                {loadingPresets ? (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Carregando configurações salvas...</p>
                ) : presets.length > 0 && (
                  <div className="space-y-1">
                    {presets.map(preset => (
                      <div key={preset.id} className="flex items-center gap-2 rounded-lg border px-2 py-1.5">
                        <button type="button" className="flex-1 text-left text-xs font-medium truncate hover:text-primary" onClick={() => setConfig(normalizeSendConfig(preset.config, schema))}>
                          {preset.name}
                        </button>
                        {preset.is_default
                          ? <Badge className="text-[9px] h-5">padrão</Badge>
                          : <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPresetAsDefault(preset)} aria-label={`Definir ${preset.name} como padrão`}><Star className="w-3.5 h-3.5" /></Button>}
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deletePreset(preset)} aria-label={`Excluir ${preset.name}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground">O padrão é aplicado automaticamente nos próximos envios deste template (disparador, agendamento e conversa).</p>
              </section>
            </div>
          </ScrollArea>

          <div className="border-t md:border-t-0 md:border-l bg-muted/20 p-4 md:p-5 space-y-3 overflow-y-auto max-h-[40vh] md:max-h-[70vh]">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Eye className="w-3 h-3" /> Prévia do envio</span>
              {!contact && contacts.length > 0 && (
                <Select value={sampleContactId || contacts[0]?.id || ''} onValueChange={setSampleContactId}>
                  <SelectTrigger className="h-8 w-44 rounded-lg text-[11px]"><SelectValue placeholder="Contato de amostra" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    {contacts.slice(0, 200).map(c => (
                      <SelectItem key={c.id} value={c.id || ''} className="text-xs">{c.name || c.wa_id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <TemplatePreview
              name={template.name}
              headerType={preview.headerKind}
              headerText={preview.headerText}
              headerUrl={preview.headerMediaUrl}
              bodyText={preview.bodyText}
              footerText={preview.footerText}
              buttons={preview.buttons}
            />
            <p className="text-[10px] text-muted-foreground text-center">
              Amostra: <strong>{sampleContact?.name || sampleContact?.wa_id || '—'}</strong>. Cada contato recebe os próprios valores.
            </p>
          </div>
        </div>

        <div className="p-3 md:p-4 border-t flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Button type="button" variant="ghost" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" className="rounded-xl" onClick={handleApply} disabled={issues.length > 0}>
            <Check className="w-4 h-4 mr-1.5" /> {applyLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateVariablesDialog;
