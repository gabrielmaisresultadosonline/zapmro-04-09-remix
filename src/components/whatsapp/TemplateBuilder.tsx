import { uploadDedupedMedia } from '@/lib/mediaStorage';
import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Plus, 
  Trash2, 
  Send, 
  Layout, 
  Type, 
  Image as ImageIcon, 
  Video, 
  FileText, 
  MousePointer2, 
  ExternalLink, 
  Phone, 
  Play, 
  Zap, 
  Upload, 
  Loader2, 
  File, 
  Eye,
  CreditCard,
  Copy,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
  Info,
  Check,
  RefreshCw,
  Link2,
  Braces
} from "lucide-react";
import { createShortLink, isShortLink } from "@/lib/shortLink";
import TemplatePreview from './TemplatePreview';
import MetaPricingCalculator from './MetaPricingCalculator';
import TemplateVariablesGuide from './TemplateVariablesGuide';
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TemplateBuilderProps {
  onSave: (template: any) => void;
  isSaving?: boolean;
}

const getTemplateVariableIndexes = (value: string) =>
  Array.from(new Set(Array.from(value.matchAll(/\{\{(\d+)\}\}/g), match => Number(match[1])))).sort((a, b) => a - b);

const hasSequentialTemplateVariables = (value: string) => {
  const indexes = getTemplateVariableIndexes(value);
  return indexes.every((index, position) => index === position + 1);
};

/**
 * A Meta rejeita botões de URL que apontem direto para o WhatsApp
 * ("Direct links to WhatsApp aren't allowed for buttons").
 * Bloqueamos antes do envio para evitar reprovação do template.
 */
const WHATSAPP_LINK_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)*(wa\.me|whatsapp\.com|wa\.link|whatsapp\.net|api\.whatsapp\.com|chat\.whatsapp\.com)(\/|$|\?)/i;

const isWhatsAppDirectLink = (value: string) => {
  const url = String(value || '').trim();
  if (!url) return false;
  if (WHATSAPP_LINK_PATTERN.test(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /(^|\.)(wa\.me|whatsapp\.com|wa\.link|whatsapp\.net)$/.test(host);
  } catch {
    return false;
  }
};


const getButtonPayload = (button: any) => {
  const payload: any = { type: button.type, text: String(button.text || '').trim() };
  if (button.type === 'URL') {
    payload.url = String(button.url || '').trim();
    if (/\{\{1\}\}/.test(payload.url)) payload.example = [payload.url.replace(/\{\{1\}\}/g, 'exemplo')];
  }
  if (button.type === 'PHONE') payload.phone_number = String(button.phone_number || '').trim();
  return payload;
};

const TemplateBuilder: React.FC<TemplateBuilderProps> = ({ onSave, isSaving }) => {
  const { toast } = useToast();
  const [templateType, setTemplateType] = useState<'STANDARD' | 'CAROUSEL'>('STANDARD');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('MARKETING');
  const [language, setLanguage] = useState('pt_BR');
  
  // Standard Template State
  const [headerType, setHeaderType] = useState('NONE');
  const [headerText, setHeaderText] = useState('');
  const [headerUrl, setHeaderUrl] = useState('');
  const [bodyText, setBodyText] = useState('');
  // Exemplos reais de cada variável — a Meta usa para entender o contexto na aprovação.
  const [bodyExamples, setBodyExamples] = useState<Record<string, string>>({});
  const [headerExample, setHeaderExample] = useState('');
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<any[]>([]);
  const [shorteningKey, setShorteningKey] = useState<string | null>(null);

  // Utility Converter State
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [utilityLoading, setUtilityLoading] = useState(false);
  const [utilityOriginal, setUtilityOriginal] = useState('');
  const [utilityVersions, setUtilityVersions] = useState<string[]>([]);
  const [utilitySelected, setUtilitySelected] = useState(0);
  
  // Carousel State
  const [carouselBody, setCarouselBody] = useState('');
  const [cards, setCards] = useState<any[]>([
    { id: '1', headerType: 'IMAGE', headerUrl: '', bodyText: '', buttons: [] },
    { id: '2', headerType: 'IMAGE', headerUrl: '', bodyText: '', buttons: [] }
  ]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);

  // PIX State
  const [isPix, setIsPix] = useState(false);
  const [pixCode, setPixCode] = useState('');

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addButton = (type: 'QUICK_REPLY' | 'URL' | 'PHONE', cardIndex?: number) => {
    if (cardIndex !== undefined) {
      const card = cards[cardIndex];
      if (card.buttons.length >= 2) return;
      const newButton = { type, text: '', url: type === 'URL' ? '' : undefined, phone_number: type === 'PHONE' ? '' : undefined };
      const newCards = [...cards];
      newCards[cardIndex].buttons.push(newButton);
      setCards(newCards);
    } else {
      if (buttons.length >= 3) return;
      const newButton = { type, text: '', url: type === 'URL' ? '' : undefined, phone_number: type === 'PHONE' ? '' : undefined };
      setButtons([...buttons, newButton]);
    }
  };

  const removeButton = (index: number, cardIndex?: number) => {
    if (cardIndex !== undefined) {
      const newCards = [...cards];
      newCards[cardIndex].buttons = newCards[cardIndex].buttons.filter((_: any, i: number) => i !== index);
      setCards(newCards);
    } else {
      setButtons(buttons.filter((_, i) => i !== index));
    }
  };

  const updateButton = (index: number, updates: any, cardIndex?: number) => {
    if (cardIndex !== undefined) {
      const newCards = [...cards];
      newCards[cardIndex].buttons[index] = { ...newCards[cardIndex].buttons[index], ...updates };
      setCards(newCards);
    } else {
      setButtons(buttons.map((b, i) => i === index ? { ...b, ...updates } : b));
    }
  };

  /**
   * Encurtador opcional: converte a URL do botão num link do próprio domínio.
   * Útil para links que a Meta bloqueia (wa.me / api.whatsapp.com).
   */
  const shortenButtonUrl = async (index: number, cardIndex?: number) => {
    const current = cardIndex !== undefined ? cards[cardIndex].buttons[index] : buttons[index];
    const url = String(current?.url || '').trim();

    if (!/^https?:\/\//i.test(url)) {
      toast({ title: "URL inválida", description: "Cole o link completo (https://…) antes de encurtar.", variant: "destructive" });
      return;
    }
    if (isShortLink(url)) {
      toast({ title: "Já encurtado", description: "Este botão já usa um link do seu domínio." });
      return;
    }

    const key = `${cardIndex ?? 'std'}-${index}`;
    setShorteningKey(key);
    try {
      const { shortUrl } = await createShortLink(url);
      updateButton(index, { url: shortUrl }, cardIndex);
      toast({ title: "Link encurtado", description: shortUrl });
    } catch (error: any) {
      toast({ title: "Erro ao encurtar", description: error?.message || "Tente novamente.", variant: "destructive" });
    } finally {
      setShorteningKey(null);
    }
  };

  const addCard = () => {
    if (cards.length >= 10) return;
    setCards([...cards, { id: Date.now().toString(), headerType: 'IMAGE', headerUrl: '', bodyText: '', buttons: [] }]);
    setActiveCardIndex(cards.length);
  };

  const removeCard = (index: number) => {
    if (cards.length <= 2) {
      toast({ title: "Mínimo de 2 cartões", variant: "destructive" });
      return;
    }
    const newCards = cards.filter((_, i) => i !== index);
    setCards(newCards);
    setActiveCardIndex(Math.max(0, index - 1));
  };

  const updateCard = (index: number, updates: any) => {
    setCards(cards.map((c, i) => i === index ? { ...c, ...updates } : c));
  };

  const generateUtilityVersion = async (source: string) => {
    const { data, error } = await supabase.functions.invoke('meta-whatsapp-crm', {
      body: { action: 'convertToUtility', message: source }
    });
    if (error) throw new Error(error.message || 'Falha ao conectar com o conversor');
    if (!data?.success) throw new Error(data?.error || 'Não foi possível converter a mensagem');
    return String(data.converted || '').trim();
  };

  const handleConvertToUtility = async () => {
    if (!bodyText.trim()) {
      toast({ title: "Escreva a mensagem primeiro", description: "O corpo da mensagem está vazio.", variant: "destructive" });
      return;
    }
    setUtilityOriginal(bodyText);
    setUtilityVersions([]);
    setUtilitySelected(0);
    setUtilityOpen(true);
    setUtilityLoading(true);
    try {
      const converted = await generateUtilityVersion(bodyText);
      setUtilityVersions([converted]);
    } catch (err: any) {
      toast({ title: "Conversor indisponível", description: err.message, variant: "destructive" });
      setUtilityOpen(false);
    } finally {
      setUtilityLoading(false);
    }
  };

  const handleGenerateAnotherVersion = async () => {
    if (utilityVersions.length >= 4) {
      toast({ title: "Limite atingido", description: "Você pode gerar até 4 versões por conversão." });
      return;
    }
    setUtilityLoading(true);
    try {
      const converted = await generateUtilityVersion(utilityOriginal);
      setUtilityVersions(prev => {
        const next = [...prev, converted];
        setUtilitySelected(next.length - 1);
        return next;
      });
    } catch (err: any) {
      toast({ title: "Erro ao gerar variação", description: err.message, variant: "destructive" });
    } finally {
      setUtilityLoading(false);
    }
  };

  const handleAcceptUtilityVersion = () => {
    const chosen = utilityVersions[utilitySelected];
    if (!chosen) return;
    setBodyText(chosen);
    setUtilityOpen(false);
    toast({ title: "Mensagem convertida", description: "O corpo da mensagem foi substituído pela versão Utility." });
  };

  /** Insere a próxima variável sequencial ({{n}}) na posição do cursor do corpo. */
  const insertNextBodyVariable = () => {
    const nextIndex = getTemplateVariableIndexes(bodyText).length + 1;
    const token = `{{${nextIndex}}}`;
    const textarea = bodyTextareaRef.current;
    const start = textarea?.selectionStart ?? bodyText.length;
    const end = textarea?.selectionEnd ?? bodyText.length;
    const next = `${bodyText.slice(0, start)}${token}${bodyText.slice(end)}`;
    setBodyText(next);
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const bodyVariableIndexes = getTemplateVariableIndexes(bodyText);

  /**
   * A Meta rejeita corpos que começam ou terminam com uma variável.
   * Estado derivado (sem useEffect) usado para bloquear o envio e avisar na hora.
   */
  const bodyStartsOrEndsWithVariable = (() => {
    const trimmed = bodyText.trim();
    if (!trimmed) return false;
    return /^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}$/.test(trimmed);
  })();


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, cardIndex?: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();

      // Caminho derivado do hash: a mesma mídia de cabeçalho não duplica.
      const uploaded = await uploadDedupedMedia({
        bucket: 'crm-media',
        folder: 'template-media',
        file,
        contentType: file.type || undefined,
        extension: fileExt,
      });
      const publicUrl = uploaded.url;


      if (cardIndex !== undefined) {
        updateCard(cardIndex, { headerUrl: publicUrl });
      } else {
        setHeaderUrl(publicUrl);
      }
      toast({ title: "Arquivo enviado com sucesso!" });
    } catch (error: any) {
      console.error('Error uploading file:', error);
      toast({ title: "Erro no upload", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = () => {
    if (!bodyText.trim() && templateType === 'STANDARD') {
      toast({ title: "Corpo obrigatório", description: "Escreva a mensagem antes de enviar para aprovação.", variant: "destructive" });
      return;
    }

    if (headerType === 'TEXT' && !headerText.trim()) {
      toast({ title: "Cabeçalho vazio", description: "Preencha o cabeçalho ou selecione Nenhum.", variant: "destructive" });
      return;
    }

    const headerVariables = getTemplateVariableIndexes(headerText);
    if (templateType === 'STANDARD' && headerType === 'TEXT' && (headerVariables.length > 1 || (headerVariables.length === 1 && headerVariables[0] !== 1))) {
      toast({ title: "Variável inválida no cabeçalho", description: "O cabeçalho aceita somente a variável {{1}}.", variant: "destructive" });
      return;
    }

    if (templateType === 'STANDARD' && !hasSequentialTemplateVariables(bodyText)) {
      toast({ title: "Variáveis fora de sequência", description: "Use {{1}}, {{2}}, {{3}} em ordem, sem pular números.", variant: "destructive" });
      return;
    }

    // Regra da Meta: o corpo não pode começar nem terminar com uma variável
    // ("Variables can't be at the start or end of the template").
    if (templateType === 'STANDARD' && bodyStartsOrEndsWithVariable) {
      toast({
        title: "Variável no início ou fim",
        description: "A Meta não aceita o corpo começando ou terminando com {{n}}. Ex.: use \"Olá {{1}}, tudo bem?\" em vez de \"{{1}}\" no fim.",
        variant: "destructive",
      });
      return;
    }


    const invalidButton = buttons.find(button => !String(button.text || '').trim() || (button.type === 'URL' && !/^https?:\/\//i.test(String(button.url || '').trim())));
    if (templateType === 'STANDARD' && invalidButton) {
      toast({ title: "Botão incompleto", description: "Preencha o texto e use uma URL completa iniciando com https://.", variant: "destructive" });
      return;
    }

    if (templateType === 'STANDARD' && buttons.some(button => button.type === 'URL' && isWhatsAppDirectLink(String(button.url || '')))) {
      toast({
        title: "Link do WhatsApp não permitido",
        description: "A Meta bloqueia botões que apontam para wa.me / api.whatsapp.com. Use um link do seu site ou troque por um botão de Resposta Rápida.",
        variant: "destructive",
      });
      return;
    }

    if (templateType === 'STANDARD' && buttons.filter(button => button.type === 'URL').length > 2) {
      toast({ title: "Botões de link em excesso", description: "A Meta permite no máximo 2 botões de URL por template.", variant: "destructive" });
      return;
    }

    if (templateType === 'STANDARD' && buttons.filter(button => button.type === 'PHONE_NUMBER' || button.type === 'PHONE').length > 1) {
      toast({ title: "Botões de telefone em excesso", description: "A Meta permite no máximo 1 botão de telefone por template.", variant: "destructive" });
      return;
    }

    if (templateType === 'STANDARD' && buttons.length > 10) {
      toast({ title: "Botões em excesso", description: "A Meta permite no máximo 10 botões por template.", variant: "destructive" });
      return;
    }


    if (templateType === 'STANDARD' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) && !headerUrl.trim()) {
      toast({
        title: "Mídia obrigatória",
        description: "Faça upload ou informe uma URL pública real antes de enviar o template para aprovação.",
        variant: "destructive",
      });
      return;
    }

    if (templateType === 'CAROUSEL') {
      const emptyCardIndex = cards.findIndex(card => !String(card.headerUrl || '').trim());
      if (emptyCardIndex >= 0) {
        toast({
          title: "Mídia obrigatória no carrossel",
          description: `Adicione uma imagem ou vídeo real no Cartão ${emptyCardIndex + 1} antes de enviar.`,
          variant: "destructive",
        });
        setActiveCardIndex(emptyCardIndex);
        return;
      }

      const expectedButtonTypes = cards[0].buttons.map((button: any) => button.type).join(',');
      const invalidCardIndex = cards.findIndex(card =>
        !String(card.bodyText || '').trim() ||
        card.buttons.map((button: any) => button.type).join(',') !== expectedButtonTypes ||
        card.buttons.some((button: any) => !String(button.text || '').trim() || (button.type === 'URL' && !/^https?:\/\//i.test(String(button.url || '').trim())))
      );
      if (invalidCardIndex >= 0) {
        toast({
          title: "Cartão incompleto",
          description: `Revise o texto, links e tipos de botão do Cartão ${invalidCardIndex + 1}. Todos os cartões devem usar os mesmos tipos de botão.`,
          variant: "destructive",
        });
        setActiveCardIndex(invalidCardIndex);
        return;
      }

      const whatsappLinkCardIndex = cards.findIndex(card =>
        card.buttons.some((button: any) => button.type === 'URL' && isWhatsAppDirectLink(String(button.url || '')))
      );
      if (whatsappLinkCardIndex >= 0) {
        toast({
          title: "Link do WhatsApp não permitido",
          description: `O Cartão ${whatsappLinkCardIndex + 1} usa um link direto do WhatsApp (wa.me). A Meta não aprova esse tipo de botão.`,
          variant: "destructive",
        });
        setActiveCardIndex(whatsappLinkCardIndex);
        return;
      }



      const expectedHeaderType = cards[0].headerType;
      if (cards.some(card => card.headerType !== expectedHeaderType)) {
        toast({ title: "Mídias incompatíveis", description: "Todos os cartões precisam usar o mesmo tipo de mídia: somente imagens ou somente vídeos.", variant: "destructive" });
        return;
      }
    }

    const components: any[] = [];
    
    if (templateType === 'STANDARD') {
      // Header
      if (headerType !== 'NONE') {
        const header: any = { type: 'HEADER', format: headerType };
        if (headerType === 'TEXT') {
          header.text = headerText;
          const variables = headerText.match(/\{\{\d+\}\}/g);
          if (variables) header.example = { header_text: [headerExample.trim() || "Exemplo"] };
        } else {
          header.example = { header_handle: [headerUrl.trim()] };
        }
        components.push(header);
      }
      
      // Body
      const body: any = { type: 'BODY', text: bodyText };
      const bodyVariables = getTemplateVariableIndexes(bodyText);
      if (bodyVariables.length > 0) {
        body.example = { body_text: [bodyVariables.map(index => (bodyExamples[String(index)] || '').trim() || "Exemplo")] };
      }
      components.push(body);
      
      // Footer
      if (footerText) components.push({ type: 'FOOTER', text: footerText });
      
      // Buttons
      if (buttons.length > 0) {
        components.push({
          type: 'BUTTONS',
            buttons: buttons.map(getButtonPayload)
        });
      }
    } else {
      // Carousel Template
      // Main Body
      const body: any = { type: 'BODY', text: carouselBody || "Veja as opções abaixo:" };
      components.push(body);

      // Carousel Component
      const carousel: any = {
        type: 'CAROUSEL',
        cards: cards.map(card => {
          const cardComponents: any[] = [
            { 
              type: 'HEADER', 
              format: card.headerType, 
              example: { header_handle: [String(card.headerUrl || '').trim()] } 
            },
            { 
              type: 'BODY', 
              text: card.bodyText || "Descrição do cartão" 
            }
          ];

          if (card.buttons.length > 0) {
            cardComponents.push({
              type: 'BUTTONS',
              buttons: card.buttons.map(getButtonPayload)
            });
          }

          return { components: cardComponents };
        })
      };
      components.push(carousel);
    }
    
    onSave({ 
      name, 
      category, 
      language, 
      components, 
      is_pix: isPix, 
      pix_code: pixCode, 
      is_carousel: templateType === 'CAROUSEL' 
    });
  };

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-4">
      <div className="space-y-6">
        <Card className="glass-card">
          <CardHeader>
            <div className="flex justify-between items-start">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Layout className="w-5 h-5 text-primary" /> Configuração do Template
                </CardTitle>
                <CardDescription>Crie templates profissionais para o WhatsApp</CardDescription>
              </div>
              <div className="flex bg-muted p-1 rounded-lg">
                <Button 
                  variant={templateType === 'STANDARD' ? 'default' : 'ghost'} 
                  size="sm" 
                  onClick={() => setTemplateType('STANDARD')}
                >
                  Padrão
                </Button>
                <Button 
                  variant={templateType === 'CAROUSEL' ? 'default' : 'ghost'} 
                  size="sm" 
                  onClick={() => setTemplateType('CAROUSEL')}
                >
                  Carrossel
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome do Template</Label>
                <Input 
                  placeholder="ex: promocao_verao" 
                  value={name} 
                  onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} 
                />
              </div>
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utilidade</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {templateType === 'STANDARD' ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-left-2">
                <div className="space-y-2">
                  <Label>Cabeçalho (Opcional)</Label>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant={headerType === 'NONE' ? 'default' : 'outline'} size="sm" onClick={() => { setHeaderType('NONE'); setHeaderUrl(''); }}>Nenhum</Button>
                    <Button variant={headerType === 'TEXT' ? 'default' : 'outline'} size="sm" onClick={() => { setHeaderType('TEXT'); setHeaderUrl(''); }}><Type className="w-4 h-4 mr-1" /> Texto</Button>
                    <Button variant={headerType === 'IMAGE' ? 'default' : 'outline'} size="sm" onClick={() => setHeaderType('IMAGE')}><ImageIcon className="w-4 h-4 mr-1" /> Imagem</Button>
                    <Button variant={headerType === 'VIDEO' ? 'default' : 'outline'} size="sm" onClick={() => setHeaderType('VIDEO')}><Video className="w-4 h-4 mr-1" /> Vídeo</Button>
                    <Button variant={headerType === 'DOCUMENT' ? 'default' : 'outline'} size="sm" onClick={() => setHeaderType('DOCUMENT')}><FileText className="w-4 h-4 mr-1" /> Documento</Button>
                  </div>
                  
                  {headerType === 'TEXT' && (
                    <div className="space-y-2">
                      <Input placeholder="Texto do cabeçalho (aceita somente {{1}})" value={headerText} onChange={e => setHeaderText(e.target.value)} maxLength={60} />
                      {/\{\{1\}\}/.test(headerText) && (
                        <Input placeholder="Exemplo real para {{1}} do cabeçalho (ex.: Pedido 45821)" value={headerExample} onChange={e => setHeaderExample(e.target.value)} maxLength={60} className="text-xs" />
                      )}
                    </div>
                  )}
                  {(headerType === 'IMAGE' || headerType === 'VIDEO' || headerType === 'DOCUMENT') && (
                    <div className="flex gap-2">
                      <Input placeholder="URL da mídia" value={headerUrl} onChange={e => setHeaderUrl(e.target.value)} className="flex-1" />
                      <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFileUpload(e)} accept={headerType === 'IMAGE' ? 'image/*' : headerType === 'VIDEO' ? 'video/*' : '*/*'} />
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                        {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      </Button>
                    </div>
                  )}
                  {(headerType === 'IMAGE' || headerType === 'VIDEO' || headerType === 'DOCUMENT') && (
                    <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                      <Info className="w-3 h-3 shrink-0 mt-0.5" />
                      Esta mídia é só o exemplo para aprovação. No envio você pode trocar por outra imagem/vídeo em cada campanha, mantendo o mesmo template aprovado.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Corpo da Mensagem</Label>
                    <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={insertNextBodyVariable} aria-label="Inserir variável no corpo">
                      <Braces className="w-3 h-3 mr-1" /> Inserir variável {`{{${bodyVariableIndexes.length + 1}}}`}
                    </Button>
                  </div>
                  <div className="relative">
                    <Textarea
                      ref={bodyTextareaRef}
                      placeholder="Ex.: Olá {{1}}, sua solicitação {{2}} foi atualizada."
                      value={bodyText}
                      onChange={e => setBodyText(e.target.value)}
                      rows={5}
                      className="pb-12"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleConvertToUtility}
                      disabled={utilityLoading}
                      className="absolute bottom-2 left-2 right-2 sm:right-auto h-8 bg-orange-500 hover:bg-orange-600 text-white shadow-md"
                    >
                      {utilityLoading && !utilityOpen
                        ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                      Converter para Utility
                    </Button>
                  </div>
                  {bodyVariableIndexes.length > 0 && (
                    <div className="rounded-xl border bg-muted/30 p-3 space-y-2 animate-in fade-in">
                      <p className="text-[11px] font-semibold flex items-center gap-1.5">
                        <Braces className="w-3.5 h-3.5 text-primary" /> Exemplos das variáveis (obrigatório para aprovação)
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Informe um valor real de cada variável. No envio, você troca por texto ou campos do contato ({'{{nome}}'}, {'{{pedido}}'}...).
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {bodyVariableIndexes.map(index => (
                          <div key={index} className="space-y-1">
                            <Label className="text-[10px] font-mono text-primary">{`{{${index}}}`}</Label>
                            <Input
                              value={bodyExamples[String(index)] || ''}
                              onChange={e => setBodyExamples(prev => ({ ...prev, [String(index)]: e.target.value }))}
                              placeholder={index === 1 ? 'Ex.: João' : index === 2 ? 'Ex.: 45821' : 'Ex.: valor real'}
                              className="h-8 text-xs"
                              maxLength={120}
                            />
                          </div>
                        ))}
                      </div>
                      {!hasSequentialTemplateVariables(bodyText) && (
                        <p className="text-[10px] text-destructive">As variáveis precisam ser sequenciais: {'{{1}}'}, {'{{2}}'}, {'{{3}}'}...</p>
                      )}
                      {bodyStartsOrEndsWithVariable && (
                        <p className="text-[10px] text-destructive">
                          A Meta não aceita variável no início nem no fim do corpo. Escreva algum texto antes e depois (ex.: “Olá {'{{1}}'}, tudo bem?”).
                        </p>
                      )}

                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Rodapé (Opcional)</Label>
                  <Input placeholder="Rodapé curto" value={footerText} onChange={e => setFooterText(e.target.value)} maxLength={60} />
                </div>

                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <Label>Botões (Máx 3)</Label>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => addButton('QUICK_REPLY')} disabled={buttons.length >= 3}><MousePointer2 className="w-3 h-3 mr-1" /> Resposta</Button>
                      <Button variant="outline" size="sm" onClick={() => addButton('URL')} disabled={buttons.length >= 3}><ExternalLink className="w-3 h-3 mr-1" /> Link</Button>
                    </div>
                  </div>
                  {buttons.map((btn, idx) => (
                    <div key={idx} className="flex gap-2 items-start bg-muted/30 p-2 rounded-lg border">
                      <div className="flex-1 space-y-2">
                        <Input placeholder="Texto" value={btn.text} onChange={e => updateButton(idx, { text: e.target.value })} maxLength={25} />
                        {btn.type === 'URL' && (
                          <div className="space-y-1">
                            <div className="flex gap-2">
                              <Input placeholder="URL" value={btn.url} onChange={e => updateButton(idx, { url: e.target.value })} />
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="shrink-0"
                                disabled={shorteningKey === `std-${idx}`}
                                onClick={() => shortenButtonUrl(idx)}
                              >
                                {shorteningKey === `std-${idx}`
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : <><Link2 className="w-3 h-3 mr-1" /> Encurtar</>}
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              Opcional: gera um link do seu domínio (ex.: /l/ab12cd) — permite usar destinos que a Meta bloqueia, como wa.me.
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              Link dinâmico: termine a URL com <code className="text-primary">{'{{1}}'}</code> (ex.: https://seusite.com/pedido/{'{{1}}'}) e preencha o valor no envio.
                            </p>
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeButton(idx)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-4 border-t bg-amber-50/50 dark:bg-amber-900/10 p-4 rounded-xl border-amber-100 dark:border-amber-900/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-amber-600" />
                      <Label className="text-amber-900 dark:text-amber-100 font-semibold cursor-pointer" htmlFor="pix-toggle">Configurar PIX</Label>
                    </div>
                    <Switch id="pix-toggle" checked={isPix} onCheckedChange={setIsPix} />
                  </div>
                  {isPix && (
                    <div className="space-y-2 animate-in slide-in-from-top-2">
                      <Label className="text-xs text-amber-700 dark:text-amber-300">Cole sua Chave PIX ou Código Copia e Cola</Label>
                      <div className="flex gap-2">
                        <Textarea 
                          placeholder="Chave PIX ou Código..." 
                          value={pixCode} 
                          onChange={e => setPixCode(e.target.value)}
                          className="font-mono text-xs border-amber-200 dark:border-amber-800"
                        />
                      </div>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">Isso adicionará uma opção de cópia rápida no CRM.</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-2">
                <div className="space-y-2">
                  <Label>Corpo do Carrossel (Texto que aparece acima)</Label>
                  <Input placeholder="Ex: Escolha um dos nossos planos:" value={carouselBody} onChange={e => setCarouselBody(e.target.value)} />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-primary font-bold">Cartões ({cards.length}/10)</Label>
                    <Button variant="outline" size="sm" onClick={addCard} disabled={cards.length >= 10}>
                      <Plus className="w-4 h-4 mr-1" /> Novo Cartão
                    </Button>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {cards.map((card, idx) => (
                      <Button 
                        key={card.id}
                        variant={activeCardIndex === idx ? 'default' : 'outline'}
                        className="shrink-0 min-w-[80px]"
                        onClick={() => setActiveCardIndex(idx)}
                      >
                        Cartão {idx + 1}
                      </Button>
                    ))}
                  </div>

                  <Card className="border-primary/20 bg-primary/5">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                      <CardTitle className="text-sm">Editando Cartão {activeCardIndex + 1}</CardTitle>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeCard(activeCardIndex)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      <div className="space-y-2">
                        <Label>Mídia do Cartão</Label>
                        <div className="flex gap-2">
                          <Button variant={cards[activeCardIndex].headerType === 'IMAGE' ? 'default' : 'outline'} size="sm" onClick={() => updateCard(activeCardIndex, { headerType: 'IMAGE' })}><ImageIcon className="w-4 h-4 mr-1" /> Imagem</Button>
                          <Button variant={cards[activeCardIndex].headerType === 'VIDEO' ? 'default' : 'outline'} size="sm" onClick={() => updateCard(activeCardIndex, { headerType: 'VIDEO' })}><Video className="w-4 h-4 mr-1" /> Vídeo</Button>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Input placeholder="URL da mídia" value={cards[activeCardIndex].headerUrl} onChange={e => updateCard(activeCardIndex, { headerUrl: e.target.value })} className="h-8 text-xs" />
                          <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => handleFileUpload(e, activeCardIndex)} accept={cards[activeCardIndex].headerType === 'IMAGE' ? 'image/*' : 'video/*'} />
                          <Button variant="outline" size="sm" className="h-8" onClick={() => fileInputRef.current?.click()}>
                            <Upload className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Texto do Cartão (Máx 160 chars)</Label>
                        <Textarea 
                          placeholder="Descrição do item..." 
                          value={cards[activeCardIndex].bodyText} 
                          onChange={e => updateCard(activeCardIndex, { bodyText: e.target.value })}
                          maxLength={160}
                          rows={2}
                          className="text-xs"
                        />
                      </div>

                      <div className="space-y-2 border-t pt-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Botões do Cartão (Máx 2)</Label>
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => addButton('QUICK_REPLY', activeCardIndex)} disabled={cards[activeCardIndex].buttons.length >= 2}>+ Resposta</Button>
                            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => addButton('URL', activeCardIndex)} disabled={cards[activeCardIndex].buttons.length >= 2}>+ Link</Button>
                          </div>
                        </div>
                        {cards[activeCardIndex].buttons.map((btn: any, idx: number) => (
                          <div key={idx} className="flex gap-1 items-start bg-background p-2 rounded-md border text-xs">
                            <div className="flex-1 space-y-1">
                              <Input placeholder="Texto" value={btn.text} onChange={e => updateButton(idx, { text: e.target.value }, activeCardIndex)} maxLength={25} className="h-7 text-[10px]" />
                              {btn.type === 'URL' && (
                                <div className="flex gap-1">
                                  <Input placeholder="URL" value={btn.url} onChange={e => updateButton(idx, { url: e.target.value }, activeCardIndex)} className="h-7 text-[10px]" />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="h-7 text-[10px] shrink-0"
                                    disabled={shorteningKey === `${activeCardIndex}-${idx}`}
                                    onClick={() => shortenButtonUrl(idx, activeCardIndex)}
                                  >
                                    {shorteningKey === `${activeCardIndex}-${idx}`
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <><Link2 className="w-3 h-3 mr-1" /> Encurtar</>}
                                  </Button>
                                </div>
                              )}
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => removeButton(idx, activeCardIndex)} className="h-7 w-7 text-destructive"><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            <Button className="w-full mt-6" onClick={handleSubmit} disabled={isSaving || !name}>
              {isSaving ? "Enviando..." : "Enviar para Aprovação"}
              <Send className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="sticky top-24 h-fit space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground uppercase text-[10px] font-bold tracking-wider">
          <Eye className="w-3 h-3" /> Prévia do Dispositivo
        </div>
        <TemplatePreview 
          name={name}
          headerType={templateType === 'STANDARD' ? headerType : 'CAROUSEL'}
          headerText={headerText}
          headerUrl={headerUrl}
          bodyText={templateType === 'STANDARD' ? bodyText : carouselBody}
          footerText={footerText}
          buttons={templateType === 'STANDARD' ? buttons : []}
          isCarousel={templateType === 'CAROUSEL'}
          carouselCards={cards}
          isPix={isPix}
          pixCode={pixCode}
        />
        <MetaPricingCalculator
          defaultCategory={category as any}
          defaultQuantity={100}
          collapsible
        />
        <TemplateVariablesGuide />
      </div>
    </div>

      <Dialog open={utilityOpen} onOpenChange={setUtilityOpen}>
        <DialogContent className="max-w-2xl w-[95vw] p-0 gap-0">
          <DialogHeader className="p-4 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="w-4 h-4 text-orange-500" /> Conversor Utility
            </DialogTitle>
            <DialogDescription className="text-xs">
              Compare o antes e depois e escolha a versão que deseja usar.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[65vh]">
            <div className="p-4 space-y-4">
              <div className="flex gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3">
                <Info className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Esta mensagem foi ajustada da melhor forma para que a inteligência da Meta a interprete como uma
                  mensagem <strong className="text-foreground">Utility</strong>, buscando reduzir o custo por mensagem
                  nos envios em massa. Não temos garantia de que esta primeira tentativa será aprovada como Utility —
                  este conversor é um ajudante para aumentar as chances de aprovação.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Antes</Label>
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words min-h-[120px]">
                    {utilityOriginal}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-orange-500">Depois</Label>
                  <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-3 text-xs whitespace-pre-wrap break-words min-h-[120px]">
                    {utilityLoading && utilityVersions.length === 0 ? (
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Convertendo mensagem...
                      </span>
                    ) : (
                      utilityVersions[utilitySelected] || '—'
                    )}
                  </div>
                </div>
              </div>

              {utilityVersions.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {utilityVersions.map((_, i) => (
                    <Button
                      key={i}
                      size="sm"
                      variant={utilitySelected === i ? 'default' : 'outline'}
                      onClick={() => setUtilitySelected(i)}
                    >
                      Versão {i + 1}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="flex flex-col-reverse sm:flex-row gap-2 p-4 border-t">
            <Button variant="outline" className="sm:flex-1" onClick={() => setUtilityOpen(false)}>
              Fechar
            </Button>
            <Button
              variant="outline"
              className="sm:flex-1"
              onClick={handleGenerateAnotherVersion}
              disabled={utilityLoading || utilityVersions.length >= 4 || utilityVersions.length === 0}
            >
              {utilityLoading && utilityVersions.length > 0
                ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Criar outra ({utilityVersions.length}/4)
            </Button>
            <Button
              className="sm:flex-1 bg-orange-500 hover:bg-orange-600 text-white"
              onClick={handleAcceptUtilityVersion}
              disabled={utilityLoading || utilityVersions.length === 0}
            >
              <Check className="w-4 h-4 mr-1.5" /> Aceitar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default TemplateBuilder;
