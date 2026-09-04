import { useState, useEffect, useRef, useMemo } from 'react';
import { getActiveWhatsAppNumberId, activeNumberPatch } from "@/lib/activeNumberContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

/** Normaliza um número BR para o formato canônico (55 + DDD + 9 dígitos). */
const canonicalWaId = (raw: string): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  if (normalized.startsWith('55') && normalized.length === 12) {
    return `${normalized.slice(0, 4)}9${normalized.slice(4)}`;
  }
  return normalized;
};

/** Todas as grafias possíveis do mesmo número (com e sem o 9º dígito). */
const waIdVariants = (raw: string): string[] => {
  const digits = String(raw || '').replace(/\D/g, '');
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  const variants = new Set<string>([normalized, canonicalWaId(raw)]);
  if (normalized.startsWith('55') && normalized.length === 13 && normalized[4] === '9') {
    variants.add(`${normalized.slice(0, 4)}${normalized.slice(5)}`);
  }
  return Array.from(variants).filter(Boolean);
};
import { 
  Zap, 
  Send, 
  Users, 
  FileText, 
  GitBranch, 
  Play, 
  Pause, 
  Trash2, 
  Clock, 
  History, 
  HelpCircle, 
  CheckCircle2, 
  XCircle,
  AlertCircle,
  RefreshCcw,
  Plus,
  Upload,
  ArrowRight,
  Save,
  BrainCircuit,
  X,
  Search,
  Bookmark,
  Braces
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import MetaPricingCalculator from "@/components/whatsapp/MetaPricingCalculator";
import BroadcastFailureLogs from "@/components/crm/BroadcastFailureLogs";
import TemplateVariablesDialog, { loadDefaultTemplatePreset } from "@/components/whatsapp/TemplateVariablesDialog";
import {
  TemplateSendConfig,
  buildTemplateComponents,
  countDynamicInputs,
  createDefaultSendConfig,
  normalizeSendConfig,
  parseTemplateSchema,
  templateHasDynamicInputs,
  validateTemplateSendConfig,
} from "@/lib/templateVariables";



interface BroadcasterProps {
  templates: any[];
  flows: any[];
  contacts: any[];
  statuses: any[];
}

/** DDDs válidos no Brasil (ANATEL) */
const VALID_BR_DDD = new Set([
  11,12,13,14,15,16,17,18,19,
  21,22,24,27,28,
  31,32,33,34,35,37,38,
  41,42,43,44,45,46,47,48,49,
  51,53,54,55,
  61,62,63,64,65,66,67,68,69,
  71,73,74,75,77,79,
  81,82,83,84,85,86,87,88,89,
  91,92,93,94,95,96,97,98,99,
]);

/**
 * Normaliza um número para o formato E.164 do WhatsApp.
 * - Remove máscara, "+" e zeros à esquerda (0800/DDD com 0)
 * - Adiciona o DDI 55 quando for número brasileiro sem país
 * - Adiciona o 9º dígito em celulares brasileiros de 8 dígitos (prefixo 6-9)
 * - Valida o DDD; retorna null quando inválido
 */
export function normalizeBrWhatsappNumber(input: string): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  // Remove zeros à esquerda (ex.: 011 99999-9999)
  digits = digits.replace(/^0+/, '');

  // Se já vem com DDI 55 e tamanho compatível, isolamos o restante
  let local = digits;
  let hasCountry = false;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    local = digits.slice(2);
    hasCountry = true;
  }

  // Números estrangeiros (não batem com o padrão BR) passam sem alteração
  if (!hasCountry && local.length !== 10 && local.length !== 11) {
    return local.length >= 8 ? local : null;
  }

  const ddd = Number(local.slice(0, 2));
  if (!VALID_BR_DDD.has(ddd)) return null;

  let subscriber = local.slice(2);

  // Celular sem o 9º dígito -> adiciona
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    subscriber = `9${subscriber}`;
  }

  // Corrige duplicidade de 9 (ex.: 99 9 9999 9999 digitado errado)
  if (subscriber.length === 10 && subscriber.startsWith('99') && /^9{2}/.test(subscriber)) {
    subscriber = subscriber.slice(1);
  }

  if (subscriber.length !== 8 && subscriber.length !== 9) return null;

  return `55${ddd}${subscriber}`;
}

export type UploadedEntry = { wa_id: string; name: string; rawNumber: string };

/**
 * Interpreta a lista importada aceitando "Nome, número", "Nome;número",
 * "Nome<TAB>número" ou apenas o número. O nome é preservado para que as
 * variáveis do template (ex.: {{nome}}) funcionem em listas de Excel/CSV.
 * Duplicados e números inválidos são descartados.
 */
export function parseUploadedEntries(source: string): UploadedEntry[] {
  const seen = new Set<string>();
  const entries: UploadedEntry[] = [];

  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/[,;\t|]/).map(p => p.trim()).filter(Boolean);
    let rawNumber = '';
    const nameParts: string[] = [];

    for (const part of parts) {
      const digits = part.replace(/\D/g, '');
      const looksLikeNumber = !rawNumber && digits.length >= 8 && digits.length <= 15 && !/[A-Za-zÀ-ÿ]{2}/.test(part);
      if (looksLikeNumber) rawNumber = part;
      else nameParts.push(part);
    }

    // Linha sem separador: "João 5511999999999"
    if (!rawNumber) {
      const match = line.match(/[+\d][\d\s\-().]{7,}\d/);
      if (match) {
        rawNumber = match[0];
        const rest = line.replace(match[0], ' ').trim();
        if (rest) nameParts.push(rest);
      }
    }

    const wa_id = rawNumber ? normalizeBrWhatsappNumber(rawNumber) : null;
    if (!wa_id || seen.has(wa_id)) continue;
    seen.add(wa_id);

    const name = nameParts.join(' ').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    entries.push({ wa_id, name: name === wa_id ? '' : name, rawNumber });
  }

  return entries;
}


const Broadcaster = ({ templates, flows, contacts, statuses }: BroadcasterProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [activeCampaign, setActiveCampaign] = useState<any>(null);
  
  // New campaign state
  const [name, setName] = useState('');
  const [type, setType] = useState<'message' | 'template' | 'flow'>('message');
  const [targetType, setTargetType] = useState<'contacts' | 'conversation' | 'uploaded' | 'tag' | 'tag_24h'>('contacts');
  // Múltiplas etiquetas podem ser combinadas no público "Por Etiqueta (Status)".
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const selectedStatus = selectedStatuses[0] || '';
  const [selectedTags24h, setSelectedTags24h] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  // Dados do envio do template (mídia + variáveis) — separados da estrutura aprovada.
  const [templateConfig, setTemplateConfig] = useState<TemplateSendConfig | null>(null);
  const [templateVariablesOpen, setTemplateVariablesOpen] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState('');
  const [uploadedNumbers, setUploadedNumbers] = useState('');
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(60);
  const [applyTag, setApplyTag] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsingType, setParsingType] = useState<'vcard' | 'csv' | null>(null);

  // Recipient preview / management
  const [excludedNumbers, setExcludedNumbers] = useState<Set<string>>(new Set());
  const [recipientSearch, setRecipientSearch] = useState('');
  const [savedLists, setSavedLists] = useState<{ name: string; numbers: string[]; createdAt: string }[]>([]);
  const [showRecipients, setShowRecipients] = useState(false);
  const [only24h, setOnly24h] = useState(false);
  // Optional tag filter when targeting "Contatos em Janela de 24h"
  const [conversationTagFilter, setConversationTagFilter] = useState<string>('__all__');
  const SAVED_LISTS_KEY = 'crm_broadcast_saved_lists';

  // 24h Countdown trigger state
  const [countdownEnabled, setCountdownEnabled] = useState(false);
  const [countdownThreshold, setCountdownThreshold] = useState(60);
  const [countdownType, setCountdownType] = useState<'message' | 'template' | 'flow'>('message');
  const [countdownContent, setCountdownContent] = useState('');
  const [countdownTemplate, setCountdownTemplate] = useState('');
  const [countdownFlow, setCountdownFlow] = useState('');
  const [savingCountdown, setSavingCountdown] = useState(false);
  const [countdownStatusFilter, setCountdownStatusFilter] = useState<string[]>([]);
  // 'always' = dispara sempre que o contato entrar na janela de 24h.
  // 'once'   = dispara apenas para quem nunca recebeu em nenhum dia.
  const [countdownScope, setCountdownScope] = useState<'always' | 'once'>('always');
  const [countdownHistory, setCountdownHistory] = useState<any[]>([]);
  // Campanha selecionada para exibir os logs de falha detalhados
  const [logsBroadcast, setLogsBroadcast] = useState<any | null>(null);

  useEffect(() => {
    fetchBroadcasts();
    fetchCountdownSettings();
    fetchCountdownHistory();
    try {
      const raw = localStorage.getItem(SAVED_LISTS_KEY);
      if (raw) setSavedLists(JSON.parse(raw));
    } catch {}
  }, []);

  // Poll countdown history every 10s so users see contacts fired in near real time
  useEffect(() => {
    const id = setInterval(fetchCountdownHistory, 10000);
    return () => clearInterval(id);
  }, []);

  // Poll while any campaign is running so progress + Stop stay live
  useEffect(() => {
    const hasRunning = broadcasts.some((b: any) => b.status === 'running' || b.status === 'pending');
    if (!hasRunning) return;
    const id = setInterval(fetchBroadcasts, 3000);
    return () => clearInterval(id);
  }, [broadcasts]);

  const persistSavedLists = (lists: typeof savedLists) => {
    setSavedLists(lists);
    try { localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists)); } catch {}
  };

  // Reset exclusions when changing target
  useEffect(() => {
    setExcludedNumbers(new Set());
    setRecipientSearch('');
    setShowRecipients(false);
    setOnly24h(false);
  }, [targetType, selectedStatuses]);

  // Compute candidate recipients (with contact info) based on current target
  const candidateRecipients = useMemo(() => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (targetType === 'conversation') {
      return contacts.filter(c => c.last_message_received_at && (now - new Date(c.last_message_received_at).getTime()) < DAY)
        .filter(c => conversationTagFilter === '__all__' ? true : c.status === conversationTagFilter)
        .map(c => ({ wa_id: c.wa_id, name: c.name || c.wa_id }));
    }
    if (targetType === 'contacts') {
      return contacts.map(c => ({ wa_id: c.wa_id, name: c.name || c.wa_id }));
    }
    if (targetType === 'tag' && selectedStatuses.length > 0) {
      return contacts.filter(c => selectedStatuses.includes(c.status)).map(c => ({ wa_id: c.wa_id, name: c.name || c.wa_id }));
    }
    if (targetType === 'tag_24h') {
      if (selectedTags24h.length === 0) return [];
      return contacts
        .filter(c => selectedTags24h.includes(c.status))
        .filter(c => c.last_message_received_at && (now - new Date(c.last_message_received_at).getTime()) < DAY)
        .map(c => ({ wa_id: c.wa_id, name: c.name || c.wa_id }));
    }
    if (targetType === 'uploaded') {
      return parseUploadedEntries(uploadedNumbers).map(e => ({ wa_id: e.wa_id, name: e.name || e.wa_id }));
    }
    return [];
  }, [targetType, selectedStatuses, contacts, uploadedNumbers, conversationTagFilter, selectedTags24h]);

  /** Nome informado na lista importada, usado nas variáveis do template. */
  const uploadedNamesByWaId = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of parseUploadedEntries(uploadedNumbers)) {
      if (entry.name) map.set(entry.wa_id, entry.name);
    }
    return map;
  }, [uploadedNumbers]);

  const normalizeUploadedList = async (raw?: string) => {
    const source = raw ?? uploadedNumbers;
    const rawLines = source.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (rawLines.length === 0) return;

    const entries = parseUploadedEntries(source);
    let fixed = 0;
    for (const entry of entries) {
      const originalDigits = entry.rawNumber.replace(/\D/g, '');
      if (entry.wa_id !== originalDigits) fixed++;
    }

    // Mantém "Nome, número" quando o nome veio na lista; assim a variável
    // {{nome}} continua disponível depois da correção dos números.
    setUploadedNumbers(entries.map(e => (e.name ? `${e.name}, ${e.wa_id}` : e.wa_id)).join('\n'));

    const invalid = Math.max(0, rawLines.length - entries.length);
    if (fixed || invalid) {
      toast({
        title: `${entries.length} números prontos`,
        description: [
          fixed ? `${fixed} corrigidos (DDI 55 / 9º dígito)` : null,
          invalid ? `${invalid} linhas descartadas (número inválido ou duplicado)` : null,
        ].filter(Boolean).join(' • '),
      });
    }
  };


  // Map wa_id -> minutes left in the 24h window (null when outside/unknown)
  const windowInfo = useMemo(() => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const map = new Map<string, number>();
    for (const c of contacts as any[]) {
      if (!c?.last_message_received_at) continue;
      const last = new Date(c.last_message_received_at).getTime();
      if (Number.isNaN(last)) continue;
      const msLeft = DAY - (now - last);
      if (msLeft > 0) map.set(c.wa_id, Math.round(msLeft / 60000));
    }
    return map;
  }, [contacts]);

  // Count contacts matching selected tags that are OUT of the 24h window (informational)
  const outOf24hByTag = useMemo(() => {
    if (targetType !== 'tag_24h' || selectedTags24h.length === 0) return 0;
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    return contacts.filter(c =>
      selectedTags24h.includes(c.status) &&
      (!c.last_message_received_at || now - new Date(c.last_message_received_at).getTime() >= DAY)
    ).length;
  }, [contacts, selectedTags24h, targetType]);

  // Próximos contatos na fila do disparo automático de 24h.
  // Considera contatos cujo janela de 24h esteja terminando nos próximos
  // `countdownThreshold` minutos (ou já expirada há pouco), filtrando pelas
  // etiquetas selecionadas em `countdownStatusFilter` quando houver.
  const countdownQueue = useMemo(() => {
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const thresholdMs = Math.max(1, countdownThreshold || 0) * 60 * 1000;
    return contacts
      .filter((c: any) => {
        if (!c?.last_message_received_at) return false;
        if (countdownStatusFilter.length > 0 && !countdownStatusFilter.includes(c.status)) return false;
        const last = new Date(c.last_message_received_at).getTime();
        if (Number.isNaN(last)) return false;
        const msLeft = DAY - (now - last);
        // Mostra todos os contatos ainda dentro da janela de 24h que se
        // encaixam nas etiquetas selecionadas. Os que já estão dentro do
        // `threshold` serão disparados primeiro pelo agendador.
        return msLeft > 0;
      })
      .map((c: any) => {
        const last = new Date(c.last_message_received_at).getTime();
        const msLeft = DAY - (now - last);
        return {
          wa_id: c.wa_id,
          name: c.name || c.wa_id,
          status: c.status,
          minutesLeft: Math.max(0, Math.round(msLeft / 60000)),
          lastTriggerAt: c.countdown_trigger_last_sent_at || null,
        };
      })
      .sort((a, b) => a.minutesLeft - b.minutesLeft);
  }, [contacts, countdownStatusFilter, countdownThreshold]);

  const finalRecipients = useMemo(
    () => {
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      return candidateRecipients.filter(r => {
        if (excludedNumbers.has(r.wa_id)) return false;
        if (only24h) {
          const c = contacts.find((x: any) => x.wa_id === r.wa_id);
          if (!c || !c.last_message_received_at) return false;
          if (now - new Date(c.last_message_received_at).getTime() >= DAY) return false;
        }
        return true;
      });
    },
    [candidateRecipients, excludedNumbers, only24h, contacts]
  );

  const visibleRecipients = useMemo(() => {
    const q = recipientSearch.trim().toLowerCase();
    if (!q) return candidateRecipients;
    return candidateRecipients.filter(r =>
      r.name.toLowerCase().includes(q) || r.wa_id.includes(q)
    );
  }, [candidateRecipients, recipientSearch]);

  const toggleExclude = (wa: string) => {
    setExcludedNumbers(prev => {
      const next = new Set(prev);
      if (next.has(wa)) next.delete(wa); else next.add(wa);
      return next;
    });
  };

  const handleSaveListForLater = () => {
    if (finalRecipients.length === 0) {
      toast({ title: "Lista vazia", description: "Selecione destinatários antes de salvar.", variant: "destructive" });
      return;
    }
    const listName = window.prompt('Nome da lista (para reutilizar em outro disparo):', name || `Lista ${new Date().toLocaleDateString('pt-BR')}`);
    if (!listName) return;
    const numbers = finalRecipients.map(r => r.wa_id);
    const updated = [...savedLists.filter(l => l.name !== listName), { name: listName, numbers, createdAt: new Date().toISOString() }];
    persistSavedLists(updated);
    toast({ title: "Lista salva!", description: `${numbers.length} contatos em "${listName}".` });
  };

  const handleLoadSavedList = (listName: string) => {
    const list = savedLists.find(l => l.name === listName);
    if (!list) return;
    setTargetType('uploaded');
    setUploadedNumbers(list.numbers.join('\n'));
    setExcludedNumbers(new Set());
    toast({ title: `Lista "${listName}" carregada`, description: `${list.numbers.length} contatos.` });
  };

  const handleDeleteSavedList = (listName: string) => {
    if (!confirm(`Excluir a lista "${listName}"?`)) return;
    persistSavedLists(savedLists.filter(l => l.name !== listName));
  };

  const fetchCountdownSettings = async () => {
    const { data: settings } = await supabase
      .from('crm_settings')
      .select('*')
      .maybeSingle();

    if (settings) {
      setCountdownEnabled(settings.countdown_trigger_enabled || false);
      setCountdownThreshold(settings.countdown_trigger_threshold_minutes || 60);
      setCountdownType(settings.countdown_trigger_message_type as 'message' | 'template' | 'flow' || 'message');
      setCountdownContent(settings.countdown_trigger_content || '');
      setCountdownTemplate(settings.countdown_trigger_template_id || '');
      setCountdownFlow(settings.countdown_trigger_flow_id || '');
      setCountdownStatusFilter(Array.isArray((settings as any).countdown_trigger_status_filter) ? (settings as any).countdown_trigger_status_filter : []);
      setCountdownScope(((settings as any).countdown_trigger_scope === 'once' ? 'once' : 'always'));
    }
  };

  const selectedTemplateRow = useMemo(() => templates.find(t => t.id === selectedTemplate) || null, [templates, selectedTemplate]);
  const selectedTemplateSchema = useMemo(() => parseTemplateSchema(selectedTemplateRow?.components), [selectedTemplateRow]);
  const selectedTemplateIsDynamic = !!selectedTemplateRow && templateHasDynamicInputs(selectedTemplateSchema);
  const templateConfigIssues = useMemo(
    () => (selectedTemplateIsDynamic && templateConfig ? validateTemplateSendConfig(selectedTemplateSchema, templateConfig, null, null) : []),
    [selectedTemplateIsDynamic, selectedTemplateSchema, templateConfig],
  );

  // Ao trocar de template, carrega a configuração padrão salva no CRM (se houver).
  useEffect(() => {
    let cancelled = false;
    if (!selectedTemplateRow) { setTemplateConfig(null); return; }
    const schema = parseTemplateSchema(selectedTemplateRow.components);
    if (!templateHasDynamicInputs(schema)) { setTemplateConfig(null); return; }
    setTemplateConfig(createDefaultSendConfig(schema));
    loadDefaultTemplatePreset(selectedTemplateRow.id).then(preset => {
      if (!cancelled && preset) setTemplateConfig(normalizeSendConfig(preset, schema));
    });
    return () => { cancelled = true; };
  }, [selectedTemplateRow]);

  /** Localiza o contato do CRM pelo número para resolver {{nome}}, {{pedido}} etc. */
  const findContactForNumber = (number: string) => {
    const variants = new Set(waIdVariants(number));
    return contacts.find(c => variants.has(String(c?.wa_id || '').replace(/\D/g, ''))) || { wa_id: canonicalWaId(number), name: '', metadata: {} };
  };

  /** Filtra pelo número de WhatsApp aberto: cada caixa tem sua própria base. */
  const scopeNumber = <T,>(query: T): T => {
    const numberId = getActiveWhatsAppNumberId();
    return numberId ? ((query as any).eq('whatsapp_number_id', numberId) as T) : query;
  };

  const fetchCountdownHistory = async () => {
    const { data } = await scopeNumber(
      supabase
        .from('crm_contacts')
        .select('wa_id, name, status, countdown_trigger_sent_at, countdown_trigger_last_sent_at, countdown_trigger_total_sent')
    )
      .not('countdown_trigger_last_sent_at', 'is', null)
      .order('countdown_trigger_last_sent_at', { ascending: false })
      .limit(100);
    setCountdownHistory(data || []);
  };

  const handleSaveCountdown = async () => {
    setSavingCountdown(true);
    try {
      const { error } = await supabase
        .from('crm_settings')
        .update({
          countdown_trigger_enabled: countdownEnabled,
          countdown_trigger_threshold_minutes: countdownThreshold,
          countdown_trigger_message_type: countdownType,
          countdown_trigger_content: countdownContent,
          countdown_trigger_template_id: countdownTemplate,
          countdown_trigger_flow_id: countdownFlow || null,
          countdown_trigger_status_filter: countdownStatusFilter,
          countdown_trigger_scope: countdownScope,
        } as any)
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id);

      if (error) throw error;
      toast({ title: "Configuração de 24h salva!" });
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSavingCountdown(false);
    }
  };


  const fetchBroadcasts = async () => {
    const { data } = await supabase
      .from('crm_broadcasts')
      .select('*')
      .order('created_at', { ascending: false });
    setBroadcasts(data || []);
  };

  const handleStartBroadcast = async () => {
    if (!name) {
      toast({ title: "Dê um nome à campanha", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      let numbers: string[] = [];
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      
      // Use the curated final recipients (respects exclusions & uploaded normalization)
      const curated = finalRecipients.map(r => r.wa_id);

      if (targetType === 'conversation') {
        numbers = curated;
      } else if (targetType === 'tag_24h') {
        if (selectedTags24h.length === 0) {
          toast({ title: "Selecione ao menos uma etiqueta", variant: "destructive" });
          setLoading(false);
          return;
        }
        numbers = curated;
        if (outOf24hByTag > 0) {
          toast({
            title: `${outOf24hByTag} contato(s) fora das 24h`,
            description: `Foram ignorados pois não estão mais na janela ativa. Use um Template para falar com eles.`,
          });
        }
      } else {
        // Lista Geral/Etiqueta/Upload
        let potentialNumbers: string[] = curated;
        if (targetType === 'tag') {
          if (selectedStatuses.length === 0) {
            toast({ title: "Selecione ao menos uma etiqueta", variant: "destructive" });
            setLoading(false);
            return;
          }
        }

        // REGRAS DE DISPARO (META API)
        if (type === 'template') {
          // A Meta só entrega template APROVADO. Bloqueamos antes do disparo
          // para não queimar a lista com erros genéricos (code 10/132001).
          const tpl = templates.find(t => t.id === selectedTemplate);
          const tplStatus = String(tpl?.status || '').toUpperCase();
          if (!tpl || tplStatus !== 'APPROVED') {
            toast({
              title: "Template não aprovado",
              description: tpl
                ? `O template "${tpl.name}" está com status ${tplStatus || 'DESCONHECIDO'} na Meta. Só é possível disparar templates APROVADOS — aguarde a aprovação antes de enviar.`
                : "Selecione um template aprovado pela Meta para disparar.",
              variant: "destructive",
            });
            setLoading(false);
            return;
          }
          // Variáveis/imagem obrigatórias precisam estar preenchidas antes de queimar a lista.
          if (selectedTemplateIsDynamic) {
            const issues = validateTemplateSendConfig(selectedTemplateSchema, templateConfig || createDefaultSendConfig(selectedTemplateSchema), null, null);
            if (issues.length > 0) {
              toast({
                title: "Complete as variáveis do template",
                description: issues[0].message,
                variant: "destructive",
              });
              setTemplateVariablesOpen(true);
              setLoading(false);
              return;
            }
          }
          // Templates aprovados podem ser enviados para qualquer um (Lista Fria ou Janela Ativa)
          numbers = potentialNumbers;

        } else {
          // Mensagem normal e Fluxos só podem ser enviados para Janela Ativa (24h)
          const activeNumbers = contacts
            .filter(c => potentialNumbers.includes(c.wa_id) && c.last_message_received_at && (now - new Date(c.last_message_received_at).getTime()) < DAY)
            .map(c => c.wa_id);
          
          const coldCount = potentialNumbers.length - activeNumbers.length;
          
          if (activeNumbers.length === 0 && potentialNumbers.length > 0) {
            toast({ 
              title: "Atenção: Regra de 24h", 
              description: `Para lista fria ou contatos fora das 24h, você só pode enviar "Templates". Mensagens e Fluxos são bloqueados pela Meta para evitar spam fora da janela ativa.`, 
              variant: "destructive" 
            });
            setLoading(false);
            return;
          }

          if (coldCount > 0) {
            toast({ 
              title: "Filtro Ativo", 
              description: `${coldCount} contatos fora da janela de 24h foram removidos. Use "Template" para falar com eles.`,
            });
          }
          numbers = activeNumbers;
        }
      }

      if (numbers.length === 0) {
        toast({ title: "Nenhum número válido encontrado", variant: "destructive" });
        return;
      }

      const { data, error } = await supabase
        .from('crm_broadcasts')
        .insert([{
          name,
          type,
          target_type: targetType,
          message_text: type === 'message' ? messageText : null,
          template_id: type === 'template' ? selectedTemplate : null,
          flow_id: type === 'flow' ? selectedFlow : null,
          random_delay_min: delayMin,
          random_delay_max: delayMax,
          total_contacts: numbers.length,
          uploaded_numbers: (targetType === 'uploaded' || targetType === 'tag' || targetType === 'conversation' || targetType === 'contacts') ? numbers : null,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      toast({ title: "Campanha criada com sucesso!" });
      fetchBroadcasts();
      
      // Reset form
      setName('');
      setMessageText('');
      setUploadedNumbers('');
      
      // Here we would ideally trigger an edge function to process the queue
      // For now, let's just simulate the start
      await processBroadcast(data.id, numbers);

    } catch (err: any) {
      toast({ title: "Erro ao criar campanha", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const processBroadcast = async (broadcastId: string, numbers: string[]) => {
    // This is a simplified client-side processor
    // In a production app, this should be an Edge Function or Database Hook
    toast({ title: "Iniciando disparos...", description: `Total: ${numbers.length} números` });
    
    // Update status to running
    await supabase.from('crm_broadcasts').update({ status: 'running' }).eq('id', broadcastId);
    
    // We'll just update the DB records one by one in this simulation
    // In reality, you'd insert into crm_scheduled_messages
    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i];
      
      // Check for manual cancellation between sends
      const { data: cur } = await supabase
        .from('crm_broadcasts')
        .select('status')
        .eq('id', broadcastId)
        .maybeSingle();
      if (cur?.status === 'cancelled') {
        toast({ title: 'Disparo interrompido', description: `Parado em ${i}/${numbers.length}.` });
        fetchBroadcasts();
        return;
      }

      // Wait random delay
      const delay = Math.floor(Math.random() * (delayMax - delayMin + 1) + delayMin) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
        // Send actual message
        const payload: any = { action: 'sendMessage', to: number, broadcastId, ...activeNumberPatch() };
        if (type === 'message') payload.text = messageText;
        else if (type === 'template') {
          const t = templates.find(temp => temp.id === selectedTemplate);
          payload.action = 'sendTemplate';
          payload.templateName = t?.name;
          payload.languageCode = t?.language || 'pt_BR';
          // Mesmo template aprovado, parâmetros próprios de cada contato.
          if (t && templateConfig) {
            const schema = parseTemplateSchema(t.components);
            if (templateHasDynamicInputs(schema)) {
              payload.components = buildTemplateComponents(schema, templateConfig, findContactForNumber(number));
            }
          }
        } else if (type === 'flow') {
          // Find contact or create one (flows require a contactId)
          const canonicalNumber = canonicalWaId(number);
          let { data: contact } = await scopeNumber(
            supabase
              .from('crm_contacts')
              .select('id')
              .in('wa_id', waIdVariants(number))
          )
            .limit(1)
            .maybeSingle();
          if (!contact) {
            const { data: created } = await supabase
              .from('crm_contacts')
              .insert([{ wa_id: canonicalNumber, name: canonicalNumber, source_type: 'broadcast', ...activeNumberPatch() }])
              .select('id')
              .single();
            contact = created;
          }
          payload.action = 'startFlow';
          payload.flowId = selectedFlow;
          payload.waId = number;
          if (contact) payload.contactId = contact.id;
        }

        const { data: sendResult, error: invokeError } = await supabase.functions.invoke('meta-whatsapp-crm', { body: payload });
        if (invokeError) throw invokeError;
        if (sendResult?.success === false) {
          throw new Error(sendResult?.message || sendResult?.error || 'A Meta recusou o envio');
        }
        // Só consideramos enviado quando a Meta devolve um ID de mensagem real.
        // Fluxos (startFlow) não retornam messageId único, por isso são exceção.
        if (type !== 'flow' && !sendResult?.messageId) {
          throw new Error('A Meta não confirmou o envio (sem ID de mensagem)');
        }

        await supabase.from('crm_broadcasts')
          .update({ sent_count: i + 1 })
          .eq('id', broadcastId);
          
      } catch (err) {
        console.error("Error sending to", number, err);
        // Update failed count
        await (supabase.rpc as any)('increment_broadcast_failed', { b_id: broadcastId });
        await supabase.from('crm_broadcasts')
          .update({ sent_count: i + 1 })
          .eq('id', broadcastId);
      }
    }
    
    await supabase.from('crm_broadcasts').update({ status: 'completed' }).eq('id', broadcastId);

    // Conferência real de entrega: a Meta confirma via webhook (sent/delivered/read/failed).
    // Damos um tempo para os status chegarem e reportamos o resultado verdadeiro.
    try {
      await new Promise(resolve => setTimeout(resolve, 15000));
      const { data: sentMessages } = await scopeNumber(
        supabase
          .from('crm_messages')
          .select('status')
      ).contains('metadata', { broadcast_id: broadcastId });

      if (sentMessages && sentMessages.length > 0) {
        const confirmed = sentMessages.filter(m => ['sent', 'delivered', 'read'].includes(String(m.status))).length;
        const failed = sentMessages.filter(m => String(m.status) === 'failed').length;
        const pending = sentMessages.length - confirmed - failed;
        toast({
          title: 'Conferência de entrega',
          description: `${confirmed} confirmadas pela Meta • ${failed} falharam • ${pending} aguardando confirmação.`,
          variant: failed > 0 ? 'destructive' : 'default',
        });
      }
    } catch (err) {
      console.error('Erro ao conferir entregas do disparo:', err);
    }

    // Apply etiqueta (tag) to all contacts in this broadcast, if selected
    if (applyTag) {
      try {
        for (const number of numbers) {
          const canonicalNumber = canonicalWaId(number);
          const { data: existing } = await scopeNumber(
            supabase
              .from('crm_contacts')
              .select('id')
              .in('wa_id', waIdVariants(number))
          )
            .limit(1)
            .maybeSingle();

          if (existing) {
            await supabase
              .from('crm_contacts')
              .update({ status: applyTag })
              .eq('id', existing.id);
          } else {
            await supabase
              .from('crm_contacts')
              .insert([{ wa_id: canonicalNumber, name: canonicalNumber, status: applyTag, source_type: 'broadcast', ...activeNumberPatch() }]);
          }
        }
        toast({ title: `Etiqueta aplicada a ${numbers.length} contatos!` });
      } catch (err) {
        console.error('Error applying tag to broadcast contacts:', err);
      }
    }

    fetchBroadcasts();
    toast({ title: "Campanha finalizada!" });
  };

  const deleteBroadcast = async (id: string) => {
    if (!confirm('Deseja excluir este histórico?')) return;
    await supabase.from('crm_broadcasts').delete().eq('id', id);
    fetchBroadcasts();
  };

  const cancelBroadcast = async (id: string) => {
    if (!confirm('Parar este disparo? Os contatos restantes não receberão a mensagem.')) return;
    await supabase.from('crm_broadcasts').update({ status: 'cancelled' }).eq('id', id);
    toast({ title: 'Solicitação de parada enviada', description: 'O disparo será interrompido no próximo intervalo.' });
    fetchBroadcasts();
  };

  const handleFileUpload = (type: 'vcard' | 'csv') => {
    setParsingType(type);
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (parsingType === 'vcard') {
        // Extract numbers from VCard
        // Typical VCard entry: TEL;CELL;PREF:+55 11 99999-9999
        const telMatches = content.match(/TEL.*:([+\d\s\-()]+)/gi);
        if (telMatches) {
          const extracted = telMatches.map(m => {
            const num = m.split(':')[1].replace(/\D/g, '');
            return num;
          }).filter(n => n.length >= 10);
          setUploadedNumbers(prev => (prev ? prev + '\n' : '') + extracted.join('\n'));
          toast({ title: `${extracted.length} números extraídos do VCard` });
        }
      } else if (parsingType === 'csv') {
        // Simple CSV/Excel export parser (just look for long numbers)
        const lines = content.split('\n');
        const extracted: string[] = [];
        lines.forEach(line => {
          const matches = line.match(/\d{10,14}/g);
          if (matches) extracted.push(...matches);
        });
        setUploadedNumbers(prev => (prev ? prev + '\n' : '') + extracted.join('\n'));
        toast({ title: `${extracted.length} números extraídos do arquivo` });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 md:space-y-6 pb-24 md:pb-8 p-3 md:p-8 animate-in fade-in duration-500 overflow-x-hidden">

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#111b21] p-4 md:p-6 rounded-2xl border border-white/5 shadow-2xl">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl md:text-3xl font-bold tracking-tight text-[#e9edef] truncate">Disparador de Mensagens</h2>
          <p className="text-xs md:text-base text-[#8696a0] mt-1 line-clamp-2 sm:line-clamp-none">Automação de disparos em massa profissional e segura.</p>
        </div>
        <div className="flex shrink-0">
          <Badge variant="outline" className="px-2 md:px-3 py-1 bg-[#00a884]/10 text-[#00a884] border-[#00a884]/20 flex items-center gap-1 md:gap-2 text-[10px] md:text-xs whitespace-nowrap">
            <Zap className="w-3 h-3 shrink-0" /> Modo Inteligente Ativo
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-8">
        <div className="lg:col-span-8 space-y-4 md:space-y-6">
          <MetaPricingCalculator
            defaultCategory="MARKETING"
            defaultQuantity={contacts?.length || 100}
            collapsible
          />
          <Accordion type="single" collapsible className="w-full space-y-4">
            <AccordionItem value="countdown" className="border-none">
              <Card className="rounded-2xl shadow-xl border border-white/5 overflow-hidden bg-[#111b21]">
                <CardHeader className="bg-[#202c33] border-b border-white/5 p-0 flex flex-row items-center justify-between">
                  <AccordionTrigger className="flex-1 p-4 hover:no-underline [&[data-state=open]>div>h3]:text-[#00a884] transition-all">
                    <div className="space-y-1 text-left">
                      <CardTitle className="text-base md:text-lg flex items-center gap-2 text-[#00a884]">
                        <Clock className="w-5 h-5" /> Automação de Janela (24h)
                      </CardTitle>
                      <CardDescription className="text-[10px] md:text-xs">
                        Disparar mensagem automática antes de expirar as 24h de conversa grátis.
                      </CardDescription>
                    </div>
                  </AccordionTrigger>
                </CardHeader>
                <AccordionContent>
                  <CardContent className="p-4 md:p-6 space-y-4">
                    <div className="flex items-center justify-between p-3 bg-[#202c33] rounded-xl mb-4 border border-white/5">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-bold flex items-center gap-2 text-white">
                          Status da Automação
                        </Label>
                        <p className="text-[10px] text-white/40">Ativar ou desativar o disparo automático.</p>
                      </div>
                      <Switch 
                        checked={countdownEnabled} 
                        onCheckedChange={setCountdownEnabled}
                        className="data-[state=checked]:bg-[#00a884]"
                      />
                    </div>
                    {/* Rest of countdown inputs will be handled in next step or kept if compatible */}


              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs md:text-sm">Tempo Restante (minutos)</Label>
                  <Input 
                    type="number" 
                    value={countdownThreshold}
                    onChange={e => setCountdownThreshold(parseInt(e.target.value))}
                    placeholder="Ex: 60 (1 hora antes)"
                    className="h-10 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm"
                  />
                  <p className="text-[10px] text-white/40 italic">O sistema verificará conversas que expiram em {countdownThreshold} min.</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs md:text-sm">Tipo de Conteúdo</Label>
                  <Select value={countdownType} onValueChange={(val: any) => setCountdownType(val)}>
                    <SelectTrigger className="h-10 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="message">Mensagem de Texto</SelectItem>
                      <SelectItem value="template">Template Aprovado</SelectItem>
                      <SelectItem value="flow">Fluxo Visual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 p-3 bg-[#202c33] rounded-xl border border-white/5">
                <Label className="text-xs md:text-sm text-white">Quem pode receber</Label>
                <Select value={countdownScope} onValueChange={(val: any) => setCountdownScope(val)}>
                  <SelectTrigger className="h-10 rounded-xl bg-[#111b21] border-none text-[#e9edef] text-xs md:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always">Sempre — todos os contatos, a cada nova janela de 24h</SelectItem>
                    <SelectItem value="once">Somente quem nunca recebeu (1 vez por contato)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-white/40 italic">
                  Em qualquer opção é enviada <b>somente 1 mensagem por janela de 24h</b> para cada contato.
                  Na opção "somente quem nunca recebeu", contatos já disparados em dias anteriores são ignorados.
                </p>
              </div>

              {countdownType === 'message' && (
                <div className="space-y-2 animate-in fade-in">
                  <Label className="text-xs md:text-sm">Texto do Disparo</Label>
                  <Textarea 
                    value={countdownContent}
                    onChange={e => setCountdownContent(e.target.value)}
                    placeholder="Olá, ainda está por aí? Gostaríamos de saber se..."
                    className="min-h-[80px] rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm"
                  />
                </div>
              )}

              {countdownType === 'template' && (
                <div className="space-y-2 animate-in fade-in">
                  <Label className="text-xs md:text-sm">Selecione o Template</Label>
                  <Select value={countdownTemplate} onValueChange={setCountdownTemplate}>
                    <SelectTrigger className="h-10 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm">
                      <SelectValue placeholder="Escolha um template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.filter(t => t.status === 'APPROVED').map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {countdownType === 'flow' && (
                <div className="space-y-2 animate-in fade-in">
                  <Label className="text-xs md:text-sm">Selecione o Fluxo</Label>
                  <Select value={countdownFlow} onValueChange={setCountdownFlow}>
                    <SelectTrigger className="h-10 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm">
                      <SelectValue placeholder="Escolha um fluxo" />
                    </SelectTrigger>
                    <SelectContent>
                      {flows.map(f => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2 p-3 bg-[#202c33] rounded-xl border border-white/5">
                <Label className="text-xs md:text-sm flex items-center gap-2 text-white">
                  <Bookmark className="w-3.5 h-3.5 text-[#00a884]" /> Destinatários por Etiqueta (opcional)
                </Label>
                <p className="text-[10px] text-white/40">
                  Selecione uma ou mais etiquetas para que a automação envie <b>apenas</b> para contatos dessas etiquetas que estejam com a janela de 24h prestes a expirar (dentro do tempo restante configurado acima). Se nenhuma for selecionada, dispara para todos que estiverem encerrando as 24h.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {statuses.length === 0 && (
                    <span className="text-[10px] text-white/40 italic">Nenhuma etiqueta cadastrada no CRM.</span>
                  )}
                  {statuses.map((s: any) => {
                    const val = s.value || s.name;
                    const active = countdownStatusFilter.includes(val);
                    return (
                      <button
                        key={s.id || val}
                        type="button"
                        onClick={() =>
                          setCountdownStatusFilter(prev =>
                            prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
                          )
                        }
                        className={cn(
                          "px-2.5 py-1 rounded-full text-[10px] md:text-xs font-medium border transition-all",
                          active
                            ? "bg-[#00a884] text-white border-[#00a884]"
                            : "bg-transparent text-white/70 border-white/15 hover:border-[#00a884]/60"
                        )}
                        style={active && s.color ? { backgroundColor: s.color, borderColor: s.color } : undefined}
                      >
                        {s.label || s.name || val}
                      </button>
                    );
                  })}
                </div>
                {countdownStatusFilter.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCountdownStatusFilter([])}
                    className="text-[10px] text-white/50 hover:text-white underline mt-1"
                  >
                    Limpar seleção ({countdownStatusFilter.length})
                  </button>
                )}
              </div>

              {/* Fila: próximos contatos que serão disparados dentro da janela */}
              <div className="space-y-2 p-3 bg-[#202c33] rounded-xl border border-white/5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs md:text-sm flex items-center gap-2 text-white">
                    <History className="w-3.5 h-3.5 text-[#00a884]" /> Próximos na fila (24h)
                  </Label>
                  <Badge variant="outline" className="text-[10px] bg-[#00a884]/10 text-[#00a884] border-[#00a884]/30">
                    {countdownQueue.length} contato(s)
                  </Badge>
                </div>
                <p className="text-[10px] text-white/40">
                  Contatos com janela de 24h ativa
                  {countdownStatusFilter.length > 0 ? <> nas etiquetas <b>{countdownStatusFilter.join(', ')}</b></> : ' (todas as etiquetas)'}.
                  Os destacados em verde entram no disparo automático nos próximos <b>{countdownThreshold} min</b>. Ordenados do que expira primeiro para o último.
                </p>
                {countdownQueue.length === 0 ? (
                  <div className="text-[11px] text-white/40 italic py-3 text-center">
                    Nenhum contato com janela de 24h ativa nas etiquetas selecionadas.
                  </div>
                ) : (
                  <ScrollArea className="h-52 pr-2">
                    <div className="space-y-1.5">
                      {countdownQueue.slice(0, 200).map((r, idx) => {
                        const st = statuses.find((s: any) => (s.value || s.name) === r.status);
                        const alreadySent = !!r.lastTriggerAt;
                        const blockedByScope = alreadySent && countdownScope === 'once';
                        const willFire = r.minutesLeft <= countdownThreshold && !blockedByScope;
                        return (
                          <div
                            key={r.wa_id + idx}
                            className={cn(
                              "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#111b21] border",
                              blockedByScope ? "border-yellow-500/40 opacity-70" : willFire ? "border-[#00a884]/50" : "border-white/5"
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-white/40 w-5 shrink-0">#{idx + 1}</span>
                              <div className="min-w-0">
                                <div className="text-xs text-[#e9edef] truncate">{r.name}</div>
                                <div className="text-[10px] text-white/40 truncate">{r.wa_id}</div>
                                {alreadySent && (
                                  <div className={cn("text-[9px] truncate", blockedByScope ? "text-yellow-500/90" : "text-white/40")}>
                                    {blockedByScope ? '⚠ Já enviamos' : 'Já enviamos'} em {new Date(r.lastTriggerAt).toLocaleDateString('pt-BR')} às {new Date(r.lastTriggerAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {st && (
                                <span
                                  className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/80"
                                  style={st.color ? { backgroundColor: `${st.color}33`, borderColor: st.color } : undefined}
                                >
                                  {st.label || st.name || r.status}
                                </span>
                              )}
                              <span className={cn(
                                "text-[10px] font-medium tabular-nums",
                                willFire ? "text-[#00a884]" : "text-white/50"
                              )}>
                                {r.minutesLeft < 60 ? `${r.minutesLeft}m` : `${Math.floor(r.minutesLeft/60)}h${r.minutesLeft%60 ? ` ${r.minutesLeft%60}m` : ''}`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {countdownQueue.length > 200 && (
                        <div className="text-[10px] text-white/40 italic text-center pt-1">
                          + {countdownQueue.length - 200} contatos adicionais na fila…
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                )}
                {!countdownEnabled && (
                  <p className="text-[10px] text-yellow-500/80 pt-1">
                    ⚠ A automação está <b>desativada</b>. Ative o status acima e salve para começar a disparar para esta fila.
                  </p>
                )}
              </div>

              {/* Histórico recente: contatos já disparados pela automação 24h */}
              <div className="space-y-2 p-3 bg-[#202c33] rounded-xl border border-white/5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs md:text-sm flex items-center gap-2 text-white">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00a884]" /> Histórico recente (24h)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] bg-[#00a884]/10 text-[#00a884] border-[#00a884]/30">
                      {countdownHistory.length} enviado(s)
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-white/60 hover:text-white"
                      onClick={fetchCountdownHistory}
                    >
                      <RefreshCcw className="w-3 h-3 mr-1" /> Atualizar
                    </Button>
                  </div>
                </div>
                <p className="text-[10px] text-white/40">
                  Últimos contatos que receberam o disparo automático da janela de 24h. Atualiza automaticamente enquanto novos contatos entram nas etiquetas.
                </p>
                {countdownHistory.length === 0 ? (
                  <div className="text-[11px] text-white/40 italic py-3 text-center">
                    Nenhum disparo automático realizado ainda.
                  </div>
                ) : (
                  <ScrollArea className="h-52 pr-2">
                    <div className="space-y-1.5">
                      {countdownHistory.map((h: any, idx: number) => {
                        const st = statuses.find((s: any) => (s.value || s.name) === h.status);
                        const sent = h.countdown_trigger_sent_at ? new Date(h.countdown_trigger_sent_at) : null;
                        return (
                          <div
                            key={h.wa_id + idx}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#111b21] border border-white/5"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-white/40 w-5 shrink-0">#{idx + 1}</span>
                              <div className="min-w-0">
                                <div className="text-xs text-[#e9edef] truncate">{h.name || h.wa_id}</div>
                                <div className="text-[10px] text-white/40 truncate">{h.wa_id}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {st && (
                                <span
                                  className="text-[9px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/80"
                                  style={st.color ? { backgroundColor: `${st.color}33`, borderColor: st.color } : undefined}
                                >
                                  {st.label || st.name || h.status}
                                </span>
                              )}
                              <span className="text-[10px] text-white/50 tabular-nums">
                                {sent ? sent.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>

              <Button 
                onClick={handleSaveCountdown} 
                disabled={savingCountdown}
                className="w-full h-10 bg-[#00a884] hover:bg-[#00a884]/90 text-white font-semibold"
              >
                {savingCountdown ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                {countdownEnabled ? "ATIVAR E SALVAR CONFIGURAÇÃO" : "SALVAR CONFIGURAÇÃO"}
              </Button>
                    </CardContent>
                  </AccordionContent>
                </Card>
              </AccordionItem>

            <AccordionItem value="new-campaign" className="border-none">
              <Card className="rounded-2xl shadow-xl border border-white/5 overflow-hidden bg-[#111b21]">
                <CardHeader className="bg-[#202c33] border-b border-white/5 p-0">
                  <AccordionTrigger className="flex-1 p-4 hover:no-underline [&[data-state=open]>div>h3]:text-[#00a884] transition-all">
                    <div className="text-left">
                      <CardTitle className="text-base md:text-lg flex items-center gap-2 text-[#00a884]">
                        <Plus className="w-5 h-5" /> Nova Campanha
                      </CardTitle>
                    </div>
                  </AccordionTrigger>
                </CardHeader>
                <AccordionContent>
                  <CardContent className="p-4 md:p-6 space-y-4 md:space-y-6">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-2">
                  <Label className="text-xs md:text-sm">Nome da Campanha</Label>
                  <Input 
                    placeholder="Ex: Promoção de Verão" 
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="h-10 md:h-11 rounded-xl bg-[#202c33] border-none text-[#e9edef] placeholder:text-[#8696a0] text-xs md:text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs md:text-sm text-[#e9edef]">Destinatários</Label>
                  <Select value={targetType} onValueChange={(val: any) => setTargetType(val)}>
                    <SelectTrigger className="h-10 md:h-11 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm">
                      <SelectValue placeholder="Selecione o público" />
                    </SelectTrigger>
                    <SelectContent>
                      {type === 'template' ? (
                        <>
                          <SelectItem value="contacts">Todos os Contatos ({contacts.length})</SelectItem>
                          <SelectItem value="tag">Por Etiqueta (Status)</SelectItem>
                          <SelectItem value="uploaded">Subir Lista (VCard, Excel, Texto)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="conversation">Contatos em Janela de 24h (Grátis)</SelectItem>
                          <SelectItem value="tag_24h">Por Etiquetas (dentro de 24h)</SelectItem>
                          <SelectItem value="contacts">Todos os Contatos ({contacts.length})</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>

              </div>

              {targetType === 'tag_24h' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 p-3 bg-[#202c33] rounded-xl border border-white/5">
                  <Label className="text-xs md:text-sm flex items-center gap-2 text-white">
                    <Bookmark className="w-3.5 h-3.5 text-[#00a884]" /> Selecione uma ou mais Etiquetas
                  </Label>
                  <p className="text-[10px] text-white/40">
                    Enviaremos apenas para contatos com essas etiquetas <b>que estão dentro da janela de 24h</b>. Os que estiverem fora serão avisados no relatório.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {statuses.length === 0 && (
                      <span className="text-[10px] text-white/40 italic">Nenhuma etiqueta cadastrada.</span>
                    )}
                    {statuses.map((s: any) => {
                      const val = s.value || s.name;
                      const active = selectedTags24h.includes(val);
                      return (
                        <button
                          key={s.id || val}
                          type="button"
                          onClick={() =>
                            setSelectedTags24h(prev =>
                              prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
                            )
                          }
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] md:text-xs font-medium border transition-all",
                            active
                              ? "bg-[#00a884] text-white border-[#00a884]"
                              : "bg-transparent text-white/70 border-white/15 hover:border-[#00a884]/60"
                          )}
                          style={active && s.color ? { backgroundColor: s.color, borderColor: s.color } : undefined}
                        >
                          {s.label || s.name}
                        </button>
                      );
                    })}
                  </div>
                  {selectedTags24h.length > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                      <span className="text-[10px] text-[#00a884]">
                        ✓ {finalRecipients.length} dentro da janela de 24h
                      </span>
                      {outOf24hByTag > 0 && (
                        <span className="text-[10px] text-yellow-500">
                          ⚠ {outOf24hByTag} fora das 24h (serão ignorados)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {targetType === 'tag' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 p-3 bg-[#202c33] rounded-xl border border-white/5">
                  <Label className="text-xs md:text-sm flex items-center gap-2 text-white">
                    <Bookmark className="w-3.5 h-3.5 text-[#00a884]" /> Selecione uma ou mais Etiquetas
                  </Label>
                  <p className="text-[10px] text-white/40">
                    Você pode combinar várias etiquetas — os contatos de todas elas entram no mesmo disparo (sem duplicar).
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {statuses.length === 0 && (
                      <span className="text-[10px] text-white/40 italic">Nenhuma etiqueta cadastrada.</span>
                    )}
                    {statuses.map((s: any) => {
                      const val = s.value || s.name;
                      const active = selectedStatuses.includes(val);
                      return (
                        <button
                          key={s.id || val}
                          type="button"
                          onClick={() =>
                            setSelectedStatuses(prev =>
                              prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
                            )
                          }
                          className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] md:text-xs font-medium border transition-all",
                            active
                              ? "bg-[#00a884] text-white border-[#00a884]"
                              : "bg-transparent text-white/70 border-white/15 hover:border-[#00a884]/60"
                          )}
                          style={active && s.color ? { backgroundColor: s.color, borderColor: s.color } : undefined}
                        >
                          {s.label || s.name}
                        </button>
                      );
                    })}
                  </div>
                  {selectedStatuses.length > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                      <span className="text-[10px] text-[#00a884]">
                        ✓ {finalRecipients.length} contato(s) selecionado(s)
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedStatuses([])}
                        className="text-[10px] underline text-white/50 hover:text-white"
                      >
                        Limpar etiquetas
                      </button>
                    </div>
                  )}
                </div>
              )}

              {targetType === 'conversation' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <Label className="text-xs md:text-sm text-[#e9edef]">
                    Filtrar por Etiqueta (opcional)
                  </Label>
                  <Select value={conversationTagFilter} onValueChange={setConversationTagFilter}>
                    <SelectTrigger className="h-10 md:h-11 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm">
                      <SelectValue placeholder="Todas as etiquetas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Todas as etiquetas</SelectItem>
                      {statuses.map(s => (
                        <SelectItem key={s.id} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] md:text-xs text-[#8696a0]">
                    Enviará apenas para contatos em janela de 24h com a etiqueta selecionada.
                  </p>
                </div>
              )}

              {targetType === 'uploaded' && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <Label className="text-xs md:text-sm">Lista de Números (Um por linha)</Label>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        className="hidden" 
                        accept={parsingType === 'vcard' ? '.vcf' : '.csv,.txt'} 
                        onChange={onFileChange} 
                      />
                      <Button variant="outline" size="sm" className="text-[9px] md:text-[10px] h-7 flex-1 sm:flex-none" onClick={() => handleFileUpload('vcard')}>
                        <Upload className="w-3 h-3 mr-1" /> VCard
                      </Button>
                      <Button variant="outline" size="sm" className="text-[9px] md:text-[10px] h-7 flex-1 sm:flex-none" onClick={() => handleFileUpload('csv')}>
                        <FileText className="w-3 h-3 mr-1" /> Excel/CSV
                      </Button>
                    </div>
                  </div>
                  <Textarea 
                    placeholder="5511999999999&#10;5521888888888"
                    className="min-h-[100px] md:min-h-[120px] rounded-xl bg-[#202c33] border-none resize-none font-mono text-xs md:text-sm text-[#e9edef]"
                    value={uploadedNumbers}
                    onChange={e => setUploadedNumbers(e.target.value)}
                    onBlur={() => normalizeUploadedList()}
                    onPaste={e => {
                      e.preventDefault();
                      const pasted = e.clipboardData.getData('text');
                      const merged = [uploadedNumbers, pasted].filter(Boolean).join('\n');
                      normalizeUploadedList(merged);
                    }}
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[9px] md:text-[10px] text-muted-foreground italic flex-1 min-w-[180px]">
                      Correção automática: adiciona o 55, insere o 9º dígito em celulares, valida o DDD e remove duplicados.
                    </p>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      className="h-7 text-[9px] md:text-[10px]" 
                      onClick={() => normalizeUploadedList()}
                      disabled={loading}
                    >
                      {loading ? <RefreshCcw className="w-3 h-3 animate-spin mr-1" /> : null}
                      Corrigir números
                    </Button>
                  </div>
                </div>
              )}

              {/* Recipient preview & management */}
              {candidateRecipients.length > 0 && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 p-3 rounded-xl bg-[#202c33] border border-white/5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-xs md:text-sm font-bold text-[#e9edef] flex items-center gap-2">
                      <Users className="w-4 h-4 text-[#00a884]" />
                      Destinatários ({finalRecipients.length}{excludedNumbers.size > 0 ? ` • ${excludedNumbers.size} removidos` : ''})
                    </Label>
                    <div className="flex gap-2">
                      {excludedNumbers.size > 0 && (
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px] text-[#8696a0] hover:text-white" onClick={() => setExcludedNumbers(new Set())}>
                          Restaurar todos
                        </Button>
                      )}
                      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={handleSaveListForLater}>
                        <Bookmark className="w-3 h-3 mr-1" /> Salvar lista
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => setShowRecipients(s => !s)}>
                        {showRecipients ? 'Ocultar lista' : 'Ver / editar lista'}
                      </Button>
                    </div>
                  </div>
                  {targetType !== 'conversation' && (
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-[10px] md:text-xs text-[#8696a0] cursor-pointer select-none">
                        <Switch checked={only24h} onCheckedChange={setOnly24h} />
                        Apenas conversas dentro da janela de 24h
                      </label>
                      <span className="text-[10px] text-[#00a884]">
                        {candidateRecipients.filter(r => windowInfo.has(r.wa_id)).length} dentro das 24h
                      </span>
                      <span className="text-[10px] text-yellow-500">
                        {candidateRecipients.filter(r => !windowInfo.has(r.wa_id)).length} fora
                      </span>
                      <button
                        type="button"
                        onClick={() => setExcludedNumbers(prev => {
                          const next = new Set(prev);
                          candidateRecipients.forEach(r => { if (!windowInfo.has(r.wa_id)) next.add(r.wa_id); });
                          return next;
                        })}
                        className="text-[10px] underline text-[#8696a0] hover:text-[#e9edef]"
                      >
                        Remover os fora das 24h
                      </button>
                      <button
                        type="button"
                        onClick={() => setExcludedNumbers(prev => {
                          const next = new Set(prev);
                          candidateRecipients.forEach(r => { if (windowInfo.has(r.wa_id)) next.add(r.wa_id); });
                          return next;
                        })}
                        className="text-[10px] underline text-[#8696a0] hover:text-[#e9edef]"
                      >
                        Remover os dentro das 24h
                      </button>
                    </div>
                  )}
                  {showRecipients && (
                    <>
                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8696a0]" />
                    <Input
                      placeholder="Buscar por nome ou número..."
                      value={recipientSearch}
                      onChange={e => setRecipientSearch(e.target.value)}
                      className="h-8 pl-7 rounded-lg bg-[#111b21] border-none text-[#e9edef] text-xs"
                    />
                  </div>
                  <ScrollArea className="h-[180px] rounded-lg bg-[#111b21] border border-white/5">
                    <div className="p-1">
                      {visibleRecipients.length === 0 ? (
                        <p className="text-[10px] text-[#8696a0] text-center py-6">Nenhum destinatário encontrado.</p>
                      ) : visibleRecipients.map(r => {
                        const isExcluded = excludedNumbers.has(r.wa_id);
                        return (
                          <div key={r.wa_id} className={cn(
                            "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md transition-colors",
                            isExcluded ? "opacity-40" : "hover:bg-[#202c33]"
                          )}>
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-xs text-[#e9edef] truncate", isExcluded && "line-through")}>{r.name}</p>
                              <p className="text-[9px] text-[#8696a0] font-mono flex items-center gap-1.5">
                                {r.wa_id}
                                {windowInfo.has(r.wa_id) ? (
                                  <span className="px-1.5 py-0.5 rounded-full bg-[#00a884]/15 text-[#00a884] font-sans">
                                    {Math.floor((windowInfo.get(r.wa_id) || 0) / 60)}h {(windowInfo.get(r.wa_id) || 0) % 60}m restantes
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-500 font-sans">
                                    fora das 24h
                                  </span>
                                )}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => toggleExclude(r.wa_id)}
                              title={isExcluded ? "Adicionar de volta" : "Remover deste disparo"}
                              className={cn(
                                "shrink-0 w-6 h-6 rounded flex items-center justify-center transition-colors",
                                isExcluded ? "text-[#00a884] hover:bg-[#00a884]/10" : "text-[#8696a0] hover:text-red-400 hover:bg-red-500/10"
                              )}
                            >
                              {isExcluded ? <Plus className="w-3 h-3" /> : <X className="w-3 h-3" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                    </>
                  )}
                </div>
              )}

              {/* Saved lists */}
              {savedLists.length > 0 && (
                <div className="space-y-2 animate-in fade-in">
                  <Label className="text-[10px] md:text-xs text-[#8696a0] flex items-center gap-1.5">
                    <Bookmark className="w-3 h-3" /> Listas salvas (reutilizar)
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {savedLists.map(list => (
                      <div key={list.name} className="flex items-center gap-1 bg-[#202c33] border border-white/5 rounded-lg pl-2 pr-1 py-1">
                        <button type="button" onClick={() => handleLoadSavedList(list.name)} className="text-[10px] text-[#e9edef] hover:text-[#00a884]">
                          {list.name} <span className="text-[#8696a0]">({list.numbers.length})</span>
                        </button>
                        <button type="button" onClick={() => handleDeleteSavedList(list.name)} className="text-[#8696a0] hover:text-red-400 p-0.5">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4 pt-4 border-t border-white/5">
                <Label className="text-xs md:text-sm font-bold uppercase tracking-wider text-muted-foreground">Conteúdo do Disparo</Label>
                <Tabs value={type} onValueChange={(val: any) => {
                  setType(val);
                  if (val === 'message' || val === 'flow') {
                    setTargetType('conversation');
                  } else {
                    setTargetType('contacts');
                  }
                }} className="w-full">
                  <TabsList className="grid grid-cols-3 h-10 md:h-12 bg-[#202c33] rounded-xl p-1 gap-1">
                    <TabsTrigger value="message" className="rounded-lg text-[9px] sm:text-xs md:text-sm data-[state=active]:bg-[#00a884] data-[state=active]:text-white px-1">Mensagem</TabsTrigger>
                    <TabsTrigger value="template" className="rounded-lg text-[9px] sm:text-xs md:text-sm data-[state=active]:bg-[#00a884] data-[state=active]:text-white px-1">Template</TabsTrigger>
                    <TabsTrigger value="flow" className="rounded-lg text-[9px] sm:text-xs md:text-sm data-[state=active]:bg-[#00a884] data-[state=active]:text-white px-1">Fluxo</TabsTrigger>
                  </TabsList>

                  
                  <div className="mt-4 md:mt-6">
                    <TabsContent value="message" className="space-y-2 animate-in fade-in">
                      <Label className="text-xs md:text-sm">Texto da Mensagem</Label>
                      <Textarea 
                        placeholder="Escreva sua mensagem aqui..."
                        className="min-h-[120px] md:min-h-[150px] rounded-xl bg-[#202c33] border-none resize-none text-[#e9edef] placeholder:text-[#8696a0] text-xs md:text-sm"
                        value={messageText}
                        onChange={e => setMessageText(e.target.value)}
                      />
                    </TabsContent>

                    <TabsContent value="template" className="space-y-4 animate-in fade-in">
                      <div className="flex flex-col gap-2 mb-4">
                        <Label className="text-xs md:text-sm">Selecione o Template Aprovado</Label>
                        {(() => {
                          const sel = templates.find(t => t.id === selectedTemplate);
                          const cat = (sel?.category || 'MARKETING').toUpperCase();
                          const unit = cat === 'MARKETING' ? 0.33 : 0.04;
                          const label = cat === 'MARKETING' ? 'Marketing' : cat === 'UTILITY' ? 'Utility' : 'Autenticação';
                          return (
                            <div className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                              <p className="text-[10px] md:text-xs text-amber-200/80 leading-relaxed italic">
                                <strong className="text-amber-500">Atenção:</strong> {sel ? <>Template <strong className="text-white">{label}</strong> — será cobrado <strong className="text-white">R$ {unit.toFixed(2).replace('.', ',')}</strong> por envio.</> : <>Marketing: <strong className="text-white">R$ 0,33</strong> · Utility: <strong className="text-white">R$ 0,04</strong> · Autenticação: <strong className="text-white">R$ 0,04</strong> por envio.</>}
                              </p>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                        {templates.filter(t => t.status === 'APPROVED').map(t => (
                          <div 
                            key={t.id} 
                            onClick={() => setSelectedTemplate(t.id)}
                            className={cn(
                              "p-3 md:p-4 rounded-xl border-2 transition-all cursor-pointer min-w-0 w-full",
                              selectedTemplate === t.id ? "border-[#00a884] bg-[#00a884]/5 shadow-md" : "border-transparent bg-[#202c33] hover:border-white/10"
                            )}
                          >
                            <div className="flex justify-between items-center mb-2 gap-2">
                              <span className="font-bold text-[10px] md:text-xs truncate text-[#e9edef] flex-1">{t.name}</span>
                              {(() => {
                                const schema = parseTemplateSchema(t.components);
                                const dynamicCount = templateHasDynamicInputs(schema) ? countDynamicInputs(schema) : 0;
                                return dynamicCount > 0 ? (
                                  <button
                                    type="button"
                                    aria-label={`Editar variáveis do template ${t.name}`}
                                    title="Editar variáveis, imagem e links deste template"
                                    onClick={(e) => { e.stopPropagation(); setSelectedTemplate(t.id); setTemplateVariablesOpen(true); }}
                                    className={cn(
                                      "shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-[9px] font-bold transition-colors",
                                      selectedTemplate === t.id && templateConfigIssues.length > 0
                                        ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                                        : "bg-[#00a884]/15 text-[#00a884] hover:bg-[#00a884]/30"
                                    )}
                                  >
                                    <Braces className="w-3 h-3" /> {dynamicCount}
                                  </button>
                                ) : null;
                              })()}
                              <Badge variant="secondary" className="text-[8px] md:text-[9px] bg-[#111b21] shrink-0">{t.category}</Badge>
                            </div>
                            <p className="text-[9px] md:text-[10px] text-[#8696a0] line-clamp-2 break-words">
                              {t.components?.find((c: any) => c.type === 'BODY')?.text}
                            </p>
                          </div>
                        ))}
                      </div>

                      {selectedTemplateRow && selectedTemplateIsDynamic && (
                        <div className={cn(
                          "rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3",
                          templateConfigIssues.length > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-[#00a884]/30 bg-[#00a884]/5"
                        )}>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-[#e9edef] flex items-center gap-1.5">
                              <Braces className="w-3.5 h-3.5" /> Este template tem {countDynamicInputs(selectedTemplateSchema)} campo(s) dinâmico(s)
                            </p>
                            <p className="text-[10px] text-[#8696a0] leading-snug">
                              {templateConfigIssues.length > 0
                                ? templateConfigIssues[0].message
                                : "Variáveis preenchidas. Cada contato recebe os próprios valores ({{nome}}, {{pedido}}...)."}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={templateConfigIssues.length > 0 ? "default" : "outline"}
                            className="rounded-lg h-8 text-[11px] shrink-0"
                            onClick={() => setTemplateVariablesOpen(true)}
                          >
                            <Braces className="w-3.5 h-3.5 mr-1" /> {templateConfigIssues.length > 0 ? "Preencher variáveis" : "Editar variáveis"}
                          </Button>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="flow" className="space-y-4 animate-in fade-in">
                      <Label className="text-xs md:text-sm">Selecione o Fluxo Visual</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                        {flows.map(f => (
                          <div 
                            key={f.id} 
                            onClick={() => setSelectedFlow(f.id)}
                            className={cn(
                              "p-3 md:p-4 rounded-xl border-2 transition-all cursor-pointer min-w-0 w-full",
                              selectedFlow === f.id ? "border-[#00a884] bg-[#00a884]/5 shadow-md" : "border-transparent bg-[#202c33] hover:border-white/10"
                            )}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="p-2 rounded-lg bg-[#00a884]/10 text-[#00a884] shrink-0">
                                <GitBranch className="w-4 h-4" />
                              </div>
                              <span className="font-bold text-[10px] md:text-xs text-[#e9edef] truncate">{f.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  </div>
                </Tabs>
              </div>

              <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <Label className="text-xs md:text-sm font-bold uppercase tracking-wider text-[#8696a0] flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Tempo Randomizado
                  </Label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {targetType !== 'conversation' && type === 'template' && (() => {
                      const sel = templates.find(t => t.id === selectedTemplate);
                      const cat = (sel?.category || 'MARKETING').toUpperCase();
                      const unit = cat === 'MARKETING' ? 0.33 : 0.04;
                      const qty = targetType === 'contacts' ? contacts.length : uploadedNumbers.split('\n').filter(n => n.trim().length >= 10).length;
                      return (
                        <Badge variant="outline" className="text-[8px] md:text-[10px] text-amber-500 border-amber-500/20 bg-amber-500/5">
                          Custo Estimado ({cat}): R$ {(unit * qty).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </Badge>
                      );
                    })()}

                    <Badge variant="outline" className="text-[8px] md:text-[10px] text-[#00a884] border-[#00a884]/20 bg-[#00a884]/5">Evita Bloqueios</Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 md:gap-6">
                  <div className="space-y-2">
                    <Label className="text-[9px] md:text-[10px]">Mínimo (seg)</Label>
                    <Input 
                      type="number" 
                      value={delayMin}
                      onChange={e => setDelayMin(parseInt(e.target.value))}
                      className="h-10 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] md:text-[10px]">Máximo (seg)</Label>
                    <Input 
                      type="number" 
                      value={delayMax}
                      onChange={e => setDelayMax(parseInt(e.target.value))}
                      className="h-10 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="text-xs md:text-sm font-bold uppercase tracking-wider text-[#8696a0] flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Aplicar Etiqueta (Opcional)
                  </Label>
                  <Badge variant="outline" className="text-[8px] md:text-[10px] text-[#00a884] border-[#00a884]/20 bg-[#00a884]/5">
                    Organiza no CRM
                  </Badge>
                </div>
                <p className="text-[10px] md:text-xs text-[#8696a0] italic">
                  Todos os contatos desta campanha receberão automaticamente esta etiqueta no CRM ao final do disparo.
                </p>
                <div className="flex gap-2">
                  <Select value={applyTag || 'none'} onValueChange={(v) => setApplyTag(v === 'none' ? '' : v)}>
                    <SelectTrigger className="h-10 md:h-11 rounded-xl bg-[#202c33] border-none text-[#e9edef] text-xs md:text-sm flex-1">
                      <SelectValue placeholder="Nenhuma etiqueta (não organizar)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma etiqueta</SelectItem>
                      {statuses.map(s => (
                        <SelectItem key={s.id} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button 
                onClick={handleStartBroadcast} 
                disabled={loading}
                className="w-full h-12 md:h-14 rounded-xl bg-[#00a884] hover:bg-[#00a884]/90 text-white font-bold text-base md:text-lg shadow-lg shadow-[#00a884]/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                INICIAR DISPAROS AGORA
              </Button>
                  </CardContent>
                </AccordionContent>
              </Card>
            </AccordionItem>
          </Accordion>
        </div>


        <div className="lg:col-span-4 space-y-4 md:space-y-6">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="history" className="border-none">
              <Card className="rounded-2xl shadow-xl border border-white/5 overflow-hidden bg-[#111b21] flex flex-col">
                <CardHeader className="bg-[#202c33] border-b border-white/5 p-0">
                  <AccordionTrigger className="p-4 hover:no-underline [&[data-state=open]>div>h3]:text-[#00a884] transition-all">
                    <CardTitle className="text-base md:text-lg flex items-center gap-2 text-[#00a884]">
                      <History className="w-5 h-5" /> Histórico Recente
                    </CardTitle>
                  </AccordionTrigger>
                </CardHeader>
                <AccordionContent>
                  <CardContent className="p-0 flex-1">
                    <ScrollArea className="h-[300px] lg:h-[500px]">

                <div className="p-4 space-y-3">
                  {broadcasts.length === 0 ? (
                    <div className="text-center py-10">
                      <Clock className="w-10 h-10 text-white/10 mx-auto mb-2" />
                      <p className="text-xs text-[#8696a0]">Nenhuma campanha realizada ainda.</p>
                    </div>
                  ) : (
                    broadcasts.map(b => (
                      <div key={b.id} className="p-3 rounded-xl bg-[#202c33] border border-white/5 space-y-2 group">
                        <div className="flex justify-between items-start">
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-xs text-[#e9edef] truncate">{b.name}</h4>
                            <p className="text-[9px] text-[#8696a0]">{new Date(b.created_at).toLocaleDateString('pt-BR')} às {new Date(b.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                          <button 
                            onClick={() => deleteBroadcast(b.id)}
                            className="text-white/20 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex justify-between text-[9px] text-[#8696a0]">
                            <span>Progresso</span>
                            <span>{Math.round((b.sent_count / b.total_contacts) * 100) || 0}%</span>
                          </div>
                          <div className="w-full bg-[#111b21] h-1 rounded-full overflow-hidden">
                            <div 
                              className="bg-[#00a884] h-full transition-all duration-500" 
                              style={{ width: `${(b.sent_count / b.total_contacts) * 100}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center pt-1">
                            <div className="flex gap-2 text-[9px]">
                              <span className="text-[#00a884]">{Math.max(0, b.sent_count - b.failed_count)} ok</span>
                              <span className="text-red-400">{b.failed_count || 0} erro</span>
                              <span className="text-[#8696a0]">/ {b.total_contacts} total</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setLogsBroadcast(b)}
                                className="text-[9px] px-2 h-5 rounded bg-white/5 text-[#8696a0] hover:text-[#e9edef] hover:bg-white/10 flex items-center gap-1"
                                title="Ver logs e motivos das falhas"
                              >
                                <AlertCircle className="w-2.5 h-2.5" /> Logs
                              </button>
                              {b.status === 'running' && (
                                <button
                                  onClick={() => cancelBroadcast(b.id)}
                                  className="text-[9px] px-2 h-5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/40 flex items-center gap-1"
                                  title="Parar disparo"
                                >
                                  <Pause className="w-2.5 h-2.5" /> Parar
                                </button>
                              )}
                              <Badge className={cn(
                                "text-[8px] h-4 px-1 capitalize",
                                b.status === 'completed' ? "bg-blue-500/20 text-blue-400" :
                                b.status === 'running' ? "bg-green-500/20 text-green-400 animate-pulse" :
                                b.status === 'cancelled' ? "bg-red-500/20 text-red-400" :
                                "bg-yellow-500/20 text-yellow-400"
                              )}>
                                {b.status === 'completed' ? 'Finalizado' : b.status === 'running' ? 'Em curso' : b.status === 'cancelled' ? 'Parado' : 'Pendente'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                    </ScrollArea>
                  </CardContent>
                </AccordionContent>
              </Card>
            </AccordionItem>
          </Accordion>

          
          {/* Tutorial Card */}
          <Card className="rounded-2xl shadow-xl border border-white/5 overflow-hidden bg-[#202c33]">
            <CardHeader className="p-4 border-b border-white/5">
              <CardTitle className="text-sm flex items-center gap-2 text-[#00a884]">
                <HelpCircle className="w-4 h-4" /> Dicas de Ouro
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {[
                { icon: <Zap className="w-3 h-3 text-yellow-500" />, text: "Use o tempo randomizado para imitar o comportamento humano e evitar bloqueios." },
                { icon: <AlertCircle className="w-3 h-3 text-orange-500" />, text: "Regra Meta: Mensagens normais e Fluxos só funcionam para quem respondeu nas últimas 24h." },
                { icon: <CheckCircle2 className="w-3 h-3 text-green-500" />, text: "Para lista fria (fora de 24h), use sempre Templates Aprovados para garantir a entrega." }
              ].map((tip, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <div className="mt-0.5 shrink-0">{tip.icon}</div>
                  <p className="text-[10px] text-[#8696a0] leading-relaxed">{tip.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <BroadcastFailureLogs
        broadcast={logsBroadcast}
        open={!!logsBroadcast}
        onOpenChange={(o) => { if (!o) setLogsBroadcast(null); }}
      />

      <TemplateVariablesDialog
        open={templateVariablesOpen}
        onOpenChange={setTemplateVariablesOpen}
        template={selectedTemplateRow}
        initialConfig={templateConfig}
        contacts={contacts}
        onApply={setTemplateConfig}
        applyLabel="Usar nesta campanha"
      />
    </div>
  );
};

export default Broadcaster;
