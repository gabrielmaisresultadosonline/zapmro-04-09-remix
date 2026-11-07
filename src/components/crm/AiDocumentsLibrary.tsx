import { useCallback, useEffect, useState } from 'react';
import { FileText, Image as ImageIcon, Mic, Video, Trash2, Upload, RefreshCcw, Copy, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getActiveWhatsAppNumberId } from '@/lib/activeNumberContext';
import { uploadDedupedMedia, deleteMediaUrlsIfUnused } from '@/lib/mediaStorage';
import { MissingMediaWarning, clearMediaAvailabilityCache } from '@/components/crm/MissingMediaWarning';

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
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (file.type.startsWith('audio/') || ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'amr', 'wav'].includes(ext)) return 'audio';
  if (file.type.startsWith('video/') || ['mp4', '3gp', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  return 'document';
};

/** Formatos que o WhatsApp aceita; retorna aviso quando não aceita. */
export const unsupportedMediaReason = (file: File): string | null => {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const kind = kindFromFile(file);
  if (kind === 'video' && !['mp4', '3gp'].includes(ext)) return 'O WhatsApp só aceita vídeo MP4 ou 3GP. Converta o vídeo para MP4 e envie de novo.';
  if (kind === 'audio' && ['wav'].includes(ext)) return 'O WhatsApp não aceita áudio WAV. Use MP3, M4A, OGG ou AAC.';
  if (kind === 'image' && ext === 'webp') return 'O WhatsApp só aceita imagem JPG ou PNG.';
  if (kind === 'video' && file.size > 16 * 1024 * 1024) return 'O WhatsApp aceita vídeos de até 16 MB.';
  if (kind === 'audio' && file.size > 16 * 1024 * 1024) return 'O WhatsApp aceita áudios de até 16 MB.';
  if (kind === 'image' && file.size > 5 * 1024 * 1024) return 'O WhatsApp aceita imagens de até 5 MB.';
  return null;
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
    { const bad = unsupportedMediaReason(file); if (bad) { toast({ title: 'Formato não aceito pelo WhatsApp', description: bad, variant: 'destructive' }); return; } }
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
      clearMediaAvailabilityCache(uploaded.url);
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

  // ---- Editar / substituir arquivo sem recriar o item ----
  const [editing, setEditing] = useState<AiDocument | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editProgress, setEditProgress] = useState(0);

  const openEdit = (doc: AiDocument) => {
    setEditing(doc);
    setEditCode(doc.code);
    setEditTitle(doc.title);
    setEditDescription(doc.description || '');
    setEditFile(null);
    setEditProgress(0);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    const finalCode = editCode.trim();
    if (!CODE_RE.test(finalCode)) { toast({ title: 'Código inválido', description: 'Use só letras, números, - ou _ (ex.: Document1).', variant: 'destructive' }); return; }
    if (docs.some((d) => d.id !== editing.id && d.code.toLowerCase() === finalCode.toLowerCase())) { toast({ title: 'Esse código já existe', variant: 'destructive' }); return; }
    if (!editTitle.trim()) { toast({ title: 'Dê um nome ao arquivo', variant: 'destructive' }); return; }
    setEditSaving(true); setEditProgress(0);
    try {
      const patch: Record<string, unknown> = {
        code: finalCode,
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        updated_at: new Date().toISOString(),
      };
      let newUrl: string | null = null;
      if (editFile && unsupportedMediaReason(editFile)) {
        toast({ title: 'Formato não aceito pelo WhatsApp', description: unsupportedMediaReason(editFile)!, variant: 'destructive' });
        return;
      }
      if (editFile) {
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (!userId) throw new Error('Sua sessão expirou. Entre novamente.');
        const ext = editFile.name.includes('.') ? editFile.name.split('.').pop() : undefined;
        // uploadDedupedMedia só devolve sucesso depois de conferir que o arquivo abre.
        const uploaded = await uploadDedupedMedia({
          bucket: 'crm-media', folder: `${userId}/ai-docs`, file: editFile, contentType: editFile.type || undefined, extension: ext, onProgress: setEditProgress,
        });
        newUrl = uploaded.url;
        Object.assign(patch, {
          media_url: uploaded.url,
          media_type: kindFromFile(editFile),
          file_name: editFile.name,
          mime_type: editFile.type || null,
        });
      }
      const { error } = await (supabase as any).from('crm_ai_documents').update(patch).eq('id', editing.id);
      if (error) throw error;
      if (newUrl) {
        clearMediaAvailabilityCache(newUrl);
        clearMediaAvailabilityCache(editing.media_url);
        // O arquivo antigo vai para a lixeira de 7 dias, só se nada mais o usar.
        if (editing.media_url && editing.media_url !== newUrl) {
          void deleteMediaUrlsIfUnused([editing.media_url], { reason: 'ai_document_replaced' }).catch(() => null);
        }
      }
      toast({ title: editFile ? `Arquivo de ${finalCode} substituído` : `${finalCode} atualizado` });
      setEditing(null);
      await load();
    } catch (e) {
      toast({ title: 'Erro ao salvar', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setEditSaving(false); }
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
        <Button type="button" variant="ghost" size="icon" onClick={() => { clearMediaAvailabilityCache(); void load(); }} aria-label="Atualizar lista">
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
                <MissingMediaWarning url={d.media_url} />
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Copiar código"
                onClick={() => { void navigator.clipboard?.writeText(`(${d.code})`); toast({ title: `(${d.code}) copiado` }); }}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Editar / substituir arquivo"
                onClick={() => openEdit(d)} aria-label={`Editar ${d.code}`}>
                <Pencil className="w-3.5 h-3.5" />
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

      <Dialog open={!!editing} onOpenChange={(open) => { if (!open && !editSaving) setEditing(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar arquivo {editing?.code}</DialogTitle>
            <DialogDescription>
              Mude o nome, o código ou quando enviar. Para trocar o arquivo, escolha um novo — o Agente passa a enviar o novo no lugar do antigo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Código</Label>
              <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="text-xs" />
              {editing && editCode.trim() !== editing.code && (
                <p className="text-[10px] text-muted-foreground">Lembre de trocar ({editing.code}) por ({editCode.trim() || '...'}) no prompt.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quando enviar (opcional)</Label>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="text-xs" />
            </div>
            <div className="space-y-1 rounded-lg border border-border/60 p-2">
              <Label className="text-xs">Arquivo atual</Label>
              {editing && (
                <a href={editing.media_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-primary hover:underline">
                  {editing.file_name || editing.title}
                </a>
              )}
              {editing && <MissingMediaWarning url={editing.media_url} />}
              <Label className="text-xs pt-2 block">Substituir por outro arquivo (opcional)</Label>
              <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*,audio/*,video/*"
                onChange={(e) => setEditFile(e.target.files?.[0] || null)} className="text-xs" />
              {editFile && <p className="text-[10px] text-muted-foreground truncate">Novo: {editFile.name}</p>}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={editSaving}>Cancelar</Button>
            <Button type="button" onClick={() => void handleSaveEdit()} disabled={editSaving} className="gap-2">
              {editSaving ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {editSaving ? (editFile ? `Enviando ${editProgress}%` : 'Salvando...') : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
