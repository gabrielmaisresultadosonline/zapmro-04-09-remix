import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from 'react';
import { WhatsAppAudioPlayer } from '@/components/crm/WhatsAppAudioPlayer';
import { openWhatsAppChat } from '@/lib/whatsapp';
 import { useNavigate, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { 
  MessageSquare, 
  Settings, 
  Users, 
  Search,
  Send, 
  GitBranch, 
  LogOut, 
  Plus, 
  Trash2, 
  Save, 
  RefreshCcw,
  Bot,
  BarChart3,
  CheckCircle2,
  XCircle,
  Mic,
  DollarSign,
  TrendingUp,
  Filter,
  FileUp,
  Paperclip,
  Video,
  ImageIcon,
  FileText,
  StopCircle,
  Clock,
  Play,
  PlayCircle,
  ArrowRight,
  Check,
  AlertCircle,
  FileCheck2,
  ListFilter,
  Zap,
  Eye,
  EyeOff,
  LayoutDashboard,
  Menu,
  ChevronLeft,
  Facebook,
  Link as LinkIcon,
  UserPlus,
  Download,
  Upload,
  User,
  CalendarClock,
  Calendar,
  MapPin,
  Smile,
  MoreHorizontal,
  Webhook,
  Layers,
  CreditCard,
  Copy,
  Pencil,
  Camera,
  LayoutList,
   MessageCircle, 
   RotateCw,
   ShieldCheck
   ,
   UserCog,
   ExternalLink,
    Eraser,
    Moon,
     Sun,
     History as HistoryIcon,
     BookOpen,
     ChevronUp,
     ChevronDown,
     Braces
   } from "lucide-react";
import * as LucideIcons from 'lucide-react';
const Instagram = (LucideIcons as any).Instagram || Camera;
import TemplatePreview from "@/components/whatsapp/TemplatePreview";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TemplateBuilder from "@/components/whatsapp/TemplateBuilder";
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
import FlowEditor from "@/components/crm/FlowEditor";
import { FlowSaveOverlay } from "@/components/crm/FlowSaveOverlay";
import { MediaPopup } from "@/components/MediaPopup";
import { DocumentPopup } from "@/components/crm/DocumentPopup";

import Broadcaster from "@/components/crm/Broadcaster";
import { SwipeableContactRow } from "@/components/crm/SwipeableContactRow";
import { ImageEditor } from "@/components/crm/ImageEditor";
import ModuleManager from "@/components/admin/ModuleManager";
import SalesTutorials from "@/components/sales/SalesTutorials";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EmojiPicker } from "@/components/crm/EmojiPicker";
import { getFileExtension, resolveMimeType } from "@/lib/mime";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  SidebarProvider, 
  Sidebar, 
  SidebarContent, 
  SidebarHeader, 
  SidebarFooter, 
  SidebarGroup, 
  SidebarGroupContent, 
  SidebarGroupLabel, 
  SidebarMenu, 
  SidebarMenuItem, 
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import AnnouncementPopup from "@/components/AnnouncementPopup";
import FirstTutorialVideo from "@/components/sales/FirstTutorialVideo";
import { WhatsAppNumberSelector } from "@/components/crm/WhatsAppNumberSelector";
import {
  fetchMaxWhatsAppNumbers,
  fetchUserNumbers,
  getActiveNumberId,
  setActiveNumberId as persistActiveNumberId,
  syncSettingsIntoNumbers,
  type WhatsAppNumberRecord,
} from "@/lib/whatsappNumbers";
import {
  getActiveWhatsAppNumberId,
  setActiveWhatsAppNumberId,
} from "@/lib/activeNumberContext";

const getCanonicalConversationPhone = (rawPhone: unknown): string => {
  const digits = String(rawPhone ?? '').replace(/\D/g, '');
  const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;

  // Números BR de celular chegam da Meta sem o 9º dígito. O dígito após o DDD
  // pode ser qualquer um, então normalizamos todo 55+DDD+8 dígitos com o 9.
  if (normalized.startsWith('55') && normalized.length === 12) {
    return `${normalized.slice(0, 4)}9${normalized.slice(4)}`;
  }

  return normalized;
};

const getConversationActivityTime = (contact: any): number => {
  // `updated_at` also changes when a name, tag or Google sync changes. Using it
  // here placed contacts without a recent conversation above active chats.
  const candidates = [contact?.last_interaction, contact?.last_message_received_at];
  for (const value of candidates) {
    if (!value) continue;
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const getLatestIsoValue = (first: unknown, second: unknown): string | null => {
  const values = [first, second]
    .filter(Boolean)
    .map(value => ({ value: String(value), time: new Date(String(value)).getTime() }))
    .filter(item => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time);
  return values[0]?.value ?? null;
};

const compareConversationContacts = (a: any, b: any): number => {
  const now = Date.now();
  const windowDuration = 24 * 60 * 60 * 1000;
  // Atividade recente inclui envios (disparo em massa/template), não apenas
  // mensagens recebidas — assim campanhas aparecem no topo em tempo real.
  const aActivity = getConversationActivityTime(a);
  const bActivity = getConversationActivityTime(b);
  const aRecent = aActivity > 0 && now - aActivity < windowDuration;
  const bRecent = bActivity > 0 && now - bActivity < windowDuration;

  if (aRecent !== bRecent) return aRecent ? -1 : 1;
  return bActivity - aActivity;
};


const deduplicateConversationContacts = (rows: any[]): any[] => {
  const byConversation = new Map<string, any>();

  for (const contact of rows) {
    const canonicalPhone = getCanonicalConversationPhone(contact?.wa_id);
    const key = canonicalPhone ? `${contact?.user_id ?? 'current'}:${canonicalPhone}` : `id:${contact?.id}`;
    const existing = byConversation.get(key);

    if (!existing) {
      byConversation.set(key, contact);
      continue;
    }

    const existingTime = getConversationActivityTime(existing);
    const contactTime = getConversationActivityTime(contact);
    const newest = contactTime >= existingTime ? contact : existing;
    const oldest = newest === contact ? existing : contact;

    byConversation.set(key, {
      ...oldest,
      ...newest,
      last_interaction: getLatestIsoValue(oldest.last_interaction, newest.last_interaction),
      last_message_received_at: getLatestIsoValue(oldest.last_message_received_at, newest.last_message_received_at),
      total_messages_received: Math.max(oldest.total_messages_received ?? 0, newest.total_messages_received ?? 0),
      total_messages_sent: Math.max(oldest.total_messages_sent ?? 0, newest.total_messages_sent ?? 0),
    });
  }

  return Array.from(byConversation.values()).sort(compareConversationContacts);
};

const encodeAudioBufferToWav = (audioBuffer: AudioBuffer) => {
  const channels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples * blockAlign);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * blockAlign, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples * blockAlign, true);

  let offset = 44;
  const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index));
  for (let i = 0; i < samples; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return buffer;
};

const createMobilePlayableAudioBlob = async (audioBlob: Blob) => {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;

  const context = new AudioContextCtor();
  try {
    const sourceBuffer = await audioBlob.arrayBuffer();
    const decoded = await context.decodeAudioData(sourceBuffer.slice(0));
    return new Blob([encodeAudioBufferToWav(decoded)], { type: 'audio/wav' });
  } catch (error) {
    console.warn('Não foi possível gerar cópia WAV para o histórico mobile:', error);
    return null;
  } finally {
    context.close?.();
  }
};

const getMetaErrorCode = (message: any): string => {
  return String(
    message?.error_code ||
    message?.metadata?.last_meta_status?.errors?.[0]?.code ||
    ''
  ).trim();
};

const getMetaDeliveryErrorMessage = (message: any) => {
  const raw = String(message?.error_message || message?.metadata?.last_meta_status?.errors?.[0]?.message || '').trim();
  const code = getMetaErrorCode(message);
  if (code === '131026' || /message undeliverable/i.test(raw)) {
    return 'Mensagem não entregue (erro 131026 da Meta).';
  }
  if (/business account locked|not been verified|business.*verification|verifica(c|ç)/i.test(raw)) {
    return 'A Meta bloqueou o envio porque o seu Negócio (Business Manager) ainda não foi verificado. Você consegue receber mensagens, mas não enviar até concluir a verificação.';
  }
  if (/media upload error/i.test(raw)) {
    return 'A Meta recusou o arquivo de áudio/mídia após o upload. Grave novamente ou envie outro formato.';
  }
  return raw || 'A Meta informou falha na entrega desta mensagem.';
};

const getMetaDeliveryErrorExplanation = (message: any) => {
  const raw = String(message?.error_message || message?.metadata?.last_meta_status?.errors?.[0]?.message || '').trim();
  const code = getMetaErrorCode(message);
  if (code === '131026' || /message undeliverable/i.test(raw)) {
    return 'A Meta aceitou o envio, mas o WhatsApp não conseguiu entregar no aparelho do destinatário naquele momento (celular sem conexão, app desatualizado ou conta temporariamente indisponível). A Meta NÃO reenvia sozinha essas mensagens — elas são descartadas. Clique em "Reenviar" para tentar de novo.';
  }
  if (/business account locked|not been verified|business.*verification|verifica(c|ç)/i.test(raw)) {
    return 'O Business Manager precisa concluir a verificação para liberar envios. Até lá você só recebe mensagens.';
  }
  if (/media upload error/i.test(raw)) {
    return 'A Meta recusou o arquivo enviado após o upload. Tente gravar/enviar novamente, de preferência em outro formato ou com menor duração.';
  }
  if (code === '131047') {
    return 'A janela de 24 horas de atendimento expirou. Para falar novamente é preciso enviar um template aprovado pela Meta.';
  }
  return raw
    ? `A Meta retornou: "${raw}"${code ? ` (código ${code})` : ''}. Você pode tentar reenviar a mensagem.`
    : 'A Meta informou falha na entrega desta mensagem. Você pode tentar reenviar.';
};

const isBusinessVerificationError = (message: any) => {
  const raw = String(message?.error_message || message?.metadata?.last_meta_status?.errors?.[0]?.message || '').trim();
  return /business account locked|not been verified|business.*verification|verifica(c|ç)/i.test(raw);
};

type UnsupportedMetaRaw = {
  type?: string;
  unsupported?: { type?: string };
  errors?: Array<{ code?: number; message?: string; error_data?: { details?: string } }>;
};

const getUnsupportedMetaRaw = (message: unknown): UnsupportedMetaRaw => {
  if (!message || typeof message !== 'object') return {};
  const metadata = (message as { metadata?: { raw?: UnsupportedMetaRaw } }).metadata;
  return metadata?.raw || {};
};

const getUnsupportedMetaMessage = (message: unknown) => {
  const raw = getUnsupportedMetaRaw(message);
  const error = Array.isArray(raw.errors) ? raw.errors[0] : null;
  const details = String(error?.error_data?.details || error?.message || '').trim();

  if (Number(error?.code) === 131060 || /unavailable/i.test(details)) {
    return 'Mensagem de anúncio (Click-to-WhatsApp) recebida. Em modo coexistência (QR Code), a Meta não libera o conteúdo, imagem nem link do anúncio para o CRM — apenas o app do WhatsApp mostra. Para receber tudo aqui, migre o número 100% para a Cloud API.';
  }

  return 'Mensagem recebida em um formato que o WhatsApp ainda não disponibilizou para leitura no CRM.';
};

const getUnsupportedMetaDetails = (message: unknown) => {
  const raw = getUnsupportedMetaRaw(message);
  const error = Array.isArray(raw.errors) ? raw.errors[0] : null;
  return String(error?.error_data?.details || error?.message || raw.unsupported?.type || raw.type || '').trim();
};

const hasReadableUnsupportedContent = (message: unknown) => {
  if (!message || typeof message !== 'object') return false;
  const value = String((message as { message_text?: string; content?: string }).message_text || (message as { content?: string }).content || '').trim();
  if (!value || /^\[unsupported\]$/i.test(value)) return false;
  return !/^\[Formato não suportado pela Meta\]/i.test(value);
};

type AdReferral = {
  source_url?: string;
  source_type?: string;
  source_id?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
};

const getAdReferral = (message: unknown): AdReferral | null => {
  if (!message || typeof message !== 'object') return null;
  const meta = (message as { metadata?: any }).metadata;
  const ref =
    meta?.referral ||
    meta?.raw?.referral ||
    meta?.context?.referred_product ||
    null;
  return ref && typeof ref === 'object' ? ref as AdReferral : null;
};

const getWindowInfo = (lastReceivedAt: string | null | undefined) => {
  if (!lastReceivedAt) return null;
  const elapsed = Date.now() - new Date(lastReceivedAt).getTime();
  const limit = 24.5 * 60 * 60 * 1000;
  if (elapsed >= limit) return { isExpired: true, label: 'Janela expirada' };
  
  const remainingMs = limit - elapsed;
  const h = Math.floor(remainingMs / (60 * 60 * 1000));
  const m = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  return { isExpired: false, label: `${h}h ${m}m restantes` };
};

type ConnectionLogEntry = {
  id: string;
  at: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
  details?: string;
};

const sanitizeConnectionDetails = (details?: unknown) => {
  if (!details) return undefined;
  try {
    return JSON.stringify(
      details,
      (key, value) => {
        if (/code|token|secret|password/i.test(key)) return value ? '[oculto]' : value;
        return value;
      },
      2
    );
  } catch {
    return String(details);
  }
};

const CRM = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /**
   * Resultado da checagem da chave da OpenAI. Sem isto, uma chave errada só
   * falhava no webhook (401 invalid_api_key) e o usuário achava que a I.A.
   * estava funcionando.
   */
  const [openAiKeyCheck, setOpenAiKeyCheck] = useState<{
    state: 'idle' | 'checking' | 'valid' | 'invalid';
    /** Código devolvido pelo servidor: `no_credits`, `invalid_api_key`, etc. */
    code?: string;
    message?: string;
    detail?: string;
  }>({ state: 'idle' });
  const validatedOpenAiKeyRef = useRef<{
    key: string;
    result: { valid: boolean; message: string; detail?: string };
  } | null>(null);
  const openAiValidationInFlightRef = useRef<{
    key: string;
    promise: Promise<{ valid: boolean; message: string; detail?: string }>;
  } | null>(null);
  /**
   * Proteção contra corrida: `fetchData` é disparado por visibilitychange
   * (ex.: voltar da aba da OpenAI) e a resposta de `getCloudSettings` pode
   * chegar DEPOIS de um Salvar — sobrescrevendo o campo (type=password) com
   * a chave antiga. Guardamos o instante do último salvamento e o rascunho
   * em edição para que respostas obsoletas nunca vençam o que o usuário digitou.
   */
  const settingsSavedAtRef = useRef<number>(0);
  const openAiKeyDraftRef = useRef<string | null>(null);

  const [bizWarnExpanded, setBizWarnExpanded] = useState(false);
  const [expiredWindowDialog, setExpiredWindowDialog] = useState(false);
  const [confirmConvAction, setConfirmConvAction] = useState<{
    type: 'clear' | 'delete';
    contactId: string;
    contactName: string;
  } | null>(null);
    const [activeTab, setActiveTab] = useState(() => {
      try {
        const saved = localStorage.getItem('crm_active_tab');
        return saved || 'dashboard';
      } catch {
        return 'dashboard';
      }
    });
    useEffect(() => {
      try { localStorage.setItem('crm_active_tab', activeTab); } catch {}
    }, [activeTab]);
   const [userRole, setUserRole] = useState<string | null>(null);
  // Multi-WhatsApp: quantidade liberada pelo admin e número ativo escolhido.
  const [maxWhatsAppNumbers, setMaxWhatsAppNumbers] = useState<number>(1);
  const [activeNumberId, setActiveNumberId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userNumbersCount, setUserNumbersCount] = useState<number>(0);
  const [isMyDataOpen, setIsMyDataOpen] = useState(false);
  const [myDataEmail, setMyDataEmail] = useState('');
  const [myDataNewEmail, setMyDataNewEmail] = useState('');
  const [myDataNewPassword, setMyDataNewPassword] = useState('');
  const [myDataConfirmPassword, setMyDataConfirmPassword] = useState('');
  const [myDataShowPassword, setMyDataShowPassword] = useState(false);
  const [myDataSaving, setMyDataSaving] = useState(false);
  const [metaSettings, setMetaSettings] = useState<any>({
    meta_access_token: '',
    meta_phone_number_id: '',
    meta_waba_id: '',
    meta_app_id: '',
    meta_app_secret: '',
    meta_display_phone_number: '',
    meta_verified_name: '',
    meta_business_id: '424282342514566',
    google_client_id: '474898024942-7kagkoc25n5osu9pj1as5g1kod7op7m0.apps.googleusercontent.com',
    google_client_secret: '',
    openai_api_key: '',
    ai_agent_enabled: false,
     ai_kanban_auto_organizer: false,
     ai_send_bundled: false,
    ai_operation_mode: 'chat',
    ai_recovery_enabled: false,
    ai_recovery_delay_minutes: 60,
    ai_recovery_max_attempts: 2,
    ai_recovery_finalized_status: 'Finalizado agente IA',
    ai_recovery_scope: 'ai_only',
    auto_generate_strategy: false,
    strategy_generation_prompt: 'Analise o histórico acima e gere uma análise detalhada. Destaque pontos positivos da conversa e sugira o que dizer daqui para frente para converter este cliente. Sugira também 2 perguntas que eliminem as principais dúvidas dele sob o cabeçalho \"### Perguntas para Eliminar Dúvidas\".',
    ai_system_prompt: 'Você é um assistente de vendas profissional para a empresa Mais Resultados Online. Responda em Português do Brasil.',
    ai_agent_trigger: 'all',
    ai_agent_trigger_keyword: '',
    initial_auto_response_enabled: true,
    initial_response_text: '',
    initial_response_buttons: [],
    save_deleted_messages: false,
    shortcut_size: 100,
    tag_size: 100,
    business_hours_enabled: false,
    business_hours_start: '08:00',
    business_hours_end: '18:00',
    business_hours_tz: 'America/Sao_Paulo',
    outside_hours_message: 'Nossos administradores não estão ativos no momento. Seguiremos com o atendimento automatizado e em breve retornaremos com um atendimento humano.',
    business_description: 'Empresa especializada em soluções digitais e vendas online através do WhatsApp e redes sociais.',
    google_auto_sync: false,
    vps_transcoder_url: '', // Desativado temporariamente para evitar erro de DNS
    vps_status: 'unknown' as 'unknown' | 'online' | 'offline'
  });
  const [whatsAppConnectionConfirmed, setWhatsAppConnectionConfirmed] = useState(false);

  // ---- Flow shortcut bar preferences (persisted in localStorage per profile) ----
  const FLOW_BAR_PREFS_KEY = 'crm_flow_bar_prefs_v1';
  const FLOW_BAR_COLORS: Record<string, { border: string; bg: string; text: string; hover: string }> = {
    blue:   { border: 'border-blue-500/20',   bg: 'bg-blue-500/5',   text: 'text-blue-600',   hover: 'hover:bg-blue-500 hover:text-white hover:border-blue-500' },
    green:  { border: 'border-green-500/20',  bg: 'bg-green-500/5',  text: 'text-green-600',  hover: 'hover:bg-green-500 hover:text-white hover:border-green-500' },
    purple: { border: 'border-purple-500/20', bg: 'bg-purple-500/5', text: 'text-purple-600', hover: 'hover:bg-purple-500 hover:text-white hover:border-purple-500' },
    orange: { border: 'border-orange-500/20', bg: 'bg-orange-500/5', text: 'text-orange-600', hover: 'hover:bg-orange-500 hover:text-white hover:border-orange-500' },
    pink:   { border: 'border-pink-500/20',   bg: 'bg-pink-500/5',   text: 'text-pink-600',   hover: 'hover:bg-pink-500 hover:text-white hover:border-pink-500' },
    red:    { border: 'border-red-500/20',    bg: 'bg-red-500/5',    text: 'text-red-600',    hover: 'hover:bg-red-500 hover:text-white hover:border-red-500' },
  };
  const [flowBarPrefs, setFlowBarPrefs] = useState<{ size: number; color: string; layout: 'scroll' | 'one' | 'two'; chatFontScale: number; order: string[] }>(() => {
    try {
      const raw = localStorage.getItem(FLOW_BAR_PREFS_KEY);
      if (raw) return { size: 100, color: 'blue', layout: 'scroll', chatFontScale: 100, order: [], ...JSON.parse(raw) };
    } catch {}
    return { size: 100, color: 'blue', layout: 'scroll', chatFontScale: 100, order: [] };
  });
  useEffect(() => {
    try { localStorage.setItem(FLOW_BAR_PREFS_KEY, JSON.stringify(flowBarPrefs)); } catch {}
  }, [flowBarPrefs]);
  const [flowBarSettingsOpen, setFlowBarSettingsOpen] = useState(false);

  // Kanban view prefs (column width + font scale)
  const KANBAN_PREFS_KEY = 'crm_kanban_prefs_v1';
  const [kanbanPrefs, setKanbanPrefs] = useState<{ colWidth: number; fontScale: number }>(() => {
    try {
      const raw = localStorage.getItem(KANBAN_PREFS_KEY);
      if (raw) return { colWidth: 288, fontScale: 100, ...JSON.parse(raw) };
    } catch {}
    return { colWidth: 288, fontScale: 100 };
  });
  useEffect(() => {
    try { localStorage.setItem(KANBAN_PREFS_KEY, JSON.stringify(kanbanPrefs)); } catch {}
  }, [kanbanPrefs]);
  const [kanbanSettingsOpen, setKanbanSettingsOpen] = useState(false);
  // Deleted messages history (per conversation)
  const [deletedHistoryOpen, setDeletedHistoryOpen] = useState(false);
  const [deletedHistoryMessages, setDeletedHistoryMessages] = useState<any[]>([]);
  const [deletedHistoryLoading, setDeletedHistoryLoading] = useState(false);
  const openDeletedHistory = async (contactId: string) => {
    if (!contactId) return;
    setDeletedHistoryOpen(true);
    setDeletedHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('crm_messages')
        .select('*')
        .eq('contact_id', contactId)
        .eq('is_deleted', true)
        .order('deleted_at', { ascending: false });
      setDeletedHistoryMessages(data || []);
    } finally {
      setDeletedHistoryLoading(false);
    }
  };

  const [metrics, setMetrics] = useState<any>({
    sent_count: 0,
    responded_count: 0,
    qualified_count: 0,
    sales_count: 0,
    conv_24h_count: 0 // Nova métrica: conversas 24h
  });
  const [conversationStats, setConversationStats] = useState({
    paidThisMonth: 0,
    activeWindow24h: 0,
    monthLabel: '',
    paidThisWeek: 0,
    activeThisWeek: 0
  });
  const CONVERSATION_COST = 0.33;
  // Cache de mensagens para melhorar a performance de abertura de conversas
  const messagesCacheRef = useRef<Record<string, { messages: any[], timestamp: number }>>({});
  const CACHE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutos
  const [flows, setFlows] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const currentUserIdRef = useRef<string | null>(null);
  // Multi-WhatsApp: número aberto agora. Cada número tem contatos, mensagens e
  // histórico próprios (coluna whatsapp_number_id), então TODA consulta e todo
  // insert de conversa é filtrado por ele.
  const activeNumberIdRef = useRef<string | null>(getActiveWhatsAppNumberId());
  /** Aplica o filtro do número aberto em qualquer query builder do Supabase. */
  const scopeToNumber = <T,>(query: T): T => {
    const numberId = activeNumberIdRef.current;
    if (!numberId) return query;
    return (query as any).eq('whatsapp_number_id', numberId) as T;
  };
  /** Campos de escopo para inserts de contatos/mensagens. */
  const numberScopePatch = (): { whatsapp_number_id?: string } =>
    activeNumberIdRef.current ? { whatsapp_number_id: activeNumberIdRef.current } : {};
  /** Ignora eventos de realtime que pertencem a outro número do mesmo cadastro. */
  const belongsToActiveNumber = (row: any): boolean => {
    const numberId = activeNumberIdRef.current;
    if (!numberId) return true;
    const rowNumber = row?.whatsapp_number_id;
    // Registros antigos (sem número) continuam visíveis até o backfill rodar.
    return !rowNumber || rowNumber === numberId;
  };
  // Per-contact inbound message timestamps (last 7 days) used to compute
  // unread counts shown as a yellow badge on the conversation list.
  const [inboundTimestampsByContact, setInboundTimestampsByContact] = useState<Record<string, string[]>>({});
  // Baseline timestamp for unread counts: messages received before the user
  // first loaded the CRM are considered "already seen" so the badge only
  // shows truly new inbound messages.
  const unreadBaselineRef = useRef<number>(Date.now());
  // Freeze conversation order toggle — when on, the conversation list keeps
  // its current ordering (new contacts go on top, but existing ones don't
  // jump when new messages arrive). Persisted in localStorage.
  const [freezeConversationOrder, setFreezeConversationOrder] = useState<boolean>(false);
  const frozenOrderRef = useRef<string[]>([]);
  // Pre-computed once whenever `contacts` changes — used by the Conversas
  // tab. Avoids re-scanning 14k+ rows on every tab switch / status change.
  const contactsCacheKeyRef = useRef<string | null>(null);
  const lastContactsSyncRef = useRef<string | null>(null);
  const contactsSeededRef = useRef<boolean>(false);
  const contactsInFlightRef = useRef<boolean>(false);
  const realtimeFallbackCursorRef = useRef<string | null>(null);
  const realtimeFallbackInFlightRef = useRef<boolean>(false);
  const [statusFilter, setStatusFilter] = useState('all');
  // Texto visível do campo de busca da lista de Conversas. Mantido em sincronia
  // com `statusFilter`: quando o usuário apaga o texto, voltamos automaticamente
  // para "Todos"; ao clicar em uma etiqueta, o campo é limpo.
  const [conversationSearch, setConversationSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  // Bulk-rename dialog state (nomear em massa os contatos "Sem Nome")
  const [bulkNameOpen, setBulkNameOpen] = useState(false);
  const [bulkNamePrefix, setBulkNamePrefix] = useState('Contato');
  const [bulkNameStart, setBulkNameStart] = useState(1);
  const [bulkNameBusy, setBulkNameBusy] = useState(false);
  const [bulkResendBusy, setBulkResendBusy] = useState(false);
  // Dedicated search state for the Contatos and Sincronizados Google tabs.
  // Keeping it separate from `statusFilter` ensures that searching/filtering
  // there does NOT silently filter the Conversas list (which uses
  // `statusFilter`) when the user navigates back to Conversas.
  const [contactListSearch, setContactListSearch] = useState('all');
  const [kanbanView, setKanbanView] = useState(false);
  const [kanbanSearch, setKanbanSearch] = useState('');
  const kanbanScrollRef = useRef<HTMLDivElement>(null);
  const kanbanScrollTimerRef = useRef<number | null>(null);

  const stopKanbanAutoScroll = () => {
    if (kanbanScrollTimerRef.current !== null) {
      window.clearInterval(kanbanScrollTimerRef.current);
      kanbanScrollTimerRef.current = null;
    }
  };

  const handleKanbanDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const el = kanbanScrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = 80;
    const x = e.clientX;
    let dir = 0;
    if (x - rect.left < edge) dir = -1;
    else if (rect.right - x < edge) dir = 1;
    if (dir === 0) { stopKanbanAutoScroll(); return; }
    if (kanbanScrollTimerRef.current !== null) return;
    kanbanScrollTimerRef.current = window.setInterval(() => {
      el.scrollLeft += dir * 20;
    }, 16);
  };
  const [draggedContact, setDraggedContact] = useState<any>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const selectedContactRef = useRef<any>(null);
  const sendQueueRef = useRef<Record<string, Promise<void>>>({});
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const chatMessagesRef = useRef<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingContacts, setSendingContacts] = useState<Record<string, boolean>>({});
  const [loadingChat, setLoadingChat] = useState(false);
  const isSending = (id: string) => !!sendingContacts[id];
  const setContactSending = (id: string, state: boolean) => {
    setSendingContacts(prev => ({ ...prev, [id]: state }));
  };
  const [templates, setTemplates] = useState<any[]>([]);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isPreviewingAudio, setIsPreviewingAudio] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const recordingTimerRef = useRef<any>(null);
  // Recursos de gravação mantidos em refs (não em state) para permitir cleanup síncrono e confiável
  const recorderRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isStartingRecordingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFlowEditorOpen, setIsFlowEditorOpen] = useState(false);
  const [flowSaveOverlay, setFlowSaveOverlay] = useState<{ open: boolean; done: boolean }>({ open: false, done: false });
  // Após trocar/desconectar um número, forçamos a lista de WhatsApps conectados
  // (nunca o Embedded Signup direto) até o usuário escolher uma caixa.
  const [forceNumberSelector, setForceNumberSelector] = useState(false);
  const [editingFlow, setEditingFlow] = useState<any>(null);
  const [uploadType, setUploadType] = useState<'image' | 'video' | 'audio' | 'document' | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Editor de variáveis de template (agendamento / padrão do template).
  const [templateVariablesTarget, setTemplateVariablesTarget] = useState<{ template: any; purpose: 'schedule' | 'default' } | null>(null);
  const [scheduleTemplateConfig, setScheduleTemplateConfig] = useState<TemplateSendConfig | null>(null);
  const [confirmSend, setConfirmSend] = useState<{
    type: 'template' | 'flow';
    id: string;
    name: string;
    language?: string;
  } | null>(null);
   const [previewTemplate, setPreviewTemplate] = useState<any>(null);
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [previewDocument, setPreviewDocument] = useState<{ url: string; fileName?: string } | null>(null);
  // Busca de mensagens dentro da conversa aberta
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchIndex, setChatSearchIndex] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);


   const [pastedImage, setPastedImage] = useState<File | null>(null);
   const [pastedImagePreview, setPastedImagePreview] = useState<string | null>(null);
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  // Diálogo rápido "mensagem com botão" (copiar PIX / link / resposta) dentro da conversa.
  const [showTemplates, setShowTemplates] = useState(true);
  const [showFlows, setShowFlows] = useState(true);
  const [isContactInfoOpen, setIsContactInfoOpen] = useState(false);
  const [isImportExportOpen, setIsImportExportOpen] = useState(false);
  const [contactToView, setContactToView] = useState<any>(null);
  const [now, setNow] = useState(Date.now());
  const [isSchedulingOpen, setIsSchedulingOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleDateObj, setScheduleDateObj] = useState<Date | undefined>(undefined);
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleType, setScheduleType] = useState<'message' | 'template' | 'flow'>('message');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [selectedContactsForScheduling, setSelectedContactsForScheduling] = useState<string[]>([]);
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [selectedCampaignType, setSelectedCampaignType] = useState<'individual' | 'batch' | 'birthday' | 'list'>('individual');
  const [contactListText, setContactListText] = useState('');
  const [birthdayName, setBirthdayName] = useState('');
  const [birthdayNumber, setBirthdayNumber] = useState('');
  
  const [improvingPrompt, setImprovingPrompt] = useState(false);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [isNewWebhookDialogOpen, setIsNewWebhookDialogOpen] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ name: '', response_type: 'text' as 'text' | 'template', template_id: '', secret_token: '', is_active: true, default_status: 'new' });
  const [googleAccounts, setGoogleAccounts] = useState<Array<{ id: string; email: string; auto_sync: boolean; connection_status?: string | null; last_sync_error?: string | null }>>([]);
  const googleContactsEnabled = googleAccounts.length > 0;
  const anyAutoSync = googleAccounts.some(a => a.auto_sync);
  const MAX_GOOGLE_ACCOUNTS = 3;
  const [showUnnamedContacts, setShowUnnamedContacts] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [bulkName, setBulkName] = useState('');
  const [isBulkNaming, setIsBulkNaming] = useState(false);

  // Detecta quando a conta WhatsApp foi desregistrada na Meta (erro 133010)
  const [whatsappDisconnected, setWhatsappDisconnected] = useState(false);
  const [crmTheme, setCrmTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return (localStorage.getItem('crm_theme') as 'dark' | 'light') || 'dark';
  });
  useEffect(() => {
    try { localStorage.setItem('crm_theme', crmTheme); } catch {}
  }, [crmTheme]);

  useEffect(() => {
    const originalInvoke = supabase.functions.invoke.bind(supabase.functions);
    (supabase.functions as any).invoke = async (fnName: string, opts?: any) => {
      const result: any = await originalInvoke(fnName as any, opts);
      try {
        if (fnName === 'meta-whatsapp-crm') {
          const blob = JSON.stringify(result?.error ?? '') + JSON.stringify(result?.data ?? '');
          if (blob.includes('133010') || blob.includes('Account not registered')) {
            setWhatsappDisconnected(true);
          }
        }
      } catch {}
      return result;
    };
    return () => {
      (supabase.functions as any).invoke = originalInvoke;
    };
  }, []);

  const [mediaUploadProgress, setMediaUploadProgress] = useState<{ [key: string]: number }>({});

  const [scheduledMessages, setScheduledMessages] = useState<any[]>([]);
  const [allScheduledMessages, setAllScheduledMessages] = useState<any[]>([]);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [showAllGoogleContacts, setShowAllGoogleContacts] = useState(false);
  // Reenvio de contatos já salvos/sincronizados pela ferramenta para outra conta Google
  const [resendSelection, setResendSelection] = useState<Set<string>>(new Set());
  const [resendSourceFilter, setResendSourceFilter] = useState<string>('all');
  const [resendTargetAccount, setResendTargetAccount] = useState<string>('');
  const [isResendingGoogle, setIsResendingGoogle] = useState(false);

  // States for custom statuses
  const [kanbanStatuses, setKanbanStatuses] = useState<any[]>([]);
  const [isNewStatusDialogOpen, setIsNewStatusDialogOpen] = useState(false);
  const [isEditStatusDialogOpen, setIsEditStatusDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<any>(null);
  const [newStatusData, setNewStatusData] = useState({ label: '', color: 'blue', value: '' });
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [isMetricsListOpen, setIsMetricsListOpen] = useState(false);
  const [metricsListType, setMetricsListType] = useState<'paid' | 'active' | 'weekly_paid' | 'weekly_active' | null>(null);
  const [metricsListData, setMetricsListData] = useState<any[]>([]);
  const [metricsChartData, setMetricsChartData] = useState<any[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<any>(null);
  const [activeFlowsView, setActiveFlowsView] = useState(false);
  const [isRepairingWebhook, setIsRepairingWebhook] = useState(false);
  const [connectionLogs, setConnectionLogs] = useState<ConnectionLogEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem('crm_connection_logs') || '[]');
    } catch {
      return [];
    }
  });

  const addConnectionLog = useCallback((level: ConnectionLogEntry['level'], message: string, details?: unknown) => {
    const entry: ConnectionLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: new Date().toLocaleString('pt-BR'),
      level,
      message,
      details: sanitizeConnectionDetails(details),
    };
    setConnectionLogs(prev => {
      const next = [entry, ...prev].slice(0, 25);
      localStorage.setItem('crm_connection_logs', JSON.stringify(next));
      return next;
    });

    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    logger('[WhatsApp Connection]', message, details || '');
  }, []);

  const repairWhatsAppWebhook = useCallback(async () => {
    setIsRepairingWebhook(true);
    addConnectionLog('info', 'Reparando recebimento de mensagens do WhatsApp');
    try {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'repairMetaWebhook' },
      });

      if (error || !data?.success) {
        addConnectionLog('error', 'Falha ao reparar o webhook da Meta', data || error);
        if (data?.requiresReconnect) {
          toast({
            title: 'Você precisa reconectar seu WhatsApp',
            description: 'Clique em Desconectar WhatsApp e conecte novamente pelo Facebook para receber as conversas.',
            variant: 'destructive',
          });
          return;
        }
        throw new Error(data?.error || error?.message || 'Falha ao reparar recebimento');
      }

      addConnectionLog('success', 'Recebimento de mensagens reparado', data);
      toast({
        title: 'Recebimento reparado',
        description: 'Envie uma mensagem de teste para este WhatsApp e atualize as Conversas.',
      });
      await fetchContacts();
    } catch (err: any) {
      toast({
        title: 'Erro ao reparar recebimento',
        description: err?.message || 'Reconecte o WhatsApp e tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsRepairingWebhook(false);
    }
  }, [addConnectionLog, toast]);

  // Relógio usado pelos contadores regressivos (janela de 24h, timeout de
  // fluxo, próxima ação). Ele força um re-render por segundo, então é pausado
  // enquanto a aba está em segundo plano — no celular isso evita que o
  // navegador fique processando a árvore inteira do CRM sem ninguém olhando.
  useEffect(() => {
    let interval: number | undefined;

    const start = () => {
      if (interval !== undefined) return;
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 1000);
    };

    const stop = () => {
      if (interval === undefined) return;
      window.clearInterval(interval);
      interval = undefined;
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      stop();
    };
  }, []);

  // Meta Embedded Signup (WhatsApp Tech Provider) ---------------------------
  const META_APP_ID = '1296667748608099';
  const META_CONFIG_ID = '2206282020152107';

  useEffect(() => {
    if ((window as any).FB) return;
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({
        appId: META_APP_ID,
        autoLogAppEvents: true,
        cookie: true,
        xfbml: true,
        version: 'v25.0',
      });
      addConnectionLog('success', 'SDK do Facebook carregado', { app_id: META_APP_ID, config_id: META_CONFIG_ID, version: 'v25.0' });
    };
    const id = 'facebook-jssdk';
    if (document.getElementById(id)) return;
    const js = document.createElement('script');
    js.id = id;
    js.async = true;
    js.defer = true;
    js.crossOrigin = 'anonymous';
    js.src = 'https://connect.facebook.net/en_US/sdk.js';
    document.body.appendChild(js);

    const handleMsg = async (event: MessageEvent) => {
      if (!event.origin || !/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        console.log('[Embedded Signup] event:', data);
        addConnectionLog(data.event === 'ERROR' ? 'error' : data.event === 'CANCEL' ? 'warn' : 'info', `Evento Meta recebido: ${data.event}`, data.data);
        if (['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', 'FINISH_GRANT_ONLY_API_ACCESS'].includes(data.event)) {
          (window as any).__waEmbeddedSignupData = { ...(data.data || {}), event: data.event };
        } else if (data.event === 'CANCEL') {
          toast({ title: 'Conexão cancelada', description: `Etapa: ${data.data?.current_step || 'N/A'}`, variant: 'destructive' });
        } else if (data.event === 'ERROR') {
          toast({ title: 'Erro no Embedded Signup', description: data.data?.error_message || 'Erro desconhecido', variant: 'destructive' });
        }
      } catch {}
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, [addConnectionLog]);

  const startEmbeddedSignup = () => {
    const FB = (window as any).FB;
    if (!FB) {
      toast({ title: 'Facebook ainda carregando…', description: 'Aguarde, tentaremos abrir novamente em 2s.' });
      setTimeout(() => {
        if ((window as any).FB) startEmbeddedSignup();
        else toast({ title: 'Facebook não carregou', description: 'Recarregue a página e tente novamente.', variant: 'destructive' });
      }, 2000);
      return;
    }
    (window as any).__waEmbeddedSignupData = null;
    const handleSignupResponse = async (response: any) => {
      addConnectionLog(response?.authResponse?.code ? 'success' : 'warn', 'Resposta final do popup Meta recebida', response);
      if (!response?.authResponse?.code) {
        console.warn('[Embedded Signup] no auth code in response', response);
        toast({ title: 'Login cancelado ou bloqueado', description: 'Verifique se o popup foi bloqueado pelo navegador.', variant: 'destructive' });
        return;
      }
      const code = response.authResponse.code;
      const sessionInfo = (window as any).__waEmbeddedSignupData || {};
      addConnectionLog('info', 'Enviando código para salvar a conexão no CRM', {
        signup_event: sessionInfo.event,
        waba_id: sessionInfo.waba_id,
        phone_number_id: sessionInfo.phone_number_id,
        business_id: sessionInfo.business_id,
        has_code: true,
      });
      toast({ title: 'Conectando à Meta…', description: 'Trocando código por token e salvando credenciais.' });
      try {
        const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
          body: {
            action: 'exchangeEmbeddedSignupCode',
            code,
            waba_id: sessionInfo.waba_id,
            phone_number_id: sessionInfo.phone_number_id,
            business_id: sessionInfo.business_id,
            signup_event: sessionInfo.event,
          },
        });
        if (error || !data?.success) {
          addConnectionLog('error', 'Falha ao salvar conexão retornada pelo servidor', data || error);
          throw new Error(data?.error || error?.message || 'Falha ao conectar');
        }
           const { data: { session } } = await supabase.auth.getSession();
           const user = session?.user;
        if (user) localStorage.setItem(`crm_whatsapp_connected_${user.id}`, 'true');
        // Ativa o teste grátis de 2 dias no momento em que o WhatsApp é conectado
        // (apenas se o usuário ainda não tem trial ativo e não é pago).
        if (user) {
          try {
            const { data: prof } = await supabase
              .from('crm_profiles')
              .select('trial_ends_at, is_paid, access_until')
              .eq('user_id', user.id)
              .maybeSingle();
            const nowMs = Date.now();
            const accessUntilMs = prof?.access_until ? new Date(prof.access_until).getTime() : 0;
            const isPaidActive = !!prof?.is_paid && accessUntilMs > nowMs;
            if (!prof?.trial_ends_at && !isPaidActive) {
              const trialEnds = new Date(nowMs + 2 * 86400000).toISOString();
              await supabase
                .from('crm_profiles')
                .update({ trial_ends_at: trialEnds })
                .eq('user_id', user.id);
              toast({ title: '🎁 Teste grátis iniciado!', description: 'Você tem 2 dias completos para testar o CRM.' });
            }
          } catch (err) {
            console.error('[trial] erro ao ativar teste após conexão do WhatsApp', err);
          }
        }
        addConnectionLog('success', 'Conexão salva no CRM com sucesso', data);
        setWhatsAppConnectionConfirmed(true);
        setMetaSettings(prev => ({
          ...prev,
          meta_waba_id: data.waba_id || prev.meta_waba_id,
          meta_phone_number_id: data.phone_number_id || prev.meta_phone_number_id,
          meta_display_phone_number: data.display_phone_number || prev.meta_display_phone_number,
          meta_verified_name: data.verified_name || prev.meta_verified_name,
          meta_business_id: data.business_id || prev.meta_business_id,
        }));
        toast({ title: 'WhatsApp conectado!', description: `WABA: ${data.waba_id || '—'} · Phone: ${data.phone_number_id || '—'}` });
        await fetchData(false);
      } catch (e: any) {
        addConnectionLog('error', 'Erro ao finalizar conexão no CRM', { message: e?.message || String(e) });
        toast({ title: 'Erro ao conectar', description: e?.message || String(e), variant: 'destructive' });
      }
    };
    try {
      addConnectionLog('info', 'Abrindo popup de conexão Meta', {
        app_id: META_APP_ID,
        config_id: META_CONFIG_ID,
        domain: window.location.hostname,
        flow: 'whatsapp_business_app_onboarding',
      });
      FB.login(
      (response: any) => {
        void handleSignupResponse(response);
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      }
      );
    } catch (err: any) {
      console.error('[Embedded Signup] FB.login threw', err);
      addConnectionLog('error', 'Erro ao abrir popup do Facebook', { message: err?.message || String(err) });
      toast({ title: 'Erro ao abrir o Facebook', description: err?.message || 'Recarregue a página e tente novamente.', variant: 'destructive' });
    }
  };

  const computeConversationStats = async () => {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: monthMsgs } = await scopeToNumber(
        supabase
          .from('crm_messages')
          .select('contact_id, direction, created_at, metadata')
      )
        .gte('created_at', startOfMonth)
        .order('created_at', { ascending: true });

      const byContact: Record<string, any[]> = {};
      (monthMsgs || []).forEach((m: any) => {
        if (!m.contact_id) return;
        (byContact[m.contact_id] = byContact[m.contact_id] || []).push(m);
      });

      const DAY = 24 * 60 * 60 * 1000;
      let paidCount = 0;
      let paidWeek = 0;
      
      Object.values(byContact).forEach((msgs) => {
        let lastInbound = -Infinity;
        let lastPaidStart = -Infinity;
        const weekTime = new Date(startOfWeek).getTime();
        
        for (const m of msgs) {
          const t = new Date(m.created_at).getTime();
          if (m.direction === 'inbound') {
            lastInbound = t;
          } else if (m.direction === 'outbound') {
            // Mensagens enviadas pelo app do celular (echoes) NÃO são cobradas
            // pela Meta — não contam como conversa paga.
            const src = (m as any)?.metadata?.source;
            const isEcho = src === 'echo_mobile_app' || src === 'meta_webhook_echo';
            const isManual = src === 'manual_send';
            const isAutomation = src === 'api_automation' || m.message_type === 'template' || m.message_type === 'carousel';
            if (isEcho || isManual || !isAutomation) continue;
            // Regra oficial do WhatsApp: A janela de 24h só reseta quando o cliente responde.
            // O envio de mensagens outbound não estende a janela de atendimento livre.
            const inFreeWindow = t - lastInbound < DAY;
            const inPaidWindow = t - lastPaidStart < DAY;
            if (!inFreeWindow && !inPaidWindow) {
              paidCount++;
              if (t >= weekTime) paidWeek++;
              // Uma nova conversa (paga) começa aqui e dura 24h
              lastPaidStart = t;
            }
          }
        }
      });

      const { data: recent } = await scopeToNumber(
        supabase
          .from('crm_messages')
          .select('contact_id, direction, created_at')
      )
        .eq('direction', 'inbound')
        .gte('created_at', since24h);

      const activeSet = new Set<string>();
      (recent || []).forEach((m: any) => m.contact_id && activeSet.add(m.contact_id));

      const { data: recentWeek } = await scopeToNumber(
        supabase
          .from('crm_messages')
          .select('contact_id')
      )
        .eq('direction', 'inbound')
        .gte('created_at', startOfWeek);
      const activeWeekSet = new Set<string>();
      (recentWeek || []).forEach((m: any) => m.contact_id && activeWeekSet.add(m.contact_id));

      setConversationStats({
        paidThisMonth: paidCount,
        activeWindow24h: activeSet.size,
        monthLabel: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        paidThisWeek: paidWeek,
        activeThisWeek: activeWeekSet.size
      });

      // Calcular dados do gráfico (últimos 7 dias)
      const chartData = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const dayLabel = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        
        let dayPaid = 0;
        let dayActive = 0;

        Object.values(byContact).forEach((msgs) => {
          let lastInbound = -Infinity;
          let lastPaidStart = -Infinity;
          let contactPaidForDay = false;
          let contactActiveForDay = false;

          msgs.forEach(m => {
            const mt = new Date(m.created_at).getTime();
            const mDate = m.created_at.split('T')[0];
            
            if (m.direction === 'inbound') {
              lastInbound = mt;
              if (mDate === dateStr) contactActiveForDay = true;
            } else if (m.direction === 'outbound') {
              const src = (m as any)?.metadata?.source;
              const isEcho = src === 'echo_mobile_app' || src === 'meta_webhook_echo';
              const isManual = src === 'manual_send';
              const isAutomation = src === 'api_automation' || m.message_type === 'template' || m.message_type === 'carousel';
              if (isEcho || isManual || !isAutomation) return;
              const inFreeWindow = mt - lastInbound < DAY;
              const inPaidWindow = mt - lastPaidStart < DAY;
              if (!inFreeWindow && !inPaidWindow) {
                if (mDate === dateStr) contactPaidForDay = true;
                lastPaidStart = mt;
              }
            }
          });
          
          if (contactPaidForDay) dayPaid++;
          if (contactActiveForDay) dayActive++;
        });

        chartData.push({ name: dayLabel, pagos: dayPaid, ativos: dayActive });
      }
      setMetricsChartData(chartData);

    } catch (e) {
      console.error('Erro ao calcular estatísticas de conversas:', e);
    }
  };

  const handleOpenMetricsList = async (type: 'paid' | 'active' | 'weekly_paid' | 'weekly_active') => {
    setMetricsListType(type as any);
    setIsMetricsListOpen(true);
    setMetricsListData([]);

    try {
      const now = new Date();
      const DAY = 24 * 60 * 60 * 1000;
      let startTime: string;
      
      if (type === 'paid' || type === 'active') {
        startTime = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      } else {
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      if (type === 'paid' || type === 'weekly_paid') {
        const { data: msgs } = await scopeToNumber(
          supabase
            .from('crm_messages')
            .select('contact_id, direction, created_at, metadata')
        )
          .gte('created_at', startTime)
          .order('created_at', { ascending: true });

        const byContact: Record<string, any[]> = {};
        (msgs || []).forEach((m: any) => {
          if (!m.contact_id) return;
          (byContact[m.contact_id] = byContact[m.contact_id] || []).push(m);
        });

        const paidContactIds = new Set<string>();
        Object.entries(byContact).forEach(([cid, cMsgs]) => {
          let lastInbound = -Infinity;
          let lastPaidStart = -Infinity;
          for (const m of cMsgs) {
            const t = new Date(m.created_at).getTime();
            if (m.direction === 'inbound') {
              lastInbound = t;
            } else if (m.direction === 'outbound') {
              const src = (m as any)?.metadata?.source;
              const isEcho = src === 'echo_mobile_app' || src === 'meta_webhook_echo';
              const isManual = src === 'manual_send';
              const isAutomation = src === 'api_automation' || m.message_type === 'template' || m.message_type === 'carousel';
              if (isEcho || isManual || !isAutomation) continue;
              const inFreeWindow = t - lastInbound < DAY;
              const inPaidWindow = t - lastPaidStart < DAY;
              if (!inFreeWindow && !inPaidWindow) {
                paidContactIds.add(cid);
                lastPaidStart = t;
              }
            }
          }
        });

        const { data: contactDetails } = await supabase
          .from('crm_contacts')
          .select('id, name, wa_id, status')
          .in('id', Array.from(paidContactIds));
        
        setMetricsListData(contactDetails || []);
      } else {
        const filterTime = (type === 'active') ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() : startTime;
        const { data: recent } = await scopeToNumber(
          supabase
            .from('crm_messages')
            .select('contact_id')
        )
          .eq('direction', 'inbound')
          .gte('created_at', filterTime);
        
        const activeIds = Array.from(new Set((recent || []).map(m => m.contact_id).filter(id => id)));
        
        const { data: contactDetails } = await supabase
          .from('crm_contacts')
          .select('id, name, wa_id, status')
          .in('id', activeIds);
          
        setMetricsListData(contactDetails || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeTab === 'dashboard') {
      computeConversationStats();
    }
  }, [activeTab]);

  useEffect(() => {
    if (metaSettings.vps_transcoder_url) {
      const checkVps = async () => {
        try {
          const url = metaSettings.vps_transcoder_url.replace(/\/$/, '');
          // Using a simple health check or just validating the URL format
          // to avoid CORS issues if the server doesn't have the OPTIONS header for the health check
          const res = await fetch(url, { 
            method: 'GET', 
            mode: 'no-cors',
            signal: AbortSignal.timeout(5000) 
          });
          setMetaSettings(prev => ({ ...prev, vps_status: 'online' }));
        } catch (e) {
          setMetaSettings(prev => ({ ...prev, vps_status: 'offline' }));
        }
      };
      checkVps();
      const interval = setInterval(checkVps, 60000);
      return () => clearInterval(interval);
    }
  }, [metaSettings.vps_transcoder_url]);


  useEffect(() => {
    selectedContactRef.current = selectedContact;
  }, [selectedContact]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  const syncRecentRealtimeMessages = async () => {
    // Aumentamos o limite de tempo para garantir que nada foi perdido
    if (realtimeFallbackInFlightRef.current) return;

    realtimeFallbackInFlightRef.current = true;

    try {
      const cursor = realtimeFallbackCursorRef.current;
      const firstCursor = cursor || new Date(Date.now() - 15_000).toISOString();
      const { data } = await scopeToNumber(
        supabase
          .from('crm_messages')
          .select('*')
          .eq('user_id', currentUserIdRef.current ?? '')
      )
        .gt('created_at', firstCursor)
        .order('created_at', { ascending: true })
        .limit(100); // Limite de segurança para evitar sobrecarga no realtime fallback

      const rows = data || [];
      realtimeFallbackCursorRef.current = rows.length > 0
        ? rows.reduce((latest: string, row: any) => row.created_at > latest ? row.created_at : latest, firstCursor)
        : firstCursor;

      if (rows.length === 0) return;

      const activeContactId = selectedContactRef.current?.id;
      const activeRows = activeContactId ? rows.filter((row: any) => row.contact_id === activeContactId) : [];

      if (activeRows.length > 0) {
        setChatMessages(prev => {
          const byId = new Map(prev.map((m: any) => [m.id, m]));
          activeRows.forEach((m: any) => byId.set(m.id, m));
          return Array.from(byId.values()).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        });
      }

      const inboundRows = rows.filter((row: any) => row.direction === 'inbound');
      if (inboundRows.length > 0) {
        setInboundTimestampsByContact(prev => {
          const next = { ...prev };
          inboundRows.forEach((row: any) => {
            const list = next[row.contact_id] || [];
            if (!list.includes(row.created_at)) next[row.contact_id] = [row.created_at, ...list].slice(0, 200);
          });
          return next;
        });
      }

      const contactIds = Array.from(new Set(rows.map((row: any) => row.contact_id).filter(Boolean)));
      if (contactIds.length > 0) {
        const { data: changedContacts } = await supabase
          .from('crm_contacts')
          .select('*')
          .eq('user_id', currentUserIdRef.current ?? '')
          .in('id', contactIds);

        if (changedContacts?.length) {
          setContacts(prev => {
            const map = new Map(prev.map((contact: any) => [contact.id, contact]));
            changedContacts.forEach((contact: any) => map.set(contact.id, { ...map.get(contact.id), ...contact }));
            return deduplicateConversationContacts(Array.from(map.values()));
          });

          const selectedUpdate = changedContacts.find((contact: any) => contact.id === activeContactId);
          if (selectedUpdate) {
            setSelectedContact((prev: any) => prev && prev.id === selectedUpdate.id ? { ...prev, ...selectedUpdate } : prev);
          }
        }
      }
    } catch (error) {
      console.warn('[CRM] Falha no fallback de tempo real:', error);
    } finally {
      realtimeFallbackInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const activeContactId = selectedContact?.id;
    if (!activeContactId) return;

    const activeMessageChannel = supabase
      .channel(`crm_active_messages_${activeContactId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crm_messages',
          filter: `contact_id=eq.${activeContactId}`,
        },
        (payload) => {
          const row: any = payload.new;
          if (!row?.id || selectedContactRef.current?.id !== activeContactId) return;

          if (payload.eventType === 'INSERT') {
            setChatMessages(prev => {
              if (prev.some(m => m.id === row.id)) return prev;
              return [...prev, row];
            });

            if (row.direction === 'inbound') {
              const nowIso = new Date().toISOString();
              setContacts(prev => prev.map(c => c.id === row.contact_id
                ? { ...c, last_message_received_at: row.created_at, last_read_at: nowIso }
                : c
              ));
              setSelectedContact((prev: any) => prev && prev.id === row.contact_id
                ? { ...prev, last_message_received_at: row.created_at, last_read_at: nowIso }
                : prev
              );
              supabase.from('crm_contacts').update({ last_read_at: nowIso }).eq('id', row.contact_id).then(() => {});
            }
          } else if (payload.eventType === 'UPDATE') {
            setChatMessages(prev => prev.map(m => m.id === row.id ? row : m));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(activeMessageChannel);
    };
  }, [selectedContact?.id]);

  useEffect(() => {
    if (selectedContact?.next_execution_time) {
      const next = new Date(selectedContact.next_execution_time).getTime();
      const diff = Math.max(0, Math.floor((next - now) / 1000));
      setCountdown(diff > 0 ? diff : null);
    } else {
      setCountdown(null);
    }
  }, [selectedContact?.next_execution_time, selectedContact?.id, now]);

  // ---- Busca dentro da conversa ----
  const chatSearchMatches = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return [] as any[];
    return [...chatMessages]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .filter((m: any) => ((m.message_text || m.content || '') as string).toLowerCase().includes(q));
  }, [chatMessages, chatSearchQuery]);

  const scrollToMessage = useCallback((messageId: string) => {
    if (!messageId) return;
    const node = document.querySelector(`[data-msg-id="${CSS.escape(messageId)}"]`) as HTMLElement | null;
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(messageId);
  }, []);

  const goToSearchMatch = useCallback((index: number) => {
    if (chatSearchMatches.length === 0) return;
    const safeIndex = ((index % chatSearchMatches.length) + chatSearchMatches.length) % chatSearchMatches.length;
    setChatSearchIndex(safeIndex);
    scrollToMessage(chatSearchMatches[safeIndex]?.id);
  }, [chatSearchMatches, scrollToMessage]);

  // Ao digitar, salta automaticamente para a ocorrência mais recente
  useEffect(() => {
    if (!chatSearchOpen || chatSearchMatches.length === 0) return;
    const lastIndex = chatSearchMatches.length - 1;
    setChatSearchIndex(lastIndex);
    const timer = setTimeout(() => scrollToMessage(chatSearchMatches[lastIndex]?.id), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSearchQuery, chatSearchOpen]);

  // Fecha a busca ao trocar de conversa
  useEffect(() => {
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setChatSearchIndex(0);
    setHighlightedMessageId(null);
  }, [selectedContact?.id]);

  const prevContactIdRef = useRef<string | null>(null);

  const prevMsgCountRef = useRef<number>(0);
  const pendingScrollToBottomRef = useRef<boolean>(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const viewport = el.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    const currentContactId = selectedContact?.id || null;
    const contactChanged = prevContactIdRef.current !== currentContactId;
    const prevCount = prevMsgCountRef.current;
    const newCount = chatMessages.length;
    prevContactIdRef.current = currentContactId;
    prevMsgCountRef.current = newCount;

    const jumpToBottom = () => {
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      } else {
        el.scrollIntoView({ behavior: 'auto', block: 'end' });
      }
    };

    // Always scroll to bottom when opening a different conversation.
    // Keep forcing it for a couple of seconds because images/audios still
    // loading keep pushing the content height after the first paint.
    if (contactChanged) {
      pendingScrollToBottomRef.current = true;
      jumpToBottom();
      requestAnimationFrame(() => {
        jumpToBottom();
        requestAnimationFrame(jumpToBottom);
      });

      const interval = setInterval(() => {
        if (!pendingScrollToBottomRef.current) return;
        jumpToBottom();
      }, 120);

      // React to late layout changes (media loading) while still pending
      let observer: ResizeObserver | null = null;
      if (viewport && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          if (pendingScrollToBottomRef.current) jumpToBottom();
        });
        Array.from(viewport.children).forEach((child) => observer!.observe(child as Element));
      }

      const stopTimer = setTimeout(() => {
        pendingScrollToBottomRef.current = false;
        clearInterval(interval);
        observer?.disconnect();
      }, 2500);

      return () => {
        clearInterval(interval);
        clearTimeout(stopTimer);
        observer?.disconnect();
      };
    }
    // If we just received the first batch of messages for this conversation,
    // still force the scroll to the bottom (no "near bottom" heuristic).
    if (pendingScrollToBottomRef.current && newCount > prevCount) {
      jumpToBottom();
      requestAnimationFrame(jumpToBottom);
      return;
    }

    // Only auto-scroll on new messages if the user is already near the bottom
    if (newCount > prevCount && viewport) {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (distanceFromBottom < 150) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [chatMessages, selectedContact?.id]);

   useEffect(() => {
     const checkAuth = async () => {
       // Acesso administrativo via token (botão "Acessar WhatsApp" no /admincentral)
       const params = new URLSearchParams(window.location.search);
       const adminToken = params.get('admin_token');
       if (adminToken) {
         try {
           // Limpa qualquer sessão anterior (do admin) antes de assumir a do usuário
           await supabase.auth.signOut({ scope: 'local' } as any).catch(() => {});
           // token_hash de magiclink deve ser verificado com type 'email'
           let { error } = await supabase.auth.verifyOtp({ type: 'email', token_hash: adminToken });
           if (error) {
             const retry = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: adminToken } as any);
             error = retry.error;
           }
           if (error) throw error;
         } catch (e) {
           console.error('Falha no acesso administrativo:', e);
         }
         params.delete('admin_token');
         const clean = window.location.pathname + (params.toString() ? `?${params}` : '');
         window.history.replaceState({}, '', clean);
       }


       const { data: { session } } = await supabase.auth.getSession();
       if (!session) {
         navigate('/crm/login');
         return;
       }
        const nextUserId = session.user.id;
        if (currentUserIdRef.current !== nextUserId) {
          setContacts([]);
          setSelectedContact(null);
          setChatMessages([]);
          messagesCacheRef.current = {};
          contactsCacheKeyRef.current = `crm_contacts_cache_v3_${nextUserId}_${activeNumberIdRef.current || 'default'}`;
          contactsSeededRef.current = false;
          lastContactsSyncRef.current = null;
        }
        currentUserIdRef.current = nextUserId;
        if (localStorage.getItem(`crm_whatsapp_connected_${session.user.id}`) === 'true') {
          setWhatsAppConnectionConfirmed(true);
        }
       fetchData(true);
     };
     checkAuth();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('App visível, atualizando dados...');
        fetchData(false);
        fetchContacts();

        if (selectedContactRef.current?.id) {
          fetchMessages(selectedContactRef.current.id, true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const messageChannel = supabase
      .channel(`crm_updates_${Date.now()}`) // Nome único para evitar conflitos de cache do canal
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_messages' }, (payload) => {

        if (payload.eventType === 'INSERT') {
          const newMessage: any = payload.new;
          if (!currentUserIdRef.current || newMessage.user_id !== currentUserIdRef.current) return;
          // Cada número tem sua própria caixa: eventos de outro número não entram aqui.
          if (!belongsToActiveNumber(newMessage)) return;
          // Disparos em massa/templates podem criar contatos novos (lista fria)
          // que ainda não estão carregados na lista: busca e insere na hora.
          setContacts(prev => {
            if (prev.some(c => c.id === newMessage.contact_id)) return prev;
            supabase
              .from('crm_contacts')
              .select('*')
              .eq('id', newMessage.contact_id)
              .eq('user_id', currentUserIdRef.current)
              .maybeSingle()
              .then(({ data: freshContact }) => {
                if (!freshContact) return;
                setContacts(current => current.some(c => c.id === freshContact.id)
                  ? current
                  : deduplicateConversationContacts([freshContact, ...current]));
              });
            return prev;
          });

          if (selectedContactRef.current && newMessage.contact_id === selectedContactRef.current.id) {
            setChatMessages(prev => {
              if (prev.find(m => m.id === newMessage.id)) return prev;
              const next = [...prev, newMessage];
              // Garante ordenação cronológica correta
              return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            });
          }
          // Reset 24h window on inbound message (regra oficial WhatsApp)
          if (newMessage.direction === 'inbound') {
            setContacts(prev => prev.map(c => c.id === newMessage.contact_id
              ? { ...c, last_message_received_at: newMessage.created_at, last_interaction: newMessage.created_at }
              : c
            ).sort(compareConversationContacts));

            setSelectedContact((prev: any) => prev && prev.id === newMessage.contact_id
              ? { ...prev, last_message_received_at: newMessage.created_at, last_interaction: newMessage.created_at }
              : prev);
            
            setInboundTimestampsByContact(prev => {
              const list = prev[newMessage.contact_id] || [];
              return { ...prev, [newMessage.contact_id]: [newMessage.created_at, ...list].slice(0, 200) };
            });

            if (selectedContactRef.current?.id === newMessage.contact_id) {
              const nowIso = new Date().toISOString();
              setContacts(prev => prev.map(c => c.id === newMessage.contact_id
                ? { ...c, last_read_at: nowIso }
                : c
              ));
              supabase.from('crm_contacts').update({ last_read_at: nowIso }).eq('id', newMessage.contact_id).then(() => {});
            }
          } else if (newMessage.direction === 'outbound') {
            // Atualiza last_interaction para mensagens enviadas também aparecerem no topo
            setContacts(prev => prev.map(c => c.id === newMessage.contact_id
              ? { ...c, last_interaction: newMessage.created_at }
              : c
            ).sort(compareConversationContacts));
          }
        } else if (payload.eventType === 'UPDATE') {
          const updatedMessage = payload.new;
          if (!currentUserIdRef.current || updatedMessage.user_id !== currentUserIdRef.current) return;
          if (!belongsToActiveNumber(updatedMessage)) return;
          if (selectedContactRef.current && updatedMessage.contact_id === selectedContactRef.current.id) {
            setChatMessages(prev => prev.map(m => m.id === updatedMessage.id ? updatedMessage : m));
            if (updatedMessage.direction === 'outbound' && updatedMessage.status === 'failed') {
              toast({
                title: 'Mensagem não entregue',
                description: getMetaDeliveryErrorMessage(updatedMessage),
                variant: 'destructive',
              });
            }
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_contacts' }, (payload) => {
        const newRow: any = (payload as any).new;
        const oldRow: any = (payload as any).old;
        const eventOwnerId = newRow?.user_id ?? oldRow?.user_id;
        if (!currentUserIdRef.current || eventOwnerId !== currentUserIdRef.current) return;
        if (!belongsToActiveNumber(newRow ?? oldRow)) return;
        if (payload.eventType === 'DELETE' && oldRow?.id) {
          setContacts(prev => prev.filter(c => c.id !== oldRow.id));
        } else if (newRow?.id) {
          setContacts(prev => {
            const idx = prev.findIndex(c => c.id === newRow.id);
            let next;
            if (idx === -1) {
              next = [newRow, ...prev];
            } else {
              next = prev.slice();
              next[idx] = { ...next[idx], ...newRow };
            }
            // Re-sort para garantir que o contato atualizado suba na lista
            return deduplicateConversationContacts(next);
          });
        }
        if (selectedContactRef.current && payload.new && (payload.new as any).id === selectedContactRef.current.id) {
          setSelectedContact((prev: any) => ({ ...prev, ...payload.new }));
        }
      })
      .subscribe();

    // Interval for processing scheduled flow nodes (delays)
    let scheduledRunning = false;
    const scheduledInterval = setInterval(async () => {
      if (scheduledRunning) return;
      if (document.visibilityState !== 'visible') return;
      scheduledRunning = true;
      try {
        const nowIso = new Date().toISOString();
        // 1) Contatos com delay agendado pronto para executar
        const { data: delayContacts } = await supabase
          .from('crm_contacts')
          .select('id, last_message_received_at, last_interaction')
          .neq('flow_state', 'idle')
          .lte('next_execution_time', nowIso);

        // 2) Contatos em waiting_response cujo timeout (ex.: 40 min) já venceu.
        //    Estes têm next_execution_time = NULL, então não apareciam no query
        //    acima e o processScheduled nunca era acionado pelo front, dependendo
        //    apenas do pg_cron (que pode falhar/atrasar). Aqui detectamos no
        //    cliente e disparamos imediatamente o processamento na edge function.
        const { data: waitingContacts } = await supabase
          .from('crm_contacts')
          .select('id, last_message_received_at, last_flow_interaction, flow_timeout_minutes, flow_timeout_node_id')
          .eq('flow_state', 'waiting_response')
          .not('flow_timeout_node_id', 'is', null)
          .not('flow_timeout_minutes', 'is', null);

        const nowMs = Date.now();
        const expiredWaiting = (waitingContacts || []).filter((c: any) => {
          const mins = Number(c.flow_timeout_minutes);
          if (!Number.isFinite(mins) || mins <= 0) return false;
          const baseRaw = c.last_flow_interaction;
          if (!baseRaw) return false;
          const base = new Date(baseRaw).getTime();
          return nowMs >= base + mins * 60000;
        });

        const contactsToProcess = [
          ...((delayContacts as any[]) || []),
          ...expiredWaiting,
        ];

        if (contactsToProcess.length > 0) {
          // Regra de interrupção de fluxo: Só paramos o fluxo se o ÚLTIMO INBOUND (mensagem do cliente)
          // tiver ocorrido há mais de 24 horas + 30 minutos de tolerância.
          const DAY = 24 * 60 * 60 * 1000;
          const TOLERANCE = 30 * 60 * 1000;
          const limit = DAY + TOLERANCE;

          const activeContacts = contactsToProcess.filter(c => {
            if (!c.last_message_received_at) return true;
            const diff = Date.now() - new Date(c.last_message_received_at).getTime();
            return diff < limit;
          });

          const expiredContacts = contactsToProcess.filter(c => {
            if (!c.last_message_received_at) return false;
            const diff = Date.now() - new Date(c.last_message_received_at).getTime();
            return diff >= limit;
          });

          // Encerrar fluxos expirados automaticamente
          if (expiredContacts.length > 0) {
            console.log(`[FLOW] Auto-stopping ${expiredContacts.length} expired flows...`);
            await supabase
              .from('crm_contacts')
              .update({ flow_state: 'idle', next_execution_time: null })
              .in('id', expiredContacts.map(c => c.id));
          }

          if (activeContacts.length > 0) {
            console.log(`[FLOW] Triggering scheduled processing for ${activeContacts.length} active flows...`);
            await supabase.functions.invoke('meta-whatsapp-crm', {
              body: { action: 'processScheduled' }
            });
          }
        }
      } catch (err) {
        console.error('Error in scheduled flow interval:', err);
      } finally {
        scheduledRunning = false;
      }
    }, 20000);

    // Controle de tentativa do refresh preventivo: sem isso, enquanto um fetch
    // grande estava em andamento o timer disparava a cada tick, empilhando
    // chamadas e travando o banco.
    let lastPreventiveRefreshAttempt = 0;

    const activeChatSyncInterval = setInterval(() => {
      const activeContactId = selectedContactRef.current?.id;
      // Heurística de auto-refresh para evitar que o CRM "trave" após longo tempo aberto:
      // Se o CRM estiver aberto há muito tempo ou houver falha persistente de realtime,
      // recarregamos a lista de contatos em segundo plano (via fetchContacts) a cada 10 minutos (reduzido de 5 para economizar recursos).
      // Isso é uma atualização interna de dados e NÃO recarrega a página inteira,
      // portanto você não perde o que está digitando ou editando no fluxo.
      const now = Date.now();
      const lastFullSync = lastContactsSyncRef.current ? new Date(lastContactsSyncRef.current).getTime() : 0;
      if (
        now - lastFullSync > 10 * 60 * 1000 &&
        now - lastPreventiveRefreshAttempt > 10 * 60 * 1000 &&
        document.visibilityState === 'visible'
      ) {
        lastPreventiveRefreshAttempt = now;
        console.log('[CRM] Executando refresh periódico preventivo de dados...');
        fetchContacts();
      }

      if (activeContactId && document.visibilityState === 'visible') {
        fetchRecentActiveMessages(activeContactId);
      }
    }, 4000);

    const realtimeFallbackInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        syncRecentRealtimeMessages();
      }
    }, 6000); // Polling de fallback (aliviado para não saturar o banco)



    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      supabase.removeChannel(messageChannel);
      clearInterval(scheduledInterval);
      clearInterval(activeChatSyncInterval);
      clearInterval(realtimeFallbackInterval);
    };
  }, [navigate]);

  const fetchWebhooks = async () => {
    const { data } = await supabase.from('crm_webhooks').select('*').order('created_at', { ascending: false });
    setWebhooks(data || []);
  };

  const fetchStatuses = async () => {
    const { data } = await supabase.from('crm_statuses').select('*').order('sort_order', { ascending: true });
    setKanbanStatuses(data || []);
  };

  const fetchContacts = async () => {
    // Strategy: load from localStorage cache first (instant) then do an
    // INCREMENTAL fetch (only rows changed since last sync). This avoids
    // re-downloading 14k+ contacts on every reload / realtime event.
    if (contactsInFlightRef.current) return;
    contactsInFlightRef.current = true;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const userId = user.id;
      if (currentUserIdRef.current !== userId) {
        setContacts([]);
        setSelectedContact(null);
        messagesCacheRef.current = {};
        contactsSeededRef.current = false;
        lastContactsSyncRef.current = null;
      }
      currentUserIdRef.current = userId;
      // Resolve cache key once per user
      contactsCacheKeyRef.current = `crm_contacts_cache_v3_${userId}_${activeNumberIdRef.current || 'default'}`;
      const cacheKey = contactsCacheKeyRef.current;
      const now = Date.now();

      // Seed from cache only on the first call this session
      if (!contactsSeededRef.current && cacheKey) {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.rows)) {
              const ownedRows = parsed.rows.filter((contact: any) => contact?.user_id === userId);
              console.log(`[CRM] Restaurando ${ownedRows.length} contatos do cache da conta atual...`);
              setContacts(deduplicateConversationContacts(ownedRows));
              // O cache guarda só as conversas mais recentes (limite do navegador),
              // então NÃO marcamos a sincronização como completa: o fetch abaixo
              // continua trazendo a base inteira.
              lastContactsSyncRef.current = null;
              // Se restauramos do cache, podemos tirar o loading inicial para a UI aparecer logo
              setLoading(false);
            }
          }
        } catch (e) {
          console.warn('[CRM] Erro ao ler cache de contatos:', e);
        }
        contactsSeededRef.current = true;
      }

      // Incremental paginated fetch — carrega TODOS os contatos (sem teto de 1000)
      const pageSize = 1000;
      const MAX_PAGES = 200; // até 200k contatos
      const newRows: any[] = [];
      const fetchStartedAt = new Date().toISOString();
      let from = 0;
      let pageError = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        let q = scopeToNumber(
          supabase
            .from('crm_contacts')
            .select('*')
            .eq('user_id', userId)
        )
          .order('updated_at', { ascending: false })
          .range(from, from + pageSize - 1);

        // Se já temos um sync anterior, buscamos apenas o que mudou
        if (lastContactsSyncRef.current) {
          q = q.gt('updated_at', lastContactsSyncRef.current);
        }

        const { data, error } = await q;
        if (error) {
          console.warn('[CRM] Erro ao paginar contatos:', error.message);
          pageError = true;
          break;
        }
        if (!data || data.length === 0) break;
        newRows.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (newRows.length > 0 || !lastContactsSyncRef.current) {
        setContacts(prev => {
          const map = new Map<string, any>();
          // Em uma carga completa, o banco é a fonte da verdade. Em cargas
          // incrementais, preservamos somente registros pertencentes à conta atual.
          if (lastContactsSyncRef.current) {
            for (const c of prev) {
              if (c?.user_id === userId) map.set(c.id, c);
            }
          }
          // Atualizar com novos dados (upsert local)
          for (const c of newRows) {
            if (c?.user_id !== userId) continue;
            const existing = map.get(c.id);
            map.set(c.id, existing ? { ...existing, ...c } : c);
          }
          
          const merged = deduplicateConversationContacts(Array.from(map.values()));

          if (cacheKey) {
            // O localStorage tem ~5MB. Com dezenas de milhares de contatos o objeto
            // completo estoura a cota, então guardamos apenas as conversas mais
            // recentes e somente os campos usados na primeira pintura da lista.
            const CACHE_MAX_ROWS = 400;
            const slim = merged.slice(0, CACHE_MAX_ROWS).map((c: any) => ({
              id: c.id,
              user_id: c.user_id,
              wa_id: c.wa_id,
              canon_wa_id: c.canon_wa_id,
              name: c.name,
              status: c.status,
              tags: c.tags,
              last_interaction: c.last_interaction,
              last_message_received_at: c.last_message_received_at,
              last_read_at: c.last_read_at,
              updated_at: c.updated_at,
              created_at: c.created_at,
            }));
            const writeCache = (rows: any[]) => localStorage.setItem(
              cacheKey,
              JSON.stringify({ rows, lastSyncedAt: fetchStartedAt })
            );
            try {
              writeCache(slim);
            } catch {
              // Ainda assim estourou: tenta um cache mínimo antes de desistir (sem poluir o console).
              try {
                writeCache(slim.slice(0, 100));
              } catch {
                try { localStorage.removeItem(cacheKey); } catch { /* noop */ }
              }
            }
          }
          return merged;
        });
      }
      // Se alguma página falhou (banco lento/instável), não avançamos o marcador
      // de sincronização — assim a próxima tentativa recupera o que faltou.
      if (!pageError) {
        lastContactsSyncRef.current = fetchStartedAt;
      }
      setLoading(false); // Garante que o loading saia após o fetch bem sucedido
    } finally {
      contactsInFlightRef.current = false;
    }
  };

  // Fetch inbound message timestamps from the last 7 days to compute
  // unread counts per contact (number = inbound messages whose
  // created_at is greater than the contact.last_read_at).
  const fetchInboundTimestamps = async () => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await scopeToNumber(
        supabase
          .from('crm_messages')
          .select('contact_id, created_at')
          .eq('user_id', currentUserIdRef.current ?? '')
      )
        .eq('direction', 'inbound')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      const map: Record<string, string[]> = {};
      (data || []).forEach((m: any) => {
        if (!m.contact_id) return;
        (map[m.contact_id] = map[m.contact_id] || []).push(m.created_at);
      });
      setInboundTimestampsByContact(map);
    } catch {}
  };

  const getPhoneVariants = (rawPhone: string) => {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    const variants = new Set<string>([normalized]);

    if (normalized.startsWith('55') && (normalized.length === 12 || normalized.length === 13)) {
      const country = normalized.slice(0, 2);
      const areaCode = normalized.slice(2, 4);
      const localNumber = normalized.slice(4);

      if (localNumber.length === 9 && localNumber.startsWith('9')) {
        variants.add(`${country}${areaCode}${localNumber.slice(1)}`);
      }

      if (localNumber.length === 8) {
        variants.add(`${country}${areaCode}9${localNumber}`);
      }
    }

    return Array.from(variants).filter(Boolean);
  };

  const hasReadableContactName = (name: string, rawPhone: string) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return false;

    const nameDigits = trimmedName.replace(/\D/g, '');
    const phoneVariants = getPhoneVariants(rawPhone);

    return trimmedName !== String(rawPhone || '').trim() && !phoneVariants.includes(nameDigits);
  };

  const googleContactNameByPhone = useMemo(() => {
    const map = new Map<string, { name: string; googleSyncAccountId: string | null }>();

    contacts.forEach((contact: any) => {
      const name = String(contact.name || '').trim();
      const googleSyncAccountId = contact.google_sync_account_id || contact.metadata?.google_resource_name || null;
      if (!googleSyncAccountId || !hasReadableContactName(name, contact.wa_id)) return;

      getPhoneVariants(contact.wa_id).forEach(phone => {
        if (!map.has(phone)) {
          map.set(phone, { name, googleSyncAccountId });
        }
      });
    });

    return map;
  }, [contacts]);

  const getGoogleResolvedContact = useCallback((contact: any) => {
    const currentName = String(contact?.name || '').trim();
    const needsGoogleName = !hasReadableContactName(currentName, contact?.wa_id);
    const match = getPhoneVariants(contact?.wa_id).map(phone => googleContactNameByPhone.get(phone)).find(Boolean);

    return {
      displayName: needsGoogleName && match?.name ? match.name : currentName || contact?.wa_id,
      googleSyncAccountId: contact?.google_sync_account_id || match?.googleSyncAccountId || null,
    };
  }, [googleContactNameByPhone]);

  // Pre-compute the conversational subset ONCE per `contacts` change.
  // This avoids re-scanning 14k+ contacts every time the user switches
  // tabs or types in the status filter (which was making the Conversas
  // tab take ~3s to open after a Google sync).
  const conversationContacts = useMemo(() => {
    return deduplicateConversationContacts(contacts.filter(c =>
      c.last_interaction != null ||
      (c.total_messages_received ?? 0) > 0 ||
      (c.total_messages_sent ?? 0) > 0 ||
      c.last_message_received_at != null
    ));
  }, [contacts]);

  // Memoize the "contatos sem nome" subset so we don't iterate all 14k+
  // contacts on every render of the Conversas sidebar.
  const unnamedContacts = useMemo(
    () => conversationContacts.filter(c => {
      const resolvedName = String(getGoogleResolvedContact(c).displayName || '').trim();
      return !hasReadableContactName(resolvedName, c.wa_id);
    }),
    [conversationContacts, getGoogleResolvedContact]
  );

  const filteredContacts = useMemo(() => {
    // Conversas must never render the full Google/imported contact base.
    // Keeping this derived list synchronous avoids the brief 3s heavy render
    // where all contacts appeared before the conversation-only filter applied.
    const base = activeTab === 'contacts' ? conversationContacts : [];

    const filtered = statusFilter === 'all'
      ? base
      : (() => {
          const needle = statusFilter.toLowerCase();
          return base.filter(c =>
            c.status === statusFilter ||
            c.name?.toLowerCase().includes(needle) ||
            c.wa_id?.includes(statusFilter)
          );
        })();

    if (!freezeConversationOrder) return [...filtered].sort(compareConversationContacts);

    // Frozen order: preserve previously seen order, prepend new contacts on top.
    const byId = new Map(filtered.map(c => [c.id, c]));
    const previousOrder = frozenOrderRef.current.filter(id => byId.has(id));
    const known = new Set(previousOrder);
    const newcomers = filtered.filter(c => !known.has(c.id)).map(c => c.id);
    const nextOrder = [...newcomers, ...previousOrder];
    frozenOrderRef.current = nextOrder;
    return nextOrder.map(id => byId.get(id)).filter(Boolean) as any[];
  }, [statusFilter, conversationContacts, activeTab, freezeConversationOrder]);

  // ---------------------------------------------------------------------
  // Listas derivadas memoizadas.
  // Antes estes filtros/ordenações rodavam inline no JSX, ou seja, varriam
  // todos os contatos/mensagens a cada tecla digitada e a cada tick de 1s do
  // relógio. O resultado é idêntico — apenas deixa de ser recalculado à toa.
  // ---------------------------------------------------------------------

  /** Contatos com fluxo em andamento (aba "Fluxos em Andamento"). */
  const activeFlowContacts = useMemo(
    () => contacts.filter(c => c.flow_state && c.flow_state !== 'idle'),
    [contacts]
  );

  /** Mensagens do chat aberto em ordem cronológica. */
  const sortedChatMessages = useMemo(
    () => [...chatMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    ),
    [chatMessages]
  );

  // ---------------------------------------------------------------------
  // Renderização incremental (janela virtual leve).
  // Em vez de montar 10k+ linhas de contato e todo o histórico do chat de
  // uma vez, renderizamos uma janela e ampliamos conforme o usuário rola.
  // Nenhum dado é removido — apenas o DOM deixa de nascer gigante.
  // ---------------------------------------------------------------------
  const CONTACTS_PAGE_SIZE = 40;
  const MESSAGES_PAGE_SIZE = 50;

  const [visibleContactCount, setVisibleContactCount] = useState(CONTACTS_PAGE_SIZE);
  const contactsSentinelRef = useRef<HTMLDivElement | null>(null);

  // Ao trocar de filtro/aba a janela volta ao início.
  useEffect(() => {
    setVisibleContactCount(CONTACTS_PAGE_SIZE);
  }, [statusFilter, activeTab]);

  const visibleFilteredContacts = useMemo(
    () => (visibleContactCount >= filteredContacts.length
      ? filteredContacts
      : filteredContacts.slice(0, visibleContactCount)),
    [filteredContacts, visibleContactCount]
  );

  const hasMoreContactsToRender = visibleFilteredContacts.length < filteredContacts.length;

  useEffect(() => {
    if (!hasMoreContactsToRender) return;
    const el = contactsSentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisibleContactCount(current => current + CONTACTS_PAGE_SIZE);
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMoreContactsToRender, visibleFilteredContacts.length]);

  const [visibleMessageCount, setVisibleMessageCount] = useState(MESSAGES_PAGE_SIZE);

  // Cada conversa aberta começa mostrando apenas as últimas mensagens.
  useEffect(() => {
    setVisibleMessageCount(MESSAGES_PAGE_SIZE);
  }, [selectedContact?.id]);

  /**
   * Mensagens efetivamente renderizadas. Durante uma busca no chat mostramos
   * o histórico completo para que a navegação por resultados continue exata.
   */
  const visibleChatMessages = useMemo(() => {
    if (chatSearchQuery.trim()) return sortedChatMessages;
    if (visibleMessageCount >= sortedChatMessages.length) return sortedChatMessages;
    return sortedChatMessages.slice(-visibleMessageCount);
  }, [sortedChatMessages, visibleMessageCount, chatSearchQuery]);

  const hiddenOlderMessages = sortedChatMessages.length - visibleChatMessages.length;



  /** Histórico de agendamentos já processados (mobile + desktop usam o mesmo). */
  const scheduledHistory = useMemo(
    () => allScheduledMessages
      .filter((m: any) => m.status !== 'pending')
      .sort((a: any, b: any) => new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime())
      .slice(0, 20),
    [allScheduledMessages]
  );



  const fetchData = async (isInitialLoad = false) => {
     if (isInitialLoad) setLoading(true);

     try {
       const { data: { session } } = await supabase.auth.getSession();
       const user = session?.user;
       if (!user) return;
       currentUserIdRef.current = user.id;

 
        let settingsData = null;
        // Marca o início da leitura: se um Salvar acontecer enquanto esta
        // requisição está no ar, a resposta é obsoleta e não pode ser aplicada.
        const settingsFetchStartedAt = Date.now();
        const { data: cloudSettings, error: cloudSettingsError } = await supabase.functions.invoke('meta-whatsapp-crm', {
          body: { action: 'getCloudSettings' }
        });

        if (!cloudSettingsError && cloudSettings?.success && cloudSettings.settings) {
          settingsData = cloudSettings.settings;
        } else {
          console.warn('[CRM] Falha ao carregar conexão em nuvem pela função, tentando leitura direta:', cloudSettingsError || cloudSettings?.error);
          const { data: directSettings } = await supabase
            .from('crm_settings')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();
          settingsData = directSettings;
        }
 
       const settingsStale = settingsSavedAtRef.current > settingsFetchStartedAt;
       if (settingsData && settingsStale) {
         console.info('[CRM] Configurações recebidas são anteriores ao último salvamento; ignoradas para não sobrescrever o que foi salvo.');
       }
       if (settingsData && !settingsStale) {
         const loadedKey = String(settingsData.openai_api_key || '').trim();
         const draftKey = openAiKeyDraftRef.current;
         // Se o usuário está editando a chave, o rascunho vence o valor do banco.
         const effectiveKey = draftKey !== null ? draftKey : loadedKey;
         if (validatedOpenAiKeyRef.current?.key !== effectiveKey.trim()) {
           validatedOpenAiKeyRef.current = null;
           setOpenAiKeyCheck({ state: 'idle' });
         }
         setMetaSettings(
           draftKey !== null ? { ...settingsData, openai_api_key: draftKey } : settingsData
         );
         setWhatsAppConnectionConfirmed(!!(settingsData.meta_access_token && settingsData.meta_phone_number_id && settingsData.meta_waba_id));
       }
 
        const { data: profile } = await supabase
         .from('crm_profiles')
         .select('role')
         .eq('user_id', user.id)
         .maybeSingle();
       if (profile) setUserRole(profile.role);

       // Multi-WhatsApp: só ativa a tela de escolha para cadastros liberados
       // pelo admin (crm_profiles.max_whatsapp_numbers > 1).
       setCurrentUserId(user.id);
       try {
         const allowed = await fetchMaxWhatsAppNumbers(user.id);
         setMaxWhatsAppNumbers(allowed);
         // Vale para 1 ou mais números: mantém a escolha já feita para não
         // voltar ao seletor em loop após clicar em "Abrir".
         const numbers = settingsData
           ? await syncSettingsIntoNumbers(user.id, settingsData)
           : await fetchUserNumbers(user.id);
         setUserNumbersCount(numbers.length);
         const stored = getActiveNumberId(user.id);
         const validStored = stored && numbers.some((n) => n.id === stored) ? stored : null;
         activeNumberIdRef.current = validStored;
         setActiveWhatsAppNumberId(validStored);
         setActiveNumberId(validStored);
       } catch (multiError) {
         console.warn('[CRM] multi-whatsapp indisponível:', multiError);
       }

      const { data: metricsData } = await supabase
        .from('crm_metrics')
        .select('*')
        .eq('date', new Date().toISOString().split('T')[0])
        .maybeSingle();
      
      if (metricsData) setMetrics(metricsData);

      const { data: flowsData } = await supabase.from('crm_flows').select('*, crm_flow_steps(*)');
      setFlows(flowsData || []);

      // Paginated fetch to load ALL contacts (default cap is 1000)
      await fetchContacts();
      fetchInboundTimestamps();

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data: templatesData } = await supabase.from('crm_templates').select('*').eq('user_id', currentUser?.id);
      setTemplates(templatesData || []);

      // Auto-sync if there are pending templates to see if they were approved
      if (templatesData?.some(t => t.status === 'PENDING' || t.status === 'pending')) {
        console.log('Detectados templates pendentes, iniciando sincronização automática...');
        supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'getTemplates' } })
          .then(({ data, error }) => {
            if (!error && data?.success) {
              supabase.from('crm_templates').select('*').eq('user_id', currentUser?.id).then(({ data: updatedTemplates }) => {
                if (updatedTemplates) setTemplates(updatedTemplates);
              });
            }
          });
      }

      await fetchWebhooks();
      await fetchStatuses();
      await fetchAllScheduledMessages();

      // Busca todas as contas Google conectadas (até 3)
      const { data: googleAccs } = await supabase
        .from('crm_google_accounts')
        .select('id, email, auto_sync, connection_status, last_sync_error')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (googleAccs) {
        setGoogleAccounts(googleAccs as any);
        if (googleAccs.length > 0) {
          localStorage.setItem('google_contacts_connected', 'true');
        } else {
          localStorage.removeItem('google_contacts_connected');
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };


  /**
   * Checa a chave da OpenAI no servidor (a Meta/OpenAI não permite validar
   * direto do navegador com segurança). Retorna se pode prosseguir com o save.
   */
  const validateOpenAiKey = async (
    apiKey: string,
    opts: { silent?: boolean } = {}
  ): Promise<{ valid: boolean; message: string; detail?: string }> => {
    const normalizedKey = apiKey.trim();
    const cached = validatedOpenAiKeyRef.current;
    if (cached?.key === normalizedKey && cached.result.valid) {
      setOpenAiKeyCheck({ state: 'valid', code: 'ok', message: cached.result.message });
      return cached.result;
    }

    const inFlight = openAiValidationInFlightRef.current;
    if (inFlight?.key === normalizedKey) {
      console.info('[AI-KEY] Validação já está em andamento; reutilizando a mesma requisição.');
      return inFlight.promise;
    }

    setOpenAiKeyCheck({ state: 'checking' });
    const validationPromise = (async () => {
      try {
      console.info('[AI-KEY] Validando token sem expor seu conteúdo.', {
        length: normalizedKey.length,
        suffix: normalizedKey.slice(-4),
      });
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'validateOpenAiKey', api_key: normalizedKey },
      });
      if (error) throw error;

      const valid = data?.valid === true;
      const code = data?.code ? String(data.code) : undefined;
      const message = String(data?.message || (valid ? 'API correta.' : 'API ERRADA.'));
      const detail = data?.provider_message ? String(data.provider_message) : undefined;

      setOpenAiKeyCheck({ state: valid ? 'valid' : 'invalid', code, message, detail });
      if (valid) {
        validatedOpenAiKeyRef.current = {
          key: normalizedKey,
          result: { valid, message, detail },
        };
      } else {
        validatedOpenAiKeyRef.current = null;
      }
      console.info('[AI-KEY] Validação concluída.', { valid, code: code || 'sem_codigo' });

      if (!opts.silent) {
        toast({
          title: valid
            ? 'API correta ✅'
            : code === 'no_credits'
              ? 'SEM SALDO na OpenAI 💳'
              : 'API ERRADA ❌',
          description: detail ? `${message} (${detail})` : message,
          variant: valid ? 'default' : 'destructive',
        });
      }
      return { valid, message, detail };
    } catch (err: any) {
      const message =
        'Não foi possível validar a chave agora. Verifique a conexão e tente novamente.';
      setOpenAiKeyCheck({ state: 'invalid', message, detail: err?.message });
      if (!opts.silent) {
        toast({ title: 'Falha ao validar a API', description: message, variant: 'destructive' });
      }
      return { valid: false, message, detail: err?.message };
      } finally {
        if (openAiValidationInFlightRef.current?.key === normalizedKey) {
          openAiValidationInFlightRef.current = null;
        }
      }
    })();

    openAiValidationInFlightRef.current = { key: normalizedKey, promise: validationPromise };
    return validationPromise;
  };

   const handleSaveSettings = async (customSettings?: any) => {
     setSaving(true);
     try {
       const { data: { user } } = await supabase.auth.getUser();
       if (!user) return;
 
        // Se o handler for usado como onClick direto, customSettings vem como
        // SyntheticEvent — ignorar e usar o estado atual.
        const isPlainSettings =
          customSettings &&
          typeof customSettings === 'object' &&
          !('nativeEvent' in customSettings) &&
          !('_reactName' in customSettings) &&
          !(typeof (customSettings as any).preventDefault === 'function');
        const targetSettings = isPlainSettings ? customSettings : metaSettings;
         // Whitelist explícito de colunas existentes em crm_settings — evita
         // erro de upsert quando o estado tem campos auxiliares (vps_status,
         // email, etc.) que não existem no banco.
         const ALLOWED_COLUMNS = [
           'meta_access_token','meta_phone_number_id','meta_waba_id','meta_app_id',
           'meta_app_secret','meta_display_phone_number','meta_verified_name','meta_business_id',
           'google_client_id','google_client_secret','google_auto_sync',
            'openai_api_key','ai_agent_enabled','ai_kanban_auto_organizer','ai_send_bundled','ai_operation_mode','ai_system_prompt',
            'ai_recovery_enabled','ai_recovery_delay_minutes','ai_recovery_max_attempts','ai_recovery_finalized_status','ai_recovery_scope',
           'ai_agent_trigger','ai_agent_trigger_keyword','ai_agent_prompt','ai_agent_label_on_transfer',
           'auto_generate_strategy','strategy_generation_prompt',
           'initial_auto_response_enabled','initial_response_text','initial_response_buttons','initial_flow_id',
            'shortcut_size','tag_size','save_deleted_messages',
           'business_hours_enabled','business_hours_start','business_hours_end','business_hours_tz',
           'outside_hours_message','business_description',
           'countdown_trigger_enabled','countdown_trigger_flow_id','countdown_trigger_template_id',
           'countdown_trigger_message_type','countdown_trigger_content','countdown_trigger_threshold_minutes',
           'vps_transcoder_url','webhook_identifier',
         ];
         const rest: Record<string, any> = {};
         for (const col of ALLOWED_COLUMNS) {
           if (targetSettings[col] !== undefined) rest[col] = targetSettings[col];
         }
         // A OpenAI rejeita espaços/quebras de linha no Bearer token. A mesma
         // forma canônica validada deve ser a forma persistida e usada pelo agente.
         if (typeof rest.openai_api_key === 'string') {
           rest.openai_api_key = rest.openai_api_key.trim();
         }
         // Normaliza FKs vazias para null (evita violar FK)
         if (rest.initial_flow_id === '') rest.initial_flow_id = null;
         if (rest.countdown_trigger_flow_id === '') rest.countdown_trigger_flow_id = null;
         if (rest.countdown_trigger_template_id === '') rest.countdown_trigger_template_id = null;

         const settingsToSave: Record<string, any> = {
           ...rest,
           user_id: user.id,
           updated_at: new Date().toISOString()
         };

       if (!settingsToSave.webhook_identifier) {
         settingsToSave.webhook_identifier = Math.random().toString(36).substring(2, 15);
       }

       const { error } = await supabase.from('crm_settings').upsert(settingsToSave, { onConflict: 'user_id' });
       
       if (error) throw error;

       // Persistido com sucesso: qualquer leitura iniciada antes deste instante
       // é obsoleta. O rascunho da chave vira o valor oficial do estado.
       settingsSavedAtRef.current = Date.now();
       openAiKeyDraftRef.current = null;
       if (typeof settingsToSave.openai_api_key === 'string') {
         const savedKey = settingsToSave.openai_api_key;
         setMetaSettings((previous: typeof metaSettings) => ({ ...previous, openai_api_key: savedKey }));
         console.info('[AI-KEY] Chave persistida.', { length: savedKey.length, suffix: savedKey.slice(-4) });
       }

       // Sync with Admin Central if needed (mocked for now)
       console.log('Syncing settings with Admin Central for token activation...');

        toast({ title: "Configurações salvas!" });
       fetchData(false);


      } catch (error: any) {
       console.error("Erro ao salvar:", error);
        toast({
          title: "Erro ao salvar",
          description: error?.message || error?.details || String(error),
          variant: "destructive",
        });
     } finally {
       setSaving(false);
     }
   };

  const handleConnectGoogle = () => {
    const clientId = metaSettings.google_client_id || '474898024942-7kagkoc25n5osu9pj1as5g1kod7op7m0.apps.googleusercontent.com';
    
    // Usamos o callback que o sistema espera
    // Google requires exact match. zapmro.com.br is the authorized domain.
    const redirectUri = encodeURIComponent('https://zapmro.com.br/google-callback');
    console.log('[OAUTH] Initiating Google login with Redirect URI: https://zapmro.com.br/google-callback');
    
    // Escopos necessários para ler e enviar contatos ao Google
    const scopes = [
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ].join(' ');
    
    const scope = encodeURIComponent(scopes);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&include_granted_scopes=true`;
    console.log('[OAUTH] Opening Auth URL:', url);
    window.location.href = url;
  };

  const handleDisconnectGoogle = async (accountId?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const query = supabase.from('crm_google_accounts').delete().eq('user_id', user.id);
      const { error } = accountId ? await query.eq('id', accountId) : await query;
      if (error) throw error;

      const remaining = accountId ? googleAccounts.filter(a => a.id !== accountId) : [];
      setGoogleAccounts(remaining);
      if (remaining.length === 0) localStorage.removeItem('google_contacts_connected');
      toast({ title: "Conta Google desconectada" });
    } catch (err: any) {
      toast({ title: "Erro ao desconectar", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleAccountAutoSync = async (accountId: string, checked: boolean) => {
    setGoogleAccounts(prev => prev.map(a => a.id === accountId ? { ...a, auto_sync: checked } : a));
    try {
      const { error } = await supabase
        .from('crm_google_accounts')
        .update({ auto_sync: checked, updated_at: new Date().toISOString() })
        .eq('id', accountId);
      if (error) throw error;
      toast({ title: checked ? "Auto Sync ativado nesta conta" : "Auto Sync desativado nesta conta" });
      if (checked) {
        googleAccountFullRef.current = false;
        setGoogleAccountFull(false);
        supabase.functions.invoke('meta-whatsapp-crm', {
          body: { action: 'syncPendingToGoogle' }
        }).then(({ data }) => {
          if (data?.requiresReconnect) {
            toast({
              title: 'Reconecte a conta Google',
              description: data.lastError || 'A conta conectada ainda está com permissão antiga somente leitura.',
              variant: 'destructive',
            });
          }
          fetchContacts();
        }).catch(() => {});
      }
    } catch (err: any) {
      // revert on error
      setGoogleAccounts(prev => prev.map(a => a.id === accountId ? { ...a, auto_sync: !checked } : a));
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    }
  };

  const handleSyncGoogleContacts = async (accountId?: string) => {
    if (!googleContactsEnabled) {
      handleConnectGoogle();
      return;
    }

    setIsSyncingContacts(true);
    setSyncProgress(5);
    
    try {
      // Inicia a sincronização chamando a função
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'syncGoogleContacts', accountId }
      });
      
      if (error) throw error;
      
      if (data.success) {
        setSyncProgress(100);
        console.log('[SYNC] Sincronização concluída com sucesso:', data);
        toast({ 
          title: "Sincronização concluída!", 
           description: `${data.count} números processados de ${data.totalFetched || 0} contatos Google${data.linkedExisting ? ` (${data.linkedExisting} já existentes foram vinculados)` : ''}.` 
        });
        
        // Atualiza a lista local de contatos
        await fetchContacts();

      } else {
        console.error('[SYNC] Erro retornado pela função:', data.error);
        throw new Error(data.error || "Erro desconhecido na sincronização");
      }
    } catch (err: any) {
      console.error('Erro na sincronização Google:', err);
      toast({ 
        title: "Erro na sincronização", 
        description: err.message, 
        variant: "destructive" 
      });
      if (err.message?.includes('token') || err.message?.includes('auth')) {
        handleConnectGoogle();
      }
    } finally {
      setTimeout(() => {
        setIsSyncingContacts(false);
        setSyncProgress(0);
      }, 1000);
    }
  };

  const handleSyncPendingGoogleContacts = async (targetAccountId?: string) => {
    if (!googleContactsEnabled) {
      handleConnectGoogle();
      return;
    }

    setIsSyncingContacts(true);
    try {
      googleAccountFullRef.current = false;
      setGoogleAccountFull(false);
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'syncPendingToGoogle', targetAccountId }
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || 'A exportação não foi iniciada pelo servidor.');
      }

      if (data?.requiresReconnect) {
        toast({
          title: 'Reconecte a conta Google',
          description: data.lastError || 'A conta conectada precisa autorizar permissão de envio de contatos.',
          variant: 'destructive',
        });
      } else if (data?.accountFull) {
        googleAccountFullRef.current = true;
        setGoogleAccountFull(true);
        toast({
          title: 'Conta Google cheia',
          description: data.lastError || 'Conecte outra conta Google com Auto Sync ativo para continuar.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Exportação concluída!',
          description: `${data?.pushed || 0} contatos subiram. ${data?.remaining || 0} ainda pendentes.`,
        });
      }
      await fetchContacts();
    } catch (err: any) {
      toast({
        title: 'Erro ao exportar contatos',
        description: err.message || 'Não foi possível enviar os pendentes ao Google.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncingContacts(false);
    }
  };

  /**
   * Reenvia contatos que já foram salvos/sincronizados pela ferramenta
   * para OUTRA conta Google escolhida pelo usuário.
   */
  const handleResendGoogleContacts = async (contactIds: string[]) => {
    if (!resendTargetAccount) {
      toast({ title: 'Selecione a conta Google de destino', variant: 'destructive' });
      return;
    }
    setIsResendingGoogle(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: {
          action: 'resendGoogleContacts',
          targetAccountId: resendTargetAccount,
          contactIds,
          sourceAccountId: resendSourceFilter !== 'all' && contactIds.length === 0 ? resendSourceFilter : undefined,
        },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.error || 'Falha ao reenviar contatos');

      toast({
        title: 'Reenvio iniciado',
        description: `${data?.detached || 0} contatos marcados para reenvio. ${data?.pushed || 0} já subiram para a conta de destino.`,
      });
      setResendSelection(new Set());
      await fetchContacts();
    } catch (err: any) {
      toast({
        title: 'Erro ao reenviar contatos',
        description: err.message || 'Não foi possível reenviar para a outra conta.',
        variant: 'destructive',
      });
    } finally {
      setIsResendingGoogle(false);
    }
  };

  // Sincronização automática em tempo real com Google Contatos
  // Executa silenciosamente a cada 2 minutos quando ativado, e uma vez ao montar.
  const [googleAccountFull, setGoogleAccountFull] = useState(false);
  const googleAccountFullRef = useRef(false);
  useEffect(() => {
    if (!googleContactsEnabled) return;
    if (!anyAutoSync) return;

    let cancelled = false;

    let syncRunning = false;

    const silentSync = async () => {
      // Conta Google cheia: não adianta insistir — pausa as tentativas
      if (googleAccountFullRef.current) return;
      // Nunca executar em paralelo nem com a aba em segundo plano:
      // isso gerava dezenas de chamadas simultâneas e sobrecarregava o banco.
      if (syncRunning) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      syncRunning = true;
      try {
        const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
          body: { action: 'syncPendingToGoogle' }
        });
        if (cancelled) return;
        if (data?.accountFull) {
          googleAccountFullRef.current = true;
          setGoogleAccountFull(true);
          toast({
            title: "Conta Google cheia (limite de 25.000 contatos)",
            description: "O Google não aceita mais contatos nesta conta. Exclua contatos em contacts.google.com ou conecte outra conta Google.",
            variant: "destructive",
          });
          return;
        }
        if (data?.requiresReconnect) {
          toast({
            title: "Reconecte a conta Google",
            description: data.lastError || "O Google recusou o envio porque a conta foi conectada com permissão antiga somente leitura.",
            variant: "destructive",
          });
          return;
        }
        if (!error && data?.success) {
          if (googleAccountFull) {
            googleAccountFullRef.current = false;
            setGoogleAccountFull(false);
          }
          // Só recarrega a base de contatos quando algo realmente foi enviado.
          const changed = Number(data?.pushed ?? data?.created ?? data?.synced ?? 0);
          if (changed > 0) {
            await fetchContacts();
          }
        }
      } catch (e) {
        console.warn('[AUTO-SYNC] Falha na sincronização silenciosa do Google:', e);
      } finally {
        syncRunning = false;
      }
    };

    // Roda imediatamente ao montar/ativar
    silentSync();
    // E depois a cada 60 segundos (evita sobrecarregar o banco/edge function)
    const intervalId = window.setInterval(silentSync, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [googleContactsEnabled, anyAutoSync]);

  const handleImprovePrompt = async () => {
    if (!metaSettings.ai_system_prompt?.trim() || improvingPrompt) {
      toast({ title: "Aviso", description: "Escreva algo no prompt primeiro para que eu possa melhorar." });
      return;
    }
    
    setImprovingPrompt(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'improvePrompt', prompt: metaSettings.ai_system_prompt }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Erro ao melhorar prompt");

      setMetaSettings(prev => ({ ...prev, ai_system_prompt: data.improvedPrompt }));
      toast({ title: "Prompt melhorado!", description: "A I.A. refinou suas instruções com sucesso." });
    } catch (err: any) {
      toast({ title: "Erro ao melhorar prompt", description: err.message, variant: "destructive" });
    } finally {
      setImprovingPrompt(false);
    }
  };

  const copyToClipboard = (text: string, label: string = "Texto") => {
    const cleanText = text.replace(/["']/g, '');
    navigator.clipboard.writeText(cleanText);
    toast({
      title: `${label} copiado!`,
      description: "Conteúdo pronto para enviar (sem aspas).",
    });
  };

  const updateContactStatus = async (contactId: string, updates: any) => {
    try {
      // Quando o Agente I.A Global está ligado, o ícone azul deve permanecer
      // ativo em TODAS as conversas, exceto nas desligadas manualmente pelo usuário.
      const currentContact = contacts.find((c: any) => c.id === contactId) || (selectedContactRef.current?.id === contactId ? selectedContactRef.current : null);
      const normalizedUpdates = Object.prototype.hasOwnProperty.call(updates, 'ai_active')
        ? {
            ...updates,
            metadata: {
              ...(currentContact?.metadata || {}),
              ...(updates.metadata || {}),
              manual_ai_activation: updates.ai_active === true,
            },
          }
        : updates;

      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, ...normalizedUpdates } : c));
      setSelectedContact(prev => prev?.id === contactId ? { ...prev, ...normalizedUpdates } : prev);
      const { error } = await supabase.from('crm_contacts').update(normalizedUpdates).eq('id', contactId);
      if (error) {
        fetchContacts();
        throw error;
      }
      toast({ title: "Status atualizado!" });
      fetchData(false);

      // Dispara sync imediato para o Google quando ativado (não espera o intervalo)
      if (googleContactsEnabled && anyAutoSync) {
        supabase.functions.invoke('meta-whatsapp-crm', {
          body: { action: 'syncPendingToGoogle' }
        }).catch(() => {});
      }


    } catch (err) {
      toast({ title: "Erro ao atualizar", variant: "destructive" });
    }
  };

  const handleDragStart = (contact: any) => setDraggedContact(contact);

  /**
   * Define se o ícone do Agente I.A deve aparecer ativo (azul) na conversa.
   * Regra: com o Agente I.A Global ligado, TODAS as conversas ficam ativas,
   * a não ser que o usuário tenha desligado manualmente aquela conversa.
   */
  const isAiVisuallyActive = (contact: any): boolean => {
    if (!contact) return false;
    const meta = (contact.metadata as any) || {};
    if (meta.manual_ai_off === true) return false;
    if (metaSettings.ai_agent_enabled) return true;
    return !!contact.ai_active && meta.manual_ai_activation === true;
  };
  const handleDrop = async (status: string) => {
    if (!draggedContact || draggedContact.status === status) return;
    await updateContactStatus(draggedContact.id, { status });
    setDraggedContact(null);
  };

  const fetchMessages = async (contactId: string, silent = false) => {
    if (!contactId) return;
    
    // Tentar restaurar do cache imediatamente se for o carregamento inicial da conversa
    const cached = messagesCacheRef.current[contactId];
    if (!silent) {
      if (cached) {
        setChatMessages(cached.messages);
      } else {
        setChatMessages([]);
      }
      setLoadingChat(true);
    }

    try {
      const { data } = await supabase
        .from('crm_messages')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', currentUserIdRef.current ?? '')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('created_at', { ascending: true });

      if (selectedContactRef.current?.id === contactId && data) {
        // Atualizar cache
        messagesCacheRef.current[contactId] = {
          messages: data,
          timestamp: Date.now()
        };
        setChatMessages(data);
        
        // Backfill: derive last_message_received_at from actual inbound messages
        const lastInboundMsg = [...data].reverse().find((m: any) => m.direction === 'inbound');
        if (lastInboundMsg) {
          const inboundIso = lastInboundMsg.created_at;
          const inboundT = new Date(inboundIso).getTime();
          const currentLast = selectedContactRef.current?.last_message_received_at
            ? new Date(selectedContactRef.current.last_message_received_at).getTime()
            : 0;
          
          if (inboundT > currentLast) {
            setSelectedContact((prev: any) => prev && prev.id === contactId
              ? { ...prev, last_message_received_at: inboundIso }
              : prev);
            setContacts((prev: any[]) => prev.map(c =>
              c.id === contactId ? { ...c, last_message_received_at: inboundIso } : c
            ));
          }
        }
      }
      
      await supabase.from('crm_contacts').update({ last_read_at: new Date().toISOString() }).eq('id', contactId);
    } catch (error) {
      console.error('[CRM] Erro ao carregar histórico:', error);
    } finally {
      if (!silent) setLoadingChat(false);
    }
  };

  const fetchRecentActiveMessages = async (contactId: string) => {
    const cached = messagesCacheRef.current[contactId];
    const now = Date.now();
    // Se o cache é muito recente (menos de 10s), pular o fetch de background
    if (cached && (now - cached.timestamp < 10000)) return;

    if (!contactId) return;
    const latestPersistedTime = chatMessagesRef.current
      .filter((m: any) => !m.isOptimistic && m.created_at)
      .reduce((latest: number, m: any) => Math.max(latest, new Date(m.created_at).getTime()), 0);

    let query = supabase
      .from('crm_messages')
      .select('*')
      .eq('contact_id', contactId)
      .eq('user_id', currentUserIdRef.current ?? '');
    if (latestPersistedTime > 0) {
      query = query.gt('created_at', new Date(latestPersistedTime).toISOString()).order('created_at', { ascending: true }).limit(25);
    } else {
      query = query.order('created_at', { ascending: false }).limit(25);
    }

    const { data } = await query;
    if (!data?.length || selectedContactRef.current?.id !== contactId) return;

    const rows = latestPersistedTime > 0 ? data : [...data].reverse();
    setChatMessages(prev => {
      const byId = new Map(prev.map((m: any) => [m.id, m]));
      rows.forEach((m: any) => byId.set(m.id, m));
      const sorted = Array.from(byId.values()).sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      
      // Atualizar cache com o estado mesclado
      messagesCacheRef.current[contactId] = {
        messages: sorted,
        timestamp: Date.now()
      };
      
      return sorted;
    });

    const lastInbound = [...rows].reverse().find((m: any) => m.direction === 'inbound');
    if (lastInbound) {
      const nowIso = new Date().toISOString();
      setContacts(prev => prev.map(c => c.id === contactId
        ? { ...c, last_message_received_at: lastInbound.created_at, last_read_at: nowIso }
        : c
      ));
      await supabase.from('crm_contacts').update({ last_read_at: nowIso }).eq('id', contactId);
    }
  };

  const getLastInboundTime = (contact: any) => {
    const raw = contact?.last_message_received_at;
    if (!raw) return 0;
    const parsed = Date.parse(String(raw).trim());
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const handleClearConversation = async (contactId: string) => {
    try {
      if (metaSettings.save_deleted_messages) {
        // Soft delete: preserve messages in server-side history
        const { error } = await supabase
          .from('crm_messages')
          .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: 'admin' })
          .eq('contact_id', contactId)
          .or('is_deleted.is.null,is_deleted.eq.false');
        if (error) throw error;
      } else {
        const { error } = await supabase.from('crm_messages').delete().eq('contact_id', contactId);
        if (error) throw error;
      }
      if (selectedContactRef.current?.id === contactId) {
        setChatMessages([]);
      }
      setInboundTimestampsByContact(prev => {
        const next = { ...prev };
        delete next[contactId];
        return next;
      });
      toast({ title: "Conversa limpa", description: "Todas as mensagens foram apagadas." });
    } catch (e: any) {
      console.error('[CRM] clearConversation error', e);
      toast({ title: "Erro ao limpar", description: e?.message || "Tente novamente.", variant: "destructive" });
    }
  };

  const handleDeleteConversation = async (contactId: string) => {
    try {
      const { error: msgErr } = await supabase.from('crm_messages').delete().eq('contact_id', contactId);
      if (msgErr) throw msgErr;
      const { error: contactErr } = await supabase.from('crm_contacts').delete().eq('id', contactId);
      if (contactErr) throw contactErr;
      setContacts(prev => prev.filter(c => c.id !== contactId));
      if (selectedContactRef.current?.id === contactId) {
        setSelectedContact(null);
        setChatMessages([]);
      }
      setInboundTimestampsByContact(prev => {
        const next = { ...prev };
        delete next[contactId];
        return next;
      });
      toast({ title: "Conversa apagada", description: "O contato e suas mensagens foram removidos." });
    } catch (e: any) {
      console.error('[CRM] deleteConversation error', e);
      toast({ title: "Erro ao apagar", description: e?.message || "Tente novamente.", variant: "destructive" });
    }
  };

  const isConversationExpired = (contact: any) => {
    const lastInbound = getLastInboundTime(contact);
    if (!lastInbound) return false;
    const DAY = 24 * 60 * 60 * 1000;
    const TOLERANCE = 30 * 60 * 1000;
    return Date.now() - lastInbound > DAY + TOLERANCE;
  };

  const [resendingMessageId, setResendingMessageId] = useState<string | null>(null);
  const [expandedErrorMessageId, setExpandedErrorMessageId] = useState<string | null>(null);

  /**
   * Reenvio manual de uma mensagem que a Meta marcou como falha (ex.: 131026).
   * Mantém o balão original com o erro e envia uma nova tentativa do mesmo texto.
   */
  const handleResendFailedMessage = async (message: any) => {
    const targetContact = selectedContactRef.current;
    if (!targetContact?.wa_id) return;

    const textToSend = String(message?.content || '').trim();
    if (!textToSend || message?.message_type !== 'text') {
      toast({
        title: 'Reenvio indisponível',
        description: 'Só é possível reenviar automaticamente mensagens de texto. Envie a mídia novamente pelo campo abaixo.',
        variant: 'destructive',
      });
      return;
    }

    setResendingMessageId(message.id);
    try {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: {
          action: 'sendMessage',
          to: targetContact.wa_id,
          text: textToSend,
          ...numberScopePatch(),
          metadata: { source: 'manual_resend', resent_from: message.id },
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao reenviar mensagem pela Meta');

      toast({ title: 'Mensagem reenviada', description: 'Nova tentativa enviada para o contato.' });
      await fetchMessages(targetContact.id, true);
    } catch (err: any) {
      toast({ title: 'Falha ao reenviar', description: err?.message || 'Tente novamente em instantes.', variant: 'destructive' });
    } finally {
      setResendingMessageId(null);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedContact) return;

    const isColdList = isConversationExpired(selectedContact);

    if (isColdList) {
      setExpiredWindowDialog(true);
      return;
    }

    const textToSend = newMessage.trim();
    const targetContactId = selectedContact.id;
    const targetWaId = selectedContact.wa_id;
    const wasAiActive = !!selectedContact.ai_active;

    setNewMessage('');

    // Optimistic update (pending → shows clock icon while queued)
    const optimisticMessage = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      contact_id: targetContactId,
      content: textToSend,
      direction: 'outbound',
      message_type: 'text',
      status: 'pending',
      created_at: new Date().toISOString(),
      isOptimistic: true
    };
    setChatMessages(prev => {
      if (selectedContactRef.current?.id === targetContactId) {
        return [...prev, optimisticMessage];
      }
      return prev;
    });

    // Per-contact FIFO queue: allow the user to type more messages while the
    // previous ones are still being sent. Each message is dispatched in order.
    const prevJob = sendQueueRef.current[targetContactId] || Promise.resolve();
    const job = prevJob.then(async () => {
      try {
        if (wasAiActive) {
          console.log('[CRM] Desativando IA para contato', targetContactId);
          await updateContactStatus(targetContactId, { ai_active: false });
        }

        console.log('[CRM][sendText] →', { to: targetWaId, len: textToSend.length, preview: textToSend.slice(0, 80) });
        const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
          body: { action: 'sendMessage', to: targetWaId, text: textToSend, ...numberScopePatch(), metadata: { source: 'manual_send' } }
        });
        console.log('[CRM][sendText] ← resp', { error, data });
        if (error) throw error;
        if (!data?.success) {
          console.error('[CRM][sendText] FAIL', data);
          throw new Error(data.error || 'Erro ao enviar mensagem pela Meta');
        }
        await fetchMessages(targetContactId, true);
      } catch (err: any) {
        if (selectedContactRef.current?.id === targetContactId) {
          setChatMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
        }
        toast({ title: 'Erro ao enviar', description: err.message, variant: 'destructive' });
      }
    });
    sendQueueRef.current[targetContactId] = job.finally(() => {
      if (sendQueueRef.current[targetContactId] === job) {
        delete sendQueueRef.current[targetContactId];
      }
    });
  };

  const handleScheduleBatch = async () => {
    let finalContactIds = [...selectedContactsForScheduling];

    if (selectedCampaignType === 'list') {
      if (!contactListText.trim()) {
        toast({ title: "Cole uma lista de números ou vCard", variant: "destructive" });
        return;
      }
      setIsScheduling(true);
      try {
        // Extrair números (considerando linhas, espaços ou formato vCard)
        const lines = contactListText.split('\n');
        const extractedNumbers: string[] = [];
        
        lines.forEach(line => {
          // Se for vCard (TEL;TYPE=...)
          if (line.includes('TEL;')) {
            const num = line.split(':')[1]?.replace(/\D/g, '');
            if (num) extractedNumbers.push(num);
          } else {
            // Apenas número
            const num = line.replace(/\D/g, '');
            if (num && num.length >= 8) extractedNumbers.push(num);
          }
        });

        if (extractedNumbers.length === 0) {
          toast({ title: "Nenhum número válido encontrado na lista", variant: "destructive" });
          setIsScheduling(false);
          return;
        }

        // Criar ou encontrar contatos
        const contactsToProcess = [...new Set(extractedNumbers)];
        const createdIds: string[] = [];
        
        const { data: { user: bulkUser } } = await supabase.auth.getUser();
        for (const num of contactsToProcess) {
          let { data: contact } = await scopeToNumber(
            supabase
              .from('crm_contacts')
              .select('id')
              .eq('wa_id', num)
              .eq('user_id', bulkUser?.id ?? '')
          ).maybeSingle();
          if (!contact) {
            const { data: newContact, error: createError } = await supabase.from('crm_contacts').insert({
              wa_id: num,
              name: num,
              user_id: bulkUser?.id,
              status: 'new',
              source_type: 'bulk_import',
              ...numberScopePatch(),
            }).select().single();
            if (!createError && newContact) contact = newContact;
          }
          if (contact) createdIds.push(contact.id);
        }
        finalContactIds = createdIds;
      } catch (err: any) {
        toast({ title: "Erro ao processar lista", description: err.message, variant: "destructive" });
        setIsScheduling(false);
        return;
      }
    }

    if (finalContactIds.length === 0) {
      toast({ title: "Nenhum contato selecionado", variant: "destructive" });
      setIsScheduling(false);
      return;
    }

    if (!scheduleDate || !scheduleTime) {
      toast({ title: "Informe data e hora", variant: "destructive" });
      setIsScheduling(false);
      return;
    }

    if (scheduleType !== 'message' && !selectedScheduleId) {
      toast({ title: "Selecione um item para agendar", variant: "destructive" });
      setIsScheduling(false);
      return;
    }

    if (scheduleType === 'message' && !newMessage.trim()) {
      toast({ title: "Escreva a mensagem", variant: "destructive" });
      setIsScheduling(false);
      return;
    }

    try {
      // Validar janela de 24h para mensagens comuns se necessário
      if (scheduleType === 'message' || scheduleType === 'flow') {
        const { data: contactsData } = await supabase.from('crm_contacts').select('id, last_message_received_at').in('id', finalContactIds);
        const coldContacts = contactsData?.filter(c => {
          if (!c.last_message_received_at) return true;
          return (Date.now() - new Date(c.last_message_received_at).getTime() > 24.5 * 60 * 60 * 1000);
        }) || [];

        if (coldContacts.length > 0) {
          const confirmCold = confirm(`Atenção: ${coldContacts.length} contatos estão fora da janela de 24h e podem não receber mensagens comuns. Deseja continuar apenas com os contatos ativos?`);
          if (!confirmCold) {
            setIsScheduling(false);
            return;
          }
          // Filtrar apenas contatos ativos
          finalContactIds = finalContactIds.filter(id => !coldContacts.find(c => c.id === id));
          if (finalContactIds.length === 0) {
            toast({ title: "Nenhum contato ativo para receber esta mensagem. Use um Template para contatos fora da janela.", variant: "destructive" });
            setIsScheduling(false);
            return;
          }
        }
      }

      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const payload: any = { action: scheduleType === 'message' ? 'sendMessage' : scheduleType === 'template' ? 'sendTemplate' : 'startFlow' };
      
      if (scheduleType === 'message') payload.text = newMessage;
      else if (scheduleType === 'template') {
        const t = templates.find(temp => temp.id === selectedScheduleId);
        const issue = templateSendIssue(t, scheduleTemplateConfig);
        if (issue) {
          toast({ title: "Complete as variáveis do template", description: issue, variant: "destructive" });
          setTemplateVariablesTarget({ template: t, purpose: 'schedule' });
          setIsScheduling(false);
          return;
        }
        payload.templateName = t?.name;
        payload.language = t?.language || 'pt_BR';
        payload.languageCode = t?.language || 'pt_BR';
        const resolvedConfig = await resolveTemplateSendConfig(t, scheduleTemplateConfig);
        if (resolvedConfig) payload.templateConfig = resolvedConfig;
      } else if (scheduleType === 'flow') {
        payload.flowId = selectedScheduleId;
      }

      const insertions = finalContactIds.map(contactId => ({
        contact_id: contactId,
        scheduled_for: scheduledFor,
        message_data: payload,
        status: 'pending'
      }));

      const { error } = await supabase.from('crm_scheduled_messages').insert(insertions);
      if (error) throw error;

      toast({ title: `${insertions.length} agendamentos criados!` });
      setIsSchedulingOpen(false);
      setSelectedContactsForScheduling([]);
      setContactListText('');
      setNewMessage('');
      setSelectedScheduleId('');
      fetchAllScheduledMessages();
      if (selectedContact) fetchScheduledMessages(selectedContact.id);
    } catch (err: any) {
      toast({ title: "Erro ao agendar", description: err.message, variant: "destructive" });
    } finally {
      setIsScheduling(false);
    }
  };
  const handleScheduleBirthday = async () => {
    if (!birthdayName || !birthdayNumber) {
      toast({ title: "Preencha nome e número", variant: "destructive" });
      return;
    }
    if (!scheduleDate || !scheduleTime) {
      toast({ title: "Informe data e hora", variant: "destructive" });
      return;
    }
    if (!selectedScheduleId) {
      toast({ title: "Selecione um template para o aniversário", variant: "destructive" });
      return;
    }

    setIsScheduling(true);
    try {
      // 1. Garantir que o contato existe ou criar um temporário/persistente
      const { data: { user: bdayUser } } = await supabase.auth.getUser();
      let { data: contact } = await scopeToNumber(
        supabase
          .from('crm_contacts')
          .select('id')
          .eq('wa_id', birthdayNumber)
          .eq('user_id', bdayUser?.id ?? '')
      ).maybeSingle();
      
      if (!contact) {
        const { data: newContact, error: createError } = await supabase.from('crm_contacts').insert({
          wa_id: birthdayNumber,
          name: birthdayName,
          user_id: bdayUser?.id,
          status: 'new',
          source_type: 'system',
          ...numberScopePatch(),
        }).select().single();
        if (createError) throw createError;
        contact = newContact;
      }

      // 2. Criar agendamento (Apenas template para novos contatos/lista fria)
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const t = templates.find(temp => temp.id === selectedScheduleId);
      const birthdayIssue = templateSendIssue(t, scheduleTemplateConfig);
      if (birthdayIssue) {
        toast({ title: "Complete as variáveis do template", description: birthdayIssue, variant: "destructive" });
        setTemplateVariablesTarget({ template: t, purpose: 'schedule' });
        setIsScheduling(false);
        return;
      }
      const birthdayConfig = await resolveTemplateSendConfig(t, scheduleTemplateConfig);
      
      const payload: any = {
        action: 'sendTemplate',
        templateName: t?.name,
        language: t?.language || 'pt_BR',
        languageCode: t?.language || 'pt_BR',
        ...(birthdayConfig ? { templateConfig: birthdayConfig } : {}),
      };

      const { error: scheduleError } = await supabase.from('crm_scheduled_messages').insert({
        contact_id: contact.id,
        scheduled_for: scheduledFor,
        message_data: payload,
        status: 'pending'
      });

      if (scheduleError) throw scheduleError;

      toast({ title: "Aniversário agendado com sucesso!" });
      setIsSchedulingOpen(false);
      setBirthdayName('');
      setBirthdayNumber('');
      fetchAllScheduledMessages();
    } catch (err: any) {
      toast({ title: "Erro ao agendar aniversário", description: err.message, variant: "destructive" });
    } finally {
      setIsScheduling(false);
    }
  };

  
  
  
  const handleCreateWebhook = async () => {
    if (!newWebhook.name) return;
    setSaving(true);
    try {
      const token = newWebhook.secret_token || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      
      const webhookData = {
        name: newWebhook.name,
        response_type: newWebhook.response_type,
        template_id: newWebhook.template_id || null,
        secret_token: token,
        is_active: true,
        default_status: newWebhook.default_status || 'new'
      };

      const { data, error } = await supabase.from('crm_webhooks').insert([webhookData]).select();
      
      if (error) {
        throw error;
      }

      toast({ title: "Webhook criado!" });
      fetchWebhooks();

      setIsNewWebhookDialogOpen(false);
      setNewWebhook({ name: '', response_type: 'text', template_id: '', secret_token: '', is_active: true, default_status: 'new' });
    } catch (err: any) {
      toast({ 
        title: "Erro ao criar", 
        description: err.message || "Ocorreu um erro ao salvar no banco de dados.", 
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      const { error } = await supabase.from('crm_webhooks').delete().eq('id', id);
      if (error) throw error;
      toast({ title: "Webhook excluído!" });
      fetchWebhooks();
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
  };

  const toggleWebhookStatus = async (id: string, current: boolean) => {
    try {
      const { error } = await supabase.from('crm_webhooks').update({ is_active: !current }).eq('id', id);
      if (error) throw error;
      fetchWebhooks();
    } catch (err: any) {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    }
  };

  const handleCreateStatus = async () => {
    if (!newStatusData.label) return;
    setSaving(true);
    try {
      const value = newStatusData.value || newStatusData.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-');
      const sortOrder = (kanbanStatuses.length + 1) * 10;
      
      const { error } = await supabase.from('crm_statuses').insert([{
        label: newStatusData.label,
        value: value,
        color: newStatusData.color,
        sort_order: sortOrder,
        is_starred: false,
        user_id: (await supabase.auth.getUser()).data.user?.id
      }]);

      if (error) throw error;
      toast({ title: "Etiqueta criada com sucesso!" });
      fetchStatuses();
      setIsNewStatusDialogOpen(false);
      setNewStatusData({ label: '', color: 'blue', value: '' });
    } catch (err: any) {
      toast({ title: "Erro ao criar etiqueta", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async () => {
    if (!editingStatus || !editingStatus.label) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('crm_statuses')
        .update({
          label: editingStatus.label,
          color: editingStatus.color,
          is_starred: !!editingStatus.is_starred
        })
        .eq('id', editingStatus.id);

      if (error) throw error;
      toast({ title: "Etiqueta atualizada com sucesso!" });
      fetchStatuses();
      setIsEditStatusDialogOpen(false);
      setEditingStatus(null);
    } catch (err: any) {
      toast({ title: "Erro ao atualizar etiqueta", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStatus = async (id: string) => {
    try {
      const { error } = await supabase.from('crm_statuses').delete().eq('id', id);
      if (error) throw error;
      toast({ title: "Etiqueta removida!" });
      fetchStatuses();
    } catch (err: any) {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
    }
  };

  const handleMoveStatus = async (id: string, direction: 'up' | 'down') => {
    const currentIndex = kanbanStatuses.findIndex(s => s.id === id);
    if (currentIndex === -1) return;
    if (direction === 'up' && currentIndex === 0) return;
    if (direction === 'down' && currentIndex === kanbanStatuses.length - 1) return;

    const newStatuses = [...kanbanStatuses];
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    [newStatuses[currentIndex], newStatuses[targetIndex]] = [newStatuses[targetIndex], newStatuses[currentIndex]];

    // Update sort orders
    const updates = newStatuses.map((s, idx) => ({
      id: s.id,
      sort_order: (idx + 1) * 10
    }));

    try {
      for (const update of updates) {
        await supabase.from('crm_statuses').update({ sort_order: update.sort_order }).eq('id', update.id);
      }
      fetchStatuses();
    } catch (err) {
      console.error(err);
    }
  };

  /**
   * Libera TODOS os recursos de áudio (recorder, stream do microfone e
   * AudioContext). Browsers travam o microfone se um stream anterior não for
   * fechado — motivo pelo qual "recarregar a página" resolvia o problema.
   */
  const releaseRecordingResources = () => {
    const rec = recorderRef.current;
    if (rec) {
      try { rec.ondataavailable = null; } catch {}
      try { if (rec.state && rec.state !== 'inactive') rec.stop?.(); } catch {}
      try { rec.close?.(); } catch {}
      recorderRef.current = null;
    }
    if (micStreamRef.current) {
      try { micStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      micStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setMediaRecorder(null);
  };

  const finishRecordingWithBlob = (audioBlob: Blob) => {
    console.log(`[RECORDER] Gravação finalizada. Tamanho: ${audioBlob.size} bytes, Tipo: ${audioBlob.type}`);
    if (!audioBlob.size) {
      toast({ title: "Gravação vazia", description: "Nenhum áudio foi capturado. Tente novamente.", variant: "destructive" });
      return;
    }
    const audioUrl = URL.createObjectURL(audioBlob);
    setRecordedAudioBlob(audioBlob);
    setRecordedAudioUrl(audioUrl);
    setIsPreviewingAudio(true);
  };

  const startRecording = async () => {
    // Evita duplo clique / duas gravações simultâneas
    if (isStartingRecordingRef.current || isRecording) return;
    isStartingRecordingRef.current = true;

    // Cleanup de qualquer gravação anterior antes de pedir o microfone de novo
    releaseRecordingResources();
    setIsRecording(false);

    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador não suporta captura de microfone. Use HTTPS e um navegador atualizado.');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      micStreamRef.current = stream;

      // 1) Caminho preferencial: Opus-Recorder gerando OGG/Opus (PTT na Meta).
      //    IMPORTANTE: passamos um sourceNode do NOSSO stream — sem isso a lib
      //    chama getUserMedia de novo internamente, e em vários dispositivos a
      //    segunda solicitação falha (NotReadableError) enquanto a primeira está ativa.
      let started = false;
      try {
        const { default: Recorder } = await import('opus-recorder');
        const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        try { await audioCtx.resume(); } catch {}
        const sourceNode = audioCtx.createMediaStreamSource(stream);

        const recorder: any = new Recorder({
          encoderPath: '/opus/encoderWorker.min.js',
          encoderApplication: 2048,
          encoderSampleRate: 16000,
          numberOfChannels: 1,
          streamPages: false,
          encoderBitRate: 24000,
          sourceNode,
        });

        recorder.ondataavailable = (typedArray: Uint8Array) => {
          const buf = typedArray.buffer.slice(typedArray.byteOffset, typedArray.byteOffset + typedArray.byteLength) as ArrayBuffer;
          finishRecordingWithBlob(new Blob([buf], { type: 'audio/ogg; codecs=opus' }));
          releaseRecordingResources();
        };

        console.log('[RECORDER] Iniciando gravação PTT com Opus-Recorder.');
        // Timeout defensivo: se o worker do encoder não carregar (404/CSP), cai no fallback
        await Promise.race([
          recorder.start(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout ao iniciar encoder Opus')), 8000)),
        ]);
        recorderRef.current = recorder;
        setMediaRecorder(recorder);
        started = true;
      } catch (opusErr) {
        console.warn('[RECORDER] Opus-Recorder indisponível, usando MediaRecorder nativo.', opusErr);
        if (audioCtxRef.current) { try { void audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
      }

      // 2) Fallback: MediaRecorder nativo (webm/opus no Chrome, mp4 no Safari).
      //    O backend/VPS transcoder normaliza para OGG antes de enviar à Meta.
      if (!started) {
        if (typeof MediaRecorder === 'undefined') {
          throw new Error('Gravação de áudio não suportada neste navegador.');
        }
        const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
        const mimeType = candidates.find(c => !c || MediaRecorder.isTypeSupported(c)) ?? '';
        const native = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        const chunks: BlobPart[] = [];
        native.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
        native.onstop = () => {
          finishRecordingWithBlob(new Blob(chunks, { type: native.mimeType || mimeType || 'audio/webm' }));
          releaseRecordingResources();
        };
        native.onerror = (ev: Event) => {
          console.error('[RECORDER] Erro no MediaRecorder nativo', ev);
          toast({ title: "Erro na gravação", description: "O navegador interrompeu a captura de áudio.", variant: "destructive" });
          releaseRecordingResources();
          setIsRecording(false);
        };
        native.start(250);
        recorderRef.current = native;
        setMediaRecorder(native as any);
      }

      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Error starting recording:', err);
      releaseRecordingResources();
      const name = err?.name || '';
      let description = err?.message || 'Não foi possível acessar o microfone.';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        description = 'Permissão negada. Clique no cadeado ao lado do endereço do site e permita o microfone.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        description = 'Nenhum microfone encontrado neste dispositivo.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        description = 'O microfone está em uso por outro aplicativo ou aba. Feche-o e tente novamente.';
      }
      toast({ title: "Erro ao acessar microfone", description, variant: "destructive" });
    } finally {
      isStartingRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current || (mediaRecorder as any);
    if (!rec || !isRecording) return;
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    try {
      rec.stop();
    } catch (err) {
      console.error('[RECORDER] Falha ao parar gravação', err);
      releaseRecordingResources();
      toast({ title: "Erro ao finalizar gravação", variant: "destructive" });
    }
  };

  const cancelAudioPreview = () => {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
    }
    setRecordedAudioBlob(null);
    setRecordedAudioUrl(null);
    setIsPreviewingAudio(false);
  };

  const sendRecordedAudio = async () => {
    if (recordedAudioBlob && !isSending(selectedContact?.id)) {
      const blob = recordedAudioBlob;
      const previewUrl = recordedAudioUrl || URL.createObjectURL(blob);
      setRecordedAudioBlob(null);
      setRecordedAudioUrl(null);
      setIsPreviewingAudio(false);
      // Forçamos isVoice como true para garantir o formato de "gravado na hora"
      await handleSendMedia(blob, 'audio', true, previewUrl);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          setPastedImage(file);
          setPastedImagePreview(URL.createObjectURL(file));
        }
      }
    }
  };

  const cancelPastedImage = () => {
    if (pastedImagePreview) URL.revokeObjectURL(pastedImagePreview);
    setPastedImage(null);
    setPastedImagePreview(null);
  };

  const sendPastedImage = async () => {
    if (pastedImage && !isSending(selectedContact?.id)) {
      const file = pastedImage;
      const preview = pastedImagePreview;
      cancelPastedImage();
      await handleSendMedia(file, 'image', false, preview || undefined);
    }
  };

  const handleEditedImageSave = (blob: Blob, url: string) => {
    const edited = new File([blob], `edited-${Date.now()}.png`, { type: 'image/png' });
    if (pastedImagePreview) URL.revokeObjectURL(pastedImagePreview);
    setPastedImage(edited);
    setPastedImagePreview(url);
    setImageEditorOpen(false);
  };

  const handleSendMedia = async (file: File | Blob, type: 'audio' | 'video' | 'image' | 'document', isVoice = false, previewUrl?: string) => {
    // IMPORTANTE: Se for áudio gravado aqui, isVoice deve ser true para que a Edge Function use o payload de voz da Meta
    const actuallyIsVoice = isVoice || type === 'audio';
    
    if (!selectedContact || isSending(selectedContact.id)) {
      console.warn('[CRM][sendMedia] abort: no contact or already sending', { hasContact: !!selectedContact, sending: selectedContact ? isSending(selectedContact.id) : false });
      return;
    }
    console.log('[CRM][sendMedia] start', { type, isVoice: actuallyIsVoice, size: (file as any).size, mime: (file as any).type, to: selectedContact.wa_id });

    const isColdList = isConversationExpired(selectedContact);

    if (isColdList) {
      setExpiredWindowDialog(true);
      return;
    }

    const targetContactId = selectedContact.id;
    const targetWaId = selectedContact.wa_id;
    
    setContactSending(targetContactId, true);
    const localPreviewUrl = previewUrl || (file instanceof File ? URL.createObjectURL(file) : (recordedAudioUrl || URL.createObjectURL(file)));
    
    // Optimistic update for media
    const optimisticMessage = {
      id: `temp-media-${Date.now()}`,
      contact_id: targetContactId,
      content: actuallyIsVoice ? '[Mensagem de Áudio...]' : `[${type.toUpperCase()}...]`,
      direction: 'outbound',
      message_type: type,
      created_at: new Date().toISOString(),
      isOptimistic: true,
      media_url: localPreviewUrl
    };
    
    setChatMessages(prev => {
      if (selectedContactRef.current?.id === targetContactId) {
        return [...prev, optimisticMessage];
      }
      return prev;
    });

    let savedAudioMessage: any = null;
    const persistOutboundAudio = async (publicUrl: string, metaMsgId: string | null, source: string, contentType?: string, status = 'sent') => {
      const { data: savedMessage, error: persistError } = await supabase
        .from('crm_messages')
        .insert({
          contact_id: targetContactId,
          user_id: currentUserIdRef.current ?? selectedContact?.user_id ?? null,
          ...numberScopePatch(),
          direction: 'outbound',
          message_type: 'audio',
          content: '[Mensagem de Áudio]',
          media_url: publicUrl,
          status,
          meta_message_id: metaMsgId,
          metadata: { source: 'manual_send', original_mime: contentType || null, is_voice: isVoice }
        })
        .select()
        .single();

      if (persistError) throw persistError;

      await supabase.from('crm_contacts')
        .update({ last_interaction: new Date().toISOString() })
        .eq('id', targetContactId);

      if (selectedContactRef.current?.id === targetContactId) {
        setChatMessages(prev => {
          const withoutTemp = prev.filter(m => m.id !== optimisticMessage.id && m.id !== savedMessage?.id);
          return savedMessage ? [...withoutTemp, savedMessage] : withoutTemp;
        });
      }
      savedAudioMessage = savedMessage;
      return savedMessage;
    };

    const updatePersistedAudio = async (status: string, source: string, metaMsgId?: string | null, errorMessage?: string) => {
      if (!savedAudioMessage?.id) return;
      const updateData: any = {
        status,
        metadata: { ...(savedAudioMessage.metadata || {}), source }
      };
      if (metaMsgId) updateData.meta_message_id = metaMsgId;
      if (errorMessage) updateData.error_message = errorMessage;
      const { data: updatedMessage } = await supabase
        .from('crm_messages')
        .update(updateData)
        .eq('id', savedAudioMessage.id)
        .select()
        .single();
      if (updatedMessage && selectedContactRef.current?.id === targetContactId) {
        setChatMessages(prev => prev.map(m => m.id === updatedMessage.id ? updatedMessage : m));
      }
    };

    try {
      // Desativa o agente de IA automaticamente ao enviar mídia manual
      if (selectedContact.ai_active) {
        await updateContactStatus(targetContactId, { ai_active: false });
      }

      const isAudio = type === 'audio';
      setMediaUploadProgress(prev => ({ ...prev, [targetContactId]: 10 }));
      
      let fileExt = 'ogg';
      let contentType = 'audio/ogg; codecs=opus';
      
      if (isAudio) {
        fileExt = 'ogg';
        contentType = 'audio/ogg; codecs=opus';
      } else if (file instanceof File) {
        // Extensão saneada (minúscula, só [a-z0-9]) — evita path inválido no Storage
        fileExt = (getFileExtension(file.name) || 'bin').replace(/[^a-z0-9]/g, '') || 'bin';
        // File.type costuma vir vazio p/ .rar, .csv, .doc no Windows → infere pela extensão
        contentType = resolveMimeType(file);
      } else {
        contentType = resolveMimeType({ type: (file as Blob).type });
      }

      // Documentos: valida limites da Meta antes de subir (100MB doc, 5MB img, 16MB vídeo)
      const metaLimits: Record<typeof type, number> = { document: 100 * 1024 * 1024, image: 5 * 1024 * 1024, video: 16 * 1024 * 1024, audio: 16 * 1024 * 1024 };
      if ((file as Blob).size > metaLimits[type]) {
        throw new Error(`Arquivo muito grande. O WhatsApp aceita no máximo ${Math.round(metaLimits[type] / 1024 / 1024)}MB para ${type === 'document' ? 'documentos' : type}.`);
      }

      const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
      const filePath = `chat-media/${fileName}`;
      const originalFileName = file instanceof File && file.name ? file.name : `document.${fileExt}`;

      setMediaUploadProgress(prev => ({ ...prev, [targetContactId]: 30 }));

      const { error: uploadError } = await supabase.storage
        .from('crm-media')
        .upload(filePath, file, {
          contentType: contentType || 'application/octet-stream',
          upsert: true
        });

      if (uploadError) throw uploadError;
      setMediaUploadProgress(prev => ({ ...prev, [targetContactId]: 60 }));

      const { data: { publicUrl } } = supabase.storage
        .from('crm-media')
        .getPublicUrl(filePath);

      let historyAudioUrl = publicUrl;
      let historyContentType = contentType;
      if (isAudio) {
        const wavBlob = await createMobilePlayableAudioBlob(file);
        if (wavBlob) {
          const wavPath = `chat-media/history_${fileName.replace(/\.[^.]+$/, '')}.wav`;
          const { error: wavUploadError } = await supabase.storage
            .from('crm-media')
            .upload(wavPath, wavBlob, { contentType: 'audio/wav', upsert: true });
          if (!wavUploadError) {
            const { data: { publicUrl: wavPublicUrl } } = supabase.storage.from('crm-media').getPublicUrl(wavPath);
            historyAudioUrl = wavPublicUrl;
            historyContentType = 'audio/wav';
          }
        }
        await persistOutboundAudio(historyAudioUrl, null, 'history_saved_before_send', historyContentType, 'sending');
      }
      setMediaUploadProgress(prev => ({ ...prev, [targetContactId]: 80 }));

      if (type === 'audio' && metaSettings.vps_transcoder_url && metaSettings.vps_status !== 'offline') {
        console.log('[CRM][sendMedia][VPS] Tentando envio via VPS Transcoder', { url: metaSettings.vps_transcoder_url, to: targetWaId });
        let vpsResult: any = null;
        try {
          const vpsUrl = metaSettings.vps_transcoder_url.replace(/\/$/, '');
          const response = await fetch(`${vpsUrl}/send-voice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: targetWaId,
              audioUrl: publicUrl,
              metaToken: metaSettings.meta_access_token,
              phoneId: metaSettings.meta_phone_number_id,
              sendAsVoice: true
            })
          });
          
          vpsResult = await response.json().catch(() => ({}));
          console.log('[CRM][sendMedia][VPS] Resposta do VPS:', { status: response.status, vpsResult });
          if (!response.ok) {
            console.error('[CRM][sendMedia][VPS] VPS retornou erro:', vpsResult);
            throw new Error(vpsResult.error || vpsResult.details || 'Erro no processamento do VPS');
          }
        } catch (vpsErr: any) {
          console.error('[CRM][sendMedia][VPS] erro', vpsErr);
          toast({ 
            title: "Erro no transcoder da Meta", 
            description: "O áudio foi salvo no histórico, mas a Meta API não aceitou o envio. Erro: " + vpsErr.message,
            variant: "destructive"
          });
          await updatePersistedAudio('failed', 'vps_bridge_failed', null, vpsErr.message);
          setContactSending(targetContactId, false);
          return;
        }

        if (vpsResult) {
          const metaMsgId = vpsResult?.messageId || vpsResult?.messages?.[0]?.id || null;
          await updatePersistedAudio('accepted', 'vps_bridge', metaMsgId);
          toast({ title: "Áudio enviado para a Meta", description: "Aguardando confirmação de entrega." });
          setMediaUploadProgress(prev => {
            const next = { ...prev };
            delete next[targetContactId];
            return next;
          });
          setContactSending(targetContactId, false);
          return;
        }
      }

      setMediaUploadProgress(prev => ({ ...prev, [targetContactId]: 90 }));

      console.log('[CRM][sendMedia] invocando edge sendMessage com mídia', { type, url: publicUrl, isVoice: type === 'audio' });
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', { 
        body: { 
          action: 'sendMessage', 
          to: targetWaId,
          ...numberScopePatch(),
          audioUrl: type === 'audio' ? publicUrl : undefined,
          imageUrl: type === 'image' ? publicUrl : undefined,
          videoUrl: type === 'video' ? publicUrl : undefined,
          documentUrl: type === 'document' ? publicUrl : undefined,
          fileName: type === 'document' ? originalFileName : undefined,
          mimeType: contentType,
          isVoice: type === 'audio',
          skipLocalSave: type === 'audio' ? true : undefined,
          meta_phone_number_id: metaSettings.meta_phone_number_id,
          meta_access_token: metaSettings.meta_access_token
        },
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        }
      });
      console.log('[CRM][sendMedia] resp edge', { error, data });
      if (error) throw error;
      if (!data?.success) {
        console.error('[CRM][sendMedia] FAIL edge', data);
        throw new Error(data?.error || 'Falha desconhecida ao enviar mídia');
      }

      if (selectedContactRef.current?.id === targetContactId) {
        setChatMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
      }
      if (type === 'audio') {
        const metaMsgId = data?.messageId || data?.messages?.[0]?.id || data?.result?.messages?.[0]?.id || null;
        await updatePersistedAudio('accepted', 'standard_send', metaMsgId);
      }
      await fetchMessages(targetContactId, true);
      toast({ title: "Mídia enviada para a Meta", description: "Aguardando confirmação de entrega." });
    } catch (err: any) {
      console.error('[CRM][sendMedia] EXCEPTION', err);
      if (selectedContactRef.current?.id === targetContactId) {
        setChatMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
      }
      toast({ title: "Erro ao enviar mídia", description: err.message, variant: "destructive" });
    } finally {
      setMediaUploadProgress(prev => {
        const next = { ...prev };
        delete next[targetContactId];
        return next;
      });
      setContactSending(targetContactId, false);
    }
  };

  const [resendingAudioIds, setResendingAudioIds] = useState<Set<string>>(new Set());

  const handleResendAudio = async (msg: any) => {
    if (!msg?.id || !msg?.media_url) return;
    const contact = contacts.find(c => c.id === msg.contact_id) || selectedContact;
    const targetWaId = contact?.wa_id;
    if (!targetWaId) {
      toast({ title: "Contato não encontrado para reenviar", variant: "destructive" });
      return;
    }

    setResendingAudioIds(prev => {
      const next = new Set(prev);
      next.add(msg.id);
      return next;
    });

    const markStatus = async (status: string, source: string, metaMsgId?: string | null, errorMessage?: string) => {
      const updateData: any = {
        status,
        metadata: { ...(msg.metadata || {}), source }
      };
      if (metaMsgId) updateData.meta_message_id = metaMsgId;
      if (errorMessage) updateData.error_message = errorMessage;
      const { data: updatedMessage } = await supabase
        .from('crm_messages')
        .update(updateData)
        .eq('id', msg.id)
        .select()
        .single();
      if (updatedMessage) {
        setChatMessages(prev => prev.map(m => m.id === updatedMessage.id ? { ...m, ...updatedMessage } : m));
      }
    };

    try {
      // Tenta primeiro via VPS transcoder se disponível
      if (metaSettings.vps_transcoder_url && metaSettings.vps_status !== 'offline') {
        try {
          const vpsUrl = metaSettings.vps_transcoder_url.replace(/\/$/, '');
          const response = await fetch(`${vpsUrl}/send-voice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: targetWaId,
              audioUrl: msg.media_url,
              metaToken: metaSettings.meta_access_token,
              phoneId: metaSettings.meta_phone_number_id,
              sendAsVoice: true
            })
          });
          const vpsResult = await response.json().catch(() => ({}));
          if (response.ok) {
            const metaMsgId = vpsResult?.messageId || vpsResult?.messages?.[0]?.id || null;
            await markStatus('sent', 'vps_bridge_resend', metaMsgId);
            toast({ title: "Áudio reenviado!" });
            return;
          }
          // se falhar, tenta fallback abaixo
        } catch (_) {
          // fallback
        }
      }

      // Fallback: envia via edge function padrão
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: {
          action: 'sendMessage',
          to: targetWaId,
          ...numberScopePatch(),
          audioUrl: msg.media_url,
          isVoice: true,
          skipLocalSave: true
        }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Falha no reenvio');
      const metaMsgId = data?.messageId || data?.messages?.[0]?.id || data?.result?.messages?.[0]?.id || null;
      await markStatus('sent', 'standard_resend', metaMsgId);
      toast({ title: "Áudio reenviado!" });
    } catch (err: any) {
      await markStatus('failed', 'resend_failed', null, err.message);
      toast({ title: "Falha ao reenviar áudio", description: err.message, variant: "destructive" });
    } finally {
      setResendingAudioIds(prev => {
        const next = new Set(prev);
        next.delete(msg.id);
        return next;
      });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !uploadType) return;

    const isVoice = uploadType === 'audio';
    for (const file of files) {
      // Auto-detect per-file type when user picked "all" (image/video/document)
      let typeForFile: 'image' | 'video' | 'audio' | 'document' = uploadType;
      const mime = file.type || '';
      if (uploadType !== 'audio') {
        if (mime.startsWith('image/')) typeForFile = 'image';
        else if (mime.startsWith('video/')) typeForFile = 'video';
        else typeForFile = 'document';
      }
      try {
        await handleSendMedia(file, typeForFile, isVoice);
      } catch (err) {
        console.error('[CRM][handleFileSelect] erro ao enviar arquivo', file.name, err);
      }
    }
    e.target.value = '';
  };

  const handleTriggerFlow = async (flowId: string) => {
    if (!selectedContact || isSending(selectedContact.id)) return;

    const isColdList = isConversationExpired(selectedContact);

    if (isColdList) {
      toast({ 
        title: "Janela de 24h Expirada", 
        description: "Não é possível iniciar fluxos em chats expirados. Use um Template Aprovado.", 
        variant: "destructive" 
      });
      return;
    }

    const targetContactId = selectedContact.id;
    const targetWaId = selectedContact.wa_id;
    
    const flow = flows.find(f => f.id === flowId);
    if (!confirmSend || confirmSend.id !== flowId) {
      setConfirmSend({ type: 'flow', id: flowId, name: flow?.name || 'Fluxo' });
      return;
    }

    setConfirmSend(null);
    setContactSending(targetContactId, true);
    try {
      // Desativa o agente de IA automaticamente ao iniciar um fluxo manual
      if (selectedContact.ai_active) {
        await updateContactStatus(targetContactId, { ai_active: false });
      }

      console.log('[CRM] Invocando startFlow para contato', targetContactId, 'fluxo', flowId);
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'startFlow', contactId: targetContactId, waId: targetWaId, flowId }
      });
      
      if (error) {
        console.error('[CRM] Erro na invocação de startFlow:', error);
        throw error;
      }
      
      if (!data?.success) {
        console.error('[CRM] Função retornou erro no startFlow:', data);
        throw new Error(data?.error || "Erro ao iniciar fluxo");
      }

      toast({ title: "Fluxo Iniciado!" });
      
      // Atualização imediata do estado local para refletir no chat e na lista
      const { data: updatedContact } = await supabase
        .from('crm_contacts')
        .select('*')
        .eq('id', targetContactId)
        .single();
        
      if (updatedContact) {
        console.log('[CRM] Contato atualizado após startFlow:', updatedContact.flow_state);
        setContacts(prev => prev.map(c => c.id === targetContactId ? updatedContact : c));
        // Use ref para não "puxar" o usuário de volta caso ele tenha aberto outra conversa
        // enquanto o envio do fluxo estava em andamento.
        if (selectedContactRef.current?.id === targetContactId) {
          setSelectedContact((prev: any) => prev && prev.id === targetContactId ? { ...prev, ...updatedContact } : prev);
        }
      }

      await fetchMessages(targetContactId, true);
    } catch (err: any) {
      toast({ title: "Erro ao iniciar fluxo", description: err.message, variant: "destructive" });
    } finally {
      setContactSending(targetContactId, false);
    }
  };

  const handleStopFlow = async (contactId: string) => {
    setContactSending(contactId, true);
    try {
      const { error } = await supabase
        .from('crm_contacts')
        .update({
          current_flow_id: null,
          current_node_id: null,
          flow_state: 'idle',
          ai_active: false,
          next_execution_time: null
        })
        .eq('id', contactId);
        
      if (error) throw error;
      
      await supabase
        .from('crm_scheduled_messages')
        .delete()
        .eq('contact_id', contactId)
        .eq('status', 'pending');

      toast({ title: "Atendimento automático interrompido" });
      
      if (selectedContact?.id === contactId) {
        setSelectedContact((prev: any) => ({
          ...prev,
          flow_state: 'idle',
          current_flow_id: null,
          current_step_index: null,
          current_node_id: null,
          ai_active: false,
          next_execution_time: null
        }));
      }
      fetchContacts();
    } catch (err: any) {
      toast({ title: "Erro ao interromper fluxo", description: err.message, variant: "destructive" });
    } finally {
      setContactSending(contactId, false);
    }
  };

  const handleManualAiReply = async (contactId: string) => {
    if (isSending(contactId)) return;
    setContactSending(contactId, true);

    try {
      const contact = contacts.find(c => c.id === contactId);
      if (!contact) throw new Error("Contato não encontrado");

      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { 
          action: 'processAiAgent',
          contactId: contactId,
          waId: contact.wa_id,
          manualTrigger: true
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "IA não conseguiu responder agora.");

      toast({ title: "IA processando resposta..." });
    } catch (err: any) {
      toast({ 
        title: "Erro ao acionar IA", 
        description: err.message, 
        variant: "destructive" 
      });
    } finally {
      setContactSending(contactId, false);
    }
  };


  const handleResumeFlow = async (contactId: string) => {
    setContactSending(contactId, true);
    try {
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('current_flow_id, current_node_id, wa_id')
        .eq('id', contactId)
        .single();
        
      if (!contact?.current_flow_id || !contact?.current_node_id) {
        throw new Error('Informações do fluxo não encontradas para retomar.');
      }

      const { error } = await supabase
        .from('crm_contacts')
        .update({
          flow_state: 'processing',
          next_execution_time: new Date().toISOString()
        })
        .eq('id', contactId);

      if (error) throw error;
      
      toast({ title: "Fluxo retomado! Processando agora..." });
      
      // Call background function to process immediately
      await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'processScheduled' }
      });
      
      fetchContacts();
    } catch (err: any) {
      toast({ title: "Erro ao retomar fluxo", description: err.message, variant: "destructive" });
    } finally {
      setContactSending(contactId, false);
    }
  };

  const handleScheduleMessage = async () => {
    if (!selectedContact || !scheduleDate || !scheduleTime) {
      toast({ title: "Preencha a data e hora", variant: "destructive" });
      return;
    }

    setIsScheduling(true);
    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      
      let messageData: any = { action: '' };
      const isColdList = isConversationExpired(selectedContact);
      
      if (scheduleType === 'message') {
        if (isColdList) {
          toast({ 
            title: "Regra de Segurança", 
            description: "Para contatos fora da janela de 24h, use apenas Templates Aprovados.", 
            variant: "destructive" 
          });
          setIsScheduling(false);
          return;
        }
        if (!newMessage.trim()) {
          toast({ title: "Digite a mensagem para agendar", variant: "destructive" });
          setIsScheduling(false);
          return;
        }
        messageData = { action: 'sendMessage', text: newMessage };
      } else if (scheduleType === 'template') {
        if (!selectedScheduleId) {
          toast({ title: "Selecione um template", variant: "destructive" });
          setIsScheduling(false);
          return;
        }
        const scheduledTemplate = templates.find(temp => temp.id === selectedScheduleId || temp.name === selectedScheduleId);
        const scheduledIssue = templateSendIssue(scheduledTemplate, scheduleTemplateConfig);
        if (scheduledIssue) {
          toast({ title: "Complete as variáveis do template", description: scheduledIssue, variant: "destructive" });
          setTemplateVariablesTarget({ template: scheduledTemplate, purpose: 'schedule' });
          setIsScheduling(false);
          return;
        }
        const scheduledConfig = await resolveTemplateSendConfig(scheduledTemplate, scheduleTemplateConfig);
        messageData = {
          action: 'sendTemplate',
          templateName: scheduledTemplate?.name || selectedScheduleId,
          languageCode: scheduledTemplate?.language || 'pt_BR',
          ...(scheduledConfig ? { templateConfig: scheduledConfig } : {}),
        };
      } else if (scheduleType === 'flow') {
        if (isColdList) {
          toast({ 
            title: "Regra de Segurança", 
            description: "Não é possível agendar fluxos para lista fria. Use Templates.", 
            variant: "destructive" 
          });
          setIsScheduling(false);
          return;
        }
        if (!selectedScheduleId) {
          toast({ title: "Selecione um fluxo", variant: "destructive" });
          setIsScheduling(false);
          return;
        }
        messageData = { action: 'startFlow', flowId: selectedScheduleId };
      }

      const { error } = await supabase.from('crm_scheduled_messages').insert({
        contact_id: selectedContact.id,
        scheduled_for: scheduledFor,
        message_data: messageData,
        status: 'pending'
      });

      if (error) throw error;

      toast({ title: "Mensagem agendada com sucesso!" });
      setIsSchedulingOpen(false);
      setNewMessage('');
      setScheduleDate('');
      setScheduleTime('');
      setSelectedScheduleId('');
      fetchScheduledMessages(selectedContact.id);
      fetchAllScheduledMessages();
    } catch (err: any) {
      toast({ title: "Erro ao agendar", description: err.message, variant: "destructive" });
    } finally {
      setIsScheduling(false);
    }
  };

  const syncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const { error } = await supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'getTemplates' } });
      if (error) throw error;
      toast({ title: "Templates Sincronizados" });
      fetchData(false);


    } catch (err) {
      toast({ title: "Erro ao sincronizar", variant: "destructive" });
    } finally {
      setSyncingTemplates(false);
    }
  };

  /**
   * Resolve a configuração de envio de um template: usa a configuração passada
   * ou o padrão salvo no CRM; retorna null quando o template não é dinâmico.
   */
  const resolveTemplateSendConfig = async (template: any, override?: TemplateSendConfig | null): Promise<TemplateSendConfig | null> => {
    if (!template) return null;
    const schema = parseTemplateSchema(template.components);
    if (!templateHasDynamicInputs(schema)) return null;
    if (override) return normalizeSendConfig(override, schema);
    const preset = await loadDefaultTemplatePreset(template.id);
    return normalizeSendConfig(preset, schema);
  };

  /** Valida antes de agendar/enviar; devolve a primeira pendência ou null. */
  const templateSendIssue = (template: any, config: TemplateSendConfig | null): string | null => {
    if (!template) return null;
    const schema = parseTemplateSchema(template.components);
    if (!templateHasDynamicInputs(schema)) return null;
    const issues = validateTemplateSendConfig(schema, config || createDefaultSendConfig(schema), null, template.status);
    return issues[0]?.message || null;
  };

  const handleSendTemplate = async (templateName: string, language: string) => {
    if (!selectedContact || isSending(selectedContact.id)) return;
    const targetContactId = selectedContact.id;
    const targetWaId = selectedContact.wa_id;
    
    const template = templates.find(t => t.name === templateName);
    
    if (!confirmSend || confirmSend.id !== templateName) {
      setConfirmSend({ type: 'template', id: templateName, name: templateName, language });
      return;
    }

    setConfirmSend(null);
    setContactSending(targetContactId, true);
    try {
      // Desativa o agente de IA automaticamente ao enviar template manual
      if (selectedContact.ai_active) {
        await updateContactStatus(targetContactId, { ai_active: false });
      }
      
      // Dados do envio (mídia + variáveis): padrão salvo no CRM, com os campos
      // do contato ({{nome}}, {{pedido}}...) resolvidos para este contato.
      let components: any[] = [];
      if (template) {
        const schema = parseTemplateSchema(template.components);
        if (templateHasDynamicInputs(schema)) {
          const config = await resolveTemplateSendConfig(template);
          const issues = validateTemplateSendConfig(schema, config || createDefaultSendConfig(schema), selectedContact, template.status);
          if (issues.length > 0) {
            throw new Error(`${issues[0].message} Abra "Variáveis" no template para configurar.`);
          }
          components = buildTemplateComponents(schema, config || createDefaultSendConfig(schema), selectedContact);
        }
      }

      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { 
          action: 'sendTemplate', 
          to: targetWaId, 
          ...numberScopePatch(),
          templateName, 
          languageCode: language,
          components: components
        }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Erro ao enviar template pela Meta");
      toast({ title: "Template enviado!" });
      await fetchMessages(targetContactId);
    } catch (err: any) {
      toast({ title: "Erro ao enviar template", description: err.message, variant: "destructive" });
    } finally {
      setContactSending(targetContactId, false);
    }
  };

  const handleSaveTemplate = async (template: any) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'createTemplate', ...template }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Erro ao criar template na Meta");
      toast({ title: "Template enviado para aprovação!" });
      fetchData(false);

    } catch (err: any) {
      toast({ title: "Erro ao criar template", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (name: string) => {
    try {
      const { error } = await supabase.functions.invoke('meta-whatsapp-crm', {
        body: { action: 'deleteTemplate', name }
      });
      if (error) throw error;
      toast({ title: "Template excluído" });
      fetchData(false);

    } catch (err) {
      toast({ title: "Erro ao excluir", variant: "destructive" });
    }
  };

  const handleSaveContactMetadata = async (contactId: string, metadata: any) => {
    try {
      const { error } = await supabase.from('crm_contacts').update({ metadata }).eq('id', contactId);
      if (error) throw error;
      toast({ title: "Informações salvas!" });
      fetchContacts();
      if (selectedContact?.id === contactId) {
        setSelectedContact({ ...selectedContact, metadata });
      }
    } catch (err) {
      toast({ title: "Erro ao salvar informações", variant: "destructive" });
    }
  };

  const handleExportContacts = (format: 'csv' | 'vcard' = 'csv') => {
    if (format === 'csv') {
      const data = contacts.map(c => ({
        Nome: c.name || '',
        Telefone: c.wa_id || '',
        Status: c.status || '',
        Bio: c.metadata?.bio || '',
        Instagram: c.metadata?.instagram || '',
        Facebook: c.metadata?.facebook || '',
        Links: c.metadata?.links || ''
      }));
      const csv = [
        Object.keys(data[0]).join(','),
        ...data.map(row => Object.values(row).map(v => `"${v}"`).join(','))
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contatos_crm_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } else if (format === 'vcard') {
      const vcards = contacts.map(c => {
        return [
          'BEGIN:VCARD',
          'VERSION:3.0',
          `FN:${c.name || c.wa_id}`,
          `TEL;TYPE=CELL:${c.wa_id}`,
          `NOTE:${c.metadata?.bio || ''} | IG: ${c.metadata?.instagram || ''} | FB: ${c.metadata?.facebook || ''}`,
          `URL:${c.metadata?.links || ''}`,
          'END:VCARD'
        ].join('\n');
      }).join('\n');
      
      const blob = new Blob([vcards], { type: 'text/vcard' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contatos_crm_${new Date().toISOString().split('T')[0]}.vcf`;
      a.click();
    }
  };

  const handleImportContacts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const reader = new FileReader();

    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const contacts_to_import: any[] = [];

      if (fileName.endsWith('.vcf') || fileName.endsWith('.vcard')) {
        const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const vcardBlocks = normalizedContent.split(/BEGIN:VCARD/i).filter(block => block.trim());
        
        console.log(`vCard blocks found: ${vcardBlocks.length}`);

        for (const block of vcardBlocks) {
          const lines = block.split('\n');
          let currentContact: any = { metadata: {} };
          let foundName = false;
          let foundPhone = false;

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            if (/^FN[;:]/i.test(trimmedLine)) {
              currentContact.name = trimmedLine.split(':').slice(1).join(':').trim();
              foundName = true;
            } else if (/^N[;:]/i.test(trimmedLine) && !foundName) {
              const nameValue = trimmedLine.split(':').slice(1).join(':').trim();
              const parts = nameValue.split(';');
              currentContact.name = parts.filter(p => p).reverse().join(' ').trim();
              foundName = true;
            } else if (/^TEL[;:]/i.test(trimmedLine)) {
              const phoneValue = trimmedLine.split(':').slice(1).join(':').trim();
              const phone = phoneValue.replace(/\D/g, '');
              if (phone && phone.length >= 8) {
                currentContact.wa_id = phone;
                foundPhone = true;
              }
            } else if (trimmedLine.toUpperCase().startsWith('NOTE:')) {
              currentContact.metadata.bio = trimmedLine.substring(5).trim();
            } else if (trimmedLine.toUpperCase().startsWith('URL:')) {
              currentContact.metadata.links = trimmedLine.substring(4).trim();
            }
          }

          if (foundPhone) {
            if (!currentContact.name) currentContact.name = currentContact.wa_id;
            contacts_to_import.push(currentContact);
          }
        }
      } else {
        const lines = content.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.length < 1) return;
        
        const firstLine = lines[0];
        const delimiter = firstLine.includes(';') ? ';' : ',';
        
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/"/g, ''));
        const imported = lines.slice(1).map(line => {
          const values = line.split(delimiter).map(v => v.trim().replace(/"/g, ''));
          const obj: any = {};
          headers.forEach((h, i) => obj[h] = values[i]);
          return obj;
        });

        for (const contact of imported) {
          const phone = (contact.Telefone || contact.wa_id || contact.phone || contact.whatsapp || Object.values(contact)[0])?.toString();
          if (!phone) continue;
          
          const cleanPhone = phone.replace(/\D/g, '');
          if (cleanPhone.length < 8) continue;

          contacts_to_import.push({
            wa_id: cleanPhone,
            name: contact.Nome || contact.name || contact.full_name || cleanPhone,
            status: contact.Status || 'new',
            source_type: 'imported',
            metadata: {
              bio: contact.Bio || contact.bio,
              instagram: contact.Instagram || contact.instagram,
              facebook: contact.Facebook || contact.facebook,
              links: contact.Links || contact.links
            }
          });
        }
      }

      if (contacts_to_import.length === 0) {
        toast({ title: "Nenhum contato válido encontrado no arquivo", variant: "destructive" });
        return;
      }

      const batchSize = 100;
      let successCount = 0;
      
      toast({ title: `Importando ${contacts_to_import.length} contatos...` });

      const { data: { user: importUser } } = await supabase.auth.getUser();

      // Processamento em lotes maiores
      for (let i = 0; i < contacts_to_import.length; i += batchSize) {
        const batch = contacts_to_import.slice(i, i + batchSize).map(contact => ({
          wa_id: contact.wa_id,
          name: contact.name,
          user_id: importUser?.id,
          status: contact.status || 'new',
          source_type: 'imported',
          metadata: contact.metadata || {},
          last_interaction: null,
          ...numberScopePatch(),
        }));

        const { error } = await supabase.from('crm_contacts').upsert(batch, {
          onConflict: activeNumberIdRef.current ? 'wa_id,user_id,whatsapp_number_id' : 'wa_id,user_id',
        });
        if (!error) {
          successCount += batch.length;
          // Atualiza a lista periodicamente para feedback visual
          if (successCount % 500 === 0) fetchContacts();
        } else {
          console.error("Batch error:", error);
        }
      }

      toast({ title: `Importação concluída: ${successCount} contatos!` });
      fetchContacts();
    };
    reader.readAsText(file);
  };

  const openContactInfo = (contact: any) => {
    setContactToView(contact);
    setIsContactInfoOpen(true);
  };

  const openChat = (contact: any) => {
    setSelectedContact(contact);
    fetchMessages(contact.id);
    fetchScheduledMessages(contact.id);
    // Clear unread count for this contact
    setInboundTimestampsByContact(prev => ({ ...prev, [contact.id]: [] }));
    const readAt = new Date().toISOString();
    setContacts(prev => prev.map(c => (c.id === contact.id ? { ...c, last_read_at: readAt } : c)));
    supabase.from('crm_contacts').update({ last_read_at: readAt }).eq('id', contact.id).then(() => {});
  };

  // Kanban quick-preview popup state
  const [previewContact, setPreviewContact] = useState<any>(null);
  const [previewMessages, setPreviewMessages] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const openPreview = async (contact: any) => {
    setPreviewContact(contact);
    setPreviewMessages([]);
    setPreviewLoading(true);
    const { data } = await supabase
      .from('crm_messages')
      .select('*')
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setPreviewMessages((data || []).reverse());
    setPreviewLoading(false);
  };

  const fetchScheduledMessages = async (contactId: string) => {
    const { data } = await supabase
      .from('crm_scheduled_messages')
      .select('*')
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true });
    
    if (selectedContactRef.current?.id === contactId) {
      setScheduledMessages(data || []);
    }
  };

  const fetchAllScheduledMessages = async () => {
    const { data, error } = await supabase
      .from('crm_scheduled_messages')
      .select(`
        *,
        crm_contacts (
          name,
          wa_id
        )
      `)
      .order('scheduled_for', { ascending: true });
    
    if (error) {
      console.error("Error fetching all scheduled messages:", error);
      return;
    }
    setAllScheduledMessages(data || []);
  };

  const handleSaveFlow = async (flow: any) => {
    setSaving(true);
    setFlowSaveOverlay({ open: true, done: false });
    try {
      const { id, ...flowData } = flow;
      
      if (!flowData.name || flowData.name.trim() === '') {
        throw new Error("O fluxo precisa de um nome.");
      }

      const payload = {
        name: flowData.name,
        trigger_type: flowData.trigger_type || 'manual',
        trigger_keywords: flowData.trigger_keywords || [],
        trigger_tag: flowData.trigger_tag || null,
        is_active: flowData.is_active !== false,
        nodes: flowData.nodes || [],
        edges: flowData.edges || [],
        updated_at: new Date().toISOString()
      };

      let result;
      if (id) {
        result = await supabase
          .from('crm_flows')
          .update(payload)
          .eq('id', id);
      } else {
        result = await supabase
          .from('crm_flows')
          .insert([payload])
          .select();
      }

      if (result.error) {
        throw result.error;
      }

      // Recarrega SOMENTE os fluxos (fetchData completo levava ~3s e o fluxo
      // reaberto vinha desatualizado).
      const { data: freshFlows } = await supabase
        .from('crm_flows')
        .select('*, crm_flow_steps(*)');
      if (freshFlows) setFlows(freshFlows);

      setFlowSaveOverlay({ open: true, done: true });
      toast({ title: "Fluxo salvo com sucesso!" });
      setIsFlowEditorOpen(false);
      setEditingFlow(null);
      // Pequena pausa só para o estado "Fluxo salvo!" ser percebido.
      await new Promise((resolve) => setTimeout(resolve, 700));
      setFlowSaveOverlay({ open: false, done: false });
    } catch (err: any) {
      setFlowSaveOverlay({ open: false, done: false });
      toast({ 
        title: "Erro ao salvar fluxo", 
        description: err.message || "Ocorreu um erro inesperado.", 
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };


  const handleDuplicateFlow = async (flow: any) => {
    setSaving(true);
    try {
      const { id, created_at, updated_at, ...flowData } = flow;
      
      const nodeMap: Record<string, string> = {};
      const newNodes = (flowData.nodes || []).map((node: any) => {
        const newId = `${node.type}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        nodeMap[node.id] = newId;
        return { ...node, id: newId };
      });

      const newEdges = (flowData.edges || []).map((edge: any) => ({
        ...edge,
        id: `e_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        source: nodeMap[edge.source] || edge.source,
        target: nodeMap[edge.target] || edge.target
      }));

      const newFlow = {
        name: `${flowData.name} (Cópia)`,
        trigger_type: flowData.trigger_type || 'manual',
        trigger_keywords: flowData.trigger_keywords || [],
        trigger_tag: flowData.trigger_tag || null,
        is_active: false,
        nodes: newNodes,
        edges: newEdges,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('crm_flows')
        .insert([newFlow])
        .select();

      if (error) {
        throw error;
      }
      
      toast({ title: "Fluxo duplicado com sucesso!" });
      fetchData(false);

      fetchData(false);

    } catch (err: any) {
      console.error("Erro ao duplicar fluxo:", err);
      toast({ 
        title: "Erro ao duplicar fluxo", 
        description: err.message || "Verifique se há campos obrigatórios faltando ou conflitos.", 
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };



  const getWindowInfo = (lastInbound: string) => {
    if (!lastInbound) return { label: "Janela aberta", isExpired: false };

    const last = new Date(lastInbound).getTime();
    if (!Number.isFinite(last)) return { label: "Janela aberta", isExpired: false };

    const DAY = 24 * 60 * 60 * 1000;
    const remainingMs = last + DAY - Date.now();

    if (remainingMs <= 0) {
      return { label: "Janela expirada", isExpired: true };
    }

    const totalMinutes = Math.floor(remainingMs / (60 * 1000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // Exibição exata: "Xh YYm restantes" ou "YYm restantes" quando <1h
    const label =
      hours > 0
        ? `${hours}h ${minutes.toString().padStart(2, "0")}m restantes`
        : `${minutes}m restantes`;

    return { label, isExpired: false };
  };

  const getStatusColor = (status: string) => {
    const statusObj = kanbanStatuses.find(s => s.value === status);
    if (statusObj) {
      switch (statusObj.color) {
        case 'blue': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
        case 'yellow': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
        case 'purple': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
        case 'green': return 'bg-green-500/10 text-green-500 border-green-500/20';
        case 'red': return 'bg-red-500/10 text-red-500 border-red-500/20';
        case 'orange': return 'bg-orange-500 text-white border-orange-600 animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]';
        case 'indigo': return 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20';
        case 'pink': return 'bg-pink-500/10 text-pink-500 border-pink-500/20';
        default: return 'bg-gray-500/10 text-gray-500';
      }
    }
    
    switch (status) {
      case 'new': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'responded': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'qualified': return 'bg-purple-500/10 text-purple-500 border-purple-500/20';
      case 'closed': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'lost': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'human': return 'bg-orange-500 text-white border-orange-600 animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]';
      default: return 'bg-gray-500/10 text-gray-500';
    }
  };

  const getStatusLabel = (status: string) => {
    const statusObj = kanbanStatuses.find(s => s.value === status);
    return statusObj ? statusObj.label : status.toUpperCase();
  };

  // Mantém a tela de carregamento até o fetch inicial terminar, mesmo que
  // exista cache local — evita "piscar" UI vazia antes dos contatos chegarem.
  if (loading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#0c1317] relative overflow-hidden">
        {/* Efeito de luzes e partículas ao fundo */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#00a884] opacity-10 blur-[120px] animate-pulse"></div>
          <div className="absolute top-0 left-0 w-full h-full opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#00a884] via-transparent to-transparent"></div>
        </div>

        <div className="relative z-10 flex flex-col items-center">
          {/* Logo do WhatsApp com efeito de preenchimento e brilho */}
          <div className="relative w-24 h-24 mb-8 group">
            {/* Sombra pulsante */}
            <div className="absolute inset-0 bg-[#00a884] rounded-full blur-xl opacity-20 animate-pulse"></div>
            
            <svg 
              viewBox="0 0 24 24" 
              className="w-full h-full drop-shadow-[0_0_15px_rgba(0,168,132,0.5)]"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient id="fillGradient" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="#00a884">
                    <animate attributeName="offset" values="0;1;0" dur="3s" repeatCount="indefinite" />
                  </stop>
                  <stop offset="0%" stopColor="transparent">
                    <animate attributeName="offset" values="0;1;0" dur="3s" repeatCount="indefinite" />
                  </stop>
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
              </defs>
              <path 
                fill="none" 
                stroke="#00a884" 
                strokeWidth="0.5"
                d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.393 0 12.03c0 2.123.554 4.197 1.606 6.01L0 24l6.117-1.605a11.815 11.815 0 005.928 1.583h.005c6.632 0 12.028-5.391 12.03-12.03a11.785 11.785 0 00-3.502-8.498"
              />
              <path 
                fill="url(#fillGradient)"
                filter="url(#glow)"
                d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.393 0 12.03c0 2.123.554 4.197 1.606 6.01L0 24l6.117-1.605a11.815 11.815 0 005.928 1.583h.005c6.632 0 12.028-5.391 12.03-12.03a11.785 11.785 0 00-3.502-8.498"
              />
            </svg>

            {/* Partículas flutuantes ao redor do ícone */}
            <div className="absolute -top-4 -right-4 w-2 h-2 bg-[#00a884] rounded-full animate-ping opacity-75"></div>
            <div className="absolute -bottom-2 -left-4 w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce opacity-50" style={{ animationDelay: '1s' }}></div>
            <div className="absolute top-1/2 -right-8 w-1 h-1 bg-[#00a884] rounded-full animate-pulse opacity-40"></div>
          </div>

          {/* Texto de carregamento com efeito de gradiente e brilho */}
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold tracking-tighter text-white/90 animate-pulse">
              Iniciando <span className="text-[#00a884]">ZAPMRO</span>
            </h2>
            
            <div className="flex items-center justify-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00a884] animate-bounce" style={{ animationDelay: '0s' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#00a884] animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              <div className="w-1.5 h-1.5 rounded-full bg-[#00a884] animate-bounce" style={{ animationDelay: '0.4s' }}></div>
            </div>

            <p className="text-white/40 text-xs uppercase tracking-widest font-medium">
              Carregando conexões oficiais da Meta
            </p>
          </div>
        </div>

        {/* Efeito de quebra/construção lateral (elementos decorativos) */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-[#00a884]/10 to-transparent rotate-45 transform translate-x-1/2 -translate-y-1/2 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-[#00a884]/10 to-transparent rotate-45 transform -translate-x-1/2 translate-y-1/2 blur-3xl"></div>
      </div>
    );
  }


  // Gate: usuário precisa conectar o WhatsApp antes de acessar conversas/CRM
  const isWhatsAppConnected = whatsAppConnectionConfirmed || !!(metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id);

  // Multi-WhatsApp habilitado: escolhe qual número abrir antes das conversas.
  // Seletor de WhatsApp: aparece para todos os cadastros (mesmo com 1 número liberado).
  const multiNumberEnabled = maxWhatsAppNumbers >= 1;
  const handleSwitchNumber = () => {
    if (!currentUserId) return;
    persistActiveNumberId(currentUserId, null);
    activeNumberIdRef.current = null;
    setActiveWhatsAppNumberId(null);
    // Nada da caixa anterior pode sobrar na tela ou no cache.
    setContacts([]);
    setSelectedContact(null);
    setChatMessages([]);
    messagesCacheRef.current = {};
    contactsSeededRef.current = false;
    lastContactsSyncRef.current = null;
    setActiveNumberId(null);
    setForceNumberSelector(true);
  };
  // Se o cadastro já tem números salvos, NUNCA forçamos o Embedded Signup:
  // mostramos o seletor para o usuário escolher um número existente (ou
  // conectar outro, se quiser). Isso cobre o caso de desconectar um número
  // estando em um cadastro com dois números.
  const hasSavedNumbers = userNumbersCount > 0;
  if (
    !loading &&
    multiNumberEnabled &&
    currentUserId &&
    (forceNumberSelector || !activeNumberId || (!isWhatsAppConnected && hasSavedNumbers))
  ) {
    return (
      <WhatsAppNumberSelector
        userId={currentUserId}
        maxNumbers={maxWhatsAppNumbers}
        onSelected={(record: WhatsAppNumberRecord) => {
          // Fixa o escopo ANTES de qualquer consulta para não misturar caixas.
          activeNumberIdRef.current = record.id;
          setForceNumberSelector(false);
          setActiveWhatsAppNumberId(record.id);
          setContacts([]);
          setSelectedContact(null);
          setChatMessages([]);
          messagesCacheRef.current = {};
          contactsSeededRef.current = false;
          lastContactsSyncRef.current = null;
          setActiveNumberId(record.id);
          // Reflete de imediato as credenciais do número escolhido para o gate
          // de conexão não voltar a aparecer enquanto o reload não terminar.
          setMetaSettings((prev: any) => ({
            ...prev,
            meta_access_token: record.meta_access_token || '',
            meta_phone_number_id: record.meta_phone_number_id || '',
            meta_waba_id: record.meta_waba_id || '',
            meta_display_phone_number: record.meta_display_phone_number || '',
            meta_verified_name: record.meta_verified_name || '',
          }));
          setWhatsAppConnectionConfirmed(
            !!(record.meta_access_token && record.meta_phone_number_id && record.meta_waba_id)
          );
          void fetchData(true);
        }}
        onConnectNew={startEmbeddedSignup}
      />
    );
  }
  if (!loading && !isWhatsAppConnected) {
    return (
      <div className="min-h-screen w-full flex flex-col lg:flex-row items-center justify-center gap-6 bg-gradient-to-br from-[#0c1317] via-[#111b21] to-[#0c1317] p-6">
        <div className="max-w-xl w-full bg-[#202c33] rounded-2xl shadow-2xl border border-white/5 p-8 text-center order-2 lg:order-1">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#00a884]/10 flex items-center justify-center">
            <MessageSquare className="w-10 h-10 text-[#00a884]" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">Conecte seu WhatsApp</h1>
          <p className="text-white/60 mb-8 text-sm leading-relaxed">
            Para começar a usar o CRM, conversas e disparos, você precisa primeiro
            conectar uma conta oficial do WhatsApp Business através do Facebook.
            É rápido e seguro — usamos o Embedded Signup oficial da Meta.
          </p>
          <button
            onClick={startEmbeddedSignup}
            className="w-full h-14 rounded-xl bg-[#1877F2] hover:bg-[#1465c8] text-white font-bold text-base flex items-center justify-center gap-3 transition-all shadow-lg shadow-[#1877F2]/30"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            Conectar com Facebook
          </button>
          <p className="text-[11px] text-white/30 mt-6">
            Ao conectar, você autoriza nosso app (Tech Provider Meta) a gerenciar mensagens em nome do seu número WhatsApp Business.
          </p>
          <div className="mt-6 space-y-3 text-left">
            <FirstTutorialVideo
              orderIndex={0}
              headline="Você precisa estar verificado"
              subline="Assista o vídeo 01 — entenda por que a verificação da Meta é obrigatória."
            />
            <FirstTutorialVideo
              orderIndex={2}
              headline="Como conectar o WhatsApp"
              subline="Assista o vídeo 03 — passo a passo para conectar sua conta oficial."
            />
            <a
              href="/vendas/tutoriais"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center h-11 leading-[44px] rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm transition"
            >
              Ver todos os tutoriais
            </a>
          </div>
        </div>

        {/* Nuvem de conversa — suporte para quem não tem CNPJ / portfólio verificado */}
        <button
          type="button"
          onClick={() =>
            openWhatsAppChat(
              "5551992835863",
              "Vim pelo ZAPMRO gostaria de saber sobre a solução para quem não tem CNPJ ou quem não esta com portifolio verificado"
            )
          }
          className="order-1 lg:order-2 relative w-full max-w-xs lg:max-w-[260px] text-left rounded-2xl bg-orange-500 hover:bg-orange-600 transition-colors text-white p-4 shadow-xl shadow-orange-500/20 animate-pulse-slow"
        >
          <span className="hidden lg:block absolute top-8 -left-2 w-4 h-4 rotate-45 bg-orange-500" />
          <span className="lg:hidden absolute -bottom-2 left-8 w-4 h-4 rotate-45 bg-orange-500" />
          <span className="flex items-start gap-2">
            <MessageSquare className="w-5 h-5 shrink-0 mt-0.5" />
            <span className="text-sm font-semibold leading-snug">
              Não tens CNPJ para utilizar? Não tens o portifólio verificado?{" "}
              <span className="underline">Entre em contato conosco no WhatsApp.</span>
            </span>
          </span>
        </button>

      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className={`h-[100dvh] w-full flex overflow-hidden bg-[#f0f2f5] dark:bg-[#0c1317] ${crmTheme === 'light' ? 'crm-theme-light' : ''}`}>
        <AnnouncementPopup />
        {whatsappDisconnected && (
          <div className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white px-4 py-3 shadow-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>
                Seu WhatsApp foi desconectado da Meta (erro 133010 — Account not registered).
                Você precisa reconectar seu WhatsApp no Meta Business Manager (registrar o número novamente com o PIN de 2 etapas) para voltar a enviar mensagens e disparar fluxos.
              </span>
            </div>
            <button
              onClick={() => setWhatsappDisconnected(false)}
              className="text-white/80 hover:text-white text-xs underline flex-shrink-0"
            >
              Fechar
            </button>
          </div>
        )}
        <Sidebar className="border-r border-border/50 shadow-xl bg-[#111b21] dark:bg-[#111b21] text-white">
           <SidebarHeader className="p-4 border-b border-white/5 flex items-center justify-between gap-2 bg-[#202c33]">
             <Link to="/vendas" className="flex-1 flex items-center justify-center">
               <Logo size="sm" />
             </Link>
             <div className="flex items-center gap-1 shrink-0">
               <button
                 type="button"
                 onClick={() => setCrmTheme('light')}
                 title="Tema claro"
                 aria-label="Ativar tema claro"
                 className={`p-1.5 rounded-md transition-colors ${crmTheme === 'light' ? 'bg-[#25D366]/20 text-[#25D366]' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
               >
                 <Sun className="w-3.5 h-3.5" />
               </button>
               <button
                 type="button"
                 onClick={() => setCrmTheme('dark')}
                 title="Tema escuro"
                 aria-label="Ativar tema escuro"
                 className={`p-1.5 rounded-md transition-colors ${crmTheme === 'dark' ? 'bg-[#00a884]/20 text-[#00a884]' : 'text-white/50 hover:text-white hover:bg-white/10'}`}
               >
                 <Moon className="w-3.5 h-3.5" />
               </button>
             </div>
           </SidebarHeader>
          <SidebarContent className="bg-[#111b21]">
            <SidebarGroup>
              <SidebarGroupLabel className="px-4 text-[10px] uppercase tracking-wider text-white/40 font-bold">Navegação</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {[
                    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
                    { id: 'contacts', label: 'Conversas', icon: MessageSquare },
                     { id: 'contact-list', label: 'Contatos', icon: Users },
                    { id: 'broadcast', label: 'Disparador', icon: Zap },
                    { id: 'scheduling', label: 'Agendamentos', icon: Calendar },
                    { id: 'flows', label: 'Fluxos', icon: GitBranch },
                    { id: 'templates', label: 'Templates', icon: FileText },
                     { id: 'ai-agent', label: 'Agente IA', icon: Bot },
                     { id: 'tutorials', label: 'Tutoriais', icon: BookOpen },
                     
                     { id: 'help', label: 'Ajuda', icon: LucideIcons.HelpCircle },
                    { id: 'settings', label: 'Ajustes', icon: Settings },
                  ].map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton 
                        isActive={activeTab === item.id} 
                        onClick={() => setActiveTab(item.id)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 rounded-none transition-all duration-300 relative group",
                          activeTab === item.id 
                            ? "bg-[#2a3942] text-[#00a884] shadow-inner" 
                            : "text-white/70 hover:bg-[#202c33] hover:text-white"
                        )}
                      >
                        {activeTab === item.id && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#00a884] shadow-[0_0_10px_rgba(0,168,132,0.5)]" />
                        )}
                        <item.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", activeTab === item.id ? "text-[#00a884]" : "text-white/50")} />
                        <span className="font-semibold text-sm">{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t border-white/5 p-4 bg-[#111b21]">
            <Button
              variant="ghost"
              className="w-full justify-start text-white/80 hover:bg-white/5 hover:text-white transition-colors mb-2"
              onClick={async () => {
                const { data: { user } } = await supabase.auth.getUser();
                setMyDataEmail(user?.email || '');
                setMyDataNewEmail(user?.email || '');
                setMyDataNewPassword('');
                setMyDataConfirmPassword('');
                setIsMyDataOpen(true);
              }}
            >
              <UserCog className="mr-2 h-4 w-4" /> Meus Dados
            </Button>
            <Button 
              variant="ghost" 
              className="w-full justify-start text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors" 
               onClick={async () => { await supabase.auth.signOut(); navigate('/crm/login'); }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Sair
            </Button>
          </SidebarFooter>
        </Sidebar>

        <Dialog open={isMyDataOpen} onOpenChange={setIsMyDataOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Meus Dados</DialogTitle>
              <DialogDescription>
                Veja e altere o email e a senha da sua conta no CRM.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Email atual</Label>
                <Input value={myDataEmail} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="my-data-new-email">Novo email (opcional)</Label>
                <Input
                  id="my-data-new-email"
                  type="email"
                  value={myDataNewEmail}
                  onChange={(e) => setMyDataNewEmail(e.target.value)}
                  placeholder="seu@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="my-data-new-password">Nova senha (opcional)</Label>
                <div className="relative">
                  <Input
                    id="my-data-new-password"
                    type={myDataShowPassword ? 'text' : 'password'}
                    value={myDataNewPassword}
                    onChange={(e) => setMyDataNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                  <button
                    type="button"
                    onClick={() => setMyDataShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {myDataShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="my-data-confirm-password">Confirmar nova senha</Label>
                <Input
                  id="my-data-confirm-password"
                  type={myDataShowPassword ? 'text' : 'password'}
                  value={myDataConfirmPassword}
                  onChange={(e) => setMyDataConfirmPassword(e.target.value)}
                  placeholder="Repita a nova senha"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsMyDataOpen(false)} disabled={myDataSaving}>
                Cancelar
              </Button>
              <Button
                disabled={myDataSaving}
                onClick={async () => {
                  const updates: { email?: string; password?: string } = {};
                  const newEmail = myDataNewEmail.trim();
                  if (newEmail && newEmail !== myDataEmail) updates.email = newEmail;
                  if (myDataNewPassword) {
                    if (myDataNewPassword.length < 6) {
                      toast({ title: 'Senha muito curta', description: 'A senha precisa ter pelo menos 6 caracteres.', variant: 'destructive' });
                      return;
                    }
                    if (myDataNewPassword !== myDataConfirmPassword) {
                      toast({ title: 'Senhas não conferem', description: 'A confirmação da senha não bate.', variant: 'destructive' });
                      return;
                    }
                    updates.password = myDataNewPassword;
                  }
                  if (!updates.email && !updates.password) {
                    toast({ title: 'Nada para atualizar', description: 'Altere o email ou a senha para salvar.' });
                    return;
                  }
                  setMyDataSaving(true);
                  const { error } = await supabase.auth.updateUser(updates);
                  setMyDataSaving(false);
                  if (error) {
                    toast({ title: 'Erro ao atualizar', description: error.message, variant: 'destructive' });
                    return;
                  }
                  toast({
                    title: 'Dados atualizados',
                    description: updates.email
                      ? 'Confirme a alteração de email pelo link enviado para sua caixa de entrada.'
                      : 'Suas informações foram salvas com sucesso.',
                  });
                  setMyDataNewPassword('');
                  setMyDataConfirmPassword('');
                  setIsMyDataOpen(false);
                }}
              >
                {myDataSaving ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SidebarInset className="flex flex-col flex-1 h-full overflow-hidden bg-[#f0f2f5] dark:bg-[#0c1317]">
          <header className="min-h-[64px] h-auto md:h-16 border-b border-border/50 flex flex-wrap items-center px-4 md:px-6 bg-[#f0f2f5] dark:bg-[#202c33] z-10 shrink-0 justify-between gap-2 py-2 shadow-sm">
            <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
              <SidebarTrigger className="hover:bg-muted shrink-0" />
              <div className="h-4 w-px bg-border/50 mx-1 hidden md:block" />
               <h1 className="font-bold text-xs md:text-base text-foreground tracking-tight truncate flex items-center gap-2">
                  {activeTab === 'contact-list' ? 'Contatos' : 
                   activeTab === 'contacts' ? 'Conversas' : 
                   activeTab === 'google-synced' ? 'Sincronizados Google' :
                   activeTab === 'tutorials' ? 'Tutoriais' :
                   activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
                 {userRole === 'super_admin' && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="ml-2 h-7 px-2 text-[10px] border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                     onClick={() => navigate('/admincentral')}
                   >
                     <ShieldCheck className="w-3 h-3 mr-1" /> ADMIN CENTRAL
                   </Button>
                 )}
               </h1>
            </div>
            {(activeTab === 'contacts' || activeTab === 'dashboard') && (
              <div className="flex items-center gap-1.5 md:gap-3">
                {multiNumberEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSwitchNumber}
                    title="Trocar de WhatsApp"
                    className="font-black h-8 px-2 md:px-3 text-[9px] md:text-xs rounded-full bg-white dark:bg-[#111b21] hover:bg-muted transition-all active:scale-95 shadow-sm whitespace-nowrap"
                  >
                    <LucideIcons.RefreshCw className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    TROCAR WHATSAPP
                  </Button>
                )}
                {activeTab === 'contacts' && (<><Button 
                  variant={activeFlowsView ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => { setActiveFlowsView(!activeFlowsView); setKanbanView(false); }} 
                  className={cn(
                    "font-black h-8 px-2 md:px-3 text-[9px] md:text-xs rounded-full transition-all active:scale-95 whitespace-nowrap", 
                    activeFlowsView 
                      ? "bg-[#00a884] text-white hover:bg-[#008f6f] shadow-md" 
                      : "bg-white dark:bg-[#111b21] hover:bg-muted"
                  )}
                >
                  <GitBranch className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                  FLUXOS
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => { setKanbanView(!kanbanView); setActiveFlowsView(false); }} 
                  className="font-black h-8 px-2 md:px-3 text-[9px] md:text-xs rounded-full bg-white dark:bg-[#111b21] hover:bg-muted transition-all active:scale-95 shadow-sm whitespace-nowrap"
                >
                  {kanbanView ? <MessageSquare className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" /> : <BarChart3 className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />}
                  {kanbanView ? 'LISTA' : 'CRM'}
                </Button></>)}
              </div>
            )}
          </header>
          
          <main className="flex-1 overflow-hidden relative flex flex-col bg-[#f0f2f5] dark:bg-[#0c1317] h-full">
            <div className={cn("flex-1 h-full overflow-hidden", activeTab !== 'dashboard' && "hidden")}>
              {activeTab === 'dashboard' && (
                <ScrollArea className="h-full w-full">
                  <div className="p-4 md:p-8">
                    <div className="max-w-7xl mx-auto space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                      {/* Bem-vindo e Logo ZAPMRO com ícone giratório no O */}
                      <div className="flex flex-col items-center justify-center py-8 md:py-12 text-center space-y-2 relative overflow-hidden bg-[#0c1317] rounded-3xl border border-white/5 shadow-2xl">
                        <div className="absolute inset-0 z-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#00a884] via-transparent to-transparent blur-3xl"></div>
                        
                        <div className="relative z-10 space-y-0 px-4">
                          <h2 className="text-base md:text-xl font-bold tracking-tight text-white/60 mb-2">
                            Seja bem vindo(a)
                          </h2>
                          <div className="flex flex-col items-center">
                            <div className="flex items-center gap-0 leading-none">
                              <span className="text-5xl md:text-7xl font-black text-[#00a884] drop-shadow-[0_0_15px_rgba(0,168,132,0.5)] tracking-tighter">ZAPMR</span>
                              <div className="relative w-[1em] h-[1em] flex items-center justify-center text-5xl md:text-7xl">
                                <div className="absolute inset-0 bg-[#00a884] rounded-full blur-[12px] opacity-25 animate-pulse"></div>
                                <div className="w-full h-full flex items-center justify-center animate-[spin_10s_linear_infinite]">
                                  <svg 
                                    viewBox="0 0 24 24" 
                                    className="w-full h-full drop-shadow-[0_0_10px_rgba(0,168,132,0.8)]"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path 
                                      fill="currentColor"
                                      className="text-[#00a884]"
                                      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .018 5.393 0 12.03c0 2.123.554 4.197 1.606 6.01L0 24l6.117-1.605a11.815 11.815 0 005.928 1.583h.005c6.632 0 12.028-5.391 12.03-12.03a11.785 11.785 0 00-3.502-8.498"
                                    />
                                  </svg>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs md:text-sm font-bold tracking-[0.4em] text-white/40 uppercase ml-2">Cloud</span>
                              <div className="h-[2px] w-8 bg-[#00a884] rounded-full shadow-[0_0_5px_#00a884]" />
                            </div>
                          </div>
                        </div>
                      </div>

                       <div className="space-y-4">
                        <div className="flex items-center justify-between px-1">
                          <div className="space-y-0">
                            <h3 className="text-lg md:text-2xl font-black tracking-tight text-foreground uppercase">Monitoramento Digital</h3>
                            <p className="text-muted-foreground text-[10px] md:text-xs uppercase tracking-widest font-bold opacity-50">Dados em tempo real</p>
                          </div>
                          <Button variant="ghost" size="sm" className="rounded-xl h-9 md:h-10 text-[10px] md:text-xs font-black border border-white/5 hover:bg-[#00a884]/10 hover:text-[#00a884] transition-all px-3" onClick={() => fetchData(false)}>
                            <RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> SYNC
                          </Button>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
                          {/* Todas conversas atendidas */}
                          <Card 
                            className="relative overflow-hidden group hover:scale-[1.01] transition-all border border-white/5 bg-[#0c1317] cursor-pointer shadow-xl rounded-2xl p-1"
                            onClick={() => {
                              setStatusFilter('all');
                              setActiveTab('contacts');
                            }}
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <CardHeader className="flex flex-row items-center justify-between pb-1 px-5 pt-5">
                              <CardDescription className="font-black text-[11px] md:text-xs uppercase tracking-[0.2em] text-blue-400/80">Base Contatos</CardDescription>
                              <Users className="w-5 h-5 text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                              <div className="text-4xl md:text-6xl font-black tracking-tighter text-white font-mono">{contacts.length}</div>
                              <div className="mt-3 h-1.5 w-full bg-blue-500/10 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 shadow-[0_0_10px_#3b82f6] w-full" />
                              </div>
                            </CardContent>
                          </Card>

                          {/* Conversas 24h Grátis */}
                          <Card 
                            className="relative overflow-hidden group hover:scale-[1.01] transition-all border border-white/5 bg-[#0c1317] cursor-pointer shadow-xl rounded-2xl p-1"
                            onClick={() => handleOpenMetricsList('active')}
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <CardHeader className="flex flex-row items-center justify-between pb-1 px-5 pt-5">
                              <CardDescription className="font-black text-[11px] md:text-xs uppercase tracking-[0.2em] text-emerald-400/80">Ativos (24h)</CardDescription>
                              <Zap className="w-5 h-5 text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                              <div className="text-4xl md:text-6xl font-black tracking-tighter text-white font-mono">{conversationStats.activeWindow24h}</div>
                              <div className="mt-3 h-1.5 w-full bg-emerald-500/10 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 shadow-[0_0_10px_#10b981] transition-all duration-1000" style={{ width: `${Math.min(100, (conversationStats.activeWindow24h / (contacts.length || 1)) * 100)}%` }} />
                              </div>
                            </CardContent>
                          </Card>

                          {/* Conversas Pagas Total */}
                          <Card 
                            className="relative overflow-hidden group hover:scale-[1.01] transition-all border border-white/5 bg-[#0c1317] cursor-pointer shadow-xl rounded-2xl p-1"
                            onClick={() => handleOpenMetricsList('paid')}
                          >
                            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <CardHeader className="flex flex-row items-center justify-between pb-1 px-5 pt-5">
                              <CardDescription className="font-black text-[11px] md:text-xs uppercase tracking-[0.2em] text-orange-400/80">Meta (Mês)</CardDescription>
                              <DollarSign className="w-5 h-5 text-orange-500 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
                            </CardHeader>
                            <CardContent className="px-5 pb-5">
                              <div className="flex items-baseline gap-1.5">
                                <div className="text-3xl md:text-5xl font-black tracking-tighter text-orange-500 font-mono">
                                  R$ {(conversationStats.paidThisMonth * CONVERSATION_COST).toFixed(2).replace('.', ',')}
                                </div>
                              </div>
                              <div className="mt-3 h-1.5 w-full bg-orange-500/10 rounded-full overflow-hidden">
                                <div className="h-full bg-orange-500 shadow-[0_0_10px_#f97316] w-1/3" />
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              )}
            </div>

            {/* Conversas */}
            <div className={cn("flex-1 h-full overflow-hidden", activeTab !== 'contacts' && "hidden")}>
              {activeTab === 'contacts' && (
              <div className="flex-1 flex overflow-hidden h-full min-h-0">
                {activeFlowsView ? (
                  <div className="flex-1 overflow-y-auto p-4 bg-muted/5">
                    <div className="max-w-5xl mx-auto space-y-4">
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h2 className="text-xl font-bold tracking-tight">Fluxos em Andamento</h2>
                          <p className="text-muted-foreground text-sm">Contatos que estão interagindo com automações agora.</p>
                        </div>
                        <Badge variant="outline" className="bg-[#00a884]/5 text-[#00a884] border-[#00a884]/20 font-black px-3 py-1">
                          {activeFlowContacts.length} ATIVOS
                        </Badge>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {activeFlowContacts.length === 0 ? (
                          <div className="py-20 text-center bg-card rounded-2xl border-2 border-dashed border-muted">
                            <GitBranch className="w-12 h-12 mx-auto text-muted-foreground opacity-20 mb-4" />
                            <h3 className="text-lg font-medium">Nenhum fluxo ativo no momento</h3>
                            <p className="text-sm text-muted-foreground">Novos fluxos aparecerão aqui conforme os gatilhos forem acionados.</p>
                          </div>
                        ) : (
                          activeFlowContacts.map(contact => {
                            const flow = flows.find(f => f.id === contact.current_flow_id);
                            return (
                              <Card key={contact.id} className="overflow-hidden border shadow-sm hover:shadow-md transition-shadow rounded-xl">
                                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                  <div className="flex items-center gap-4 flex-1 min-w-0">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
                                      <User className="w-6 h-6 text-primary" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-bold text-sm md:text-base truncate">{contact.name || contact.wa_id}</h4>
                                        <Badge className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20 border-none">
                                          {flow?.name || 'Fluxo Desconhecido'}
                                        </Badge>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                          <div className={cn("w-1.5 h-1.5 rounded-full animate-ping", contact.flow_state === 'error' ? "bg-red-500" : "bg-green-500")} />
                                          <span className="capitalize font-medium">{contact.flow_state}</span>
                                        </div>
                                        {contact.flow_state === 'waiting_response' && contact.last_flow_interaction && (() => {
                                          const mins = Number(contact.flow_timeout_minutes);
                                          const base = new Date(contact.last_flow_interaction).getTime();
                                          const elapsed = Math.max(0, Math.floor((now - base) / 1000));
                                          const eh = Math.floor(elapsed / 3600);
                                          const em = Math.floor((elapsed % 3600) / 60);
                                          const es = elapsed % 60;
                                          const elapsedStr = eh > 0 ? `${eh}h ${em}m` : `${em}m ${es}s`;
                                          if (Number.isFinite(mins) && mins > 0) {
                                            const remaining = Math.max(0, mins * 60 - elapsed);
                                            const rm = Math.floor(remaining / 60);
                                            const rs = remaining % 60;
                                            return (
                                              <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-500 tabular-nums">
                                                <Clock className="w-3 h-3" />
                                                Aguardando resposta: {elapsedStr} (restam {rm}m {rs}s de {mins}m)
                                              </div>
                                            );
                                          }
                                          return (
                                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-500 tabular-nums">
                                              <Clock className="w-3 h-3" />
                                              Aguardando resposta há {elapsedStr}
                                            </div>
                                          );
                                        })()}
                                        {contact.next_execution_time && (
                                          <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary tabular-nums">
                                            <Clock className="w-3 h-3" />
                                            Próxima ação em: {(() => {
                                              const next = new Date(contact.next_execution_time).getTime();
                                              const diff = Math.max(0, Math.floor((next - now) / 1000));
                                              return diff > 0 ? `${Math.floor(diff / 60)}m ${diff % 60}s` : 'Processando...';
                                            })()}
                                          </div>
                                        )}
                                        {contact.last_flow_interaction && (
                                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                            <CalendarClock className="w-3 h-3" />
                                            Última interação: {new Date(contact.last_flow_interaction).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      className="h-9 px-4 font-bold border-[#00a884]/20 text-[#00a884] hover:bg-[#00a884]/5 rounded-xl transition-all"
                                      onClick={() => {
                                        openChat(contact);
                                        setActiveFlowsView(false);
                                      }}
                                    >
                                      VER CONVERSA
                                    </Button>
                                    <Button 
                                      variant="destructive" 
                                      size="sm" 
                                      className="h-9 px-4 font-bold shadow-sm"
                                      onClick={() => handleStopFlow(contact.id)}
                                    >
                                      <StopCircle className="w-4 h-4 mr-2" />
                                      PARAR FLUXO
                                    </Button>
                                  </div>
                                </div>
                              </Card>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : kanbanView ? (
                  <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden">
                  <div className="p-3 border-b border-border/30 bg-white dark:bg-[#111b21] flex items-center gap-2 shrink-0">
                    <div className="relative flex-1 max-w-md">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Pesquisar contato por nome ou número..."
                        value={kanbanSearch}
                        onChange={e => setKanbanSearch(e.target.value)}
                        className="pl-10 h-9 bg-[#f0f2f5] dark:bg-[#202c33] border-none rounded-lg text-sm"
                      />
                    </div>
                    {kanbanSearch && (
                      <Button size="sm" variant="ghost" onClick={() => setKanbanSearch('')}>Limpar</Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-9 w-9 p-0"
                      onClick={() => setKanbanSettingsOpen(true)}
                      title="Configurar visualização"
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                  </div>
                  <div
                    ref={kanbanScrollRef}
                    onDragOver={handleKanbanDragOver}
                    onDragLeave={stopKanbanAutoScroll}
                    onDrop={stopKanbanAutoScroll}
                    onDragEnd={stopKanbanAutoScroll}
                    className="flex-1 overflow-x-scroll overflow-y-hidden p-3 md:p-4 flex gap-3 md:gap-4 bg-muted/5 snap-x relative group/kanban kanban-scroll"
                    style={{ fontSize: `${kanbanPrefs.fontScale}%`, scrollbarWidth: 'auto', scrollbarColor: 'hsl(var(--primary)) hsl(var(--muted))' }}
                  >
                    <div className="absolute top-0 left-0 p-2 z-10 opacity-0 group-hover/kanban:opacity-100 transition-opacity">
                      <Button 
                        size="sm" 
                        className="rounded-full bg-primary shadow-lg h-8 w-8 p-0"
                        onClick={() => setIsNewStatusDialogOpen(true)}
                        title="Nova Etiqueta"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {(
                      <>
                      {/* GERAL: virtual column for every conversation without a
                          custom kanban label. Dropping a contact here clears the
                          status so it goes back to "untagged" (default). */}
                      {(() => {
                        const customValues = new Set(
                          kanbanStatuses
                            .filter(s => s.value !== 'human' && s.value !== 'new')
                            .map(s => s.value)
                        );
                        const geralContacts = contacts.filter(
                          c => c.last_interaction !== null && !customValues.has(c.status)
                        ).filter(c => {
                          if (!kanbanSearch.trim()) return true;
                          const q = kanbanSearch.toLowerCase();
                          return (c.name || '').toLowerCase().includes(q) || (c.wa_id || '').includes(q);
                        });
                        return (
                          <div
                            key="__geral__"
                            className="shrink-0 flex flex-col bg-[#f0f2f5] dark:bg-[#111b21] rounded-2xl border-none shadow-md group/column transition-all hover:shadow-xl snap-center overflow-hidden"
                            style={{ width: kanbanPrefs.colWidth }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => handleDrop('new')}
                          >
                            <div className="p-4 border-b border-border/10 font-black uppercase text-[11px] flex justify-between items-center bg-[#202c33] text-[#e9edef]">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-slate-400" />
                                Geral
                              </div>
                              <Badge variant="secondary" className="bg-background/80 shadow-sm border font-black">
                                {geralContacts.length}
                              </Badge>
                            </div>
                            <ScrollArea className="flex-1 p-3">
                              {geralContacts.map(contact => (
                                <Card
                                  key={contact.id}
                                  draggable
                                  onDragStart={() => handleDragStart(contact)}
                                  onDragEnd={stopKanbanAutoScroll}
                                  className="p-4 mb-3 cursor-grab active:cursor-grabbing border-none bg-white dark:bg-[#202c33] shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg rounded-xl animate-in fade-in slide-in-from-top-2"
                                  onClick={() => openPreview(contact)}
                                >
                                  <p className="text-sm font-bold truncate">{contact.name || contact.wa_id}</p>
                                  <div className="flex justify-between items-center mt-3">
                                    {contact.last_interaction && (
                                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                                        <Clock className="w-3 h-3 opacity-50" />
                                        {new Date(contact.last_interaction).toLocaleDateString([], {day: '2-digit', month: '2-digit'})}
                                      </div>
                                    )}
                                    {contact.last_message_received_at && (Date.now() - new Date(contact.last_message_received_at).getTime()) < (24 * 60 * 60 * 1000) && (
                                      <Badge variant="outline" className="text-[9px] font-black bg-[#00a884]/10 text-[#00a884] border-none">
                                        <Zap className="w-2 h-2 mr-1" /> ATIVO
                                      </Badge>
                                    )}
                                  </div>
                                </Card>
                              ))}
                              {geralContacts.length === 0 && (
                                <div className="h-20 flex items-center justify-center border-2 border-dashed border-muted rounded-xl opacity-40">
                                  <p className="text-[10px] font-bold uppercase tracking-widest">Vazio</p>
                                </div>
                              )}
                            </ScrollArea>
                          </div>
                        );
                      })()}
                      {kanbanStatuses.filter(s => s.value !== 'human' && s.value !== 'new').map(status => (
                      <div 
                        key={status.value} 
                        className="shrink-0 flex flex-col bg-[#f0f2f5] dark:bg-[#111b21] rounded-2xl border-none shadow-md group/column transition-all hover:shadow-xl snap-center overflow-hidden" 
                        style={{ width: kanbanPrefs.colWidth }}
                        onDragOver={e => e.preventDefault()} 
                        onDrop={() => handleDrop(status.value)}
                      >
                        <div className={cn(
                          "p-4 border-b border-border/10 font-black uppercase text-[11px] flex justify-between items-center",
                          status.value === 'human' || status.color === 'orange' ? "bg-orange-500/10 text-orange-700" : "bg-[#202c33] text-[#e9edef]"
                        )}>
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              status.color === 'blue' && 'bg-blue-500',
                              status.color === 'yellow' && 'bg-yellow-500',
                              status.color === 'purple' && 'bg-purple-500',
                              status.color === 'green' && 'bg-green-500',
                              status.color === 'red' && 'bg-red-500',
                              status.color === 'orange' && 'bg-orange-500',
                              status.color === 'indigo' && 'bg-indigo-500',
                              status.color === 'pink' && 'bg-pink-500'
                            )} />
                            {status.label}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="bg-background/80 shadow-sm border font-black">{contacts.filter(c => c.status === status.value && c.last_interaction !== null).length}</Badge>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover/column:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sObj = kanbanStatuses.find(s => s.value === status.value);
                                  if (sObj) handleMoveStatus(sObj.id, 'up');
                                }}
                                className="hover:text-primary p-0.5"
                                title="Mover p/ Esquerda"
                              >
                                <LucideIcons.ChevronLeft className="w-3 h-3" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sObj = kanbanStatuses.find(s => s.value === status.value);
                                  if (sObj) handleMoveStatus(sObj.id, 'down');
                                }}
                                className="hover:text-primary p-0.5"
                                title="Mover p/ Direita"
                              >
                                <LucideIcons.ChevronRight className="w-3 h-3" />
                              </button>
                              {kanbanStatuses.some(s => s.id && s.value === status.value) && (
                                <>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const sObj = kanbanStatuses.find(s => s.value === status.value);
                                      if (sObj) {
                                        setEditingStatus(sObj);
                                        setIsEditStatusDialogOpen(true);
                                      }
                                    }}
                                    className="hover:text-primary p-0.5"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const sObj = kanbanStatuses.find(s => s.value === status.value);
                                      if (sObj) {
                                        if (confirm(`Remover etiqueta "${sObj.label}"?`)) {
                                          handleDeleteStatus(sObj.id);
                                        }
                                      }
                                    }}
                                    className="hover:text-red-500 p-0.5"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <ScrollArea className="flex-1 p-3">
                          {contacts.filter(c => c.status === status.value && c.last_interaction !== null).filter(c => {
                            if (!kanbanSearch.trim()) return true;
                            const q = kanbanSearch.toLowerCase();
                            return (c.name || '').toLowerCase().includes(q) || (c.wa_id || '').includes(q);
                          }).map(contact => (
                            <Card 
                              key={contact.id} 
                              draggable 
                              onDragStart={() => handleDragStart(contact)} 
                              onDragEnd={stopKanbanAutoScroll}
                              className="p-4 mb-3 cursor-grab active:cursor-grabbing border-none bg-white dark:bg-[#202c33] shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg rounded-xl animate-in fade-in slide-in-from-top-2" 
                              onClick={() => openPreview(contact)}
                            >
                              <p className="text-sm font-bold truncate">{contact.name || contact.wa_id}</p>
                              <div className="flex justify-between items-center mt-3">
                                {contact.last_interaction && (
                                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                                    <Clock className="w-3 h-3 opacity-50" />
                                    {new Date(contact.last_interaction).toLocaleDateString([], {day: '2-digit', month: '2-digit'})}
                                  </div>
                                )}
                                {contact.last_message_received_at && (Date.now() - new Date(contact.last_message_received_at).getTime()) < (24 * 60 * 60 * 1000) && (
                                  <Badge variant="outline" className="text-[9px] font-black bg-[#00a884]/10 text-[#00a884] border-none">
                                    <Zap className="w-2 h-2 mr-1" /> ATIVO
                                  </Badge>
                                )}
                              </div>
                            </Card>
                          ))}
                          {contacts.filter(c => c.status === status.value && c.last_interaction !== null).filter(c => {
                            if (!kanbanSearch.trim()) return true;
                            const q = kanbanSearch.toLowerCase();
                            return (c.name || '').toLowerCase().includes(q) || (c.wa_id || '').includes(q);
                          }).length === 0 && (
                            <div className="h-20 flex items-center justify-center border-2 border-dashed border-muted rounded-xl opacity-40">
                              <p className="text-[10px] font-bold uppercase tracking-widest">Vazio</p>
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    ))}
                      </>
                    )}
                  </div>
                  </div>
                ) : (
                  <>
                    <div className={cn(
                      "w-full md:w-[280px] lg:w-[320px] xl:w-[360px] border-r border-border/40 flex flex-col bg-white dark:bg-[#111b21] h-full min-h-0 shrink-0 shadow-sm z-[5]",
                      selectedContact ? 'hidden md:flex' : 'flex'
                    )}>
                      <div className="p-4 border-b border-border/30 flex flex-col gap-3 bg-white dark:bg-[#111b21]">
                        <div className="space-y-3">
                          <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-[#00a884] transition-colors" />
                            <Input 
                              placeholder="Pesquisar ou começar uma nova conversa" 
                              className="bg-[#f0f2f5] dark:bg-[#202c33] border-none h-9 pl-10 rounded-lg text-sm focus-visible:ring-1 focus-visible:ring-[#00a884]"
                              value={conversationSearch}
                              onChange={e => {
                                const v = e.target.value;
                                setConversationSearch(v);
                                const trimmed = v.trim();
                                setStatusFilter(trimmed === '' ? 'all' : trimmed);
                              }}
                            />
                          </div>
                        </div>
                        <Accordion type="single" collapsible className="w-full">
                          <AccordionItem value="tags" className="border-none">
                            <AccordionTrigger className="py-2 hover:no-underline text-[10px] font-black uppercase tracking-wider text-muted-foreground flex gap-2">
                              <ListFilter className="w-3 h-3" />
                              Etiquetas
                            </AccordionTrigger>
                            <AccordionContent>
                               <div className="flex gap-1.5 pb-2 pt-1 overflow-x-auto scrollbar-hide py-1">
                                {['all', ...kanbanStatuses.filter(s => s.value !== 'human' && s.value !== 'new').map(s => s.value)].map(s => {
                                  const statusObj = kanbanStatuses.find(status => status.value === s);
                                  const label = s === 'all' ? '🚀 Todos' : (statusObj ? statusObj.label : s.toUpperCase());
                                  
                                  return (
                                    <Badge 
                                      key={s} 
                                      variant={statusFilter === s ? 'default' : 'outline'} 
                                      style={{ 
                                        height: `${18 * ((metaSettings.tag_size || 100) / 100)}px`, 
                                        fontSize: `${9 * ((metaSettings.tag_size || 100) / 100)}px`,
                                        backgroundColor: statusFilter === s ? '#00a884' : undefined,
                                        borderColor: statusFilter === s ? '#00a884' : undefined
                                      }}
                                      className={cn(
                                        "cursor-pointer capitalize whitespace-nowrap px-3 font-bold transition-all rounded-full shrink-0",
                                        statusFilter === s ? "text-white shadow-md scale-105" : "hover:bg-muted"
                                      )}
                                      onClick={() => { setStatusFilter(s); setConversationSearch(''); }}
                                    >
                                      {label}
                                    </Badge>
                                  );
                                })}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                      <ScrollArea className="flex-1 min-h-0 bg-white dark:bg-[#111b21]">
                        {/* Fila de Contatos Sem Nome */}
                        {(() => {
                          const unnamed = unnamedContacts;
                          if (unnamed.length === 0) return null;
                          return (
                            <div className="border-b border-border/10">
                              <button 
                                onClick={() => setShowUnnamedContacts(!showUnnamedContacts)}
                                className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <LucideIcons.UserX className="w-4 h-4 text-orange-500" />
                                  <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">Contatos sem nome</span>
                                  <Badge className="bg-orange-500 text-white border-none h-4 px-1.5 text-[9px] font-bold">
                                    {unnamed.length}
                                  </Badge>
                                </div>
                                {showUnnamedContacts ? <LucideIcons.ChevronDown className="w-3 h-3 text-muted-foreground" /> : <LucideIcons.ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              </button>

                              
                              {showUnnamedContacts && (
                                <div className="p-3 space-y-3 bg-muted/10 animate-in slide-in-from-top-1 duration-200">
                                  <div className="flex gap-2">
                                    <Input 
                                      placeholder="Nome base (ex: Cliente)" 
                                      value={bulkName}
                                      onChange={(e) => setBulkName(e.target.value)}
                                      className="h-8 text-[11px] rounded-lg border-muted/50"
                                    />
                                    <Button 
                                      size="sm" 
                                      disabled={selectedContactIds.length === 0 || !bulkName || isBulkNaming}
                                      onClick={async () => {
                                        setIsBulkNaming(true);
                                        try {
                                          await supabase.functions.invoke('meta-whatsapp-crm', {
                                            body: { action: 'update-contacts-bulk', contactIds: selectedContactIds, name: bulkName.trim() }
                                          });
                                          toast({ title: `${selectedContactIds.length} contatos atualizados!` });
                                          fetchContacts();
                                          setSelectedContactIds([]);
                                          setBulkName('');
                                          // Dispara sync imediato para o Google (não espera o intervalo)
                                          if (googleContactsEnabled && anyAutoSync) {
                                            supabase.functions.invoke('meta-whatsapp-crm', {
                                              body: { action: 'syncPendingToGoogle' }
                                            }).then(() => fetchContacts()).catch(() => {});
                                          }
                                        } catch (e) {
                                          toast({ title: 'Erro ao atualizar', variant: 'destructive' });
                                        } finally {
                                          setIsBulkNaming(false);
                                        }
                                      }}
                                      className="h-8 bg-[#00a884] hover:bg-[#00a884]/90 text-[10px] rounded-lg px-2"
                                    >
                                      {isBulkNaming ? <RefreshCcw className="w-3 h-3 animate-spin" /> : 'Salvar massa'}
                                    </Button>
                                  </div>
                                  
                                  <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
                                    {unnamed.map(contact => (
                                      <div 
                                        key={contact.id}
                                        className={cn(
                                          "flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all border",
                                          selectedContactIds.includes(contact.id) 
                                            ? 'bg-primary/5 border-primary/20 ring-1 ring-primary/20' 
                                            : 'bg-background border-transparent hover:border-border/50'
                                        )}
                                        onClick={() => {
                                          setSelectedContactIds(prev => 
                                            prev.includes(contact.id) ? prev.filter(i => i !== contact.id) : [...prev, contact.id]
                                          );
                                        }}
                                      >
                                        <div className="shrink-0">
                                          {selectedContactIds.includes(contact.id) ? (
                                            <LucideIcons.CheckSquare className="w-3.5 h-3.5 text-primary" />
                                          ) : (
                                            <LucideIcons.Square className="w-3.5 h-3.5 text-muted-foreground/30" />
                                          )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                          <p className="text-[11px] font-bold tabular-nums truncate">{contact.wa_id}</p>
                                        </div>
                                        <Button 
                                          variant="ghost" 
                                          size="icon" 
                                          onClick={(e) => { e.stopPropagation(); openChat(contact); }}
                                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                                        >
                                          <MessageCircle className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {filteredContacts.length > 0 ? (

                          visibleFilteredContacts.map(contact => (
                            <SwipeableContactRow
                              key={contact.id}
                              onClear={() => setConfirmConvAction({ type: 'clear', contactId: contact.id, contactName: getGoogleResolvedContact(contact).displayName })}
                              onDelete={() => setConfirmConvAction({ type: 'delete', contactId: contact.id, contactName: getGoogleResolvedContact(contact).displayName })}
                            >
                            <button 
                              onClick={() => openChat(contact)} 
                              className={cn(
                                "w-full p-4 text-left border-b transition-all flex flex-col gap-1 relative",
                                selectedContact?.id === contact.id ? "bg-[#f0f2f5] dark:bg-[#2a3942] border-l-4 border-l-[#00a884]" : "hover:bg-[#f5f6f6] dark:hover:bg-[#202c33] border-l-4 border-l-transparent"
                              )}
                            >
                              <div className="flex items-center w-full gap-2 min-w-0">
                                <div className="flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
                                  {(() => {
                                     // Se o contato já foi aberto alguma vez, usamos `last_read_at`.
                                     // Só quando nunca houve leitura caímos no baseline da sessão,
                                     // assim as mensagens novas continuam marcadas após recarregar.
                                     const lastReadT = contact.last_read_at ? new Date(contact.last_read_at).getTime() : 0;
                                     const baselineT = lastReadT > 0 ? lastReadT : unreadBaselineRef.current;
                                     const stamps = inboundTimestampsByContact[contact.id] || [];
                                     const unread = stamps.filter(ts => new Date(ts).getTime() > baselineT).length;
                                     // Fallback: se ainda não carregamos os timestamps, mas o contato
                                     // tem interação mais recente que a leitura, mostramos o aviso.
                                     const lastInboundRaw = contact.last_message_received_at || contact.last_interaction;
                                     const lastInboundT = lastInboundRaw ? new Date(lastInboundRaw).getTime() : 0;
                                     const hasPending = unread > 0 || (stamps.length === 0 && lastInboundT > baselineT);
                                     if (!hasPending) return null;
                                    return (
                                      <div
                                        className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#EAB308] shadow-[0_0_10px_rgba(234,179,8,0.45)] animate-in fade-in zoom-in duration-300 shrink-0"
                                        title={unread > 0
                                          ? `${unread} mensagem${unread > 1 ? 's' : ''} não lida${unread > 1 ? 's' : ''}`
                                          : 'Mensagem não lida'}
                                      >
                                        <span className="text-[10px] font-black text-black tabular-nums leading-none">
                                          {unread > 99 ? '99+' : unread > 0 ? unread : '!'}
                                        </span>
                                      </div>
                                    );
                                  })()}
                                  <p className={cn(
                                    "font-bold truncate text-sm flex items-center gap-1.5 min-w-0",
                                    contact.last_interaction && (!contact.last_read_at || new Date(contact.last_interaction) > new Date(contact.last_read_at)) ? "text-foreground" : "text-foreground/80"
                                  )}>
                                    <span className="truncate shrink grow min-w-0">{getGoogleResolvedContact(contact).displayName}</span>
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                                   {isAiVisuallyActive(contact) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateContactStatus(contact.id, { ai_active: false, metadata: { manual_ai_off: true } });
                                      }}
                                      className="p-1 hover:bg-blue-500/20 rounded-full transition-colors group animate-pulse"
                                      title="Desativar Agente IA"
                                    >
                                      <Bot className="w-4 h-4 text-blue-500 group-hover:text-blue-600 drop-shadow-[0_0_4px_rgba(59,130,246,0.8)]" />
                                    </button>
                                  )}
                                  <span className={cn(
                                    "text-[10px] whitespace-nowrap opacity-70",
                                    contact.last_message_received_at && (Date.now() - new Date(contact.last_message_received_at).getTime()) < (24.5 * 60 * 60 * 1000) ? "text-[#25D366] font-bold opacity-100" : "text-muted-foreground"
                                  )}>
                                    {contact.last_interaction ? new Date(contact.last_interaction).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 mt-1 w-full min-w-0 pr-1">
                                <div className="flex flex-wrap items-center justify-between gap-1 w-full min-w-0">
                                  <div className="flex items-center gap-1 flex-wrap min-w-0">
                                    {(() => {
                                      // Only show the status badge when the user has manually
                                      // assigned a custom kanban label (not the automatic
                                      // 'human' / 'new' / null defaults that come from inbound
                                      // messages). Default contacts live in the "GERAL" column
                                      // of the Kanban without any visible tag.
                                      const customStatus = kanbanStatuses.find(
                                        s => s.value === contact.status && s.value !== 'human' && s.value !== 'new'
                                      );
                                      if (!customStatus) return null;
                                      return (
                                        <Badge
                                          variant="outline"
                                          style={{ height: `${16 * ((metaSettings.tag_size || 100) / 100)}px`, fontSize: `${9 * ((metaSettings.tag_size || 100) / 100)}px` }}
                                          className={cn(
                                            "px-2 capitalize font-black shadow-sm shrink-0",
                                            getStatusColor(contact.status),
                                            contact.last_interaction && (!contact.last_read_at || new Date(contact.last_interaction) > new Date(contact.last_read_at)) && "ring-2 ring-[#25D366]/20"
                                          )}
                                        >
                                          {getStatusLabel(contact.status)}
                                        </Badge>
                                      );
                                    })()}
                                    
                                    {contact.last_message_received_at && (() => {
                                      const elapsed = Date.now() - new Date(contact.last_message_received_at).getTime();
                                      const DAY = 24.5 * 60 * 60 * 1000;
                                      if (elapsed >= DAY) return null;
                                      const remainingMs = DAY - elapsed;
                                      const h = Math.floor(remainingMs / (60 * 60 * 1000));
                                      const m = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
                                      return (
                                        <Badge variant="outline" className="text-[8px] font-black bg-[#00a884]/10 text-[#00a884] border-none px-1.5 h-4 tabular-nums flex items-center gap-1 shrink-0">
                                          <Clock className="w-2.5 h-2.5" />
                                          <span>{h}h{m.toString().padStart(2,'0')}m</span>
                                        </Badge>
                                      );
                                    })()}
                                    
                                    {contact.flow_state && contact.flow_state !== 'idle' && (!contact.last_message_received_at || (Date.now() - new Date(contact.last_message_received_at).getTime()) < (24.5 * 60 * 60 * 1000)) && (
                                      <div className="flex items-center gap-1 min-w-0">
                                        <Badge 
                                          variant="secondary" 
                                          style={{ height: `${14 * ((metaSettings.tag_size || 100) / 100)}px`, fontSize: `${8 * ((metaSettings.tag_size || 100) / 100)}px` }}
                                          className={cn(
                                            "px-1.5 capitalize font-black shrink-0 border-none truncate max-w-[100px]",
                                            contact.flow_state === 'error' ? "bg-red-600 text-white" : 
                                            contact.flow_state === 'waiting_response' ? "bg-amber-500 text-white" :
                                            "bg-red-500 text-white"
                                          )}
                                        >
                                          <span className="truncate">
                                            {contact.flow_state === 'error' ? 'Erro' : 
                                             contact.flow_state === 'waiting_response' ? 'Aguardando' : 'Fluxo'}
                                            {contact.current_step_name && <span className="ml-1 text-white/90">({contact.current_step_name})</span>}
                                            {contact.flow_state === 'waiting_response' && (() => {
                                              const timeoutMinutes = Number(contact.flow_timeout_minutes);
                                              if (!timeoutMinutes || timeoutMinutes <= 0) return null;
                                              const lastInteraction = new Date(contact.last_flow_interaction || Date.now()).getTime();
                                              const timeoutThreshold = lastInteraction + (timeoutMinutes * 60 * 1000);
                                              const remainingSeconds = Math.max(0, Math.floor((timeoutThreshold - now) / 1000));
                                              if (remainingSeconds <= 0) return null;
                                              return <span className="ml-1 text-white/90 tabular-nums">· {Math.floor(remainingSeconds / 60)}m {remainingSeconds % 60}s</span>;
                                            })()}
                                          </span>
                                        </Badge>
                                        <div className="flex items-center gap-0.5 shrink-0">
                                          {(contact.flow_state === 'error' || contact.flow_state === 'waiting_response') && (
                                            <button 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleResumeFlow(contact.id);
                                              }}
                                              className="text-green-500 hover:text-green-700 p-0.5 rounded-full hover:bg-green-50"
                                              title="Retomar Fluxo"
                                            >
                                              <PlayCircle className="h-3.5 w-3.5" />
                                            </button>
                                          )}
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleStopFlow(contact.id);
                                            }}
                                            className="text-red-400 hover:text-red-600 p-0.5 rounded-full hover:bg-red-50"
                                            title="Parar Fluxo"
                                          >
                                            <XCircle className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </button>
                            </SwipeableContactRow>
                          ))
                        ) : (
                          <div className="p-8 text-center text-muted-foreground text-sm italic">
                            Nenhum contato encontrado
                          </div>
                        )}

                        {/* Sentinela: amplia a janela de contatos ao chegar no fim da rolagem. */}
                        {hasMoreContactsToRender && (
                          <div ref={contactsSentinelRef} className="p-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                            <div className="h-3 w-3 rounded-full border-2 border-[#00a884] border-t-transparent animate-spin" />
                            Carregando mais contatos...
                          </div>
                        )}
                      </ScrollArea>
                    </div>
                    
                    <div className={cn(
                      "flex-1 flex flex-col min-h-0 min-w-0 w-full relative overflow-hidden",
                      !selectedContact ? 'hidden md:flex items-center justify-center bg-muted/5' : 'flex'
                    )}>
                      {selectedContact ? (
                        <>
                          <div className="p-1 sm:p-2 border-b border-border/40 flex flex-col gap-1 bg-[#f0f2f5] dark:bg-[#202c33] z-10 shrink-0 w-full min-w-0 shadow-sm relative">
                            {isAiVisuallyActive(selectedContact) && metaSettings.ai_agent_enabled && (
                              <div className="bg-violet-600 text-white px-3 py-1.5 flex items-center justify-between shadow-md z-[20] animate-in slide-in-from-top-2 rounded-lg mb-1 mx-1">
                                <div className="flex items-center gap-2">
                                  <Bot className="w-3.5 h-3.5 animate-pulse" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider">Atendente I.A no Controle</span>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="h-6 px-2 text-[9px] font-black uppercase text-white hover:bg-white/20 gap-1 border border-white/30"
                                  onClick={() => updateContactStatus(selectedContact.id, { ai_active: false, metadata: { manual_ai_off: true } })}
                                >
                                  <StopCircle className="w-3 h-3" /> Parar Robô (Assumir Manual)
                                </Button>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-1 sm:gap-2 w-full min-w-0">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Button variant="ghost" size="icon" className="md:hidden shrink-0 h-8 w-8 hover:bg-muted" onClick={() => setSelectedContact(null)}>
                                  <ChevronLeft className="h-5 w-5" />
                                </Button>
                                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-[#dfe5e7] dark:bg-[#6a7175] flex items-center justify-center shrink-0 border border-border/10">
                                  <User className="w-4 h-4 md:w-6 md:h-6 text-white" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <p className="font-bold text-sm md:text-base hover:text-primary cursor-pointer truncate" onClick={() => openContactInfo(selectedContact)}>
                                      {getGoogleResolvedContact(selectedContact).displayName}
                                    </p>
                                    {getGoogleResolvedContact(selectedContact).googleSyncAccountId && (
                                      <span className="w-3 h-3 bg-[#4285F4] rounded-full flex items-center justify-center shrink-0">
                                         <span className="text-[5px] font-bold text-white">G</span>
                                      </span>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                       className={cn(
                                         "h-6 w-6 rounded-full transition-all shrink-0",
                                         isAiVisuallyActive(selectedContact) ? "text-blue-500 bg-blue-500/10 hover:bg-blue-500/20" : "text-muted-foreground bg-muted hover:bg-muted/80 grayscale"
                                       )}
                                      onClick={async () => {
                                        const newStatus = !isAiVisuallyActive(selectedContact);
                                        await updateContactStatus(selectedContact.id, {
                                          ai_active: newStatus,
                                          metadata: { manual_ai_off: !newStatus },
                                        });
                                      }}
                                      title={isAiVisuallyActive(selectedContact) ? "Desativar Agente IA" : "Ativar Agente IA"}
                                    >
                                      <Bot className="w-3.5 h-3.5" />
                                    </Button>
                                    {metaSettings.save_deleted_messages && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 rounded-full text-muted-foreground hover:text-primary hover:bg-primary/10 shrink-0"
                                        onClick={() => openDeletedHistory(selectedContact.id)}
                                        title="Histórico de mensagens apagadas"
                                      >
                                        <HistoryIcon className="w-3.5 h-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-7 w-7 rounded-full shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10",
                                    chatSearchOpen && "bg-primary/10 text-primary"
                                  )}
                                  title="Pesquisar mensagens nesta conversa"
                                  onClick={() => {
                                    setChatSearchOpen((v) => {
                                      if (v) { setChatSearchQuery(''); setHighlightedMessageId(null); }
                                      return !v;
                                    });
                                  }}
                                >
                                  <Search className="w-3.5 h-3.5" />
                                </Button>
                                <div className="flex items-center gap-1 flex-wrap justify-end">

                                  {selectedContact.last_message_received_at && (
                                    <div className="flex items-center gap-1 bg-white/50 dark:bg-black/20 px-1 sm:px-1.5 py-0.5 rounded border border-border/10 shadow-sm shrink-0">
                                      <Clock className={cn("w-2.5 h-2.5", getWindowInfo(selectedContact.last_message_received_at)?.isExpired ? 'text-destructive animate-pulse' : 'text-[#00a884]')} />
                                      <span className={cn("text-[8px] font-bold tabular-nums", getWindowInfo(selectedContact.last_message_received_at)?.isExpired ? 'text-destructive' : 'text-[#00a884]')}>
                                        {getWindowInfo(selectedContact.last_message_received_at)?.label}
                                      </span>
                                    </div>
                                  )}
                                  {(countdown !== null && countdown > 0 || selectedContact.flow_state === 'waiting_response') && (!selectedContact.last_message_received_at || (Date.now() - new Date(selectedContact.last_message_received_at).getTime()) < (24.5 * 60 * 60 * 1000)) && (
                                    <div className="text-[8px] font-black bg-red-600 text-white tabular-nums whitespace-nowrap px-1.5 py-0.5 rounded-sm shrink-0 shadow-sm flex items-center gap-1">
                                      <Clock className="w-2.5 h-2.5" />
                                      {(() => {
                                        if (selectedContact.flow_state === 'waiting_response') {
                                          const timeoutMinutes = Number(selectedContact.flow_timeout_minutes);
                                          if (!timeoutMinutes || timeoutMinutes <= 0) return '';
                                          const lastInteraction = new Date(selectedContact.last_flow_interaction || Date.now()).getTime();
                                          const timeoutThreshold = lastInteraction + (timeoutMinutes * 60 * 1000);
                                          const remainingSeconds = Math.max(0, Math.floor((timeoutThreshold - now) / 1000));
                                          return `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`;
                                        }
                                        return `${Math.floor(countdown! / 60)}m ${countdown! % 60}s`;
                                      })()}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            {chatSearchOpen && (
                              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border/40 bg-muted/30">
                                <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <Input
                                  autoFocus
                                  value={chatSearchQuery}
                                  onChange={(e) => setChatSearchQuery(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { e.preventDefault(); goToSearchMatch(chatSearchIndex + (e.shiftKey ? -1 : 1)); }
                                    if (e.key === 'Escape') { setChatSearchOpen(false); setChatSearchQuery(''); setHighlightedMessageId(null); }
                                  }}
                                  placeholder="Pesquisar nesta conversa..."
                                  className="h-7 text-xs border-0 bg-transparent focus-visible:ring-0 px-0"
                                />
                                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                  {chatSearchQuery.trim()
                                    ? (chatSearchMatches.length ? `${chatSearchIndex + 1}/${chatSearchMatches.length}` : '0/0')
                                    : ''}
                                </span>
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={chatSearchMatches.length === 0} onClick={() => goToSearchMatch(chatSearchIndex - 1)} title="Anterior">
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={chatSearchMatches.length === 0} onClick={() => goToSearchMatch(chatSearchIndex + 1)} title="Próxima">
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => { setChatSearchOpen(false); setChatSearchQuery(''); setHighlightedMessageId(null); }} title="Fechar busca">
                                  <XCircle className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            )}



                            {(() => { const aiFunctional = isAiVisuallyActive(selectedContact); return ((selectedContact.flow_state && selectedContact.flow_state !== 'idle') || aiFunctional) && (!selectedContact.last_message_received_at || (Date.now() - new Date(selectedContact.last_message_received_at).getTime()) < (24.5 * 60 * 60 * 1000)) && (
                              <div className={cn(
                                "flex items-center justify-between gap-2 px-2 py-1 rounded-lg border",
                                aiFunctional ? "bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30" : "bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30"
                              )}>
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className={cn(
                                    "w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300", 
                                    aiFunctional 
                                      ? (isSending(selectedContact.id) ? "bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.8)] scale-125" : "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]") 
                                      : "bg-red-500",
                                    (aiFunctional && isSending(selectedContact.id)) ? "animate-pulse" : (selectedContact.flow_state === 'error' ? "animate-bounce" : "animate-ping")
                                  )} />
                                  <span className={cn(
                                    "text-[10px] font-bold truncate",
                                    aiFunctional 
                                      ? (isSending(selectedContact.id) ? "text-yellow-600 dark:text-yellow-400" : "text-blue-600 dark:text-blue-400") 
                                      : "text-red-600 dark:text-red-400"
                                  )}>
                                    {aiFunctional 
                                      ? (isSending(selectedContact.id) ? 'IA Respondendo...' : 'Agente IA Ativado') 
                                      : (selectedContact.flow_state === 'error' ? 'Erro no Fluxo' : 'Fluxo Ativo')}
                                    {selectedContact.current_step_name && <span className="ml-1 opacity-70">({selectedContact.current_step_name})</span>}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {aiFunctional ? (
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 md:h-8 px-2 md:px-3 text-[9px] md:text-[10px] font-bold gap-1 border-[#00a884] text-[#00a884] hover:bg-[#00a884] hover:text-white transition-all shadow-sm"
                                        onClick={(e) => { e.stopPropagation(); handleManualAiReply(selectedContact.id); }}
                                        disabled={isSending(selectedContact.id)}
                                        title="Forçar resposta da IA agora"
                                      >
                                        <Bot className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                        RESPONDER
                                      </Button>
                                      
                                      <Button 
                                        variant="destructive" 
                                        size="sm" 
                                        className="h-7 md:h-8 px-2 md:px-3 text-[9px] md:text-[10px] font-bold gap-1 shadow-sm"
                                        onClick={async (e) => { 
                                          e.stopPropagation(); 
                                          await handleStopFlow(selectedContact.id);
                                        }}
                                        disabled={isSending(selectedContact.id)}
                                      >
                                        <StopCircle className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                        PARAR AGENTE IA
                                      </Button>
                                    </div>
                                  ) : (
                                    <>
                                      {(selectedContact.flow_state === 'error' || selectedContact.flow_state === 'waiting_response') && (
                                        <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30" onClick={(e) => { e.stopPropagation(); handleResumeFlow(selectedContact.id); }}><PlayCircle className="h-4 w-4" /></Button>
                                      )}
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30" onClick={(e) => { e.stopPropagation(); handleStopFlow(selectedContact.id); }}><XCircle className="h-4 w-4" /></Button>
                                    </>
                                  )}
                                </div>

                              </div>
                            ); })()}
                          </div>
                          
                          <div className={cn(
                            "bg-muted/5 border-b px-2 py-1 flex flex-col gap-1 z-[5] backdrop-blur-md overflow-hidden transition-all duration-300 shrink-0",
                            !showFlows && "h-0 py-0 border-b-0"
                          )}>
                            <div className={cn(
                              "flex items-center gap-1.5 min-w-0 pt-1 border-t border-border/5",
                              "pt-0 border-t-0"
                            )}>
                              <button 
                                onClick={() => setShowFlows(!showFlows)}
                                className="text-[9px] font-black uppercase text-muted-foreground/70 shrink-0 flex items-center gap-1 bg-muted/30 px-1.2 py-0.5 rounded-sm border border-border/20 hover:bg-muted/50 transition-colors group"
                              >
                                <Zap className="w-2.5 h-2.5 text-blue-500" /> 
                                <span className="hidden sm:inline">Fluxos</span>
                                {showFlows ? <Eye className="w-2 h-2 ml-0.5 opacity-40 group-hover:opacity-100" /> : <EyeOff className="w-2 h-2 ml-0.5 opacity-100 text-blue-500" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => setFlowBarSettingsOpen(true)}
                                title="Configurar botões de fluxo"
                                className="shrink-0 h-4 w-4 flex items-center justify-center rounded-sm border border-border/20 bg-muted/30 hover:bg-muted/60 text-muted-foreground/70 hover:text-foreground transition-colors"
                              >
                                <Settings className="w-2.5 h-2.5" />
                              </button>

                              {showFlows && (() => {
                                const activeFlows = flows.filter(f => f.is_active);
                                const order = flowBarPrefs.order || [];
                                const ordered = [...activeFlows].sort((a, b) => {
                                  const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
                                  if (ia === -1 && ib === -1) return 0;
                                  if (ia === -1) return 1;
                                  if (ib === -1) return -1;
                                  return ia - ib;
                                });
                                const scale = (flowBarPrefs.size || 100) / 100;
                                const c = FLOW_BAR_COLORS[flowBarPrefs.color] || FLOW_BAR_COLORS.blue;
                                 const layoutClass = flowBarPrefs.layout === 'scroll'
                                   ? 'flex gap-1 flex-1 min-w-0 overflow-x-auto overflow-y-hidden flex-nowrap flow-bar-scroll'
                                  : flowBarPrefs.layout === 'one'
                                    ? 'flex gap-1 flex-1 flex-wrap'
                                    : 'flex gap-1 flex-1 flex-wrap max-h-[calc(2*(20px*var(--fbs,1))+8px)] overflow-hidden';
                                return (
                                  <div
                                    className={cn(layoutClass, 'animate-in fade-in slide-in-from-left-2 duration-200 py-0.5')}
                                    style={{ ['--fbs' as any]: scale }}
                                  >
                                    {ordered.map(f => (
                                      <Button
                                        key={f.id}
                                        variant="outline"
                                        size="sm"
                                        style={{ height: `${20 * scale}px`, fontSize: `${9 * scale}px` }}
                                        className={cn(
                                          'px-2 rounded-md transition-all font-bold whitespace-nowrap shadow-none shrink-0',
                                          c.border, c.bg, c.text, c.hover
                                        )}
                                        onClick={() => handleTriggerFlow(f.id)}
                                        disabled={isSending(selectedContact?.id)}
                                      >
                                        {f.name}
                                      </Button>
                                    ))}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>

                          <ScrollArea
                            className="flex-1 bg-[#efeae2] dark:bg-[#0b141a] relative min-h-0 min-w-0 w-full overflow-x-hidden"
                            style={{ zoom: (flowBarPrefs.chatFontScale || 100) / 100 } as any}
                          >
                            <div className="absolute inset-0 opacity-[0.06] dark:opacity-[0.05] pointer-events-none bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat"></div>
                            {chatMessages.some((m: any) => m.direction === 'outbound' && m.status === 'failed' && isBusinessVerificationError(m)) && (
                              <div className="sticky top-0 z-40 m-2">
                                {bizWarnExpanded ? (
                                  <div className="rounded-lg border border-amber-500/40 bg-amber-50 dark:bg-amber-950/40 p-3 shadow-md animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div className="flex items-start gap-2">
                                      <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                          Não estamos conseguindo enviar mensagens — apenas receber
                                        </p>
                                        <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-1 leading-snug">
                                          A Meta bloqueou o envio deste número. Geralmente isso acontece quando o seu Negócio (Business Manager) ainda não foi verificado, está bloqueado ou tem pendências. Verifique no Meta Business Suite o que aconteceu com seu número, corrija e volte aqui para tentar novamente. Algo precisa estar OK no lado da Meta.
                                        </p>
                                        <div className="mt-2 flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-amber-500/50 bg-white hover:bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/60"
                                            onClick={() => window.open('https://business.facebook.com/', '_blank', 'noopener,noreferrer')}
                                          >
                                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                            Abrir Meta Business
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/60"
                                            onClick={() => setBizWarnExpanded(false)}
                                          >
                                            Minimizar
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setBizWarnExpanded(true)}
                                    title="Não estamos conseguindo enviar mensagens — clique para ver detalhes"
                                    aria-label="Aviso: não estamos conseguindo enviar mensagens"
                                    className="flex items-center justify-center w-8 h-8 rounded-full border border-amber-500/50 bg-amber-50 dark:bg-amber-950/60 shadow-md hover:bg-amber-100 dark:hover:bg-amber-900/70 transition-colors animate-pulse"
                                  >
                                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                  </button>
                                )}
                              </div>
                            )}
                            
                            {loadingChat && (
                              <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#efeae2]/80 dark:bg-[#0b141a]/80 backdrop-blur-sm animate-in fade-in duration-300">
                                <div className="flex flex-col items-center gap-4">
                                  <div className="relative">
                                    <div className="w-16 h-16 rounded-full border-4 border-[#00a884]/20 border-t-[#00a884] animate-spin" />
                                    <MessageSquare className="absolute inset-0 m-auto w-6 h-6 text-[#00a884] animate-pulse" />
                                  </div>
                                  <div className="flex flex-col items-center">
                                    <p className="text-[#00a884] font-black text-sm uppercase tracking-widest animate-pulse">Carregando conversas</p>
                                    <div className="flex gap-1 mt-1">
                                      <div className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce [animation-delay:-0.3s]" />
                                      <div className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce [animation-delay:-0.15s]" />
                                      <div className="w-1.5 h-1.5 bg-[#00a884] rounded-full animate-bounce" />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="p-2 sm:p-4 md:p-6 space-y-3 max-w-5xl mx-auto relative z-[1] min-w-0 w-full">
                              {scheduledMessages.length > 0 && (
                                <div className="space-y-2 mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
                                  <div className="flex items-center justify-between px-1">
                                    <div className="flex items-center gap-2">
                                      <CalendarClock className="w-3 h-3 text-primary" />
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mensagens Agendadas</span>
                                    </div>
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-6 text-[9px] font-bold gap-1 text-primary hover:bg-primary/5"
                                      onClick={() => {
                                        setScheduleDate('');
                                        setScheduleDateObj(undefined);
                                        setScheduleTime('');
                                        setSelectedContactsForScheduling([selectedContact.id]);
                                        setContactListText('');
                                        setIsSchedulingOpen(true);
                                      }}
                                    >
                                      <Plus className="w-2.5 h-2.5" /> Novo Agendamento
                                    </Button>
                                  </div>
                                  {scheduledMessages.map((msg) => (
                                    <div key={msg.id} className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex justify-between items-center shadow-sm backdrop-blur-sm">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                          <Badge variant="outline" className="text-[9px] h-4 bg-primary/10 text-primary border-primary/20 font-bold">
                                            {msg.message_data?.action === 'sendMessage' ? 'Mensagem' : 
                                             msg.message_data?.action === 'sendTemplate' ? 'Template' : 'Fluxo'}
                                          </Badge>
                                          <span className="text-[10px] font-bold text-primary flex items-center gap-1">
                                            <Clock className="w-2.5 h-2.5" />
                                            {new Date(msg.scheduled_for).toLocaleString()}
                                          </span>
                                        </div>
                                        <p className="text-xs text-muted-foreground truncate italic">
                                          {msg.message_data?.text || msg.message_data?.templateName || msg.message_data?.flowId || 'Agendamento'}
                                        </p>
                                      </div>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                                        onClick={async () => {
                                          if (confirm('Deseja cancelar este agendamento?')) {
                                            await supabase.from('crm_scheduled_messages').delete().eq('id', msg.id);
                                            fetchScheduledMessages(selectedContact.id);
                                          }
                                        }}
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {mediaUploadProgress[selectedContact.id] && (
                                <div className="p-3 mb-2 bg-primary/5 rounded-xl border border-primary/20 animate-in fade-in slide-in-from-top-2">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <Zap className="w-3.5 h-3.5 text-primary animate-pulse" />
                                      <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Convertendo e Enviando...</span>
                                    </div>
                                    <span className="text-[10px] font-bold text-primary">{mediaUploadProgress[selectedContact.id]}%</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-primary/10 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-primary transition-all duration-300" 
                                      style={{ width: `${mediaUploadProgress[selectedContact.id]}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                              {hiddenOlderMessages > 0 && (
                                <div className="flex justify-center py-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[10px] font-bold uppercase tracking-wider"
                                    onClick={() => setVisibleMessageCount(current => current + 50)}
                                  >
                                    Carregar mensagens anteriores ({hiddenOlderMessages})
                                  </Button>
                                </div>
                              )}
                              {(() => {
                                const sortedMessages = visibleChatMessages;
                                const formatDaySeparator = (iso: string) => {
                                  const d = new Date(iso);
                                  const today = new Date();
                                  const yesterday = new Date();
                                  yesterday.setDate(today.getDate() - 1);
                                  const sameDay = (a: Date, b: Date) =>
                                    a.getFullYear() === b.getFullYear() &&
                                    a.getMonth() === b.getMonth() &&
                                    a.getDate() === b.getDate();
                                  if (sameDay(d, today)) return 'HOJE';
                                  if (sameDay(d, yesterday)) return 'ONTEM';
                                  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
                                };
                                return sortedMessages.map((m, idx) => {
                                const prev = idx > 0 ? sortedMessages[idx - 1] : null;
                                const currentDay = new Date(m.created_at).toDateString();
                                const prevDay = prev ? new Date(prev.created_at).toDateString() : null;
                                const showDaySeparator = currentDay !== prevDay;
                                const isTemplate = m.message_type === 'template' || (m.message_type !== 'carousel' && m.content?.includes('[Template:'));
                                const templateName = m.content?.match(/\[Template: (.*?)\]/)?.[1];
                                let template = isTemplate ? templates.find(t => t.name === templateName) : null;

                                if (isTemplate && !template && m.content) {
                                  template = templates.find(t => {
                                    const bodyComponent = t.components?.find((c: any) => c.type === 'BODY');
                                    const bodyText = bodyComponent?.text;
                                    if (!bodyText) return false;
                                    
                                    const cleanContent = m.content.replace(/\[Template: .*?\]\s*/, '').trim();
                                    const normalizedBody = bodyText.replace(/\{\{\d+\}\}/g, '').trim();
                                    
                                    return cleanContent.includes(normalizedBody.substring(0, 30)) || 
                                           bodyText.includes(cleanContent.substring(0, 30));
                                  });
                                }


                                
                                return (
                                  <Fragment key={m.id || idx}>
                                    {showDaySeparator && (
                                      <div className="flex justify-center my-3 px-2">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-[#202c33]/80 text-[#e9edef] dark:bg-[#202c33] px-3 py-1 rounded-lg shadow-sm">
                                          {formatDaySeparator(m.created_at)}
                                        </span>
                                      </div>
                                    )}
                                  <div
                                    data-msg-id={m.id}
                                    className={cn(
                                    "flex w-full mb-1 min-w-0 rounded-xl transition-all duration-500",
                                    m.direction === 'inbound' ? 'justify-start' : 'justify-end',
                                    highlightedMessageId && highlightedMessageId === m.id && 'ring-2 ring-yellow-400 bg-yellow-400/10'
                                  )}>

                                    <div className={cn(
                                      "p-2 md:p-2.5 rounded-xl max-w-[88%] sm:max-w-[80%] md:max-w-[75%] min-w-0 shadow-[0_1px_0.5px_rgba(0,0,0,0.13)] relative transition-all duration-300",
                                      m.direction === 'inbound' 
                                        ? 'bg-white dark:bg-[#202c33] text-foreground rounded-tl-none border-l-[3px] border-l-transparent' 
                                        : 'bg-[#dcf8c6] dark:bg-[#005c4b] text-[#111b21] dark:text-[#e9edef] rounded-tr-none border-r-[3px] border-r-transparent',
                                      m.isOptimistic && 'opacity-70 grayscale-[0.5]'
                                    )}>
                                      {isTemplate && template ? (
                                        <div className="overflow-hidden rounded-xl bg-white dark:bg-zinc-900 shadow-lg border border-border/50 max-w-[300px]">
                                          {(() => {
                                            const h = template.components?.find((c: any) => c.type === 'HEADER');
                                            return !!h && h.format !== 'NONE';
                                          })() && (
                                            <div className="max-h-[150px] aspect-video bg-muted/20 flex items-center justify-center relative overflow-hidden border-b border-border/10">
                                              {(() => {
                                                const header = template.components.find((c: any) => c.type === 'HEADER');
                                                let mediaUrl = resolveMediaUrl(m.media_url || header?.example?.header_handle?.[0]);
                                                
                                                const isNumericId = mediaUrl && /^\d+$/.test(mediaUrl.toString());
                                                
                                                if (header?.format === 'IMAGE' && mediaUrl && !isNumericId) {
                                                  return <img src={mediaUrl} alt="Header" className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewMedia({ url: mediaUrl, type: 'image' })} />;
                                                } else if (header?.format === 'VIDEO' && mediaUrl) {
                                                  return (
                                                    <div className="w-full h-full relative cursor-pointer" onClick={() => setPreviewMedia({ url: mediaUrl, type: 'video' })}>
                                                      <video src={mediaUrl} className="w-full h-full object-cover" />
                                                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                        <Play className="w-8 h-8 text-white" />
                                                      </div>
                                                    </div>
                                                  );
                                                } else if (header?.format === 'TEXT') {
                                                  return <div className="p-3 font-bold text-sm text-foreground w-full">{header.text}</div>;
                                                }
                                                return <div className="text-[10px] text-muted-foreground flex flex-col items-center gap-1"><ImageIcon className="w-5 h-5 opacity-20" /> Sem mídia</div>;
                                              })()}
                                            </div>
                                          )}
                                          <div className="p-3 space-y-2">
                                            <div className="text-[13px] md:text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                                              {(() => {
                                                // Texto real digitado/salvo (quando existir)
                                                const raw = (m.content || '').replace(/\[Template: .*?\]\s*/, '').trim();
                                                if (raw) return raw;
                                                // Fallback: corpo aprovado do template na Meta
                                                const bodyText = template?.components?.find((c: any) => c.type === 'BODY')?.text || '';
                                                if (!bodyText) return m.content || '';
                                                // Substitui variáveis pelos exemplos aprovados, se houver
                                                const examples = template?.components?.find((c: any) => c.type === 'BODY')?.example?.body_text?.[0] || [];
                                                return bodyText.replace(/\{\{(\d+)\}\}/g, (_: string, n: string) => examples[Number(n) - 1] ?? '');
                                              })()}
                                            </div>

                                            {template.components?.find((c: any) => c.type === 'FOOTER') && (
                                              <div className="text-[10px] opacity-60 uppercase font-medium">
                                                {template.components.find((c: any) => c.type === 'FOOTER').text}
                                              </div>
                                            )}
                                          </div>
                                          {template.components?.find((c: any) => c.type === 'BUTTONS')?.buttons?.map((btn: any, bIdx: number) => (
                                            <div key={bIdx} className="flex items-center justify-center p-2 border-t border-border/30 text-blue-500 text-xs font-bold hover:bg-muted/5 transition-colors cursor-default">
                                              {btn.text}
                                            </div>
                                          ))}
                                        </div>
                                      ) : m.message_type === 'carousel' && m.metadata?.carousel ? (
                                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide max-w-full">
                                          {m.metadata.carousel.cards.map((card: any, cIdx: number) => (
                                            <div key={cIdx} className="overflow-hidden rounded-xl bg-white dark:bg-zinc-900 shadow-md border border-border/40 w-[240px] shrink-0">
                                              {card.header && (card.header.format === 'IMAGE' || card.header.format === 'VIDEO') && (
                                                <div className="h-[135px] bg-muted/20 flex items-center justify-center relative overflow-hidden border-b border-border/10">
                                                  {(() => {
                                                    const mediaUrl = resolveMediaUrl(card.header.media_url || card.header.example?.header_handle?.[0] || card.header.image?.link || card.header.video?.link);
                                                    if (card.header.format === 'IMAGE' && mediaUrl) {
                                                      return <img src={mediaUrl} alt="Card" className="w-full h-full object-cover cursor-pointer" onClick={() => setPreviewMedia({ url: mediaUrl, type: 'image' })} />;
                                                    } else if (card.header.format === 'VIDEO' && mediaUrl) {
                                                      return (
                                                        <div className="w-full h-full relative cursor-pointer" onClick={() => setPreviewMedia({ url: mediaUrl, type: 'video' })}>
                                                          <video src={mediaUrl} className="w-full h-full object-cover" />
                                                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                            <Play className="w-6 h-6 text-white" />
                                                          </div>
                                                        </div>
                                                      );
                                                    }
                                                    return null;
                                                  })()}
                                                </div>
                                              )}
                                              <div className="p-3 space-y-1.5">
                                                {card.body?.text && (
                                                  <div className="text-[12px] leading-relaxed text-zinc-800 dark:text-zinc-200 line-clamp-3">
                                                    {card.body.text}
                                                  </div>
                                                )}
                                              </div>
                                              {card.buttons?.buttons?.map((btn: any, bIdx: number) => (
                                                <div key={bIdx} className="flex items-center justify-center p-2 border-t border-border/30 text-blue-500 text-[10px] font-bold">
                                                  {btn.text}
                                                </div>
                                              ))}
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <>
                                          {m.message_type === 'image' && m.media_url && !/^\d+$/.test(m.media_url.toString()) && (
                                            <div className="mb-2 overflow-hidden rounded-lg border border-border/20 shadow-sm bg-muted/20 max-w-fit">
                                              <img 
                                                src={resolveMediaUrl(m.media_url)} 
                                                alt="Mídia" 
                                                className="max-h-[180px] w-auto object-cover cursor-zoom-in transition-transform hover:scale-[1.02] duration-300" 
                                                onClick={() => setPreviewMedia({ url: resolveMediaUrl(m.media_url), type: 'image' })} 
                                              />
                                            </div>
                                          )}
                                          {m.message_type === 'sticker' && m.media_url && (
                                            <div className="mb-2 max-w-[150px]">
                                              <img 
                                                src={resolveMediaUrl(m.media_url)} 
                                                alt="Sticker" 
                                                className="w-full h-auto cursor-zoom-in" 
                                                onClick={() => setPreviewMedia({ url: resolveMediaUrl(m.media_url), type: 'image' })}
                                              />
                                            </div>
                                          )}
                                          {m.message_type === 'image' && m.media_url && /^\d+$/.test(m.media_url.toString()) && (
                                            <div className="mb-2 p-4 rounded-lg border border-dashed border-border flex flex-col items-center justify-center bg-muted/5">
                                              <ImageIcon className="w-8 h-8 text-muted-foreground opacity-20 mb-2" />
                                              <span className="text-[10px] text-muted-foreground">ID de Mídia Meta: {m.media_url}</span>
                                            </div>
                                          )}
                                          {m.message_type === 'video' && m.media_url && (
                                            <div 
                                              className="mb-2 overflow-hidden rounded-lg border border-border/20 shadow-sm bg-muted/20 relative group cursor-pointer max-w-fit"
                                              onClick={() => setPreviewMedia({ url: resolveMediaUrl(m.media_url), type: 'video' })}
                                            >
                                              <video src={resolveMediaUrl(m.media_url)} className="max-h-[180px] w-auto object-cover rounded-lg shadow-inner" preload="metadata" />
                                              <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                                                <Play className="w-10 h-10 text-white opacity-80 group-hover:opacity-100 transition-opacity" />
                                              </div>
                                            </div>
                                          )}
                                           {(m.message_type === 'audio' || m.message_type === 'voice') && m.media_url && (
                                             <div className="mb-1">
                                               <WhatsAppAudioPlayer src={resolveMediaUrl(m.media_url)} outbound={m.direction === 'outbound'} />
                                              {m.direction === 'outbound' && m.status === 'failed' && !m.meta_message_id && (
                                                <div className="mt-2 flex items-center justify-between gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30">
                                                  <div className="flex items-center gap-1.5 text-[10px] text-red-500 dark:text-red-300 font-medium">
                                                    <AlertCircle className="w-3 h-3" />
                                                    Não enviado
                                                  </div>
                                                  <Button
                                                    size="sm"
                                                    variant="destructive"
                                                    className="h-6 px-2 text-[10px] gap-1"
                                                    disabled={resendingAudioIds.has(m.id)}
                                                    onClick={() => handleResendAudio(m)}
                                                  >
                                                    <RotateCw className={cn("w-3 h-3", resendingAudioIds.has(m.id) && "animate-spin")} />
                                                    {resendingAudioIds.has(m.id) ? 'Reenviando...' : 'Reenviar'}
                                                  </Button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          {m.message_type === 'document' && m.media_url && (
                                            <div 
                                              onClick={() => setPreviewDocument({ url: m.media_url, fileName: m.metadata?.fileName || m.metadata?.filename || m.file_name || undefined })}
                                              className="mb-2 p-3 rounded-xl bg-muted/20 border border-border/20 flex items-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
                                            >
                                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                <FileText className="w-5 h-5 text-primary" />
                                              </div>
                                              <div className="flex-1 overflow-hidden">
                                                <div className="text-[13px] font-medium truncate">{m.metadata?.fileName || m.metadata?.filename || m.file_name || 'Documento'}</div>
                                                <div className="text-[10px] opacity-60">Clique para visualizar</div>
                                              </div>
                                            </div>
                                          )}

                                          {m.message_type === 'location' && (
                                            <div className="mb-2 p-3 rounded-xl bg-muted/20 border border-border/20 flex flex-col gap-2">
                                              <div className="flex items-center gap-2">
                                                <MapPin className="w-4 h-4 text-primary" />
                                                <span className="text-xs font-bold">Localização Recebida</span>
                                              </div>
                                              <div className="text-[10px] opacity-60 truncate">{m.content}</div>
                                              <Button 
                                                variant="secondary" 
                                                size="sm" 
                                                className="w-full text-[10px] h-7"
                                                onClick={() => {
                                                  const lat = m.metadata?.location?.latitude || m.content?.match(/Lat: (.*?),/)?.[1];
                                                  const lng = m.metadata?.location?.longitude || m.content?.match(/Long: (.*?)(\s|$)/)?.[1];
                                                  if (lat && lng) window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank');
                                                }}
                                              >
                                                Ver no Google Maps
                                              </Button>
                                            </div>
                                          )}
                                          {m.message_type === 'reaction' && (
                                            <div className="absolute -bottom-3 right-0 bg-zinc-800 border border-white/10 rounded-full px-1.5 py-0.5 text-xs shadow-md z-10">
                                              {m.content?.replace('[Reação] ', '')}
                                            </div>
                                          )}
                                          {m.message_type === 'contacts' && (
                                            <div className="mb-2 p-3 rounded-xl bg-muted/20 border border-border/20 flex items-center gap-3">
                                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                                <UserPlus className="w-5 h-5 text-primary" />
                                              </div>
                                              <div className="flex-1 overflow-hidden">
                                                <div className="text-[13px] font-medium truncate">{m.content?.replace('[Contato] ', '')}</div>
                                                <div className="text-[10px] opacity-60">Contato compartilhado</div>
                                              </div>
                                            </div>
                                          )}
                                          {(m.message_text || m.content) && m.message_type !== 'reaction' && m.message_type !== 'audio' && m.message_type !== 'voice' && m.message_type !== 'unsupported' && !((m.message_text || m.content || '').trim() === '[Mensagem de Áudio]') && !/^\[(image|video|document|audio|sticker|imagem|vídeo|video|documento|áudio|audio)\]$/i.test((m.message_text || m.content || '').trim()) && (
                                            <div className="space-y-2">
                                              <div
                                                className="text-sm md:text-[15px] leading-relaxed break-words whitespace-pre-wrap px-0.5"
                                                style={{ fontFamily: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif` }}
                                              >
                                                {m.message_text || m.content}
                                              </div>
                                              
                                              {/* Botões Interativos no Histórico */}
                                              {m.metadata?.interactive?.action?.buttons && (
                                                <div className="flex flex-col gap-1.5 mt-2 border-t border-border/10 pt-2">
                                                  {m.metadata.interactive.action.buttons.map((btn: any, bIdx: number) => (
                                                    <div 
                                                      key={bIdx} 
                                                      className="flex items-center justify-center p-2 rounded-lg bg-background/50 border border-border/20 text-[11px] font-bold text-primary shadow-sm"
                                                    >
                                                      {btn.reply?.title || btn.text}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}

                                              {/* Botão CTA com link (cta_url) */}
                                              {m.metadata?.interactive?.type === 'cta_url' && m.metadata?.interactive?.action?.parameters?.url && (
                                                <div className="mt-2 border-t border-border/10 pt-2">
                                                  <a
                                                    href={m.metadata.interactive.action.parameters.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center justify-center gap-1.5 p-2 rounded-lg bg-background/50 border border-border/20 text-[12px] font-semibold text-primary shadow-sm hover:bg-background/80 transition-colors"
                                                  >
                                                    <LinkIcon className="w-3.5 h-3.5" />
                                                    {m.metadata.interactive.action.parameters.display_text || 'Acessar'}
                                                  </a>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          {m.message_type === 'unsupported' && hasReadableUnsupportedContent(m) && (
                                            <div className="space-y-2">
                                              <div
                                                className="text-sm md:text-[15px] leading-relaxed break-words whitespace-pre-wrap px-0.5"
                                                style={{ fontFamily: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif` }}
                                              >
                                                {m.message_text || m.content}
                                              </div>
                                            </div>
                                          )}
                                          {m.message_type === 'unsupported' && !hasReadableUnsupportedContent(m) && null}
                                          {(() => {
                                            const ref = getAdReferral(m);
                                            if (!ref) return null;
                                            const thumb = ref.thumbnail_url || ref.image_url;
                                            const Wrapper: any = ref.source_url ? 'a' : 'div';
                                            const wrapperProps: any = ref.source_url
                                              ? { href: ref.source_url, target: '_blank', rel: 'noopener noreferrer' }
                                              : {};
                                            return (
                                              <Wrapper
                                                {...wrapperProps}
                                                className="mt-2 block p-1.5 rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-200 w-[160px] shadow-sm hover:shadow-md transition-shadow"
                                                title="Ver anúncio"
                                              >
                                                <div className="flex items-center justify-between gap-1 mb-1">
                                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                                    📣 Anúncio
                                                  </span>
                                                </div>
                                                {thumb ? (
                                                  <img src={thumb} alt="Anúncio" className="w-full aspect-square object-cover rounded-lg border border-emerald-100" />
                                                ) : (
                                                  <div className="w-full aspect-square rounded-lg border border-emerald-100 bg-emerald-50/60 flex items-center justify-center text-[10px] text-emerald-700">
                                                    Ver anúncio
                                                  </div>
                                                )}
                                                {ref.source_url && (
                                                  <div className="mt-1 text-center text-[10px] font-semibold text-emerald-700">
                                                    🔗 Ver anúncio
                                                  </div>
                                                )}
                                              </Wrapper>
                                            );
                                          })()}
                                        </>
                                      )}
                                      {m.direction === 'outbound' && m.status === 'failed' && (
                                        <div className={cn(
                                          "mt-2 flex items-start gap-1.5 rounded-md border p-2 text-[10px] leading-snug clear-both transition-colors",
                                          isBusinessVerificationError(m)
                                            ? "bg-white text-zinc-950 border-white/20 shadow-sm"
                                            : "bg-destructive/10 text-destructive border-destructive/30"
                                        )}>
                                          <AlertCircle className={cn("w-3 h-3 mt-0.5 shrink-0", isBusinessVerificationError(m) ? "text-zinc-950" : "text-destructive")} />
                                          <div className="flex-1">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <span>{getMetaDeliveryErrorMessage(m)}</span>
                                              <button
                                                type="button"
                                                title="O que aconteceu?"
                                                aria-label="Entenda o que aconteceu"
                                                onClick={() => setExpandedErrorMessageId(prev => (prev === m.id ? null : m.id))}
                                                className={cn(
                                                  "inline-flex items-center justify-center rounded-full border p-0.5 transition-colors",
                                                  isBusinessVerificationError(m)
                                                    ? "border-zinc-300 text-zinc-900 hover:bg-zinc-100"
                                                    : "border-destructive/40 text-destructive hover:bg-destructive/15"
                                                )}
                                              >
                                                <LucideIcons.HelpCircle className="w-3 h-3" />
                                              </button>
                                              {m.message_type === 'text' && (
                                                <button
                                                  type="button"
                                                  disabled={resendingMessageId === m.id}
                                                  onClick={() => handleResendFailedMessage(m)}
                                                  className={cn(
                                                    "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-60",
                                                    isBusinessVerificationError(m)
                                                      ? "border-zinc-200 bg-zinc-50 text-zinc-900 hover:bg-zinc-100"
                                                      : "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
                                                  )}
                                                >
                                                  <LucideIcons.RefreshCw className={cn("w-3 h-3", resendingMessageId === m.id && "animate-spin")} />
                                                  {resendingMessageId === m.id ? 'Reenviando...' : 'Reenviar'}
                                                </button>
                                              )}
                                            </div>
                                            {expandedErrorMessageId === m.id && (
                                              <p className={cn(
                                                "mt-1.5 rounded border p-1.5 text-[10px] leading-snug",
                                                isBusinessVerificationError(m)
                                                  ? "border-zinc-200 bg-zinc-50 text-zinc-700"
                                                  : "border-destructive/30 bg-destructive/5 text-destructive/90"
                                              )}>
                                                {getMetaDeliveryErrorExplanation(m)}
                                              </p>
                                            )}
                                            {isBusinessVerificationError(m) && (
                                              <button
                                                type="button"
                                                onClick={() => window.open('https://business.facebook.com/', '_blank', 'noopener,noreferrer')}
                                                className="mt-1.5 inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-colors"
                                              >
                                                <ExternalLink className="w-3 h-3" />
                                                Meta Business
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      <div className={cn(
                                        "text-[10px] mt-0.5 mb-[-2px] float-right ml-2 opacity-70 flex items-center gap-1 leading-none select-none",
                                        m.direction === 'inbound' ? 'text-muted-foreground' : 'text-[#303030]/60 dark:text-white/60',
                                        m.status === 'failed' && 'text-destructive opacity-100'
                                      )}>
                                        {new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                        {m.direction === 'outbound' && (
                                          m.status === 'failed'
                                            ? <XCircle className="w-3.5 h-3.5 text-destructive" />
                                            : (m.isOptimistic || m.status === 'pending' || m.status === 'sending')
                                              ? <Clock className="w-3 h-3 text-muted-foreground/70 animate-pulse" />
                                              : <LucideIcons.CheckCheck className={cn("w-3.5 h-3.5", m.status === 'read' ? "text-[#53bdeb]" : "text-muted-foreground/60")} />
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  </Fragment>
                                );
                              });
                              })()}
                              <div ref={scrollRef} className="h-4" />
                            </div>
                          </ScrollArea>
                          
                          <div className="p-1 sm:p-2 bg-[#f0f2f5] dark:bg-[#202c33] border-t shadow-lg z-10 space-y-1 sm:space-y-2 shrink-0 w-full min-w-0 overflow-hidden">
                            {selectedContact ? (
                              <>
                                  {isPreviewingAudio && recordedAudioUrl ? (
                                   <div className="flex flex-col gap-2 p-2 bg-primary/5 rounded-xl border border-primary/20 animate-in fade-in slide-in-from-bottom-2 shrink-0">
                                     <div className="flex items-center gap-2 overflow-hidden">
                                       <audio src={recordedAudioUrl} controls className="h-8 flex-1 min-w-0" />
                                       <div className="flex gap-1 shrink-0">
                                         <Button variant="ghost" size="icon" onClick={cancelAudioPreview} className="text-destructive h-8 w-8 hover:bg-destructive/10"><XCircle className="w-4 h-4" /></Button>
                                         <Button size="icon" onClick={() => sendRecordedAudio()} className="h-8 w-8 bg-green-600 hover:bg-green-700 text-white shadow-lg"><Send className="w-4 h-4" /></Button>
                                       </div>
                                     </div>
                                     <p className="text-[9px] text-center text-muted-foreground font-medium uppercase tracking-tighter truncate">Envie ou descarte o áudio</p>
                                   </div>
                                 ) : pastedImagePreview ? (
                                  <div className="flex flex-col gap-2 p-2 bg-primary/5 rounded-xl border border-primary/20 animate-in fade-in slide-in-from-bottom-2 shrink-0">
                                    <div className="relative w-full max-w-[200px] aspect-square rounded-lg overflow-hidden border mx-auto">
                                      <img src={pastedImagePreview} alt="Colado" className="w-full h-full object-cover" />
                                    </div>
                                    <div className="flex justify-center gap-2 mt-1">
                                      <Button variant="ghost" size="sm" onClick={cancelPastedImage} className="text-destructive h-8 px-3 hover:bg-destructive/10">Cancelar</Button>
                                      <Button variant="outline" size="sm" onClick={() => setImageEditorOpen(true)} className="h-8 px-3">Editar</Button>
                                      <Button size="sm" onClick={sendPastedImage} className="h-8 px-3 bg-green-600 hover:bg-green-700 text-white shadow-lg">Enviar Imagem</Button>
                                    </div>
                                    <p className="text-[9px] text-center text-muted-foreground font-medium uppercase tracking-tighter truncate mt-1">Imagem colada pronta para envio</p>
                                  </div>
                                 ) : (
                                  <div className="flex flex-col gap-1.5 max-w-5xl mx-auto w-full px-0.5 sm:px-2 pb-2 shrink-0">
                                    {isRecording && (
                                      <div className="flex items-center justify-between px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full animate-pulse mx-1 shrink-0">
                                        <div className="flex items-center gap-1.5">
                                          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                                          <span className="text-[9px] font-black text-red-600 uppercase tracking-widest">Gravando...</span>
                                        </div>
                                        <span className="text-[10px] font-mono font-black text-red-600">
                                          {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-0.5 sm:gap-1 w-full min-w-0 px-0 sm:px-0">
                                       <div className="flex items-center gap-0 shrink-0">
                                         <DropdownMenu>
                                           <DropdownMenuTrigger asChild>
                                             <Button 
                                               variant="ghost" 
                                               size="icon" 
                                               className="text-[#54656f] dark:text-[#aebac1] hover:bg-muted h-9 w-9 rounded-full shrink-0"
                                             >
                                               <Plus className="w-6 h-6" />
                                             </Button>
                                           </DropdownMenuTrigger>
                                           <DropdownMenuContent align="start" side="top" className="w-52">
                                             <DropdownMenuItem onClick={() => { setUploadType('document'); setTimeout(() => fileInputRef.current?.click(), 0); }}>
                                               <FileText className="w-4 h-4 mr-2" /> Documento (PDF, etc.)
                                             </DropdownMenuItem>
                                             <DropdownMenuItem onClick={() => { setUploadType('image'); setTimeout(() => fileInputRef.current?.click(), 0); }}>
                                               <ImageIcon className="w-4 h-4 mr-2" /> Fotos (várias)
                                             </DropdownMenuItem>
                                             <DropdownMenuItem onClick={() => { setUploadType('video'); setTimeout(() => fileInputRef.current?.click(), 0); }}>
                                               <Video className="w-4 h-4 mr-2" /> Vídeo
                                             </DropdownMenuItem>
                                           </DropdownMenuContent>
                                         </DropdownMenu>
                                         <Button 
                                           variant="ghost" 
                                           size="icon" 
                                           onClick={() => { setUploadType('image'); setTimeout(() => fileInputRef.current?.click(), 0); }} 
                                           className="text-[#54656f] dark:text-[#aebac1] hover:bg-muted h-9 w-9 rounded-full hidden sm:flex shrink-0"
                                         >
                                           <ImageIcon className="w-5 h-5" />
                                         </Button>
                                       </div>
                                      <div className="flex-1 relative flex items-center min-w-0">
                                        <Textarea 
                                          ref={messageTextareaRef}
                                          placeholder={isRecording ? "Gravando..." : "Mensagem"}
                                          value={newMessage} 
                                          disabled={isRecording}
                                          onPaste={handlePaste}
                                          onChange={e => setNewMessage(e.target.value)}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey && !isRecording) {
                                              e.preventDefault();
                                              handleSendMessage();
                                            }
                                          }}
                                           rows={1}
                                           className="bg-white dark:bg-[#2a3942] border-none min-h-10 max-h-[60vh] py-2 pr-8 sm:pr-9 rounded-xl shadow-sm text-sm focus-visible:ring-0 w-full min-w-0 resize-y"
                                        />
                                        <EmojiPicker
                                          disabled={isRecording}
                                          className="absolute right-0.5 text-[#54656f] dark:text-[#aebac1] hover:bg-transparent"
                                          onSelect={(emoji) => {
                                            // Insere na posição do cursor (ou no fim) e mantém o foco no campo
                                            const el = messageTextareaRef.current;
                                            const start = el?.selectionStart ?? newMessage.length;
                                            const end = el?.selectionEnd ?? newMessage.length;
                                            const next = newMessage.slice(0, start) + emoji + newMessage.slice(end);
                                            setNewMessage(next);
                                            requestAnimationFrame(() => {
                                              if (!el) return;
                                              el.focus();
                                              const pos = start + emoji.length;
                                              try { el.setSelectionRange(pos, pos); } catch {}
                                            });
                                          }}
                                        />
                                      </div>
                                      {!isRecording ? (
                                        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                                          {newMessage.trim() ? (
                                            <Button 
                                              size="icon" 
                                              onClick={handleSendMessage} 
                                              className="h-9 w-9 sm:h-10 sm:w-10 shadow-lg rounded-full bg-[#00a884] hover:bg-[#008f6f] text-white active:scale-95 transition-all"
                                            >
                                              <Send className="w-4 h-4 sm:w-5 sm:h-5 ml-0.5" />
                                            </Button>
                                          ) : (
                                            <div className="relative">
                                              <Button 
                                                size="icon" 
                                                variant="ghost" 
                                                className={cn(
                                                  "h-9 w-9 sm:h-10 sm:w-10 rounded-full",
                                                  !metaSettings.vps_transcoder_url || metaSettings.vps_status === 'offline' 
                                                    ? "text-orange-500 bg-orange-50 hover:bg-orange-100" 
                                                    : "text-[#54656f] dark:text-[#aebac1] hover:bg-muted"
                                                )}
                                                onClick={startRecording}
                                              >
                                                <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
                                              </Button>
                                              {(!metaSettings.vps_transcoder_url || metaSettings.vps_status === 'offline') && (
                                                <div className="absolute -top-1 -right-1">
                                                  <div className="bg-orange-500 rounded-full p-0.5 border-2 border-white">
                                                    <AlertCircle className="w-2.5 h-2.5 text-white" />
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <Button 
                                          size="icon" 
                                          variant="ghost" 
                                          className="h-10 w-10 text-red-500 bg-red-50 hover:bg-red-100 rounded-full shrink-0"
                                          onClick={stopRecording}
                                        >
                                          <StopCircle className="w-5 h-5" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                )}
                                <input
                                  type="file"
                                  ref={fileInputRef}
                                  className="hidden"
                                  multiple={uploadType === 'image' || uploadType === 'document'}
                                  accept={
                                    uploadType === 'image' ? 'image/*'
                                    : uploadType === 'video' ? 'video/*'
                                    : uploadType === 'document' ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain'
                                    : undefined
                                  }
                                  onChange={handleFileSelect}
                                />
                              </>
                            ) : (
                              <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8 bg-white dark:bg-[#111b21]">
                                <div className="w-20 h-20 rounded-full bg-muted/20 flex items-center justify-center">
                                  <MessageSquare className="w-10 h-10 text-muted-foreground/30" />
                                </div>
                                <h3 className="text-lg font-bold">WhatsApp Business CRM</h3>
                                <p className="text-muted-foreground text-sm max-w-[280px]">Selecione uma conversa para começar a atender seus clientes em tempo real.</p>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full w-full bg-[#f0f2f5] dark:bg-[#0c1317]">
                           <div className="text-center p-8">
                            <div className="w-24 h-24 rounded-full bg-muted/20 flex items-center justify-center mx-auto mb-4">
                              <Bot className="w-12 h-12 text-muted-foreground/20" />
                            </div>
                            <h3 className="text-xl font-bold mb-2">Selecione uma Conversa</h3>
                            <p className="text-muted-foreground max-w-sm mx-auto">Conecte-se com seus clientes de forma profissional e organizada.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              )}
            </div>

            {/* Agendamentos */}
            <div className={cn("flex-1 h-full overflow-hidden", activeTab !== 'scheduling' && "hidden")}>
              {activeTab === 'scheduling' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-7xl mx-auto space-y-4 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-card p-4 md:p-6 rounded-2xl border shadow-sm">
                    <div className="min-w-0">
                      <h2 className="text-lg md:text-2xl font-bold tracking-tight">Agendamentos</h2>
                      <p className="text-muted-foreground text-xs md:text-sm">Visualize e gerencie todas as mensagens agendadas e o histórico de envios.</p>
                    </div>
                    <div className="flex flex-col xs:flex-row sm:flex-row items-stretch sm:items-center gap-2 sm:shrink-0 w-full sm:w-auto">
                      <Button variant="outline" onClick={fetchAllScheduledMessages} className="h-10 px-4 rounded-xl w-full sm:w-auto">
                        <RefreshCcw className="w-4 h-4 mr-2" /> Atualizar
                      </Button>
                      <Button 
                        onClick={() => {
                          setScheduleDate('');
                          setScheduleDateObj(undefined);
                          setScheduleTime('');
                          setSelectedContactsForScheduling([]);
                          setContactListText('');
                          setIsSchedulingOpen(true);
                        }} 
                        className="h-10 px-4 sm:px-6 rounded-xl bg-primary shadow-lg shadow-primary/20 font-bold w-full sm:w-auto"
                      >
                        <Plus className="w-4 h-4 mr-2" /> Novo Agendamento
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <Card className="border-none shadow-md overflow-hidden rounded-2xl">
                      <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="text-lg">Próximos Agendamentos</CardTitle>
                        <CardDescription>Mensagens aguardando o horário de envio.</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        {/* Mobile cards */}
                        <div className="md:hidden divide-y">
                          {allScheduledMessages.filter(m => m.status === 'pending').length > 0 ? (
                            allScheduledMessages.filter(m => m.status === 'pending').map((msg) => (
                              <div key={msg.id} className="p-4 flex flex-col gap-2">
                                <div className="flex justify-between items-start gap-2">
                                  <div className="min-w-0">
                                    <p className="font-bold text-sm truncate">{msg.crm_contacts?.name || msg.crm_contacts?.wa_id || 'Desconhecido'}</p>
                                    <p className="text-[11px] text-muted-foreground truncate">
                                      {msg.message_data?.text || msg.message_data?.templateName || msg.message_data?.flowId || '-'}
                                    </p>
                                  </div>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="text-destructive hover:bg-destructive/10 h-8 w-8 shrink-0"
                                    onClick={async () => {
                                      if (confirm('Deseja cancelar este agendamento?')) {
                                        await supabase.from('crm_scheduled_messages').update({ status: 'canceled' }).eq('id', msg.id);
                                        fetchAllScheduledMessages();
                                      }
                                    }}
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </Button>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                                  <Badge variant="outline" className="capitalize text-[10px]">
                                    {msg.message_data?.action === 'sendMessage' ? 'Texto' : 
                                     msg.message_data?.action === 'sendTemplate' ? 'Template' : 
                                     msg.message_data?.action === 'startFlow' ? 'Fluxo' : msg.message_data?.action}
                                  </Badge>
                                  <span className="text-muted-foreground font-medium">
                                    {new Date(msg.scheduled_for).toLocaleString('pt-BR')}
                                  </span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-8 text-center text-muted-foreground italic text-xs">
                              Nenhum agendamento pendente encontrado.
                            </div>
                          )}
                        </div>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground border-b">
                              <tr>
                                <th className="px-6 py-3">Contato</th>
                                <th className="px-6 py-3">Tipo</th>
                                <th className="px-6 py-3">Conteúdo</th>
                                <th className="px-6 py-3">Agendado Para</th>
                                <th className="px-6 py-3 text-right">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {allScheduledMessages.filter(m => m.status === 'pending').length > 0 ? (
                                allScheduledMessages.filter(m => m.status === 'pending').map((msg) => (
                                  <tr key={msg.id} className="hover:bg-muted/20 transition-colors">
                                    <td className="px-6 py-4 font-bold">
                                      {msg.crm_contacts?.name || msg.crm_contacts?.wa_id || 'Desconhecido'}
                                    </td>
                                    <td className="px-6 py-4">
                                      <Badge variant="outline" className="capitalize">
                                        {msg.message_data?.action === 'sendMessage' ? 'Texto' : 
                                         msg.message_data?.action === 'sendTemplate' ? 'Template' : 
                                         msg.message_data?.action === 'startFlow' ? 'Fluxo' : msg.message_data?.action}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4 max-w-xs truncate text-muted-foreground">
                                      {msg.message_data?.text || msg.message_data?.templateName || msg.message_data?.flowId || '-'}
                                    </td>
                                    <td className="px-6 py-4 font-medium">
                                      {new Date(msg.scheduled_for).toLocaleString('pt-BR')}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="text-destructive hover:bg-destructive/10"
                                        onClick={async () => {
                                          if (confirm('Deseja cancelar este agendamento?')) {
                                            await supabase.from('crm_scheduled_messages').update({ status: 'canceled' }).eq('id', msg.id);
                                            fetchAllScheduledMessages();
                                          }
                                        }}
                                      >
                                        <XCircle className="w-4 h-4" />
                                      </Button>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={5} className="px-6 py-10 text-center text-muted-foreground italic">
                                    Nenhum agendamento pendente encontrado.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-none shadow-md overflow-hidden rounded-2xl">
                      <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="text-lg">Histórico de Envios</CardTitle>
                        <CardDescription>Registro de mensagens enviadas ou com erro.</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        {/* Mobile cards */}
                        <div className="md:hidden divide-y">
                          {scheduledHistory.length > 0 ? (
                            scheduledHistory
                              .map((msg) => (
                              <div key={msg.id} className="p-4 flex flex-col gap-2">
                                <div className="flex justify-between items-start gap-2">
                                  <p className="font-bold text-sm truncate min-w-0">{msg.crm_contacts?.name || msg.crm_contacts?.wa_id || 'Desconhecido'}</p>
                                  <Badge 
                                    variant={msg.status === 'sent' ? 'default' : 'destructive'}
                                    className={cn(
                                      "capitalize text-[10px] shrink-0",
                                      msg.status === 'sent' ? "bg-green-500/10 text-green-600 border-green-200" : ""
                                    )}
                                  >
                                    {msg.status === 'sent' ? 'Enviado' : msg.status === 'canceled' ? 'Cancelado' : 'Erro'}
                                  </Badge>
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                                  <Badge variant="outline" className="capitalize text-[10px]">
                                    {msg.message_data?.action === 'sendMessage' ? 'Texto' : 
                                     msg.message_data?.action === 'sendTemplate' ? 'Template' : 
                                     msg.message_data?.action === 'startFlow' ? 'Fluxo' : msg.message_data?.action}
                                  </Badge>
                                  <span className="text-muted-foreground">{new Date(msg.scheduled_for).toLocaleString('pt-BR')}</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-8 text-center text-muted-foreground italic text-xs">
                              Nenhum histórico encontrado.
                            </div>
                          )}
                        </div>
                        {/* Desktop table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground border-b">
                              <tr>
                                <th className="px-6 py-3">Contato</th>
                                <th className="px-6 py-3">Tipo</th>
                                <th className="px-6 py-3">Status</th>
                                <th className="px-6 py-3">Enviado Em</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {scheduledHistory.length > 0 ? (
                                scheduledHistory
                                  .map((msg) => (
                                  <tr key={msg.id} className="hover:bg-muted/20 transition-colors">
                                    <td className="px-6 py-4 font-bold">
                                      {msg.crm_contacts?.name || msg.crm_contacts?.wa_id || 'Desconhecido'}
                                    </td>
                                    <td className="px-6 py-4">
                                      <Badge variant="outline" className="capitalize">
                                        {msg.message_data?.action === 'sendMessage' ? 'Texto' : 
                                         msg.message_data?.action === 'sendTemplate' ? 'Template' : 
                                         msg.message_data?.action === 'startFlow' ? 'Fluxo' : msg.message_data?.action}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                      <Badge 
                                        variant={msg.status === 'sent' ? 'default' : 'destructive'}
                                        className={cn(
                                          "capitalize",
                                          msg.status === 'sent' ? "bg-green-500/10 text-green-600 border-green-200" : ""
                                        )}
                                      >
                                        {msg.status === 'sent' ? 'Enviado' : msg.status === 'canceled' ? 'Cancelado' : 'Erro'}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">
                                      {new Date(msg.scheduled_for).toLocaleString('pt-BR')}
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={4} className="px-6 py-10 text-center text-muted-foreground italic">
                                    Nenhum histórico encontrado.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </ScrollArea>
              )}
            </div>

            {/* Fluxos */}
            <div className={cn("flex-1 h-full overflow-hidden flex flex-col", activeTab !== 'flows' && "hidden")}>
              {activeTab === 'flows' && (
              <ScrollArea className="flex-1 h-full p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-7xl mx-auto space-y-4 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-card p-4 md:p-6 rounded-2xl border shadow-sm">
                    <div className="min-w-0">
                      <h2 className="text-lg md:text-2xl font-bold tracking-tight">Fluxos de Automação</h2>
                      <p className="text-muted-foreground text-xs md:text-sm">Crie gatilhos e sequências automáticas de mensagens inteligentes.</p>
                    </div>
                    <Button onClick={() => { setEditingFlow(null); setIsFlowEditorOpen(true); }} className="shadow-lg shadow-[#00a884]/20 bg-[#00a884] hover:bg-[#008f6f] text-white font-bold shrink-0 self-start sm:self-auto rounded-xl h-10 transition-all active:scale-95">
                      <Plus className="w-4 h-4 mr-2" /> Novo Fluxo Visual
                    </Button>
                  </div>

                  <Accordion type="single" collapsible className="w-full space-y-4">
                    <AccordionItem value="flows-list" className="border-none">
                      <AccordionTrigger className="bg-card p-6 rounded-2xl border shadow-sm hover:no-underline">
                        <div className="flex flex-col items-start text-left">
                          <h3 className="text-xl font-bold tracking-tight">Lista de Fluxos</h3>
                          <p className="text-muted-foreground text-sm font-normal">Clique para ver e gerenciar seus fluxos de automação.</p>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-6">
                          {flows.length > 0 ? (
                            flows.map((flow) => (
                              <Card key={flow.id} className="group overflow-hidden border-zinc-200 dark:border-zinc-800 hover:shadow-md transition-all">
                                <CardHeader className="bg-muted/30 pb-4 border-b">
                                  <div className="flex justify-between items-start mb-2">
                                    <Badge variant={flow.is_active ? "default" : "secondary"} className={cn("text-[10px]", flow.is_active ? "bg-green-500/10 text-green-600 border-green-200" : "")}>
                                      {flow.is_active ? 'Ativo' : 'Inativo'}
                                    </Badge>
                                    <div className="flex gap-1">
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-7 w-7 text-primary hover:bg-primary/10" 
                                        onClick={() => handleDuplicateFlow(flow)}
                                        title="Duplicar Fluxo"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={async () => {
                                        if (confirm('Deseja excluir este fluxo?')) {
                                          await supabase.from('crm_flows').delete().eq('id', flow.id);
      fetchData(false);

                                        }
                                      }}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </div>
                                  <CardTitle className="text-lg truncate">{flow.name}</CardTitle>
                                  <CardDescription className="text-[11px] flex items-center gap-1.5 mt-1 font-medium">
                                    <Zap className="w-3 h-3 text-amber-500" /> Gatilho: <span className="text-foreground">{flow.trigger_type || 'Manual'}</span>
                                  </CardDescription>
                                </CardHeader>
                                <CardContent className="p-4 bg-card">
                                  <Button variant="outline" size="sm" className="w-full hover:bg-primary hover:text-white transition-colors h-9" onClick={() => { setEditingFlow(flow); setIsFlowEditorOpen(true); }}>
                                    <GitBranch className="w-4 h-4 mr-2" /> Abrir Editor Visual
                                  </Button>
                                </CardContent>
                              </Card>
                            ))
                          ) : (
                            <div className="col-span-full py-20 text-center bg-card rounded-2xl border-2 border-dashed border-muted flex flex-col items-center justify-center gap-4">
                              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                                <GitBranch className="w-8 h-8 text-muted-foreground/50" />
                              </div>
                              <div className="max-w-xs mx-auto">
                                <h3 className="font-bold text-lg">Nenhum fluxo criado</h3>
                                <p className="text-sm text-muted-foreground">Comece criando um novo fluxo visual para automatizar suas mensagens do WhatsApp.</p>
                              </div>
                              <Button variant="outline" size="sm" onClick={() => setIsFlowEditorOpen(true)}>Criar meu primeiro fluxo</Button>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </ScrollArea>
            )}
            </div>

            {activeTab === 'ai-agent' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-4xl mx-auto space-y-4 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-card p-4 md:p-6 rounded-2xl border shadow-sm">
                    <div className="min-w-0">
                      <h2 className="text-lg md:text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Bot className="w-5 h-5 md:w-6 md:h-6 text-[#00a884] shrink-0" /> <span className="truncate">Agente de Inteligência Artificial</span>
                      </h2>
                      <p className="text-muted-foreground text-xs md:text-sm">Configure como a IA deve interagir com seus clientes.</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Label htmlFor="ai-agent-enabled" className="text-sm font-bold">Ativação Geral</Label>
                      <Switch 
                        id="ai-agent-enabled"
                        checked={metaSettings.ai_agent_enabled}
                        onCheckedChange={async (val) => {
                          if (val) {
                            // Check if API key is present
                            if (!metaSettings.openai_api_key) {
                              toast({
                                title: "Token não configurado",
                                description: "Por favor, insira uma OpenAI API Key na seção 'Motor da IA' e clique em 'Salvar Motor' antes de ativar.",
                                variant: "destructive"
                              });
                              return;
                            }

                            // Nunca ligar a I.A. com API errada — era o cenário
                            // "ativada mas não responde" (401 invalid_api_key).
                            const keyCheck = await validateOpenAiKey(
                              String(metaSettings.openai_api_key).trim()
                            );
                            if (!keyCheck.valid) return;


                            if (!metaSettings.business_description || metaSettings.business_description.length < 10) {
                              toast({
                                title: "Cérebro não configurado",
                                description: "Por favor, preencha as instruções do seu negócio na seção 'Instruções do Agente (Cérebro)' antes de ativar a IA.",
                                variant: "destructive"
                              });
                              return;
                            }
                            
                            if (!confirm("Ao ativar o IA em modo geral, ele responderá automaticamente a toda e qualquer mensagem que chegar. Caso deseje ativar o agente apenas em momentos específicos, controle isso via FLUXOS.\n\nDeseja ativar o agente IA e deixar que ele responda tudo por você? (Você pode assumir o controle a qualquer momento).")) {
                              return;
                            }
                          }
                          
                          // We use await here to ensure state consistency if handleSaveSettings re-fetches
                          setMetaSettings(prev => ({ ...prev, ai_agent_enabled: val }));
                          await handleSaveSettings({ ...metaSettings, ai_agent_enabled: val });
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="rounded-lg shadow-sm border">
                      <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <Label htmlFor="ai-kanban-auto-organizer" className="text-sm font-bold">
                            Organizador Kanban CRM automático
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            A IA organiza a conversa como frio, quente, cliente ou quer falar com humano.
                          </p>
                        </div>
                        <Switch
                          id="ai-kanban-auto-organizer"
                          checked={!!metaSettings.ai_kanban_auto_organizer}
                          onCheckedChange={async (val) => {
                            setMetaSettings((previous: typeof metaSettings) => ({ ...previous, ai_kanban_auto_organizer: val }));
                            await handleSaveSettings({ ...metaSettings, ai_kanban_auto_organizer: val });
                          }}
                          aria-label="Ativar organizador Kanban CRM automático"
                        />
                      </CardContent>
                    </Card>

                    <Card className="rounded-lg shadow-sm border">
                      <CardContent className="p-4 flex items-center justify-between gap-4">
                        <div className="min-w-0 space-y-1">
                          <Label htmlFor="ai-send-bundled" className="text-sm font-bold">
                            Enviar tudo o mais junto possível
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Envia uma resposta única; somente textos muito longos são divididos com segurança.
                          </p>
                        </div>
                        <Switch
                          id="ai-send-bundled"
                          checked={!!metaSettings.ai_send_bundled}
                          onCheckedChange={async (val) => {
                            setMetaSettings((previous: typeof metaSettings) => ({ ...previous, ai_send_bundled: val }));
                            await handleSaveSettings({ ...metaSettings, ai_send_bundled: val });
                          }}
                          aria-label="Enviar respostas da IA o mais junto possível"
                        />
                      </CardContent>
                    </Card>
                  </div>

                  {/* RECUPERADOR IA — reengaja conversas paradas usando o mesmo cérebro do agente */}
                  <Card className="rounded-2xl shadow-sm border overflow-hidden">
                    <CardHeader className="bg-amber-50 dark:bg-amber-950/20 border-b p-4 md:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="text-base md:text-lg flex items-center gap-2">
                            <Clock className="w-4 h-4 text-amber-500 shrink-0" /> Recuperador I.A.
                          </CardTitle>
                          <CardDescription className="text-xs md:text-sm">
                            Se a conversa ficar parada por X tempo, a I.A. avalia o histórico e chama o cliente de volta automaticamente.
                          </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Label htmlFor="ai-recovery-enabled" className="text-sm font-bold">Ativar</Label>
                          <Switch
                            id="ai-recovery-enabled"
                            checked={!!metaSettings.ai_recovery_enabled}
                            onCheckedChange={async (val) => {
                              if (val && !metaSettings.ai_agent_enabled) {
                                toast({
                                  title: "Ative o Agente I.A. primeiro",
                                  description: "O Recuperador I.A. funciona apenas com a Ativação Geral do Agente I.A. ligada.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              setMetaSettings(prev => ({ ...prev, ai_recovery_enabled: val }));
                              await handleSaveSettings({ ...metaSettings, ai_recovery_enabled: val });
                            }}
                          />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-bold">Inatividade (minutos)</Label>
                        <Input
                          type="number"
                          min={5}
                          value={metaSettings.ai_recovery_delay_minutes ?? 60}
                          onChange={(e) => setMetaSettings({ ...metaSettings, ai_recovery_delay_minutes: Number(e.target.value) })}
                        />
                        <p className="text-[10px] text-muted-foreground italic">Tempo sem nenhuma mensagem nova antes da recuperação (ex: 60 = 1 hora).</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-bold">Máximo de tentativas</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={metaSettings.ai_recovery_max_attempts ?? 2}
                          onChange={(e) => setMetaSettings({ ...metaSettings, ai_recovery_max_attempts: Number(e.target.value) })}
                        />
                        <p className="text-[10px] text-muted-foreground italic">Zera automaticamente quando o cliente volta a responder.</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-bold">Etiqueta ao finalizar</Label>
                        <Input
                          value={metaSettings.ai_recovery_finalized_status ?? 'Finalizado agente IA'}
                          onChange={(e) => setMetaSettings({ ...metaSettings, ai_recovery_finalized_status: e.target.value })}
                        />
                        <p className="text-[10px] text-muted-foreground italic">Criada no Kanban. Conversas já concluídas recebem essa etiqueta e não são mais recuperadas.</p>
                      </div>
                      <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                        <Label className="text-sm font-bold">O que pode ser recuperado</Label>
                        <Select
                          value={metaSettings.ai_recovery_scope ?? 'ai_only'}
                          onValueChange={async (val) => {
                            setMetaSettings(prev => ({ ...prev, ai_recovery_scope: val }));
                            await handleSaveSettings({ ...metaSettings, ai_recovery_scope: val });
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ai_only">Somente conversas atendidas pelo Agente I.A.</SelectItem>
                            <SelectItem value="all">Todas as conversas dentro da janela de 24h</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground italic">
                          No modo recomendado, o Recuperador ignora conversas antigas, atendidas por fora ou com o Agente I.A. desligado. Em qualquer modo, só recupera dentro da janela de 24h do WhatsApp.
                        </p>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-3 flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={async () => {
                            try {
                              const { error } = await supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'processAiRecovery' } });
                              if (error) throw error;
                              toast({ title: "Recuperador executado", description: "As conversas paradas foram avaliadas agora." });
                            } catch (err: any) {
                              toast({ title: "Erro ao executar", description: err?.message || 'Tente novamente.', variant: "destructive" });
                            }
                          }}
                        >
                          Rodar agora
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={() => handleSaveSettings(metaSettings)}
                        >
                          Salvar Recuperador
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Accordion type="single" collapsible className="w-full space-y-4">
                    <AccordionItem value="motor" className="border-none">
                      <Card className="rounded-2xl shadow-sm border overflow-hidden">
                        <CardHeader className="bg-zinc-50 dark:bg-zinc-900/50 border-b p-0">
                          <AccordionTrigger className="flex-1 px-6 py-4 hover:no-underline [&[data-state=open]>div>h3]:text-primary transition-all">
                            <div className="flex flex-col items-start text-left gap-1">
                              <CardTitle className="text-lg flex items-center gap-2">
                                <LinkIcon className="w-4 h-4 text-zinc-600" /> Motor da IA
                              </CardTitle>
                              <CardDescription>Conexão e Modo de Operação</CardDescription>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
                            <div className="space-y-2">
                              <Label className="text-sm font-bold">OpenAI API Key</Label>
                              <Input 
                                type="password"
                                placeholder="sk-..."
                                value={metaSettings.openai_api_key}
                                onChange={(e) => {
                                  const typed = e.target.value;
                                  // Rascunho em edição: nenhum recarregamento em
                                  // segundo plano pode substituir este valor.
                                  openAiKeyDraftRef.current = typed;
                                  if (validatedOpenAiKeyRef.current?.key !== typed.trim()) {
                                    validatedOpenAiKeyRef.current = null;
                                  }
                                  setMetaSettings((previous: typeof metaSettings) => ({
                                    ...previous,
                                    openai_api_key: typed,
                                  }));
                                  setOpenAiKeyCheck({ state: 'idle' });
                                }}
                                onBlur={(e) => {
                                  const value = e.target.value.trim();
                                  if (openAiKeyDraftRef.current !== null) {
                                    openAiKeyDraftRef.current = value;
                                  }
                                  if (value !== e.target.value) {
                                    setMetaSettings((previous: typeof metaSettings) => ({
                                      ...previous,
                                      openai_api_key: value,
                                    }));
                                  }
                                  if (value) void validateOpenAiKey(value, { silent: true });
                                }}
                              />
                              {openAiKeyCheck.state === 'checking' && (
                                <p className="text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                                  <RefreshCcw className="w-3 h-3 animate-spin" /> Testando a API na OpenAI...
                                </p>
                              )}
                              {openAiKeyCheck.state === 'valid' && (
                                <p className="text-[11px] font-bold text-[#00875A]">API correta ✅ {openAiKeyCheck.message}</p>
                              )}
                              {openAiKeyCheck.state === 'invalid' && (
                                <p
                                  className={cn(
                                    'text-[11px] font-bold',
                                    openAiKeyCheck.code === 'no_credits'
                                      ? 'text-amber-600'
                                      : 'text-destructive'
                                  )}
                                >
                                  {openAiKeyCheck.code === 'no_credits'
                                    ? 'SEM SALDO 💳 '
                                    : 'API ERRADA ❌ '}
                                  {openAiKeyCheck.message}
                                  {openAiKeyCheck.detail ? ` — ${openAiKeyCheck.detail}` : ''}
                                </p>
                              )}
                              <p className="text-[10px] text-muted-foreground italic">Use uma chave da OpenAI (GPT-4o recomendado). A chave é testada antes de salvar.</p>
                            </div>


                            <div className="space-y-2">
                              <Label className="text-sm font-bold flex items-center gap-2">
                                <Zap className="w-4 h-4 text-amber-500" /> Modo de Operação
                              </Label>
                              <Select 
                                value="chat" 
                                disabled
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="chat">Apenas Conversar (I.A. Ativa)</SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-[10px] text-muted-foreground italic">
                                O agente IA está configurado para o modo de conversação ativa.
                              </p>
                            </div>

                            <div className="md:col-span-2 flex justify-end pt-4 border-t">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => window.open("https://platform.openai.com/home", "_blank", "noopener,noreferrer")}
                                className="mr-2"
                              >
                                <LinkIcon className="w-4 h-4 mr-2" /> OpenAI Token
                              </Button>
                              <Button
                                onClick={async () => {
                                  // Bloqueia o save quando a API está errada: antes a
                                  // chave inválida só aparecia como 401 no webhook.
                                  const key = String(metaSettings.openai_api_key || '').trim();
                                  const check = await validateOpenAiKey(key);
                                  if (!check.valid) return;
                                   await handleSaveSettings({ ...metaSettings, openai_api_key: key });
                                }}
                                disabled={saving || openAiKeyCheck.state === 'checking'}
                                size="sm"
                                className="bg-[#00875A] hover:bg-[#00875A]/90"
                              >
                                {saving || openAiKeyCheck.state === 'checking' ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Salvar Motor
                              </Button>
                            </div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>


                    {false && (
                    <AccordionItem value="hours" className="border-none">
                      <Card className="rounded-2xl shadow-sm border overflow-hidden">
                        <CardHeader className="bg-blue-50 dark:bg-blue-900/10 border-b p-0">
                          <AccordionTrigger className="flex-1 px-6 py-4 hover:no-underline [&[data-state=open]>div>h3]:text-blue-700 transition-all">
                            <div className="flex flex-col items-start text-left gap-1">
                              <CardTitle className="text-lg flex items-center gap-2 text-blue-700 dark:text-blue-400">
                                <Clock className="w-4 h-4 shrink-0" /> Gestão de Horário Comercial
                              </CardTitle>
                              <CardDescription>Defina quando o agente deve avisar sobre ausência</CardDescription>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-6 pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> Início
                                    </Label>
                                    <Input 
                                      type="time" 
                                      className="h-10 text-sm"
                                      value={metaSettings.business_hours_start}
                                      onChange={(e) => setMetaSettings({...metaSettings, business_hours_start: e.target.value})}
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                      <Clock className="w-3 h-3" /> Fim
                                    </Label>
                                    <Input 
                                      type="time" 
                                      className="h-10 text-sm"
                                      value={metaSettings.business_hours_end}
                                      onChange={(e) => setMetaSettings({...metaSettings, business_hours_end: e.target.value})}
                                    />
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <Label className="text-[10px] uppercase font-bold text-muted-foreground">Fuso Horário</Label>
                                  <Select 
                                    value={metaSettings.business_hours_tz} 
                                    onValueChange={(val) => setMetaSettings({...metaSettings, business_hours_tz: val})}
                                  >
                                    <SelectTrigger className="h-10 text-sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="America/Sao_Paulo">Brasília (GMT-3)</SelectItem>
                                      <SelectItem value="Europe/Lisbon">Lisboa (GMT+0)</SelectItem>
                                      <SelectItem value="UTC">UTC</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              <div className="md:col-span-2 space-y-2">
                                <Label className="text-sm font-bold">Mensagem de Ausência (Fora de Horário)</Label>
                                <Textarea 
                                  rows={4}
                                  className="resize-none text-sm"
                                  placeholder="Nossos administradores não estão ativos no momento..."
                                  value={metaSettings.outside_hours_message}
                                  onChange={(e) => setMetaSettings({...metaSettings, outside_hours_message: e.target.value})}
                                />
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-4 border-t">
                              <div className="flex items-center gap-2 px-3 py-1 bg-muted/50 rounded-lg">
                                <Label className="text-xs font-bold">Ativar</Label>
                                <Switch 
                                  checked={metaSettings.business_hours_enabled}
                                  onCheckedChange={(val) => setMetaSettings({...metaSettings, business_hours_enabled: val})}
                                />
                              </div>
                              <Button onClick={() => handleSaveSettings()} disabled={saving} size="sm" className="bg-[#00875A] hover:bg-[#00875A]/90">
                                {saving ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Salvar Horário
                              </Button>
                            </div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                    )}

                    {/* Histórico de mensagens apagadas (toggle) */}
                    {false && (
                    <AccordionItem value="deleted-history" className="border-none">
                      <Card className="rounded-2xl shadow-sm border overflow-hidden">
                        <CardHeader className="bg-primary/5 border-b p-0">
                          <AccordionTrigger className="flex-1 px-6 py-4 hover:no-underline [&[data-state=open]>div>h3]:text-primary transition-all">
                            <div className="flex flex-col items-start text-left gap-1">
                              <CardTitle className="text-lg flex items-center gap-2">
                                <HistoryIcon className="w-5 h-5 text-primary" /> Histórico de Mensagens Apagadas
                              </CardTitle>
                              <CardDescription>Salvar no servidor todas as mensagens apagadas de cada conversa</CardDescription>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-6 space-y-4 pt-6">
                            <p className="text-sm text-muted-foreground">
                              Quando ativo, mensagens apagadas (pelo contato ou por você) ficam guardadas por conversa.
                              Um pequeno ícone <HistoryIcon className="inline w-3 h-3" /> aparece no topo do chat para consultar o histórico.
                            </p>
                            <div className="flex items-center justify-between pt-2 border-t">
                              <div className="flex items-center gap-2 px-3 py-1 bg-muted/50 rounded-lg">
                                <Label className="text-xs font-bold">Ativar</Label>
                                <Switch
                                  checked={!!metaSettings.save_deleted_messages}
                                  onCheckedChange={(val) => setMetaSettings({ ...metaSettings, save_deleted_messages: val })}
                                />
                              </div>
                              <Button onClick={handleSaveSettings} disabled={saving} size="sm" className="bg-[#00875A] hover:bg-[#00875A]/90">
                                {saving ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Salvar
                              </Button>
                            </div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>
                    )}

                    <AccordionItem value="brain" className="border-none">
                      <Card className="rounded-2xl shadow-sm border overflow-hidden">
                        <CardHeader className="bg-primary/5 border-b p-0">
                          <AccordionTrigger className="flex-1 px-6 py-4 hover:no-underline [&[data-state=open]>div>h3]:text-primary transition-all">
                            <div className="flex flex-col items-start text-left gap-1">
                              <CardTitle className="text-lg flex items-center gap-2">
                                <Bot className="w-5 h-5 text-primary" /> Instruções do Agente (Cérebro)
                              </CardTitle>
                              <CardDescription>Defina a personalidade e o objetivo do seu robô</CardDescription>
                            </div>
                          </AccordionTrigger>
                        </CardHeader>
                        <AccordionContent>
                          <CardContent className="p-6 space-y-6 pt-6">
                            <div className="space-y-2">
                              <Label className="text-sm font-bold flex items-center gap-2">
                                <FileText className="w-4 h-4 text-primary" /> O que sua empresa vende?
                              </Label>
                              <Textarea 
                                rows={4}
                                className="resize-none text-xs leading-relaxed bg-muted/30 border-none rounded-xl"
                                placeholder="Descreva detalhadamente seus produtos, serviços e diferenciais..."
                                value={metaSettings.business_description}
                                onChange={(e) => setMetaSettings({...metaSettings, business_description: e.target.value})}
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                                <Label className="text-sm font-bold">Prompt do System</Label>
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={handleImprovePrompt}
                                  disabled={improvingPrompt}
                                  className="h-7 text-[10px] gap-1.5 bg-indigo-600 hover:bg-indigo-700 border-indigo-500 text-white"
                                >
                                  {improvingPrompt ? <RefreshCcw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 fill-amber-500 text-amber-500" />}
                                  Melhorar Prompt
                                </Button>
                              </div>
                              <Textarea 
                                rows={6}
                                className="resize-none font-mono text-xs leading-relaxed bg-muted/30 border-none rounded-xl"
                                value={metaSettings.ai_system_prompt}
                                onChange={(e) => setMetaSettings({...metaSettings, ai_system_prompt: e.target.value})}
                              />
                            </div>

                            <div className="flex justify-end pt-4 border-t">
                              <Button onClick={() => handleSaveSettings()} disabled={saving} size="sm" className="bg-[#00875A] hover:bg-[#00875A]/90">
                                {saving ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                                Salvar Cérebro
                              </Button>
                            </div>
                          </CardContent>
                        </AccordionContent>
                      </Card>
                    </AccordionItem>


                  </Accordion>
                </div>
              </ScrollArea>
            )}

            {activeTab === 'broadcast' && (
              <Broadcaster 
                templates={templates} 
                flows={flows} 
                contacts={contacts} 
                statuses={kanbanStatuses}
              />
             )}

            {activeTab === 'tutorials' && (
              <SalesTutorials variant="dark" />
            )}

            {activeTab === 'templates' && (
              <ScrollArea className="flex-1 p-4 md:p-8 bg-muted/5">
                <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center bg-card p-4 md:p-6 rounded-2xl border shadow-sm gap-4">
                    <div className="space-y-1">
                      <h2 className="text-xl md:text-2xl font-bold tracking-tight">Templates do WhatsApp</h2>
                      <p className="text-muted-foreground text-xs md:text-sm">Gerencie seus modelos oficiais aprovados pela Meta.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        className="text-[10px] h-8 text-muted-foreground hover:text-primary transition-colors"
                        onClick={() => {
                          const businessId = metaSettings.meta_business_id || '221547625588933';
                          const wabaId = metaSettings.meta_waba_id || '1885027082212076';
                          window.open(`https://business.facebook.com/latest/whatsapp_manager/message_templates?business_id=${businessId}&asset_id=${wabaId}`, '_blank');
                        }}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Ver modelos na Meta
                      </Button>
                      <Button variant="outline" onClick={syncTemplates} disabled={syncingTemplates} className="flex-1 sm:flex-none h-10 text-xs md:text-sm">
                        <RefreshCcw className={cn("w-3.5 h-3.5 md:w-4 md:h-4 mr-2", syncingTemplates && "animate-spin")} />
                        Sincronizar Meta
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button className="flex-1 sm:flex-none h-10 bg-[#00a884] hover:bg-[#008f6f] shadow-lg shadow-[#00a884]/20 text-xs md:text-sm font-bold rounded-xl transition-all active:scale-95">
                            <Plus className="w-3.5 h-3.5 md:w-4 md:h-4 mr-2" /> Novo Template
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-6xl w-[95vw] md:w-full h-[90vh] p-0 border-none rounded-2xl md:rounded-3xl overflow-hidden shadow-2xl">
                          <DialogHeader className="sr-only">
                            <DialogTitle>Criar template do WhatsApp</DialogTitle>
                            <DialogDescription>Configure e envie um novo template para aprovação da Meta.</DialogDescription>
                          </DialogHeader>
                          <ScrollArea className="h-full">
                            <TemplateBuilder onSave={handleSaveTemplate} isSaving={saving} />
                          </ScrollArea>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>

                  <Dialog open={!!confirmSend} onOpenChange={(open) => !open && setConfirmSend(null)}>
                    <DialogContent className="rounded-2xl border-none shadow-2xl">
                      <DialogHeader>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                          <Send className="w-5 h-5 text-primary" /> Confirmar Envio
                        </DialogTitle>
                        <DialogDescription className="py-4 text-base leading-relaxed text-foreground/80">
                          Deseja enviar o {confirmSend?.type === 'template' ? 'template' : 'fluxo'} <span className="font-black text-primary underline underline-offset-4">"{confirmSend?.name}"</span> para <span className="font-bold">{selectedContact?.name || selectedContact?.wa_id}</span>?
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="ghost" onClick={() => setConfirmSend(null)} className="rounded-xl h-11 px-6">Cancelar</Button>
                        <Button onClick={() => {
                          if (confirmSend?.type === 'template') {
                            handleSendTemplate(confirmSend.id, confirmSend.language || 'pt_BR');
                          } else if (confirmSend?.type === 'flow') {
                            handleTriggerFlow(confirmSend.id);
                          }
                        }} className="rounded-xl h-11 px-8 bg-[#00a884] hover:bg-[#008f6f] shadow-lg shadow-[#00a884]/20 text-white font-bold transition-all active:scale-95">Sim, enviar agora</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Accordion type="single" collapsible className="w-full space-y-4">
                    <AccordionItem value="templates-list" className="border-none">
                      <AccordionTrigger className="bg-card p-4 md:p-6 rounded-2xl border shadow-sm hover:no-underline [&[data-state=open]>div>h3]:text-primary transition-all">
                        <div className="flex flex-col items-start text-left gap-1">
                          <h3 className="text-lg md:text-xl font-bold tracking-tight">Lista de Templates</h3>
                          <p className="text-muted-foreground text-xs md:text-sm font-normal">Clique para ver e gerenciar seus templates.</p>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-4 md:pt-6">
                        <div className="flex justify-end mb-4">
                          <Button 
                            variant="link" 
                            size="sm" 
                            className="text-primary font-bold"
                            onClick={() => {
                              const businessId = metaSettings.meta_business_id || '221547625588933';
                              const wabaId = metaSettings.meta_waba_id || '1885027082212076';
                              window.open(`https://business.facebook.com/latest/whatsapp_manager/message_templates?business_id=${businessId}&asset_id=${wabaId}`, '_blank');
                            }}
                          >
                            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Gerenciar na Meta
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 pb-6">
                          {templates.length > 0 ? (
                            templates.map((template) => {
                              const header = template.components?.find((c: any) => c.type === 'HEADER');
                              const body = template.components?.find((c: any) => c.type === 'BODY');
                              const footer = template.components?.find((c: any) => c.type === 'FOOTER');
                              const buttonsComp = template.components?.find((c: any) => c.type === 'BUTTONS');
                              const carouselComp = template.components?.find((c: any) => c.type === 'CAROUSEL');

                              return (
                                <Card key={template.id} className="group overflow-hidden border-zinc-200 dark:border-zinc-800 hover:shadow-lg transition-all flex flex-col bg-card rounded-2xl">
                                  <CardHeader className="bg-muted/30 pb-4 border-b">
                                    <div className="flex justify-between items-start mb-2">
                                      <Badge variant={
                                        template.status === 'APPROVED' ? 'default' : 
                                        template.status === 'REJECTED' ? 'destructive' : 'secondary'
                                      } className={cn(
                                        "text-[9px] uppercase tracking-wider",
                                        template.status === 'APPROVED' ? "bg-green-500/10 text-green-600 border-green-200" : ""
                                      )}>
                                        {template.status === 'APPROVED' ? <Check className="w-3 h-3 mr-1" /> : 
                                        template.status === 'REJECTED' ? <XCircle className="w-3 h-3 mr-1" /> : 
                                        <Clock className="w-3 h-3 mr-1" />}
                                        {template.status === 'APPROVED' ? 'Aprovado' : 
                                         template.status === 'REJECTED' ? 'Rejeitado' : 
                                         template.status === 'PENDING' ? 'Pendente' : template.status}
                                      </Badge>
                                      <div className="flex gap-1">
                                        {template.status === 'APPROVED' && templateHasDynamicInputs(parseTemplateSchema(template.components)) && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-primary hover:bg-primary/10"
                                            title="Variáveis padrão deste template (imagem, valores e links)"
                                            aria-label={`Configurar variáveis do template ${template.name}`}
                                            onClick={() => setTemplateVariablesTarget({ template, purpose: 'default' })}
                                          >
                                            <Braces className="h-3.5 w-3.5" />
                                          </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/10" onClick={() => setPreviewTemplate(template)}>
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => {
                                          if (confirm(`Deseja realmente excluir o template "${template.name}"?`)) {
                                            handleDeleteTemplate(template.name);
                                          }
                                        }}>
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="flex justify-between items-center gap-2">
                                      <CardTitle className="text-sm md:text-base truncate font-bold flex items-center gap-1.5 min-w-0">
                                        <span className="truncate">{template.name}</span>
                                        <div className="flex gap-1 shrink-0">
                                          {template.is_carousel && <Layers className="w-3 h-3 text-primary" />}
                                          {template.is_pix && <CreditCard className="w-3 h-3 text-amber-500" />}
                                        </div>
                                      </CardTitle>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 md:h-9 md:w-9 shrink-0 rounded-xl text-primary hover:text-white hover:bg-primary shadow-sm hover:shadow-primary/20 transition-all border border-primary/10 active:scale-95"
                                        title="Copiar texto fácil (sem aspas)"
                                        onClick={() => {
                                          const bodyText = template.components?.find((c: any) => c.type === 'BODY')?.text || '';
                                          copyToClipboard(bodyText, "Texto do Template");
                                        }}
                                      >
                                        <Copy className="h-3.5 w-3.5 md:h-4 md:h-4" />
                                      </Button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                      <Badge variant="outline" className="text-[8px] md:text-[9px] font-bold bg-muted/50 border-none px-1.5 py-0 md:py-0.5">{template.category}</Badge>
                                      <Badge variant="outline" className="text-[8px] md:text-[9px] font-bold bg-muted/50 border-none px-1.5 py-0 md:py-0.5">{template.language}</Badge>
                                      {template.is_pix && (
                                        <Badge variant="outline" className="text-[8px] md:text-[9px] font-bold bg-amber-500/10 text-amber-600 border-amber-200 px-1.5 py-0 md:py-0.5">PIX</Badge>
                                      )}
                                    </div>
                                  </CardHeader>
                            <CardContent className="p-4 flex-1 flex flex-col justify-between gap-4">
                              <div className="bg-muted/20 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800/50 relative">
                                <div className="absolute top-2 right-2 w-4 h-4 text-muted-foreground/30"><MessageSquare className="w-full h-full" /></div>
                                {header && header.format === 'IMAGE' && header.example?.header_handle?.[0] && (
                                  <div className="mb-3 aspect-video overflow-hidden rounded-lg bg-muted shadow-inner">
                                    <img src={header.example.header_handle[0]} alt="Header" className="w-full h-full object-cover" />
                                  </div>
                                )}
                                {carouselComp && carouselComp.cards && (
                                  <div className="mb-3 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                    {carouselComp.cards.map((card: any, cIdx: number) => {
                                      const cardHeader = card.components?.find((c: any) => c.type === 'HEADER');
                                      return (
                                        <div key={cIdx} className="min-w-[120px] aspect-square rounded-lg bg-muted overflow-hidden border border-zinc-200 dark:border-zinc-800">
                                          {cardHeader?.example?.header_handle?.[0] && (
                                            <img src={cardHeader.example.header_handle[0]} className="w-full h-full object-cover" />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                <div className="text-[12px] md:text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 italic line-clamp-4 md:line-clamp-6">
                                  "{body?.text}"
                                </div>
                                {template.is_pix && template.pix_code && (
                                  <Button 
                                    variant="outline" 
                                    size="sm" 
                                    className="w-full mt-3 h-8 text-[9px] md:text-[10px] bg-amber-50/50 hover:bg-amber-100 dark:bg-amber-900/10 dark:hover:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 gap-1.5 md:gap-2 px-2"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(template.pix_code);
                                      toast({ title: "PIX Copiado!", description: "Chave PIX copiada para a área de transferência." });
                                    }}
                                  >
                                    <Copy className="w-2.5 h-2.5 md:w-3 md:h-3 shrink-0" /> <span className="truncate">Copiar PIX</span>
                                  </Button>
                                )}
                              </div>
                              {buttonsComp?.buttons && buttonsComp.buttons.length > 0 && (
                                <div className="space-y-1.5">
                                  {buttonsComp.buttons.map((btn: any, idx: number) => (
                                    <div key={idx} className="bg-primary/5 p-2 rounded-lg text-[10px] text-center text-primary font-bold border border-primary/10">
                                      {btn.text}
                                    </div>
                                  ))}
                                </div>
                              )}
                              
                            </CardContent>
                          </Card>
                        );
                      })
                    ) : (
                      <div className="col-span-full py-20 text-center bg-card rounded-2xl border-2 border-dashed border-muted flex flex-col items-center justify-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                          <FileText className="w-8 h-8 text-muted-foreground/50" />
                        </div>
                        <h3 className="font-bold text-lg">Sem templates sincronizados</h3>
                        <p className="text-sm text-muted-foreground">Clique em "Sincronizar Meta" para carregar seus templates oficiais.</p>
                        <Button variant="outline" size="sm" onClick={syncTemplates} disabled={syncingTemplates}>Sincronizar agora</Button>
                        <Button 
                          variant="link" 
                          size="sm" 
                          className="text-primary font-bold mt-2"
                          onClick={() => {
                            const businessId = metaSettings.meta_business_id || '221547625588933';
                            const wabaId = metaSettings.meta_waba_id || '1885027082212076';
                            window.open(`https://business.facebook.com/latest/whatsapp_manager/message_templates?business_id=${businessId}&asset_id=${wabaId}`, '_blank');
                          }}
                        >
                          <ExternalLink className="w-3.5 h-3.5 mr-1" /> Ver todos no Gerenciador da Meta
                        </Button>
                      </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                <TemplateVariablesDialog
                  open={!!templateVariablesTarget && templateVariablesTarget.purpose === 'default'}
                  onOpenChange={(open) => !open && setTemplateVariablesTarget(null)}
                  template={templateVariablesTarget?.purpose === 'default' ? templateVariablesTarget.template : null}
                  contacts={contacts}
                  onApply={() => setTemplateVariablesTarget(null)}
                  applyLabel="Concluir"
                />

                <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
                  <DialogContent className="max-w-md p-0 overflow-hidden bg-transparent border-none shadow-none">
                    {previewTemplate && (
                      <TemplatePreview 
                        name={previewTemplate.name}
                        headerType={previewTemplate.components?.find((c: any) => c.type === 'HEADER')?.format || 'NONE'}
                        headerText={previewTemplate.components?.find((c: any) => c.type === 'HEADER')?.text}
                        headerUrl={previewTemplate.components?.find((c: any) => c.type === 'HEADER')?.example?.header_handle?.[0]}
                        bodyText={previewTemplate.components?.find((c: any) => c.type === 'BODY')?.text || ''}
                        footerText={previewTemplate.components?.find((c: any) => c.type === 'FOOTER')?.text}
                        buttons={previewTemplate.components?.find((c: any) => c.type === 'BUTTONS')?.buttons || []}
                      />
                    )}
                  </DialogContent>
                </Dialog>
              </ScrollArea>
            )}

            {activeTab === 'contact-list' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-7xl mx-auto space-y-4 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24 md:pb-20">
                  <div className="flex flex-col bg-card p-4 md:p-6 rounded-2xl border shadow-sm gap-5">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                      <div>
                        <h2 className="text-xl md:text-2xl font-bold tracking-tight">Lista de Contatos</h2>
                        <p className="text-muted-foreground text-xs md:text-sm">Gerencie todos os seus contatos salvos e importados.</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-primary/[0.03] to-transparent p-4 md:p-5 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow ring-1 ring-border flex-shrink-0">
                            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold leading-tight">Google Contatos</p>
                            <p className="text-[11px] text-muted-foreground leading-tight">
                              {googleAccounts.length > 0
                                ? `${googleAccounts.length} de ${MAX_GOOGLE_ACCOUNTS} contas conectadas`
                                : 'Conecte sua conta para sincronizar'}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {googleAccounts.length < MAX_GOOGLE_ACCOUNTS && (
                            <Button
                              size="sm"
                              className="h-9 text-[11px] font-semibold rounded-lg px-3 bg-primary text-primary-foreground flex-1 sm:flex-none"
                              onClick={handleConnectGoogle}
                            >
                              + {googleContactsEnabled ? 'Adicionar' : 'Conectar'}
                            </Button>
                          )}
                        </div>
                      </div>

                      {googleAccounts.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {googleAccounts.map((acc) => (
                            <div key={acc.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-background rounded-xl border hover:border-primary/40 transition-colors">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <LucideIcons.Mail className="w-3.5 h-3.5 text-primary" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-xs font-medium truncate block" title={acc.email}>
                                    {acc.email}
                                  </span>
                                  {acc.connection_status && acc.connection_status !== 'active' && (
                                    <span
                                      className="text-[10px] font-bold text-destructive truncate block"
                                      title={acc.last_sync_error || 'Reconecte esta conta autorizando o acesso aos Contatos.'}
                                    >
                                      ⚠ Reconexão necessária
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-[10px] font-bold"
                                  disabled={isSyncingContacts}
                                  onClick={() => handleSyncGoogleContacts(acc.id)}
                                >
                                  <Download className="w-3.5 h-3.5 mr-1" />
                                  IMPORTAR
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2 text-[10px] font-bold"
                                  disabled={isSyncingContacts}
                                  onClick={() => handleSyncPendingGoogleContacts(acc.id)}
                                >
                                  <FileUp className="w-3.5 h-3.5 mr-1" />
                                  EXPORTAR
                                </Button>
                                <div className="flex items-center gap-1.5">
                                  <Switch
                                    id={`gsync-${acc.id}`}
                                    checked={acc.auto_sync}
                                    onCheckedChange={(checked) => handleToggleAccountAutoSync(acc.id, checked)}
                                  />
                                  <Label htmlFor={`gsync-${acc.id}`} className="text-[10px] font-bold cursor-pointer whitespace-nowrap hidden sm:inline">
                                    Auto
                                  </Label>
                                </div>
                                <button
                                  onClick={() => handleDisconnectGoogle(acc.id)}
                                  className="text-[10px] text-destructive hover:underline font-bold"
                                  title="Desconectar"
                                >
                                  SAIR
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full">
                        <Button 
                          variant="outline" 
                          onClick={() => setActiveTab('google-synced')} 
                          className="h-10 md:h-11 rounded-xl text-[11px] md:text-xs flex-1 sm:flex-none sm:px-4 border-blue-500/30 text-blue-600 hover:bg-blue-50"
                        >
                          <LucideIcons.Cloud className="w-4 h-4 sm:mr-2 flex-shrink-0" /> <span className="hidden xs:inline">Google Sync</span><span className="xs:hidden">Google</span>
                        </Button>
                        <Button variant="outline" onClick={() => setIsImportExportOpen(true)} className="h-10 md:h-11 rounded-xl text-[11px] md:text-xs flex-1 sm:flex-none sm:px-4">
                          <FileUp className="w-4 h-4 sm:mr-2 flex-shrink-0" /> <span className="hidden xs:inline">Importar/Exportar</span><span className="xs:hidden">Imp/Exp</span>
                        </Button>
                        <Button onClick={() => { setContactToView({ name: '', wa_id: '', metadata: {} }); setIsContactInfoOpen(true); }} className="bg-primary h-10 md:h-11 rounded-xl shadow-lg shadow-primary/20 text-[11px] md:text-xs flex-1 sm:flex-none sm:px-4">
                          <UserPlus className="w-4 h-4 sm:mr-2 flex-shrink-0" /> <span className="hidden xs:inline">Novo Contato</span><span className="xs:hidden">Novo</span>
                        </Button>
                  </div>
                  </div>

                  <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
                    <div className="p-4 border-b bg-muted/30 flex flex-col md:flex-row gap-4 items-center justify-between">
                      <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input 
                          placeholder="Pesquisar por nome ou número..." 
                          className="pl-9 bg-background h-10 rounded-xl"
                          value={contactListSearch === 'all' ? '' : contactListSearch}
                          onChange={e => setContactListSearch(e.target.value || 'all')}
                        />
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase">Filtrar Origem:</span>
                        {(() => {
                          const isUnnamed = (c: any) => !c.name || !c.name.trim() || c.name.trim() === c.wa_id;
                          // "Google" = contato que já está sincronizado com uma conta Google (subiu ou veio do Google).
                          const isFromGoogle = (c: any) => !!(c.google_sync_account_id || c.metadata?.google_resource_name || c.source_type === 'google');
                          // "Sistema" = QUALQUER contato criado pelo próprio CRM (recebido no WhatsApp, salvo manualmente, etc.).
                          // Não inclui apenas os importados via CSV/vCard. Pode estar sincronizado com Google também.
                          const isSystem = (c: any) => c.source_type !== 'imported' && c.source_type !== 'google';
                          const cAll = contacts.length;
                          const cSystem = contacts.filter(isSystem).length;
                          const cImported = contacts.filter(c => c.source_type === 'imported').length;
                          const cGoogle = contacts.filter(isFromGoogle).length;
                          const cUnnamed = contacts.filter(isUnnamed).length;
                          const btn = (key: string, label: string, n: number) => (
                            <Button
                              key={key}
                              variant={sourceFilter === key ? 'secondary' : 'ghost'}
                              size="sm"
                              className="text-[9px] h-7 px-3 flex-1 sm:flex-none gap-1"
                              onClick={() => setSourceFilter(key)}
                            >
                              {label} <span className="opacity-70">({n})</span>
                            </Button>
                          );
                          return (
                            <div className="flex bg-muted p-1 rounded-lg w-full sm:w-auto flex-wrap">
                              {btn('all', 'Todos', cAll)}
                              {btn('system', 'Sistema', cSystem)}
                              {btn('google', 'Google', cGoogle)}
                              {btn('imported', 'Importados', cImported)}
                              {btn('unnamed', 'Sem Nome', cUnnamed)}
                            </div>
                          );
                        })()}
                        <div className="flex gap-1 w-full sm:w-auto">
                        </div>
                      </div>
                    </div>
                    
                    <div className="overflow-x-auto w-full">
                      {/* Mobile view of contacts as cards */}
                      <div className="md:hidden divide-y divide-border">
                        {(() => {
                          const filtered = contacts.filter(c => {
                            const matchesSearch = contactListSearch === 'all' || 
                              c.name?.toLowerCase().includes(contactListSearch.toLowerCase()) || 
                              c.wa_id?.includes(contactListSearch);
                            const isUnnamed = !c.name || !c.name.trim() || c.name.trim() === c.wa_id;
                            const isFromGoogle = !!(c.google_sync_account_id || c.metadata?.google_resource_name || c.source_type === 'google');
                            const matchesSource = sourceFilter === 'all'
                              ? true
                              : sourceFilter === 'unnamed'
                                ? isUnnamed
                                : sourceFilter === 'google'
                                  ? isFromGoogle
                                  : sourceFilter === 'system'
                                    ? (c.source_type !== 'imported' && c.source_type !== 'google')
                                    : c.source_type === sourceFilter;
                            return matchesSearch && matchesSource;
                          });
                          
                          const isSearching = contactListSearch !== 'all';
                          const displayContacts = (showAllContacts || isSearching) ? filtered : filtered.slice(0, 10);

                          if (displayContacts.length === 0) {
                            return (
                              <div className="p-12 text-center text-muted-foreground italic text-xs">
                                Nenhum contato encontrado.
                              </div>
                            );
                          }

                          return (
                            <>
                              {displayContacts.map((contact) => (
                                <div key={contact.id} className="p-4 flex flex-col gap-4 bg-card/50 hover:bg-card transition-colors">
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                                        {contact.name?.charAt(0).toUpperCase() || <User className="w-5 h-5" />}
                                      </div>
                                      <div className="flex flex-col overflow-hidden">
                                        <span className="font-bold text-sm truncate">{contact.name || 'Sem nome'}</span>
                                        <span className="text-xs text-muted-foreground font-mono truncate">{contact.wa_id}</span>
                                      </div>
                                    </div>
                                    <div className="flex gap-1 flex-shrink-0">
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10" onClick={() => { openChat(contact); setActiveTab('contacts'); }}>
                                        <MessageSquare className="w-4 h-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted" onClick={() => openContactInfo(contact)}>
                                        <Settings className="w-4 h-4" />
                                      </Button>
                                    </div>
                                  </div>
                                  
                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                    <div className="flex gap-1.5 flex-wrap">
                                      <Badge variant="secondary" className={cn(
                                        "text-[9px] px-1.5 py-0 uppercase font-bold tracking-tight",
                                        (contact.google_sync_account_id || contact.metadata?.google_resource_name) && "bg-blue-500/15 text-blue-600 border-blue-500/30"
                                      )}>
                                        {(contact.google_sync_account_id || contact.metadata?.google_resource_name)
                                          ? 'Google'
                                          : contact.source_type === 'imported' ? 'Importado' : 'Sistema'}
                                      </Badge>
                                      <Badge variant="outline" className={cn("capitalize text-[9px] px-1.5 py-0 font-bold", getStatusColor(contact.status))}>
                                        {contact.status}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
                                      <Clock className="w-3 h-3" />
                                      <span>{contact.last_interaction ? new Date(contact.last_interaction).toLocaleDateString() : 'Nunca'}</span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                              {filtered.length > 10 && !showAllContacts && !isSearching && (
                                <div className="p-6 bg-muted/5 flex justify-center border-t">
                                  <Button variant="outline" size="sm" onClick={() => setShowAllContacts(true)} className="text-xs font-bold text-primary rounded-xl px-8 h-9 border-primary/20 hover:bg-primary/5">
                                    Ver Todos os {filtered.length} Contatos
                                  </Button>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      {/* Desktop view of contacts as table */}
                      <table className="hidden md:table w-full text-left border-collapse min-w-[800px]">
                        <thead>
                          <tr className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground tracking-wider border-b">
                            <th className="px-6 py-4">Nome</th>
                            <th className="px-6 py-4">WhatsApp</th>
                            <th className="px-6 py-4">Origem</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Última Interação</th>
                            <th className="px-6 py-4 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(() => {
                            const filtered = contacts.filter(c => {
                              const matchesSearch = contactListSearch === 'all' || 
                                c.name?.toLowerCase().includes(contactListSearch.toLowerCase()) || 
                                c.wa_id?.includes(contactListSearch);
                              const isUnnamed = !c.name || !c.name.trim() || c.name.trim() === c.wa_id;
                              const isFromGoogle = !!(c.google_sync_account_id || c.metadata?.google_resource_name || c.source_type === 'google');
                              const matchesSource = sourceFilter === 'all'
                                ? true
                                : sourceFilter === 'unnamed'
                                  ? isUnnamed
                                  : sourceFilter === 'google'
                                    ? isFromGoogle
                                    : sourceFilter === 'system'
                                      ? (c.source_type !== 'imported' && c.source_type !== 'google')
                                      : c.source_type === sourceFilter;
                              return matchesSearch && matchesSource;
                            });
                            
                            const totalFiltered = filtered.length;
                            const isSearching = contactListSearch !== 'all';
                            const displayContacts = (showAllContacts || isSearching) ? filtered : filtered.slice(0, 10);

                            return (
                              <>
                                {displayContacts.map((contact) => (
                                  <tr key={contact.id} className="hover:bg-muted/30 transition-colors group">
                                    <td className="px-6 py-4">
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                          {contact.name?.charAt(0) || <User className="w-4 h-4" />}
                                        </div>
                                        <span className="font-semibold text-sm">{contact.name || 'Sem nome'}</span>
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{contact.wa_id}</td>
                                    <td className="px-6 py-4">
                                      <Badge variant="secondary" className={cn(
                                        "text-[9px] uppercase font-bold",
                                        (contact.google_sync_account_id || contact.metadata?.google_resource_name) && "bg-blue-500/15 text-blue-600 border-blue-500/30"
                                      )}>
                                        {(contact.google_sync_account_id || contact.metadata?.google_resource_name)
                                          ? 'Google'
                                          : contact.source_type === 'imported' ? 'Importado' : 'Sistema'}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                      <Badge variant="outline" className={cn("capitalize text-[10px]", getStatusColor(contact.status))}>
                                        {contact.status}
                                      </Badge>
                                    </td>
                                    <td className="px-6 py-4 text-[11px] text-muted-foreground">
                                      {contact.last_interaction ? new Date(contact.last_interaction).toLocaleString() : 'Nunca'}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => { openChat(contact); setActiveTab('contacts'); }}>
                                          <MessageSquare className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openContactInfo(contact)}>
                                          <Settings className="w-4 h-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={async () => {
                                          if (confirm('Excluir este contato?')) {
                                            await supabase.from('crm_contacts').delete().eq('id', contact.id);
                                            fetchContacts();
                                          }
                                        }}>
                                          <Trash2 className="w-4 h-4" />
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                                
                                {totalFiltered > 10 && !showAllContacts && !isSearching && (
                                  <tr>
                                    <td colSpan={6} className="px-6 py-8 text-center bg-muted/5">
                                      <div className="flex flex-col items-center gap-3">
                                        <p className="text-sm text-muted-foreground">
                                          Mostrando 10 de <strong>{totalFiltered}</strong> contatos
                                        </p>
                                        <Button 
                                          variant="outline" 
                                          onClick={() => setShowAllContacts(true)}
                                          className="font-bold"
                                        >
                                          <Eye className="w-4 h-4 mr-2" /> Ver Todos os Contatos
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                
                                {totalFiltered === 0 && (
                                  <tr>
                                    <td colSpan={6} className="px-6 py-20 text-center text-muted-foreground italic text-sm">
                                      Nenhum contato encontrado. Importe uma lista vCard ou CSV para começar.
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            )}

            {activeTab === 'google-synced' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-7xl mx-auto space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-card p-4 md:p-6 rounded-2xl border shadow-sm gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm border">
                        <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-xl md:text-2xl font-bold tracking-tight">Sincronizados com Google</h2>
                        <p className="text-muted-foreground text-xs md:text-sm">
                          Contatos do sistema que já subiram para sua conta Google.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 w-full lg:w-auto">
                      <div className="flex-1 lg:flex-none relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder="Pesquisar..."
                          className="pl-9 bg-background h-10 rounded-xl w-full lg:w-72"
                          value={contactListSearch === 'all' ? '' : contactListSearch}
                          onChange={e => setContactListSearch(e.target.value || 'all')}
                        />
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        className="h-10 rounded-xl text-xs font-bold whitespace-nowrap"
                        disabled={isSyncingContacts || googleAccounts.length === 0}
                        onClick={() => handleSyncGoogleContacts()}
                      >
                        <Download className="w-3.5 h-3.5 mr-2" />
                        Importar Google
                      </Button>
                    </div>
                  </div>

                  {(() => {
                    const isSynced = (c: any) => !!(c.google_sync_account_id || c.metadata?.google_resource_name);
                    const hasRealName = (c: any) => !!(c.name && c.name.trim() && c.name.trim() !== c.wa_id);
                    const isDirty = (c: any) => !!c.metadata?.google_dirty;
                    const synced = contacts.filter(isSynced);
                    const pendingNamed = contacts.filter(c => hasRealName(c) && (!isSynced(c) || isDirty(c)));
                    const filtered = synced.filter(c => {
                      if (resendSourceFilter !== 'all' && c.google_sync_account_id !== resendSourceFilter) return false;
                      if (contactListSearch === 'all') return true;
                      const q = contactListSearch.toLowerCase();
                      return c.name?.toLowerCase().includes(q) || c.wa_id?.includes(contactListSearch);
                    });
                    const allFilteredSelected = filtered.length > 0 && filtered.every(c => resendSelection.has(c.id));
                    const toggleContactSelection = (id: string) => {
                      setResendSelection(prev => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                      });
                    };

                    return (
                      <>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                          <Card className="p-4">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Sincronizados</p>
                            <p className="text-2xl md:text-3xl font-black text-primary mt-1">{synced.length}</p>
                          </Card>
                          <Card className="p-4">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Total Contatos</p>
                            <p className="text-2xl md:text-3xl font-black mt-1">{contacts.length}</p>
                          </Card>
                          <Card className="p-4">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Pendentes</p>
                            <p className="text-2xl md:text-3xl font-black text-orange-500 mt-1">{pendingNamed.length}</p>
                          </Card>
                          <Card className="p-4">
                            <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Auto Sync</p>
                            <div className="flex items-center justify-between mt-2 gap-2">
                              <p className={cn("text-sm md:text-base font-black", metaSettings.google_auto_sync ? "text-emerald-500" : "text-muted-foreground")}>
                                {metaSettings.google_auto_sync ? '● Ativo' : '○ Desativado'}
                              </p>
                              <Switch
                                checked={metaSettings.google_auto_sync}
                                onCheckedChange={async (checked) => {
                                  setMetaSettings(prev => ({ ...prev, google_auto_sync: checked }));
                                  try {
                                    const { data: { user } } = await supabase.auth.getUser();
                                    if (!user) throw new Error('no user');
                                    const { error } = await supabase.from('crm_settings')
                                      .update({ google_auto_sync: checked, updated_at: new Date().toISOString() })
                                      .eq('user_id', user.id);
                                    if (error) throw error;
                                    toast({ title: checked ? 'Auto Sync ativado' : 'Auto Sync desativado' });
                                  } catch {
                                    toast({ title: 'Erro ao atualizar Auto Sync', variant: 'destructive' });
                                    setMetaSettings(prev => ({ ...prev, google_auto_sync: !checked }));
                                  }
                                }}
                              />
                            </div>
                          </Card>
                        </div>

                        {pendingNamed.length > 0 && (
                          <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
                            <div className="px-4 md:px-6 py-3 border-b bg-orange-500/5 flex items-center gap-2">
                              <RefreshCcw className="w-4 h-4 text-orange-500 animate-spin-slow" />
                              <h3 className="text-sm font-bold">Pendentes — aguardando subir ao Google</h3>
                              <span className="ml-auto text-[10px] uppercase font-bold text-orange-500">{pendingNamed.length}</span>
                            </div>
                            {googleAccountFull && (
                              <div className="px-4 md:px-6 py-3 border-b bg-destructive/10 flex flex-wrap items-center gap-2">
                                <p className="text-xs font-semibold text-destructive flex-1 min-w-[200px]">
                                  ⚠️ Conta Google cheia — o Google limita cada conta a 25.000 contatos e está recusando novos envios.
                                  Exclua contatos em <a href="https://contacts.google.com" target="_blank" rel="noreferrer" className="underline">contacts.google.com</a> ou conecte outra conta Google.
                                </p>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs shrink-0"
                                  onClick={() => {
                                    googleAccountFullRef.current = false;
                                    setGoogleAccountFull(false);
                                    supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'syncPendingToGoogle' } }).catch(() => {});
                                  }}
                                >
                                  Tentar novamente
                                </Button>
                              </div>
                            )}
                            <div className="divide-y divide-border max-h-72 overflow-auto">
                              {pendingNamed.slice(0, 100).map((contact) => (
                                <div key={contact.id} className="px-4 md:px-6 py-3 flex items-center justify-between gap-3 hover:bg-muted/30">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 font-bold text-xs flex-shrink-0">
                                      {contact.name?.charAt(0).toUpperCase() || <User className="w-4 h-4" />}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="font-semibold text-sm truncate">{contact.name}</p>
                                      <p className="text-[11px] text-muted-foreground font-mono truncate">{contact.wa_id}</p>
                                    </div>
                                  </div>
                                  <span className="text-[10px] uppercase font-bold text-orange-500 flex items-center gap-1 shrink-0">
                                    <Clock className="w-3 h-3" /> aguardando
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Reenvio dos contatos salvos pela ferramenta para outra conta Google */}
                        <div className="bg-card rounded-2xl border shadow-sm p-4 md:p-6 space-y-3">
                          <div className="flex items-center gap-2">
                            <RefreshCcw className="w-4 h-4 text-primary" />
                            <h3 className="text-sm font-bold">Reenviar contatos salvos pela ferramenta</h3>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Filtre os contatos que já foram salvos e sincronizados pelo sistema e reenvie todos (ou só os selecionados) para outra conta Google conectada.
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-muted-foreground">Origem (conta atual)</label>
                              <Select value={resendSourceFilter} onValueChange={(v) => { setResendSourceFilter(v); setResendSelection(new Set()); }}>
                                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Todas as contas" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">Todas as contas</SelectItem>
                                  {googleAccounts.map(acc => (
                                    <SelectItem key={acc.id} value={acc.id}>{acc.email}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] uppercase font-bold text-muted-foreground">Destino (novo email)</label>
                              <Select value={resendTargetAccount} onValueChange={setResendTargetAccount}>
                                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Escolha a conta destino" /></SelectTrigger>
                                <SelectContent>
                                  {googleAccounts
                                    .filter(acc => acc.id !== resendSourceFilter)
                                    .map(acc => (
                                      <SelectItem key={acc.id} value={acc.id}>{acc.email}</SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1 flex flex-col justify-end">
                              <Button
                                className="h-10 rounded-xl font-bold text-xs"
                                disabled={isResendingGoogle || !resendTargetAccount}
                                onClick={() => handleResendGoogleContacts(Array.from(resendSelection))}
                              >
                                <RefreshCcw className={cn("w-3.5 h-3.5 mr-2", isResendingGoogle && "animate-spin")} />
                                {resendSelection.size > 0
                                  ? `Reenviar ${resendSelection.size} selecionados`
                                  : `Reenviar todos (${filtered.length})`}
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 pt-1">
                            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                              <Checkbox
                                checked={allFilteredSelected}
                                onCheckedChange={(checked) => {
                                  setResendSelection(checked ? new Set(filtered.map(c => c.id)) : new Set());
                                }}
                              />
                              Selecionar todos os listados ({filtered.length})
                            </label>
                            {resendSelection.size > 0 && (
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setResendSelection(new Set())}>
                                Limpar seleção
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="bg-card rounded-2xl border shadow-sm overflow-hidden">
                          {filtered.length === 0 ? (
                            <div className="p-12 text-center text-muted-foreground text-sm italic">
                              Nenhum contato sincronizado com Google ainda.
                            </div>
                          ) : (
                            <>
                              <div className="px-4 md:px-6 py-3 border-b bg-emerald-500/5 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                <h3 className="text-sm font-bold">Histórico — sincronizados com Google</h3>
                                <span className="ml-auto text-[10px] uppercase font-bold text-emerald-500">{filtered.length}</span>
                              </div>
                              {/* Mobile cards */}
                              <div className="md:hidden divide-y divide-border">
                                {filtered.slice(0, showAllGoogleContacts ? undefined : 50).map((contact) => (
                                  <div key={contact.id} className="p-4 flex items-center justify-between gap-3 hover:bg-muted/30">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <Checkbox
                                        checked={resendSelection.has(contact.id)}
                                        onCheckedChange={() => toggleContactSelection(contact.id)}
                                      />
                                      <div className="relative w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm flex-shrink-0">
                                        {contact.name?.charAt(0).toUpperCase() || <User className="w-5 h-5" />}
                                        <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#4285F4] rounded-full flex items-center justify-center border-2 border-card">
                                          <span className="text-[7px] font-bold text-white">G</span>
                                        </span>
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-bold text-sm truncate">{contact.name || 'Sem nome'}</p>
                                        <p className="text-[11px] text-muted-foreground font-mono truncate">{contact.wa_id}</p>
                                      </div>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary shrink-0" onClick={() => { openChat(contact); setActiveTab('contacts'); }}>
                                      <MessageSquare className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>

                              {/* Desktop table */}
                              <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left border-collapse min-w-[700px]">
                                  <thead>
                                    <tr className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground tracking-wider border-b">
                                      <th className="px-4 py-4 w-10">
                                        <Checkbox
                                          checked={allFilteredSelected}
                                          onCheckedChange={(checked) => setResendSelection(checked ? new Set(filtered.map(c => c.id)) : new Set())}
                                        />
                                      </th>
                                      <th className="px-6 py-4">Nome</th>
                                      <th className="px-6 py-4">WhatsApp</th>
                                      <th className="px-6 py-4">Conta Google</th>
                                      <th className="px-6 py-4">Sincronizado em</th>
                                      <th className="px-6 py-4 text-right">Ações</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {filtered.slice(0, showAllGoogleContacts ? undefined : 50).map((contact) => (
                                      <tr key={contact.id} className="hover:bg-muted/30 transition-colors group">
                                        <td className="px-4 py-4">
                                          <Checkbox
                                            checked={resendSelection.has(contact.id)}
                                            onCheckedChange={() => toggleContactSelection(contact.id)}
                                          />
                                        </td>
                                        <td className="px-6 py-4">
                                          <div className="flex items-center gap-3">
                                            <div className="relative w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                                              {contact.name?.charAt(0) || <User className="w-4 h-4" />}
                                              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-[#4285F4] rounded-full flex items-center justify-center border border-card">
                                                <span className="text-[6px] font-bold text-white">G</span>
                                              </span>
                                            </div>
                                            <span className="font-semibold text-sm">{contact.name || 'Sem nome'}</span>
                                          </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{contact.wa_id}</td>
                                        <td className="px-6 py-4 text-[11px] text-muted-foreground truncate max-w-[200px]">
                                          {contact.google_sync_account_id || '—'}
                                        </td>
                                        <td className="px-6 py-4 text-[11px] text-muted-foreground">
                                          {contact.google_synced_at ? new Date(contact.google_synced_at).toLocaleString() : (contact.updated_at ? new Date(contact.updated_at).toLocaleDateString() : '—')}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => { openChat(contact); setActiveTab('contacts'); }}>
                                              <MessageSquare className="w-4 h-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openContactInfo(contact)}>
                                              <Settings className="w-4 h-4" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {filtered.length > 50 && !showAllGoogleContacts && (
                                <div className="p-8 text-center bg-muted/5 border-t">
                                  <div className="flex flex-col items-center gap-3">
                                    <p className="text-sm text-muted-foreground">
                                      Mostrando 50 de <strong>{filtered.length}</strong> contatos sincronizados
                                    </p>
                                    <Button 
                                      variant="outline" 
                                      onClick={() => setShowAllGoogleContacts(true)}
                                      className="font-bold"
                                    >
                                      <Eye className="w-4 h-4 mr-2" /> Ver Todos os Contatos Sincronizados
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </ScrollArea>
            )}

            {activeTab === 'settings' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-4xl mx-auto space-y-4 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div>
                    <h2 className="text-xl md:text-3xl font-bold tracking-tight text-primary">Configurações</h2>
                    <p className="text-muted-foreground text-xs md:text-sm font-medium">Gerencie as integrações e chaves de API do seu CRM.</p>
                  </div>

                  <div className="space-y-4">
                    <Accordion type="single" collapsible className="w-full space-y-4">
                      <AccordionItem value="whatsapp-api" className="border rounded-2xl bg-card overflow-hidden shadow-sm">
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3 text-left">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary"><MessageSquare className="w-5 h-5" /></div>
                            <div>
                              <CardTitle className="text-lg">WhatsApp API</CardTitle>
                              <CardDescription className="text-[11px]">Conecte com a plataforma Business da Meta.</CardDescription>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-2 space-y-5 border-t">
                          <div className="flex items-center gap-2 pt-2">
                            <div className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-2",
                              (metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id)
                                ? "bg-red-500 text-white animate-pulse" 
                                : "bg-muted text-muted-foreground"
                            )}>
                              <div className={cn("w-2 h-2 rounded-full", (metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id) ? "bg-white" : "bg-muted-foreground")} />
                              {(metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id) ? "ATIVADO LIGADO" : "AGUARDANDO CONFIGURAÇÃO"}
                            </div>
                          </div>

                          {(metaSettings.meta_display_phone_number || metaSettings.meta_verified_name) && (
                            <div className="mt-2 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-green-600 dark:text-green-400 mb-1">Número conectado</p>
                              {metaSettings.meta_display_phone_number && (
                                <p className="text-sm font-semibold text-foreground">{metaSettings.meta_display_phone_number}</p>
                              )}
                              {metaSettings.meta_verified_name && (
                                <p className="text-xs text-muted-foreground">{metaSettings.meta_verified_name}</p>
                              )}
                            </div>
                          )}

                          {(metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id) && (
                            <div className="pt-3 border-t border-border/60 space-y-2">
                              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Recebimento de mensagens
                              </Label>
                              <p className="text-[11px] text-muted-foreground">
                                Se as mensagens não aparecem em Conversas, repare a inscrição do webhook da Meta para este número.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={isRepairingWebhook}
                                className="w-full h-11 rounded-xl font-semibold"
                                onClick={repairWhatsAppWebhook}
                              >
                                {isRepairingWebhook ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
                                Reparar recebimento
                              </Button>
                            </div>
                          )}

                          {(metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id) && (
                            <div className="pt-3 border-t border-border/60 space-y-2">
                              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Desconectar WhatsApp
                              </Label>
                              <p className="text-[11px] text-muted-foreground">
                                Remove o token, o WABA e o número conectado deste CRM. Use isso quando o número for desregistrado na Meta ("Account not registered") para então reconectar do zero.
                              </p>
                              <Button
                                type="button"
                                variant="destructive"
                                className="w-full h-11 rounded-xl font-semibold"
                                onClick={async () => {
                                  if (!window.confirm('Tem certeza que deseja desconectar o WhatsApp? Você precisará reconectar pelo Facebook em seguida.')) return;
                                  try {
                                    const { data: { user } } = await supabase.auth.getUser();
                                    if (!user) return;
                                    const disconnectedPhoneId = metaSettings.meta_phone_number_id || null;
                                    const cleared = {
                                      meta_access_token: '',
                                      meta_phone_number_id: '',
                                      meta_waba_id: '',
                                      meta_display_phone_number: '',
                                      meta_verified_name: '',
                                    };
                                    const { error } = await supabase
                                      .from('crm_settings')
                                      .update({ ...cleared, updated_at: new Date().toISOString() })
                                      .eq('user_id', user.id);
                                    if (error) throw error;
                                    // Desconectar remove SOMENTE a caixa atual da lista de números.
                                    // Os outros números do cadastro continuam disponíveis no seletor.
                                    let remaining = 0;
                                    if (disconnectedPhoneId) {
                                      const { error: numberError } = await supabase
                                        .from('crm_whatsapp_numbers' as any)
                                        .delete()
                                        .eq('user_id', user.id)
                                        .eq('meta_phone_number_id', disconnectedPhoneId);
                                      if (numberError) {
                                        console.warn('[CRM] não foi possível remover o número desconectado:', numberError.message);
                                      }
                                    }
                                    try {
                                      const numbers = await fetchUserNumbers(user.id);
                                      remaining = numbers.length;
                                      setUserNumbersCount(remaining);
                                    } catch {
                                      /* lista indisponível — segue com o gate padrão */
                                    }
                                    setMetaSettings((prev: any) => ({ ...prev, ...cleared }));
                                    setWhatsAppConnectionConfirmed(false);
                                    // Volta ao seletor: o usuário escolhe outro número já salvo
                                    // ou conecta um novo, sem ser forçado ao Embedded Signup.
                                    handleSwitchNumber();
                                    toast({
                                      title: 'WhatsApp desconectado',
                                      description: remaining > 0
                                        ? 'Escolha outro número do seu cadastro ou conecte um novo.'
                                        : 'Agora você pode conectar um novo número.',
                                    });
                                  } catch (err: any) {
                                    console.error('[CRM] disconnect whatsapp error:', err);
                                    toast({ title: 'Erro ao desconectar', description: err?.message || 'Tente novamente.', variant: 'destructive' });
                                  }
                                }}
                              >
                                Desconectar WhatsApp
                              </Button>
                            </div>
                          )}

                          {!(metaSettings.meta_access_token && metaSettings.meta_phone_number_id && metaSettings.meta_waba_id) && (
                            <div className="pt-3 border-t border-border/60 space-y-2">
                              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Facebook className="w-3 h-3" /> Embedded Signup (Meta Tech Provider)
                              </Label>
                              <p className="text-[11px] text-muted-foreground">
                                Conecte uma conta WhatsApp Business diretamente pelo Facebook — preenche WABA, Phone Number ID e Access Token automaticamente.
                              </p>
                              <Button
                                type="button"
                                className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#1668d8] text-white font-semibold"
                                onClick={() => startEmbeddedSignup()}
                              >
                                <Facebook className="w-4 h-4 mr-2" />
                                Conectar com Facebook
                              </Button>
                            </div>
                          )}

                          {userRole === 'admin' && (
                            <div className="pt-4 border-t border-border/60 space-y-4">
                              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <LucideIcons.Cloud className="w-3 h-3" /> Credenciais Google Cloud (Oauth)
                              </Label>
                              <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground">Client ID</Label>
                                  <Input 
                                    value={metaSettings.google_client_id || ''} 
                                    onChange={e => setMetaSettings({...metaSettings, google_client_id: e.target.value})}
                                    placeholder="474898024942-..."
                                    className="h-10 rounded-xl bg-muted/50 border-none text-xs"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] text-muted-foreground">Client Secret</Label>
                                  <Input 
                                    type="password"
                                    value={metaSettings.google_client_secret || ''} 
                                    onChange={e => setMetaSettings({...metaSettings, google_client_secret: e.target.value})}
                                    placeholder="GOCSPX-..."
                                    className="h-10 rounded-xl bg-muted/50 border-none text-xs"
                                  />
                                </div>
                                <p className="text-[9px] text-muted-foreground italic leading-relaxed">
                                  * Necessário para sincronizar contatos. Certifique-se de que a Redirect URI no Google Console seja: <br/>
                                  <code className="text-primary font-bold">https://zapmro.com.br/google-callback</code>
                                </p>
                              </div>
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>


                      <AccordionItem value="payments" className="border rounded-2xl bg-card overflow-hidden shadow-sm">
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3 text-left">
                            <div className="p-2 rounded-lg bg-amber-100 text-amber-700"><CreditCard className="w-5 h-5" /></div>
                            <div>
                              <CardTitle className="text-lg">Saldo e Pagamentos Meta</CardTitle>
                              <CardDescription className="text-[11px]">Gerencie seus créditos para disparos em massa.</CardDescription>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-2 space-y-4 border-t">
                          <div className="bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-xl flex items-start gap-3 mt-2">
                            <div className="w-8 h-8 rounded-full bg-amber-200 dark:bg-amber-800 flex items-center justify-center shrink-0">
                              <Zap className="w-4 h-4 text-amber-700 dark:text-amber-400 fill-amber-700 dark:fill-amber-400" />
                            </div>
                            <div className="space-y-1">
                              <h4 className="text-sm font-bold text-amber-800 dark:text-amber-400">Aviso sobre Custos de Envio</h4>
                              <p className="text-xs text-amber-700/80 dark:text-amber-400/70 leading-relaxed">
                                Para realizar disparos em massa (Broadcasting) e agendamentos, a Meta cobra uma taxa por mensagem enviada.
                                Em média, o custo de uma mensagem de marketing é de <strong>R$ 0,33</strong>.
                              </p>
                              <p className="text-[11px] text-amber-700/80 dark:text-amber-400/70">
                                Adicione saldo ou um cartão de crédito na sua conta da Meta para evitar falhas no envio.
                              </p>
                            </div>
                          </div>

                          <Button 
                            className="w-full h-12 bg-[#00875A] hover:bg-[#00875A]/90 text-white font-bold rounded-xl shadow-lg shadow-[#00875A]/20 gap-2"
                            onClick={() => {
                              const businessId = metaSettings.meta_business_id || '221547625588933';
                              const wabaId = metaSettings.meta_waba_id || '1885027082212076';
                              // Link dinâmico baseado na estrutura do Billing Hub da Meta enviada
                              window.open(`https://business.facebook.com/latest/billing_hub/accounts/details/?asset_id=${wabaId}&business_id=${businessId}&placement=whatsapp_ads`, '_blank');
                            }}
                          >
                            <CreditCard className="w-5 h-5" />
                            Ir para Central de Pagamentos Meta
                          </Button>
                        </AccordionContent>
                      </AccordionItem>

                      <AccordionItem value="interface" className="border rounded-2xl bg-card overflow-hidden shadow-sm">
                        <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-3 text-left">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary"><Zap className="w-5 h-5" /></div>
                            <div>
                              <CardTitle className="text-lg">Customização da Interface</CardTitle>
                              <CardDescription className="text-[11px]">Ajuste o tamanho dos botões e etiquetas.</CardDescription>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-6 pb-6 pt-2 space-y-8 border-t">
                          <div className="flex items-start justify-between gap-4 p-4 rounded-xl border bg-muted/30">
                            <div className="min-w-0">
                              <Label className="text-sm font-bold">Congelar ordem das conversas</Label>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                Quando ativado, as conversas não sobem para o topo ao enviar/receber mensagens. Apenas conversas novas entram no topo.
                              </p>
                            </div>
                            <Switch
                              checked={freezeConversationOrder}
                              onCheckedChange={(val) => {
                                setFreezeConversationOrder(val);
                              }}
                            />
                          </div>

                          <div className="space-y-4 mt-2">
                            <div className="flex justify-between items-center">
                              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tamanho dos Atalhos (Modelos/Fluxos)</Label>
                              <Badge variant="secondary" className="text-[10px]">{metaSettings.shortcut_size}%</Badge>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-[10px] text-muted-foreground">Menor</span>
                              <input 
                                type="range" 
                                min="70" 
                                max="150" 
                                step="5"
                                value={metaSettings.shortcut_size || 100} 
                                onChange={e => setMetaSettings({...metaSettings, shortcut_size: parseInt(e.target.value)})}
                                className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="text-[10px] text-muted-foreground">Maior</span>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" style={{ height: `${20 * ((metaSettings.shortcut_size || 100) / 100)}px`, fontSize: `${9 * ((metaSettings.shortcut_size || 100) / 100)}px` }} className="px-2 rounded-md border-primary/20 bg-primary/5 text-primary pointer-events-none">Exemplo Atalho</Button>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tamanho das Etiquetas (Status/Filtros)</Label>
                              <Badge variant="secondary" className="text-[10px]">{metaSettings.tag_size}%</Badge>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-[10px] text-muted-foreground">Menor</span>
                              <input 
                                type="range" 
                                min="70" 
                                max="150" 
                                step="5"
                                value={metaSettings.tag_size || 100} 
                                onChange={e => setMetaSettings({...metaSettings, tag_size: parseInt(e.target.value)})}
                                className="flex-1 h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                              />
                              <span className="text-[10px] text-muted-foreground">Maior</span>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant="outline" style={{ height: `${14 * ((metaSettings.tag_size || 100) / 100)}px`, fontSize: `${8 * ((metaSettings.tag_size || 100) / 100)}px` }} className="px-1.2 font-bold pointer-events-none">Exemplo Etiqueta</Badge>
                            </div>
                          </div>
                        </AccordionContent>
                       </AccordionItem>
                      <ConversationStorageSettings
                        userId={currentUserId}
                        onHistoryCleared={() => {
                          setChatMessages([]);
                          setInboundTimestampsByContact({});
                        }}
                      />
                     </Accordion>

                  </div>

                  <div className="flex justify-end pt-4">
                    <Button onClick={() => handleSaveSettings()} disabled={saving} size="lg" className="px-10 h-14 rounded-2xl bg-primary text-white font-bold shadow-xl shadow-primary/20 hover:scale-[1.02] transition-transform">
                      {saving ? <RefreshCcw className="mr-3 h-5 w-5 animate-spin" /> : <Save className="mr-3 h-5 w-5" />}
                      Salvar Configurações
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            )}

            {activeTab === 'webhooks' && (
              <ScrollArea className="flex-1 p-8 bg-muted/5">
                <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col md:flex-row justify-between md:items-center bg-card p-6 rounded-2xl border shadow-sm gap-4">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Webhooks (API Externa)</h2>
                      <p className="text-muted-foreground text-sm">Conecte sites externos para enviar mensagens automáticas.</p>
                    </div>
                    <Button onClick={() => setIsNewWebhookDialogOpen(true)} className="h-10 bg-primary shadow-lg shadow-primary/20">
                      <Plus className="w-4 h-4 mr-2" /> Novo Webhook
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    {webhooks.length === 0 ? (
                      <Card className="p-12 text-center border-dashed border-2 bg-muted/20 rounded-2xl">
                        <Webhook className="w-12 h-12 mx-auto text-muted-foreground opacity-20 mb-4" />
                        <h3 className="text-lg font-medium">Nenhum webhook criado</h3>
                        <p className="text-sm text-muted-foreground">Crie um webhook para integrar seu site ou sistema externo.</p>
                      </Card>
                    ) : (
                      webhooks.map((webhook) => (
                        <Card key={webhook.id} className="overflow-hidden border shadow-sm hover:shadow-md transition-shadow rounded-2xl">
                          <CardHeader className="flex flex-row items-center justify-between pb-2 bg-muted/10">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-primary/10 rounded-lg">
                                <Webhook className="w-5 h-5 text-primary" />
                              </div>
                              <div>
                                <CardTitle className="text-lg font-bold">{webhook.name}</CardTitle>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant={webhook.is_active ? "default" : "secondary"} className="text-[10px]">
                                    {webhook.is_active ? "Ativo" : "Inativo"}
                                  </Badge>
                                  <span className="text-[10px] text-muted-foreground font-mono">ID: {webhook.id}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch 
                                checked={webhook.is_active} 
                                onCheckedChange={() => toggleWebhookStatus(webhook.id, webhook.is_active)} 
                              />
                              <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => {
                                if(confirm("Deseja excluir este webhook?")) handleDeleteWebhook(webhook.id);
                              }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <div className="space-y-4">
                                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Configurações de Resposta</h4>
                                <div className="grid grid-cols-3 gap-4">
                                  <div className="p-3 bg-muted/30 rounded-xl border">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">Tipo</Label>
                                    <p className="text-sm font-semibold capitalize">{webhook.response_type === 'text' ? 'Texto' : 'Template'}</p>
                                  </div>
                                  <div className="p-3 bg-muted/30 rounded-xl border">
                                    <Label className="text-[10px] font-bold text-muted-foreground uppercase">Etapa Kanban</Label>
                                    <p className="text-sm font-semibold capitalize text-primary">{webhook.default_status || 'Novo'}</p>
                                  </div>
                                  {webhook.response_type === 'template' && (
                                    <div className="p-3 bg-muted/30 rounded-xl border">
                                      <Label className="text-[10px] font-bold text-muted-foreground uppercase">Template</Label>
                                      <p className="text-sm font-semibold truncate">{templates.find(t => t.id === webhook.template_id)?.name || 'N/A'}</p>
                                    </div>
                                  )}
                                </div>
                                
                                <div className="space-y-2">
                                  <Label className="text-xs font-bold uppercase text-muted-foreground">URL do Webhook (POST)</Label>
                                  <div className="flex gap-2">
                                    <Input 
                                      readOnly 
                                      value={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-webhook`} 
                                      className="font-mono text-[10px] bg-muted/50 rounded-xl"
                                    />
                                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => {
                                      navigator.clipboard.writeText(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-webhook`);
                                      toast({ title: "URL copiada!" });
                                    }}>
                                      <Paperclip className="w-4 h-4" />
                                    </Button>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground italic">* Esta URL recebe os dados do seu site para disparar o WhatsApp.</p>
                                </div>

                                <div className="space-y-2">
                                  <Label className="text-xs font-bold uppercase text-muted-foreground">Token de Autenticação</Label>
                                  <div className="flex gap-2">
                                    <Input 
                                      readOnly 
                                      type="password"
                                      value={webhook.secret_token} 
                                      className="font-mono text-[10px] bg-muted/50 rounded-xl"
                                    />
                                    <Button size="sm" variant="outline" className="rounded-xl" onClick={() => {
                                      navigator.clipboard.writeText(webhook.secret_token);
                                      toast({ title: "Token copiado!" });
                                    }}>
                                      <Paperclip className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              <div className="bg-zinc-950 rounded-2xl p-6 text-zinc-300 overflow-hidden relative border border-white/5 shadow-2xl">
                                <div className="absolute top-4 right-4 text-zinc-700 font-mono text-[10px] tracking-widest">API DOCS</div>
                                <h4 className="text-primary font-bold text-sm mb-4 flex items-center gap-2">
                                  <Play className="w-3 h-3 fill-current" /> Guia de Integração
                                </h4>
                                <div className="space-y-4 font-mono text-[11px]">
                                  <p className="text-zinc-500">// Exemplo de requisição no seu site</p>
                                  <div className="bg-black/50 p-4 rounded-xl border border-white/5 overflow-x-auto whitespace-pre text-emerald-400">
{`fetch("${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    webhook_id: "${webhook.id}",
    token: "${webhook.secret_token}",
    to: "5511999999999",
    message: "Olá, seu acesso ao produto foi liberado!"
  })
});`}
                                  </div>
                                  <div className="space-y-2 pt-2 border-t border-white/5 text-zinc-400 font-sans">
                                    <p className="italic text-[10px]">
                                      <strong className="text-zinc-200">Parâmetros:</strong><br/>
                                      - <code className="text-primary">to</code>: Número do cliente (DDI+DDD+Número)<br/>
                                      - <code className="text-primary">message</code>: Conteúdo da mensagem (se tipo Texto)<br/>
                                      - <code className="text-primary">variables</code>: [Array] Valores para as variáveis do template (se tipo Template)
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </div>

                <Dialog open={isNewWebhookDialogOpen} onOpenChange={setIsNewWebhookDialogOpen}>
                  <DialogContent className="sm:max-w-[500px] rounded-3xl border-none shadow-2xl">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-2xl font-black">
                        <Webhook className="w-6 h-6 text-primary" /> Novo Webhook
                      </DialogTitle>
                      <DialogDescription className="text-base">
                        Crie um ponto de entrada para disparar mensagens do seu site.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-6 py-4">
                      <div className="space-y-2">
                        <Label className="font-bold">Nome de Identificação</Label>
                        <Input 
                          placeholder="Ex: Checkout - Produto A" 
                          value={newWebhook.name}
                          onChange={e => setNewWebhook({...newWebhook, name: e.target.value})}
                          className="rounded-2xl h-12"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="font-bold">Tipo da Mensagem</Label>
                          <Select 
                            value={newWebhook.response_type} 
                            onValueChange={(val: any) => setNewWebhook({...newWebhook, response_type: val, template_id: val === 'text' ? '' : newWebhook.template_id})}
                          >
                            <SelectTrigger className="rounded-2xl h-12">
                              <SelectValue placeholder="Selecione o tipo" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-none shadow-xl">
                              <SelectItem value="text" className="rounded-xl">Texto Livre</SelectItem>
                              <SelectItem value="template" className="rounded-xl">Template Meta</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="font-bold">Etapa Kanban</Label>
                          <Select 
                            value={newWebhook.default_status} 
                            onValueChange={(val: any) => setNewWebhook({...newWebhook, default_status: val})}
                          >
                            <SelectTrigger className="rounded-2xl h-12">
                              <SelectValue placeholder="Selecione a etapa" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-none shadow-xl">
                              <SelectItem value="new" className="rounded-xl">Novo</SelectItem>
                              <SelectItem value="responded" className="rounded-xl">Respondido</SelectItem>
                              <SelectItem value="qualified" className="rounded-xl">Qualificado</SelectItem>
                              <SelectItem value="human" className="rounded-xl">+ Humano</SelectItem>
                              <SelectItem value="closed" className="rounded-xl">Vendido</SelectItem>
                              <SelectItem value="lost" className="rounded-xl">Perdido</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {newWebhook.response_type === 'template' && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
                          <Label className="font-bold">Template Vinculado</Label>
                          <Select 
                            value={newWebhook.template_id} 
                            onValueChange={val => setNewWebhook({...newWebhook, template_id: val})}
                          >
                            <SelectTrigger className="rounded-2xl h-12">
                              <SelectValue placeholder="Selecione um template aprovado" />
                            </SelectTrigger>
                            <SelectContent className="rounded-2xl border-none shadow-xl">
                              {templates.filter(t => t.status === 'APPROVED').map(t => (
                                <SelectItem key={t.id} value={t.id} className="rounded-xl">{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button variant="ghost" onClick={() => setIsNewWebhookDialogOpen(false)} className="rounded-2xl h-12 px-6">Cancelar</Button>
                      <Button onClick={handleCreateWebhook} disabled={saving || !newWebhook.name} className="rounded-2xl h-12 px-8 bg-primary shadow-lg shadow-primary/20 font-bold">
                        {saving ? <RefreshCcw className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                        Salvar Webhook
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </ScrollArea>
            )}
            {activeTab === 'ai-analysis' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-6xl mx-auto space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-card p-4 md:p-6 rounded-2xl border shadow-sm">
                    <div className="min-w-0">
                      <h2 className="text-lg md:text-2xl font-bold tracking-tight flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-indigo-600 shrink-0" /> <span>Histórico Global de Análises IA</span>
                      </h2>
                      <p className="text-muted-foreground text-xs md:text-sm">Registro cronológico de todas as estratégias e análises geradas.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {(() => {
                      // Create a flattened, sorted list of all analyses from all contacts
                      const allAnalyses = contacts.flatMap(contact => 
                        (contact.ai_strategy_history || []).map((analysis: any) => ({
                          ...analysis,
                          contactId: contact.id,
                          contactName: contact.name || contact.wa_id,
                          waId: contact.wa_id,
                          contactStatus: contact.status,
                          contactObj: contact
                        }))
                      ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

                      if (allAnalyses.length === 0) {
                        return (
                          <div className="col-span-full py-20 text-center bg-card rounded-3xl border-2 border-dashed">
                            <Zap className="w-12 h-12 mx-auto mb-4 opacity-10" />
                            <p className="font-bold text-muted-foreground">Nenhuma análise foi gerada ainda.</p>
                            <p className="text-xs text-muted-foreground/60 mt-1">Gere análises diretamente nas conversas com os clientes.</p>
                          </div>
                        );
                      }

                      return allAnalyses.map((item, i) => (
                        <Card key={`${item.contactId}-${i}`} className="rounded-2xl border shadow-sm overflow-hidden flex flex-col h-[280px] hover:shadow-md transition-all group">
                          <CardHeader className="bg-muted/30 border-b p-4">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <User className="w-3.5 h-3.5 text-primary" />
                                </div>
                                <div className="min-w-0">
                                  <CardTitle className="text-xs font-bold truncate">{item.contactName}</CardTitle>
                                  <p className="text-[9px] text-muted-foreground">{item.waId}</p>
                                </div>
                              </div>
                              <Badge variant="outline" className="text-[8px] uppercase px-1.5 h-4 shrink-0">
                                {item.type || 'Estratégia'}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent 
                            className="p-4 flex-1 cursor-pointer overflow-hidden relative"
                            onClick={() => setSelectedAnalysis(item)}
                          >
                            <p className="text-xs leading-relaxed text-zinc-600 italic line-clamp-6">
                              {item.strategy}
                            </p>
                            <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent pointer-events-none" />
                          </CardContent>
                          <div className="p-3 bg-muted/10 border-t flex items-center justify-between gap-2">
                            <span className="text-[9px] text-muted-foreground font-mono">
                              {new Date(item.created_at).toLocaleDateString('pt-BR')} {new Date(item.created_at).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
                            </span>
                            <div className="flex gap-1">
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="text-[9px] font-bold h-7 px-2 gap-1 hover:bg-primary/10"
                                onClick={() => {
                                  setSelectedContact(item.contactObj);
                                  setActiveTab('contacts');
                                }}
                              >
                                <MessageSquare className="w-3 h-3" /> Chat
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="text-[9px] font-bold h-7 px-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                                onClick={() => setSelectedAnalysis(item)}
                              >
                                <Eye className="w-3 h-3" /> Ver
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ));
                    })()}
                  </div>
                </div>
              </ScrollArea>
            )}

            {activeTab === 'help' && (
              <ScrollArea className="flex-1 p-3 sm:p-4 md:p-8 bg-muted/5">
                <div className="max-w-4xl mx-auto space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
                  <div className="flex items-center gap-4 bg-card p-6 rounded-2xl border shadow-sm">
                    <div className="p-3 rounded-full bg-primary/10 text-primary">
                      <LucideIcons.HelpCircle className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Centro de Ajuda e Tutoriais</h2>
                      <p className="text-muted-foreground">Guia completo para dominar todas as ferramentas do seu CRM.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <Card className="rounded-2xl border shadow-sm overflow-hidden">
                      <CardHeader className="bg-primary/5 border-b">
                        <CardTitle className="flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-primary" /> Dashboard e Métricas
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <h4 className="font-bold text-sm text-primary">Métricas Gerais</h4>
                            <ul className="text-xs space-y-2 text-muted-foreground list-disc pl-4">
                              <li><strong>Mensagens Enviadas:</strong> Total de mensagens que saíram do seu número.</li>
                              <li><strong>Respondidas:</strong> Contatos que enviaram ao menos uma mensagem de volta.</li>
                              <li><strong>Contatos Qualificados:</strong> Leads marcados com a etiqueta "Qualificado".</li>
                              <li><strong>Conversas 24h (Hoje):</strong> Volume de interações únicas nas últimas 24 horas.</li>
                            </ul>
                          </div>
                          <div className="space-y-2">
                            <h4 className="font-bold text-sm text-primary">Custos e Janelas</h4>
                            <ul className="text-xs space-y-2 text-muted-foreground list-disc pl-4">
                              <li><strong>Conversas Pagas:</strong> Cobrança da Meta quando você inicia uma conversa fora da janela de 24h.</li>
                              <li><strong>Janela Grátis:</strong> Período de 24h após a última mensagem do cliente onde você não paga por envios.</li>
                              <li><strong>Resumo Semanal:</strong> Comparativo de performance dos últimos 7 dias.</li>
                            </ul>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border shadow-sm overflow-hidden">
                      <CardHeader className="bg-emerald-500/5 border-b">
                        <CardTitle className="flex items-center gap-2">
                          <MessageSquare className="w-5 h-5 text-emerald-500" /> CRM Kanban e Conversas
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <p className="text-sm text-muted-foreground">O coração do seu atendimento. Organize leads por funil de vendas.</p>
                        <div className="space-y-3">
                          <div className="p-3 bg-muted/30 rounded-xl">
                            <h4 className="text-xs font-bold mb-1">Visualização Kanban</h4>
                            <p className="text-[11px] text-muted-foreground">Arraste e solte contatos entre as colunas (Novo Lead, Em Atendimento, Qualificado, etc.) para gerenciar seu progresso.</p>
                          </div>
                          <div className="p-3 bg-muted/30 rounded-xl">
                            <h4 className="text-xs font-bold mb-1">Chat em Tempo Real</h4>
                            <p className="text-[11px] text-muted-foreground">Envie textos, áudios (com transcrição), imagens e vídeos. O sistema detecta se o áudio foi "gravado na hora" para maior autoridade.</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border shadow-sm overflow-hidden">
                      <CardHeader className="bg-blue-500/5 border-b">
                        <CardTitle className="flex items-center gap-2">
                          <GitBranch className="w-5 h-5 text-blue-500" /> Fluxos e Gatilhos (Automação)
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <div className="space-y-4">
                          <div>
                            <h4 className="font-bold text-sm">O que são Fluxos?</h4>
                            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                              Sequências lógicas de mensagens, perguntas e ações. Você pode criar caminhos onde o cliente clica em botões e o sistema responde automaticamente.
                            </p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="border p-3 rounded-xl">
                              <h5 className="text-[11px] font-bold flex items-center gap-1"><Zap className="w-3 h-3" /> Gatilhos (Triggers)</h5>
                              <p className="text-[10px] text-muted-foreground mt-1">Palavras-chave, primeira mensagem ou inatividade. Eles disparam o fluxo sozinho.</p>
                            </div>
                            <div className="border p-3 rounded-xl">
                              <h5 className="text-[11px] font-bold flex items-center gap-1"><UserPlus className="w-3 h-3" /> Etiqueta Automática</h5>
                              <p className="text-[10px] text-muted-foreground mt-1">Configure o fluxo para colocar o contato em uma etiqueta (Ex: "Interesse Produto X") logo no início.</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border shadow-sm overflow-hidden">
                      <CardHeader className="bg-purple-500/5 border-b">
                        <CardTitle className="flex items-center gap-2">
                          <Bot className="w-5 h-5 text-purple-500" /> Agente IA
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-purple-100 text-purple-600"><Bot className="w-4 h-4" /></div>
                            <div>
                              <h5 className="text-xs font-bold">Assistente Inteligente</h5>
                              <p className="text-[11px] text-muted-foreground">Responde seus clientes automaticamente usando o conhecimento configurado no "Cérebro" e nos seus templates.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-amber-100 text-amber-600"><CreditCard className="w-4 h-4" /></div>
                            <div>
                              <h5 className="text-xs font-bold">Saldo e Pagamentos</h5>
                              <p className="text-[11px] text-muted-foreground">O envio de templates aprovados e conversas de marketing via IA possuem um custo médio de R$ 0,33 por mensagem pela Meta.</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border shadow-sm overflow-hidden">
                      <CardHeader className="bg-orange-500/5 border-b">
                        <CardTitle className="flex items-center gap-2">
                          <Zap className="w-5 h-5 text-orange-500" /> Disparador e Agendamentos
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <h4 className="font-bold text-sm">Disparador em Massa</h4>
                            <p className="text-xs text-muted-foreground">Envie uma mensagem ou inicie um fluxo para centenas de contatos filtrados por etiqueta de uma só vez.</p>
                          </div>
                          <div className="space-y-2">
                            <h4 className="font-bold text-sm">Agendamentos</h4>
                            <p className="text-xs text-muted-foreground">Programe mensagens para datas e horários específicos. Ideal para lembretes de reuniões ou follow-ups futuros.</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="rounded-2xl border shadow-sm overflow-hidden">
                      <CardHeader className="bg-zinc-500/5 border-b">
                        <CardTitle className="flex items-center gap-2">
                          <Users className="w-5 h-5 text-zinc-600" /> Contatos e Google
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-6 space-y-4">
                        <div className="space-y-2">
                          <h4 className="font-bold text-sm">Sincronização Google</h4>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Conecte sua conta Google para importar milhares de contatos. O sistema processa em segundo plano e filtra apenas números válidos para WhatsApp. Você também pode ativar a sincronização automática para novos leads.
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </ScrollArea>
            )}
          </main>
        </SidebarInset>
      </div>
      {isFlowEditorOpen && (
        <FlowEditor 
          flow={editingFlow} 
          onSave={handleSaveFlow} 
          onClose={() => { setIsFlowEditorOpen(false); setEditingFlow(null); }} 
        />
      )}
      <FlowSaveOverlay open={flowSaveOverlay.open} done={flowSaveOverlay.done} />
      {previewMedia && (
        <MediaPopup 
          url={previewMedia.url} 
          type={previewMedia.type} 
          onClose={() => setPreviewMedia(null)} 
        />
      )}
      {previewDocument && (
        <DocumentPopup
          url={previewDocument.url}
          fileName={previewDocument.fileName}
          onClose={() => setPreviewDocument(null)}
        />
      )}


      <Dialog open={isSyncingContacts} onOpenChange={setIsSyncingContacts}>
        <DialogContent className="sm:max-w-md text-center py-10">
          <DialogHeader className="items-center">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <RefreshCcw className="w-8 h-8 text-primary animate-spin" />
            </div>
            <DialogTitle className="text-xl">Sincronizando Contatos</DialogTitle>
            <DialogDescription>
              Aguarde enquanto buscamos seus contatos do Google...
            </DialogDescription>
          </DialogHeader>
          <div className="py-6 space-y-4">
            <Progress value={syncProgress} className="h-2" />
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest">
              {syncProgress < 100 ? 'Sincronizando...' : 'Concluído!'}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isContactInfoOpen} onOpenChange={setIsContactInfoOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader className="items-center pb-4 border-b">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <User className="w-10 h-10 text-primary" />
            </div>
            <DialogTitle className="text-2xl font-bold">{contactToView?.id ? 'Informações do Contato' : 'Novo Contato'}</DialogTitle>
            <DialogDescription>
              {contactToView?.id 
                ? `Visualize e edite os detalhes de ${contactToView?.name || contactToView?.wa_id}`
                : 'Adicione um novo contato manualmente à sua lista.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Nome</Label>
                <Input 
                  value={contactToView?.name || ''} 
                  onChange={e => setContactToView({...contactToView, name: e.target.value})}
                  placeholder="Nome do contato"
                  className="bg-muted/30 border-none h-10 rounded-xl text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">WhatsApp / ID</Label>
                <Input 
                  value={contactToView?.wa_id || ''} 
                  onChange={e => setContactToView({...contactToView, wa_id: e.target.value})}
                  readOnly={!!contactToView?.id}
                  placeholder="Ex: 5511999999999"
                  className={cn(
                    "bg-muted/30 border-none h-10 rounded-xl text-sm",
                    contactToView?.id && "opacity-70 cursor-not-allowed bg-muted/20"
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1">Biografia / Observações</Label>
              <Textarea 
                value={contactToView?.metadata?.bio || ''} 
                onChange={e => setContactToView({...contactToView, metadata: { ...contactToView?.metadata, bio: e.target.value }})}
                placeholder="Descreva informações importantes..."
                className="bg-muted/30 border-none rounded-xl min-h-[80px] text-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1 flex items-center gap-2">
                  <Instagram className="w-3 h-3" /> Instagram
                </Label>
                <Input 
                  value={contactToView?.metadata?.instagram || ''} 
                  onChange={e => setContactToView({...contactToView, metadata: { ...contactToView?.metadata, instagram: e.target.value }})}
                  placeholder="@usuario ou link"
                  className="bg-muted/30 border-none h-10 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1 flex items-center gap-2">
                  <Facebook className="w-3 h-3" /> Facebook
                </Label>
                <Input 
                  value={contactToView?.metadata?.facebook || ''} 
                  onChange={e => setContactToView({...contactToView, metadata: { ...contactToView?.metadata, facebook: e.target.value }})}
                  placeholder="link da página"
                  className="bg-muted/30 border-none h-10 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase text-muted-foreground ml-1 flex items-center gap-2">
                  <LinkIcon className="w-3 h-3" /> Outros Links
                </Label>
                <Input 
                  value={contactToView?.metadata?.links || ''} 
                  onChange={e => setContactToView({...contactToView, metadata: { ...contactToView?.metadata, links: e.target.value }})}
                  placeholder="https://site.com"
                  className="bg-muted/30 border-none h-10 rounded-xl text-sm"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setIsContactInfoOpen(false)} className="rounded-xl h-12 px-6">Fechar</Button>
            <Button 
              className="bg-primary hover:bg-primary/90 text-white rounded-xl h-12 px-8 font-bold shadow-lg shadow-primary/20"
              onClick={async () => {
                const { id, ...rest } = contactToView;
                if (id) {
                  // Detect changes that must be re-sent to Google Contacts.
                  const original = contacts.find((c: any) => c.id === id);
                  const nameChanged = (original?.name || '') !== (contactToView.name || '');
                  const phoneChanged = (original?.wa_id || '') !== (contactToView.wa_id || '');
                  const isSyncedToGoogle = !!(original?.google_sync_account_id || original?.metadata?.google_resource_name);
                  const nextMetadata: any = { ...(contactToView.metadata || {}) };
                  if (isSyncedToGoogle && (nameChanged || phoneChanged)) {
                    nextMetadata.google_dirty = true;
                  }
                  await supabase.from('crm_contacts').update({
                    name: contactToView.name,
                    metadata: nextMetadata,
                    updated_at: new Date().toISOString(),
                  }).eq('id', id);
                  // Trigger an immediate silent push so Google is updated in <1min.
                  if (isSyncedToGoogle && (nameChanged || phoneChanged) && anyAutoSync) {
                    supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'syncPendingToGoogle' } }).catch(() => {});
                  }
                } else {
                  const { error } = await supabase.from('crm_contacts').insert([{
                    name: contactToView.name,
                    wa_id: contactToView.wa_id,
                    metadata: contactToView.metadata,
                    status: 'new',
                    source_type: 'system',
                    ...numberScopePatch(),
                  }]);
                  if (error) {
                    toast({ title: "Erro ao criar contato", variant: "destructive" });
                    return;
                  }
                }
                toast({ title: id ? "Contato atualizado!" : "Contato criado!" });
                fetchContacts();
                if (selectedContact?.id === contactToView.id) {
                  setSelectedContact({ ...selectedContact, name: contactToView.name, metadata: contactToView.metadata });
                }
                setIsContactInfoOpen(false);
              }}
            >
              <Save className="w-4 h-4 mr-2" /> Salvar Alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkNameOpen} onOpenChange={setBulkNameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nomear contatos em massa</DialogTitle>
            <DialogDescription>
              Cada contato sem nome recebe: <strong>Prefixo + número</strong> (ex: Contato 1, Contato 2, ...).
              Após nomear, eles são marcados para subir automaticamente ao Google.
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const unnamed = contacts.filter((c: any) => !c.name || !c.name.trim() || c.name.trim() === c.wa_id);
            return (
              <div className="space-y-3 py-2">
                <div className="text-xs text-muted-foreground">
                  <strong>{unnamed.length}</strong> contatos sem nome serão renomeados.
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Prefixo do nome</Label>
                  <Input value={bulkNamePrefix} onChange={e => setBulkNamePrefix(e.target.value)} placeholder="Ex: Contato" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Começar numeração em</Label>
                  <Input type="number" min={1} value={bulkNameStart} onChange={e => setBulkNameStart(Math.max(1, parseInt(e.target.value) || 1))} />
                </div>
                <div className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2">
                  Prévia: <strong>{(bulkNamePrefix || 'Contato').trim()} {bulkNameStart}</strong>, {(bulkNamePrefix || 'Contato').trim()} {bulkNameStart + 1}, {(bulkNamePrefix || 'Contato').trim()} {bulkNameStart + 2}...
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" size="sm" onClick={() => setBulkNameOpen(false)} disabled={bulkNameBusy}>Cancelar</Button>
                  <Button
                    size="sm"
                    disabled={bulkNameBusy || unnamed.length === 0 || !bulkNamePrefix.trim()}
                    onClick={async () => {
                      setBulkNameBusy(true);
                      try {
                        const prefix = bulkNamePrefix.trim();
                        let idx = bulkNameStart;
                        for (let i = 0; i < unnamed.length; i += 100) {
                          const chunk = unnamed.slice(i, i + 100);
                          await Promise.all(chunk.map((c: any) => {
                            const newName = `${prefix} ${idx++}`;
                            return supabase.from('crm_contacts').update({
                              name: newName,
                              metadata: { ...(c.metadata || {}), google_dirty: true },
                            } as any).eq('id', c.id);
                          }));
                        }
                        toast({ title: 'Contatos renomeados', description: `${unnamed.length} contatos ganharam nome e serão enviados ao Google.` });
                        setBulkNameOpen(false);
                        await fetchContacts();
                        if (googleContactsEnabled) {
                          supabase.functions.invoke('meta-whatsapp-crm', { body: { action: 'syncPendingToGoogle' } }).catch(() => {});
                        }
                      } catch (e: any) {
                        toast({ title: 'Erro ao renomear', description: e?.message || 'Falha', variant: 'destructive' });
                      } finally {
                        setBulkNameBusy(false);
                      }
                    }}
                  >
                    {bulkNameBusy ? 'Renomeando...' : `Renomear ${unnamed.length} contatos`}
                  </Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      <Dialog open={isImportExportOpen} onOpenChange={setIsImportExportOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <FileUp className="w-5 h-5 text-primary" /> Gerenciar Contatos
            </DialogTitle>
            <DialogDescription>Exporte sua lista atual ou importe novos contatos via CSV ou vCard.</DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-1 gap-4 py-6">
            <div className="p-4 rounded-2xl border-2 border-dashed border-muted bg-muted/5 flex flex-col items-center gap-4 text-center">
              <div className="p-2 rounded-full bg-primary/10 text-primary">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm">Exportar Lista</p>
                <p className="text-[10px] text-muted-foreground">Baixe todos os contatos para backups ou importação.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 w-full">
                <Button variant="outline" size="sm" className="rounded-xl text-[11px]" onClick={() => handleExportContacts('csv')}>
                  <Download className="w-3 h-3 mr-1.5" /> CSV
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl text-[11px]" onClick={() => handleExportContacts('vcard')}>
                  <UserPlus className="w-3 h-3 mr-1.5" /> vCard
                </Button>
              </div>
            </div>

            <div className="p-6 rounded-2xl border-2 border-dashed border-primary/20 bg-primary/5 flex flex-col items-center gap-4 text-center">
              <div className="p-3 rounded-full bg-primary/20 text-primary">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="font-bold">Importar Lista</p>
                <p className="text-xs text-muted-foreground">Adicione contatos em massa enviando um arquivo CSV ou vCard.</p>
              </div>
              <Label htmlFor="import-file" className="w-full">
                <Button variant="default" className="w-full rounded-xl pointer-events-none">
                  Selecionar Arquivo
                </Button>
              </Label>
              <input 
                id="import-file" 
                type="file" 
                accept=".csv,.vcf,.vcard" 
                className="hidden" 
                onChange={(e) => {
                  handleImportContacts(e);
                  setIsImportExportOpen(false);
                }} 
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsImportExportOpen(false)} className="w-full rounded-xl h-11">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplateVariablesDialog
        open={!!templateVariablesTarget && templateVariablesTarget.purpose === 'schedule'}
        onOpenChange={(open) => !open && setTemplateVariablesTarget(null)}
        template={templateVariablesTarget?.purpose === 'schedule' ? templateVariablesTarget.template : null}
        initialConfig={scheduleTemplateConfig}
        contacts={contacts}
        onApply={(config) => { setScheduleTemplateConfig(config); setTemplateVariablesTarget(null); }}
        applyLabel="Usar neste agendamento"
      />

      <Dialog open={isSchedulingOpen} onOpenChange={(open) => { setIsSchedulingOpen(open); if (!open) setScheduleTemplateConfig(null); }}>
        <DialogContent className="w-[calc(100vw-1rem)] sm:w-full max-w-2xl rounded-2xl sm:rounded-3xl p-4 sm:p-6 border-none shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh] bg-white text-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2 text-primary">
              <CalendarClock className="w-5 h-5" /> Novo Agendamento
            </DialogTitle>
            <DialogDescription className="text-zinc-500">Agende templates aprovados para seus contatos de forma organizada.</DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
            <Button 
              variant={selectedCampaignType === 'individual' ? 'default' : 'outline'}
              className={cn("h-11 rounded-xl text-[10px] font-bold px-1 transition-all", 
                selectedCampaignType === 'individual' 
                  ? "bg-primary text-white shadow-lg shadow-primary/20 border-primary" 
                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50")}
              onClick={() => { setSelectedCampaignType('individual'); setSelectedContactsForScheduling([]); setScheduleType('template'); }}
            >
              <User className="w-4 h-4 mr-1.5" /> Individual
            </Button>
            <Button 
              variant={selectedCampaignType === 'batch' ? 'default' : 'outline'}
              className={cn("h-11 rounded-xl text-[10px] font-bold px-1 transition-all", 
                selectedCampaignType === 'batch' 
                  ? "bg-primary text-white shadow-lg shadow-primary/20 border-primary" 
                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50")}
              onClick={() => { setSelectedCampaignType('batch'); setSelectedContactsForScheduling([]); setScheduleType('template'); }}
            >
              <Users className="w-4 h-4 mr-1.5" /> Massa
            </Button>
            <Button 
              variant={selectedCampaignType === 'list' ? 'default' : 'outline'}
              className={cn("h-11 rounded-xl text-[10px] font-bold px-1 transition-all", 
                selectedCampaignType === 'list' 
                  ? "bg-primary text-white shadow-lg shadow-primary/20 border-primary" 
                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50")}
              onClick={() => { setSelectedCampaignType('list'); setSelectedContactsForScheduling([]); setScheduleType('template'); }}
            >
              <FileText className="w-4 h-4 mr-1.5" /> vCard / TXT
            </Button>
            <Button 
              variant={selectedCampaignType === 'birthday' ? 'default' : 'outline'}
              className={cn("h-11 rounded-xl text-[10px] font-bold px-1 transition-all", 
                selectedCampaignType === 'birthday' 
                  ? "bg-primary text-white shadow-lg shadow-primary/20 border-primary" 
                  : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50")}
              onClick={() => { setSelectedCampaignType('birthday'); setSelectedContactsForScheduling([]); setScheduleType('template'); }}
            >
              <Calendar className="w-4 h-4 mr-1.5" /> Aniversário
            </Button>
          </div>

          <ScrollArea className="flex-1 pr-2 sm:pr-4 -mr-2 sm:-mr-4 py-4">
            <div className="space-y-6">
              {/* Configuração baseada no tipo de campanha */}
              {selectedCampaignType === 'individual' && (
                <div className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-500">1. Selecionar Contato</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      placeholder="Pesquisar..." 
                      className="pl-9 h-11 rounded-xl bg-zinc-100 border-none text-zinc-900 placeholder:text-zinc-400"
                      value={scheduleSearch}
                      onChange={e => setScheduleSearch(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 max-h-[160px] overflow-y-auto p-1">
                    {contacts
                      .filter(c => {
                        if (!scheduleSearch) return true;
                        const q = scheduleSearch.toLowerCase();
                        return c.name?.toLowerCase().includes(q) || c.wa_id?.includes(scheduleSearch);
                      })
                      .slice(0, 20)
                      .map(contact => (
                        <div 
                          key={contact.id}
                          onClick={() => setSelectedContactsForScheduling([contact.id])}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer",
                            selectedContactsForScheduling.includes(contact.id)
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-transparent bg-zinc-100/50 hover:bg-zinc-100"
                          )}
                        >
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                            selectedContactsForScheduling.includes(contact.id) ? "bg-primary/20" : "bg-muted-foreground/10"
                          )}>
                            <User className={cn("w-4 h-4", selectedContactsForScheduling.includes(contact.id) ? "text-primary" : "text-zinc-400")} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">{contact.name || contact.wa_id}</p>
                            <p className="text-[10px] text-zinc-500 truncate">{contact.wa_id}</p>
                          </div>
                          {contact.last_message_received_at && (
                            <div className={cn(
                              "ml-auto w-2 h-2 rounded-full",
                              (Date.now() - new Date(contact.last_message_received_at).getTime() < 24 * 60 * 60 * 1000) ? "bg-emerald-500" : "bg-zinc-300"
                            )} title={(Date.now() - new Date(contact.last_message_received_at).getTime() < 24 * 60 * 60 * 1000) ? "Janela Ativa" : "Janela Expirada"} />
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {selectedCampaignType === 'batch' && (
                <div className="space-y-3">
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                    <span>1. Selecionar Massa de Contatos</span>
                    <span className="text-primary">{selectedContactsForScheduling.length} selecionados</span>
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      placeholder="Pesquisar..." 
                      className="pl-9 h-11 rounded-xl bg-zinc-100 border-none text-zinc-900 placeholder:text-zinc-400"
                      value={scheduleSearch}
                      onChange={e => setScheduleSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2 mb-2">
                    <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 rounded-lg border-zinc-200 bg-white hover:bg-zinc-50" onClick={() => setSelectedContactsForScheduling(contacts.map(c => c.id))}>Selecionar Todos</Button>
                    <Button variant="outline" size="sm" className="h-7 text-[10px] flex-1 rounded-lg border-zinc-200 bg-white hover:bg-zinc-50" onClick={() => setSelectedContactsForScheduling([])}>Limpar</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto p-1">
                    {contacts
                      .filter(c => {
                        if (!scheduleSearch) return true;
                        const q = scheduleSearch.toLowerCase();
                        return c.name?.toLowerCase().includes(q) || c.wa_id?.includes(scheduleSearch);
                      })
                      .slice(0, 30)
                      .map(contact => (
                        <div 
                          key={contact.id}
                          onClick={() => {
                            setSelectedContactsForScheduling(prev => 
                              prev.includes(contact.id) ? prev.filter(id => id !== contact.id) : [...prev, contact.id]
                            );
                          }}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded-xl border transition-all cursor-pointer",
                            selectedContactsForScheduling.includes(contact.id) ? "border-primary bg-primary/5" : "border-transparent bg-zinc-100/50 hover:bg-zinc-100"
                          )}
                        >
                          <div className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0", selectedContactsForScheduling.includes(contact.id) ? "bg-primary border-primary" : "border-zinc-300")}>
                            {selectedContactsForScheduling.includes(contact.id) && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <p className="text-[10px] font-bold truncate flex-1">{contact.name || contact.wa_id}</p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {selectedCampaignType === 'list' && (
                <div className="space-y-3 animate-in fade-in duration-300">
                  <Label className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                    <span>1. Lista de Contatos (vCard ou TXT)</span>
                    <Badge variant="outline" className="text-[9px] font-bold">Importação Direta</Badge>
                  </Label>
                  <Textarea 
                    placeholder="Cole aqui os números (um por linha) ou o conteúdo de um arquivo vCard..."
                    className="min-h-[120px] rounded-xl bg-zinc-100 border-none resize-none font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400"
                    value={contactListText}
                    onChange={e => setContactListText(e.target.value)}
                  />
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-zinc-100 border border-zinc-200">
                    <AlertCircle className="w-4 h-4 text-zinc-400 shrink-0" />
                    <p className="text-[10px] text-zinc-500">
                      Os números serão cadastrados automaticamente se não existirem. Formatos aceitos: <span className="font-bold">5511999999999</span> ou <span className="font-bold">vCard (.vcf)</span>.
                    </p>
                  </div>
                </div>
              )}

              {selectedCampaignType === 'birthday' && (
                <div className="space-y-4 border p-4 rounded-2xl bg-primary/5 border-primary/20">
                  <div className="space-y-3">
                    <Label className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-2">
                      <Plus className="w-3 h-3" /> Cadastro de Aniversariante
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-600">Nome Completo</Label>
                        <Input placeholder="Nome do aniversariante" value={birthdayName} onChange={e => setBirthdayName(e.target.value)} className="h-10 rounded-xl bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-600">WhatsApp (com DDI)</Label>
                        <Input placeholder="Ex: 5511999999999" value={birthdayNumber} onChange={e => setBirthdayNumber(e.target.value)} className="h-10 rounded-xl bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400" />
                      </div>
                    </div>
                    <p className="text-[9px] text-zinc-500 italic">* O aniversariante será cadastrado automaticamente como um novo contato.</p>
                  </div>
                </div>
              )}

              {/* Tipo de Agendamento */}
              <div className="space-y-3">
                <Label className="text-xs font-bold uppercase tracking-wider text-zinc-500">2. O que deseja agendar?</Label>
                <Tabs value={scheduleType} onValueChange={(val: any) => setScheduleType(val)} className="w-full">
                  <TabsList className="grid grid-cols-1 h-12 bg-zinc-100 rounded-xl p-1 gap-1">
                    <TabsTrigger value="template" className="rounded-lg text-xs font-bold data-[state=active]:bg-primary data-[state=active]:text-white">Template Aprovado</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Conteúdo dinâmico baseado no tipo */}
              <div className="space-y-4 animate-in fade-in duration-300">
                {scheduleType === 'template' && (
                  <div className="space-y-3">
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
                      <div className="flex items-center gap-2 text-amber-800">
                        <AlertCircle className="w-4 h-4" />
                        <p className="text-xs font-bold uppercase tracking-wider">Aviso de Cobrança</p>
                      </div>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        Agendamentos serão enviados apenas com <span className="font-bold">templates aprovados pela Meta</span>. 
                        Isso gera um custo médio de <span className="font-bold text-amber-900">R$ 0,33</span> por disparo enviado.
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-xs font-bold text-zinc-700">Selecione o Template Aprovado</Label>
                      {templates.filter(t => t.status === 'APPROVED').length > 0 ? (
                        <>
                          <div className="flex gap-2">
                            <Select value={selectedScheduleId} onValueChange={(value) => { setSelectedScheduleId(value); setScheduleTemplateConfig(null); }}>
                              <SelectTrigger className="h-11 rounded-xl bg-zinc-100 border-none text-zinc-900 flex-1">
                                <SelectValue placeholder="Escolha um modelo..." />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl">
                                {templates.filter(t => t.status === 'APPROVED').map(t => {
                                  const schema = parseTemplateSchema(t.components);
                                  const dynamic = templateHasDynamicInputs(schema) ? countDynamicInputs(schema) : 0;
                                  return (
                                    <SelectItem key={t.id} value={t.id}>
                                      {t.name}{dynamic > 0 ? ` · ${dynamic} variável(is)` : ''}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {(() => {
                              const t = templates.find(temp => temp.id === selectedScheduleId);
                              if (!t || !templateHasDynamicInputs(parseTemplateSchema(t.components))) return null;
                              const issue = templateSendIssue(t, scheduleTemplateConfig);
                              return (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className={cn(
                                    "h-11 rounded-xl px-3 shrink-0 border-zinc-200",
                                    issue && !scheduleTemplateConfig ? "text-amber-700 border-amber-300 bg-amber-50" : "text-primary"
                                  )}
                                  title="Editar variáveis, imagem e links deste template"
                                  aria-label="Editar variáveis do template"
                                  onClick={() => setTemplateVariablesTarget({ template: t, purpose: 'schedule' })}
                                >
                                  <Braces className="w-4 h-4" />
                                  <span className="ml-1.5 text-xs font-bold hidden sm:inline">Variáveis</span>
                                </Button>
                              );
                            })()}
                          </div>
                          {(() => {
                            const t = templates.find(temp => temp.id === selectedScheduleId);
                            if (!t || !templateHasDynamicInputs(parseTemplateSchema(t.components))) return null;
                            return (
                              <p className="text-[10px] text-zinc-500">
                                {scheduleTemplateConfig
                                  ? 'Variáveis definidas para este agendamento.'
                                  : 'Será usada a configuração padrão salva do template. Clique em Variáveis para ajustar imagem e valores.'}
                              </p>
                            );
                          })()}
                          <p className="text-[10px] text-emerald-600 font-medium italic flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Templates podem ser agendados para qualquer contato (Mesmo janelas expiradas).
                          </p>
                        </>
                      ) : (
                        <div className="p-4 rounded-2xl bg-zinc-50 border border-dashed border-zinc-200 text-center space-y-3">
                          <div className="flex flex-col items-center gap-2">
                            <AlertCircle className="w-6 h-6 text-zinc-400" />
                            <p className="text-sm font-medium text-zinc-600">Você ainda não possui modelos aprovados pela Meta.</p>
                          </div>
                          <Button 
                            variant="default" 
                            size="sm" 
                            className="w-full rounded-xl bg-primary text-white font-bold"
                            onClick={() => {
                              setIsSchedulingOpen(false);
                              setActiveTab('templates');
                            }}
                          >
                            Criar meu primeiro Template
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-2">
                  <Label className="text-xs font-bold flex items-center gap-2 text-zinc-700"><Calendar className="w-3 h-3 text-primary" /> Data</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full h-11 justify-start text-left font-normal rounded-xl bg-zinc-100 border-none text-zinc-900",
                          !scheduleDateObj && "text-zinc-400"
                        )}
                      >
                        <Calendar className="mr-2 h-4 w-4" />
                        {scheduleDateObj ? format(scheduleDateObj, "PPP", { locale: ptBR }) : <span>Selecione a data</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-0 rounded-2xl border-none shadow-2xl pointer-events-auto" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={scheduleDateObj}
                        onSelect={(date) => {
                          setScheduleDateObj(date);
                          if (date) setScheduleDate(format(date, "yyyy-MM-dd"));
                        }}
                        initialFocus
                        locale={ptBR}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold flex items-center gap-2 text-zinc-700"><Clock className="w-3 h-3 text-primary" /> Hora</Label>
                  <Input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="h-11 rounded-xl bg-zinc-100 border-none text-zinc-900" />
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => { setIsSchedulingOpen(false); setSelectedContactsForScheduling([]); }} className="rounded-xl h-11 px-6 w-full sm:w-auto text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">Cancelar</Button>
            <Button 
              onClick={selectedCampaignType === 'birthday' ? handleScheduleBirthday : handleScheduleBatch} 
              disabled={isScheduling || (selectedCampaignType === 'individual' && selectedContactsForScheduling.length === 0) || (selectedCampaignType === 'batch' && selectedContactsForScheduling.length === 0) || (selectedCampaignType === 'list' && !contactListText.trim())}
              className="rounded-xl h-11 bg-primary px-4 sm:px-8 shadow-lg shadow-primary/20 font-bold w-full sm:w-auto"
            >
              {isScheduling ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {selectedCampaignType === 'birthday' ? 'Agendar Aniversário' : 
               selectedCampaignType === 'list' ? 'Agendar Lista' : 
               `Agendar para ${selectedContactsForScheduling.length} contatos`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isMetricsListOpen} onOpenChange={setIsMetricsListOpen}>
        <DialogContent className="max-w-2xl rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              {metricsListType === 'paid' && <><DollarSign className="w-5 h-5 text-orange-500" /> Conversas Pagas (Mês)</>}
              {metricsListType === 'active' && <><Clock className="w-5 h-5 text-emerald-500" /> Janela 24h Aberta (Grátis)</>}
              {metricsListType === 'weekly_paid' && <><DollarSign className="w-5 h-5 text-emerald-500" /> Pagas (Semanal)</>}
              {metricsListType === 'weekly_active' && <><Clock className="w-5 h-5 text-emerald-500" /> Ativas (Semanal)</>}
            </DialogTitle>
            <DialogDescription>
              {metricsListType === 'paid' && "Lista de contatos que iniciaram uma nova cobrança este mês."}
              {metricsListType === 'active' && "Contatos com janela de resposta gratuita ativa."}
              {metricsListType === 'weekly_paid' && "Contatos que geraram cobrança nos últimos 7 dias."}
              {metricsListType === 'weekly_active' && "Contatos únicos que interagiram na última semana."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-2">
                {metricsListData.length > 0 ? metricsListData.map((contact) => (
                  <div 
                    key={contact.id} 
                    className="flex items-center justify-between p-3 rounded-xl bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedContact(contact);
                      setActiveTab('contacts');
                      setIsMetricsListOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{contact.name || contact.wa_id}</p>
                        <p className="text-[10px] text-muted-foreground">{contact.wa_id}</p>
                      </div>
                    </div>
                    <Badge className={cn("text-[10px] uppercase font-black", getStatusColor(contact.status))}>
                      {getStatusLabel(contact.status)}
                    </Badge>
                  </div>
                )) : (
                  <div className="text-center py-10 opacity-50">Nenhum contato encontrado.</div>
                )}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsMetricsListOpen(false)} className="w-full rounded-xl">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedAnalysis} onOpenChange={(open) => !open && setSelectedAnalysis(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-3xl rounded-3xl p-6 border-none shadow-2xl animate-in fade-in zoom-in-95 duration-300">
          <DialogHeader className="border-b pb-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <DialogTitle className="text-xl font-bold flex items-center gap-2">
                    {selectedAnalysis?.type || 'Estratégia de Venda'}
                  </DialogTitle>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider flex items-center gap-1">
                    <User className="w-3 h-3" /> {selectedAnalysis?.contactName} • {new Date(selectedAnalysis?.created_at).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="py-6">
            <div className="bg-muted/30 border-l-4 border-indigo-500 rounded-r-2xl p-6 max-h-[60vh] overflow-y-auto">
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-800 dark:text-zinc-200 font-medium">
                {selectedAnalysis?.strategy}
              </p>
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2 border-t pt-4">
            <Button 
              variant="outline" 
              className="flex-1 rounded-xl h-11 font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              onClick={() => copyToClipboard(selectedAnalysis?.strategy, "Análise IA")}
            >
              <Copy className="w-4 h-4 mr-2" /> Copiar Texto
            </Button>
            <Button 
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-11 font-bold shadow-lg shadow-indigo-500/20"
              onClick={() => {
                setSelectedContact(selectedAnalysis?.contactObj);
                setActiveTab('contacts');
                setSelectedAnalysis(null);
              }}
            >
              <MessageSquare className="w-4 h-4 mr-2" /> Abrir Conversa
            </Button>
            <Button 
              variant="ghost" 
              className="sm:w-24 rounded-xl h-11"
              onClick={() => setSelectedAnalysis(null)}
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isNewStatusDialogOpen} onOpenChange={setIsNewStatusDialogOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Nova Etiqueta Kanban</DialogTitle>
            <DialogDescription>Crie uma nova etapa para o seu funil de vendas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome da Etiqueta</Label>
              <Input 
                placeholder="Ex: Prospectando, Reunião Agendada..." 
                value={newStatusData.label}
                onChange={e => setNewStatusData({...newStatusData, label: e.target.value})}
                className="rounded-xl h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Cor da Etiqueta</Label>
              <Select value={newStatusData.color} onValueChange={val => setNewStatusData({...newStatusData, color: val})}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blue">Azul</SelectItem>
                  <SelectItem value="yellow">Amarelo</SelectItem>
                  <SelectItem value="purple">Roxo</SelectItem>
                  <SelectItem value="green">Verde</SelectItem>
                  <SelectItem value="red">Vermelho</SelectItem>
                  <SelectItem value="orange">Laranja</SelectItem>
                  <SelectItem value="indigo">Índigo</SelectItem>
                  <SelectItem value="pink">Rosa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsNewStatusDialogOpen(false)} className="rounded-xl h-11">Cancelar</Button>
            <Button onClick={handleCreateStatus} disabled={saving || !newStatusData.label} className="rounded-xl h-11 px-8 bg-primary">Criar Etiqueta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditStatusDialogOpen} onOpenChange={setIsEditStatusDialogOpen}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Editar Etiqueta</DialogTitle>
            <DialogDescription>Altere as informações da etapa do funil.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome da Etiqueta</Label>
              <Input 
                placeholder="Nome..." 
                value={editingStatus?.label || ''}
                onChange={e => setEditingStatus({...editingStatus, label: e.target.value})}
                className="rounded-xl h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Cor da Etiqueta</Label>
              <Select value={editingStatus?.color} onValueChange={val => setEditingStatus({...editingStatus, color: val})}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blue">Azul</SelectItem>
                  <SelectItem value="yellow">Amarelo</SelectItem>
                  <SelectItem value="purple">Roxo</SelectItem>
                  <SelectItem value="green">Verde</SelectItem>
                  <SelectItem value="red">Vermelho</SelectItem>
                  <SelectItem value="orange">Laranja</SelectItem>
                  <SelectItem value="indigo">Índigo</SelectItem>
                  <SelectItem value="pink">Rosa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl border border-zinc-200">
              <div className="space-y-0.5">
                <Label className="text-sm font-bold flex items-center gap-2">
                  <RefreshCcw className={cn("w-4 h-4 text-zinc-500", editingStatus?.is_starred && "text-yellow-500 fill-yellow-500")} /> 
                  Destacar no Chat
                </Label>
                <p className="text-[10px] text-muted-foreground">Exibir como botão fixo no cabeçalho da conversa.</p>
              </div>
              <Switch 
                checked={editingStatus?.is_starred || false}
                onCheckedChange={(val) => setEditingStatus({...editingStatus, is_starred: val})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditStatusDialogOpen(false)} className="rounded-xl h-11">Cancelar</Button>
            <Button onClick={handleUpdateStatus} disabled={saving || !editingStatus?.label} className="rounded-xl h-11 px-8 bg-primary">Salvar Alterações</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Janela de 24h Expirada - aviso profissional */}
      <ImageEditor
        open={imageEditorOpen}
        imageUrl={pastedImagePreview}
        onCancel={() => setImageEditorOpen(false)}
        onSave={handleEditedImageSave}
      />

      <Dialog open={expiredWindowDialog} onOpenChange={setExpiredWindowDialog}>
        <DialogContent className="max-w-lg rounded-2xl border border-amber-500/30 bg-card">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Clock className="w-5 h-5 text-amber-500" />
              Janela de 24h Expirada
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-1">
              Esta conversa está fora da janela de 24h. Por isso o ZAPMRO não pode enviar uma mensagem comum agora.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm leading-relaxed">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <p className="font-semibold text-amber-400 mb-1">Opção 1 — Enviar um Template Aprovado</p>
              <p className="text-muted-foreground">
                Para iniciar uma nova conversa por aqui, use um <strong className="text-foreground">Template aprovado pela Meta</strong>.
                A Meta cobra em torno de <strong className="text-foreground">R$ 0,33</strong> por mensagem iniciada por você fora da janela.
                É necessário ter saldo na Meta e o template aprovado.
              </p>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <p className="font-semibold text-emerald-400 mb-1">Opção 2 — Iniciar pelo seu WhatsApp Business</p>
              <p className="text-muted-foreground">
                Você pode mandar a primeira mensagem direto pelo app <strong className="text-foreground">WhatsApp Business</strong> no seu celular.
                Quando o cliente responder, abre uma <strong className="text-foreground">janela de 24h gratuita</strong> e você volta a usar o ZAPMRO sem pagar nada por mensagem dentro desse período.
              </p>
            </div>

            <p className="text-xs text-muted-foreground/80 border-t border-border/40 pt-3">
              <strong className="text-foreground">Observação:</strong> esse custo de R$ 0,33 é cobrado pela Meta e não tem relação com a sua mensalidade/anuidade do ZAPMRO.
              Cobranças por envio frio (fora da janela de 24h) são regra da Meta para iniciar novas conversas.
            </p>
          </div>

          <DialogFooter>
            <Button onClick={() => setExpiredWindowDialog(false)} className="rounded-xl h-11 px-8 bg-primary">
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação - Limpar / Apagar conversa via swipe */}
      <Dialog open={!!confirmConvAction} onOpenChange={(open) => !open && setConfirmConvAction(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {confirmConvAction?.type === 'clear' ? (
                <><Eraser className="w-5 h-5 text-amber-500" /> Limpar conversa</>
              ) : (
                <><Trash2 className="w-5 h-5 text-red-500" /> Apagar conversa</>
              )}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {confirmConvAction?.type === 'clear' ? (
                <>Tem certeza que deseja <strong>limpar todas as mensagens</strong> da conversa com <strong>{confirmConvAction?.contactName}</strong>? O contato permanece, apenas o histórico será apagado. Esta ação não pode ser desfeita.</>
              ) : (
                <>Tem certeza que deseja <strong>apagar a conversa completa</strong> com <strong>{confirmConvAction?.contactName}</strong>? O contato e todas as mensagens serão removidos. Esta ação não pode ser desfeita.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirmConvAction(null)} className="rounded-xl">Cancelar</Button>
            <Button
              onClick={async () => {
                if (!confirmConvAction) return;
                const action = confirmConvAction;
                setConfirmConvAction(null);
                if (action.type === 'clear') await handleClearConversation(action.contactId);
                else await handleDeleteConversation(action.contactId);
              }}
              className={cn(
                "rounded-xl text-white",
                confirmConvAction?.type === 'clear' ? "bg-amber-500 hover:bg-amber-600" : "bg-red-600 hover:bg-red-700"
              )}
            >
              {confirmConvAction?.type === 'clear' ? 'Limpar mensagens' : 'Apagar conversa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Kanban quick preview */}
      <Dialog open={!!previewContact} onOpenChange={(o) => { if (!o) setPreviewContact(null); }}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-4 border-b bg-[#202c33] text-white">
            <DialogTitle className="text-base font-bold truncate">
              {previewContact?.name || previewContact?.wa_id}
            </DialogTitle>
            {previewContact?.name && (
              <p className="text-xs opacity-70 font-mono">{previewContact.wa_id}</p>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-4 bg-[#0b141a] space-y-2 min-h-[300px]">
            {previewLoading ? (
              <p className="text-center text-xs text-muted-foreground py-8">Carregando conversa...</p>
            ) : previewMessages.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-8">Sem mensagens</p>
            ) : previewMessages.map((m: any) => {
              const isOut = m.direction === 'outbound';
              const body = (m.body || m.content || m.text || '').toString().replace(/\[(image|video|document|audio|sticker)\]/gi, '').trim();
              const hasMedia = m.media_url || m.image_url || m.video_url || m.document_url || m.audio_url;
              return (
                <div key={m.id} className={cn("flex", isOut ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[75%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap shadow",
                    isOut ? "bg-[#005c4b] text-white" : "bg-[#202c33] text-[#e9edef]"
                  )}>
                    {hasMedia && (
                      <p className="text-[10px] opacity-70 mb-1 uppercase">📎 mídia</p>
                    )}
                    {body || (hasMedia ? '' : <span className="opacity-50 italic">(vazio)</span>)}
                    <p className="text-[9px] opacity-50 mt-1 text-right">
                      {m.created_at && new Date(m.created_at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="p-3 border-t bg-background">
            <Button variant="outline" onClick={() => setPreviewContact(null)}>Fechar</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => {
                const c = previewContact;
                setPreviewContact(null);
                setKanbanView(false);
                if (c) openChat(c);
              }}
            >
              Abrir Completa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Configurações da barra de fluxos */}
      {/* Histórico de mensagens apagadas */}
      <Dialog open={deletedHistoryOpen} onOpenChange={setDeletedHistoryOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <HistoryIcon className="w-4 h-4" /> Mensagens apagadas
            </DialogTitle>
            <DialogDescription className="text-xs">
              Histórico das mensagens desta conversa que foram apagadas.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 -mx-6 px-6">
            {deletedHistoryLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
            ) : deletedHistoryMessages.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Nenhuma mensagem apagada nesta conversa.</div>
            ) : (
              <ul className="space-y-2 py-2">
                {deletedHistoryMessages.map((m) => (
                  <li key={m.id} className="rounded-lg border border-border/40 bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
                        m.direction === 'inbound' ? 'bg-blue-500/10 text-blue-600' : 'bg-emerald-500/10 text-emerald-600'
                      )}>
                        {m.direction === 'inbound' ? 'Recebida' : 'Enviada'} · {m.message_type || 'text'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {m.deleted_at ? new Date(m.deleted_at).toLocaleString('pt-BR') : ''}
                      </span>
                    </div>
                    {m.content && <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>}
                    {m.media_url && (
                      <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">
                        Ver mídia anexada
                      </a>
                    )}
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Enviada em {m.created_at ? new Date(m.created_at).toLocaleString('pt-BR') : '—'}
                      {m.deleted_by ? ` · Apagada por ${m.deleted_by}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeletedHistoryOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Configurações do CRM (Kanban) */}
      <Dialog open={kanbanSettingsOpen} onOpenChange={setKanbanSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings className="w-4 h-4" /> Configurar CRM
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ajuste a largura das colunas e o tamanho da fonte do Kanban.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Largura das colunas</span>
                <span className="text-muted-foreground">{kanbanPrefs.colWidth}px</span>
              </div>
              <input
                type="range" min={180} max={480} step={10}
                value={kanbanPrefs.colWidth}
                onChange={e => setKanbanPrefs(p => ({ ...p, colWidth: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span>Tamanho da fonte</span>
                <span className="text-muted-foreground">{kanbanPrefs.fontScale}%</span>
              </div>
              <input
                type="range" min={75} max={160} step={5}
                value={kanbanPrefs.fontScale}
                onChange={e => setKanbanPrefs(p => ({ ...p, fontScale: Number(e.target.value) }))}
                className="w-full"
              />
            </div>
            <Button
              variant="outline" size="sm"
              onClick={() => setKanbanPrefs({ colWidth: 288, fontScale: 100 })}
              className="w-full"
            >
              Restaurar padrão
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={flowBarSettingsOpen} onOpenChange={setFlowBarSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings className="w-4 h-4" /> Configurar Botões de Fluxo
            </DialogTitle>
            <DialogDescription className="text-xs">
              Personalize tamanho, cor, ordem e disposição dos botões de fluxo, além do tamanho do texto do chat.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-bold">Tamanho dos botões</Label>
                <span className="text-[10px] text-muted-foreground tabular-nums">{flowBarPrefs.size}%</span>
              </div>
              <input
                type="range" min={70} max={200} step={5}
                value={flowBarPrefs.size}
                onChange={(e) => setFlowBarPrefs(p => ({ ...p, size: Number(e.target.value) }))}
                className="w-full accent-primary"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-bold">Tamanho do texto do chat</Label>
                <span className="text-[10px] text-muted-foreground tabular-nums">{flowBarPrefs.chatFontScale}%</span>
              </div>
              <input
                type="range" min={80} max={160} step={5}
                value={flowBarPrefs.chatFontScale}
                onChange={(e) => setFlowBarPrefs(p => ({ ...p, chatFontScale: Number(e.target.value) }))}
                className="w-full accent-primary"
              />
            </div>

            <div>
              <Label className="text-xs font-bold mb-1.5 block">Cor dos botões</Label>
              <div className="flex gap-2 flex-wrap">
                {Object.keys(FLOW_BAR_COLORS).map((colorKey) => (
                  <button
                    key={colorKey}
                    type="button"
                    onClick={() => setFlowBarPrefs(p => ({ ...p, color: colorKey }))}
                    className={cn(
                      'h-8 px-3 rounded-md border font-bold text-xs capitalize transition-all',
                      FLOW_BAR_COLORS[colorKey].border,
                      FLOW_BAR_COLORS[colorKey].bg,
                      FLOW_BAR_COLORS[colorKey].text,
                      flowBarPrefs.color === colorKey && 'ring-2 ring-offset-1 ring-primary'
                    )}
                  >
                    {colorKey}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold mb-1.5 block">Disposição</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: 'scroll', l: 'Rolagem' },
                  { v: 'one', l: '1+ linhas' },
                  { v: 'two', l: 'Máx. 2 linhas' },
                ] as const).map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setFlowBarPrefs(p => ({ ...p, layout: opt.v }))}
                    className={cn(
                      'h-9 rounded-md border text-xs font-bold transition-all',
                      flowBarPrefs.layout === opt.v
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/30 hover:bg-muted/60 border-border/40'
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold mb-1.5 block">Ordem dos botões</Label>
              <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                {(() => {
                  const activeFlows = flows.filter(f => f.is_active);
                  const order = flowBarPrefs.order || [];
                  const ordered = [...activeFlows].sort((a, b) => {
                    const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
                    if (ia === -1 && ib === -1) return 0;
                    if (ia === -1) return 1;
                    if (ib === -1) return -1;
                    return ia - ib;
                  });
                  const move = (idx: number, dir: -1 | 1) => {
                    const arr = ordered.map(f => f.id);
                    const ni = idx + dir;
                    if (ni < 0 || ni >= arr.length) return;
                    [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
                    setFlowBarPrefs(p => ({ ...p, order: arr }));
                  };
                  if (ordered.length === 0) {
                    return <div className="p-3 text-xs text-muted-foreground text-center">Nenhum fluxo ativo</div>;
                  }
                  return ordered.map((f, idx) => (
                    <div key={f.id} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="text-[10px] text-muted-foreground tabular-nums w-5">{idx + 1}.</span>
                      <span className="text-xs font-medium flex-1 truncate">{f.name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(idx, -1)} disabled={idx === 0}>
                        <LucideIcons.ChevronUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => move(idx, 1)} disabled={idx === ordered.length - 1}>
                        <LucideIcons.ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFlowBarPrefs({ size: 100, color: 'blue', layout: 'scroll', chatFontScale: 100, order: [] })}
            >
              Restaurar padrão
            </Button>
            <Button onClick={() => setFlowBarSettingsOpen(false)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
};

export default CRM;
