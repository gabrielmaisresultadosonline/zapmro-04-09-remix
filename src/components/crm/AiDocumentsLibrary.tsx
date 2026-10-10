import { useCallback, useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Mic, Video, Trash2, Upload, RefreshCcw, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getActiveWhatsAppNumberId } from '@/lib/activeNumberContext';
import { uploadDedupedMedia } from '@/lib/mediaStorage';

type MediaKind = 'document' | 'image' | 'audio' | 'video';

interface AiDocument {
  id: string;
  code: string;
  title: string;
  description: string | null;
  media_type: MediaKind;
  media_url: string;
  file_name: string | null;
  is_active: boolean;
}

const KIND_ICON: Record<MediaKind, typeof FileText> = { document: FileText, image: ImageIcon, audio: Mic, video: Video };
const KIND_LABEL: Record<MediaKind, string> = { document: 'Documento', image: 'Imagem', audio: 'Áudio', video: 'Vídeo' };
const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

const kindFromFile = (file: File): MediaKind => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  return 'document';
};

/** Biblioteca de arquivos que o Agente I.A. envia sozinho quando o código é pedido. Separada por WhatsApp. */
export function AiDocumentsLibrary() {
  const { toast } = useToast();
  const numberId = getActiveWhatsAppNumberId();
  const [docs, setDocs] = useState<AiDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    let query = (supabase as any).from('crm_ai_documents').select('id, code, title, description, media_type, media_url, file_name, is_active');
    query = numberId ? query.eq('whatsapp_number_id', numberId) : query.is('whatsapp_number_id', null);
    const { data, error } = await query.order('created_at', { ascending: true });
    setLoading(false);
    if (error) { toast({ title: 'Não foi possível carregar os arquivos', description: error.message, variant: 'destructive' }); return; }
    setDocs((data || []) as AiDocument[]);
  }, [numberId, toast]);

  useEffect(() => { void load(); }, [load]);

  const suggestCode = () => {
    let n = docs.length + 1;
    while (docs.some((d) => d.code.toLowerCase() === `document${n}`)) n++;
    return `Document${n}`;
  };

  const handleAdd = async () => {
    const finalCode = (code.trim() || suggestCode());
    if (!CODE_RE.test(finalCode)) { toast({ title: 'Código inválido', description: 'Use só letras, números, - ou _ (ex.: Document1).', variant: 'destructive' }); return; }
    if (docs.some((d) => d.code.toLowerCase() === finalCode.toLowerCase())) { toast({ title: 'Esse código já existe', variant: 'destructive' }); return; }
    if (!title.trim()) { toast({ title: 'Dê um nome ao arquivo', variant: 'destructive' }); return; }
    if (!file) { toast({ title: 'Escolha o arquivo', variant: 'destructive' }); return; }
    setSaving(true); setProgress(0);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error('Sua sessão expirou. Entre novamente.');
      const ext = file.name.includes('.') ? file.name.split('.').pop() : undefined;
      const uploaded = await uploadDedupedMedia({
        bucket: 'crm-media', folder: `${userId}/ai-docs`, file, contentType: file.type || undefined, extension: ext, onProgress: setProgress,
      });
      const { error } = await (supabase as any).from('crm_ai_documents').insert({
        user_id: userId, whatsapp_number_id: numberId || null, code: finalCode, title: title.trim(),
        description: description.trim() || null, media_type: kindFromFile(file), media_url: uploaded.url,
        file_name: file.name, mime_type: file.type || null,
      });
      if (error) throw error;
      toast({ title: `Arquivo ${finalCode} adicionado` });
      setCode(''); setTitle(''); setDescription(''); setFile(null);
      await load();
    } catch (e) {
      toast({ title: 'Erro ao adicionar', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const toggle = async (doc: AiDocument) => {
    const { error } = await (supabase as any).from('crm_ai_documents').update({ is_active: !doc.is_active, updated_at: new Date().toISOString() }).eq('id', doc.id);
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' }); else void load();
  };

  const remove = async (doc: AiDocument) => {
    if (!window.confirm(`Remover ${doc.code} (${doc.title}) da biblioteca do Agente?`)) return;
    const { error } = await (supabase as any).from('crm_ai_documents').delete().eq('id', doc.id);
    if (error) toast({ title: 'Erro', description: error.message, variant: 'destructive' }); else void load();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label className="text-sm font-bold">Arquivos do Agente (PDF, imagem, áudio, vídeo)</Label>
          <p className="text-[11px] text-muted-foreground mt-1">
            Cada arquivo tem um código. No prompt escreva, por exemplo: <em>"se pedirem a tabela de preços, envie (Document1)"</em>.
            O Agente envia sozinho quando pedirem ou quando entender que deve. Vale só para este WhatsApp.
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => void load()} aria-label="Atualizar lista">
          <RefreshCcw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
        </Button>
      </div>

      <ul className="space-y-2">
        {docs.map((d) => {
          const Icon = KIND_ICON[d.media_type] || FileText;
          return (
            <li key={d.id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-2">
              <Icon className="w-4 h-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="text-xs font-bold">{d.code}</code>
                  <span className="text-[10px] text-muted-foreground">{KIND_LABEL[d.media_type]}</span>
                </div>
                <a href={d.media_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs hover:underline">{d.title}</a>
                {d.description && <p className="truncate text-[10px] text-muted-foreground">{d.description}</p>}
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Copiar código"
                onClick={() => { void navigator.clipboard?.writeText(`(${d.code})`); toast({ title: `(${d.code}) copiado` }); }}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Switch checked={d.is_active} onCheckedChange={() => void toggle(d)} aria-label="Ativo" />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => void remove(d)} aria-label="Remover">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </li>
          );
        })}
        {docs.length === 0 && !loading && <li className="text-xs text-muted-foreground">Nenhum arquivo ainda.</li>}
      </ul>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border/60 pt-3">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={`Código (ex.: ${suggestCode()})`} className="text-xs" />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nome (ex.: Tabela de preços)" className="text-xs" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Quando enviar (opcional)" className="text-xs sm:col-span-2" />
        <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*,audio/*,video/*"
          onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-xs sm:col-span-2" />
      </div>
      <Button type="button" size="sm" onClick={() => void handleAdd()} disabled={saving} className="w-full gap-2">
        {saving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {saving ? `Enviando ${progress}%` : 'Adicionar arquivo'}
      </Button>
    </div>
  );
}
