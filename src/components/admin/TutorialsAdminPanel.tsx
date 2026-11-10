import { useEffect, useState, useCallback } from "react";
import { SafeImage } from "@/components/media/SafeImage";
import { MissingMediaWarning } from "@/components/crm/MissingMediaWarning";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Video as VideoIcon,
  Image as ImageIcon,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Upload,
  Eye,
  EyeOff,
  Layers,
  Zap,
} from "lucide-react";

type Module = {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  order_index: number;
  is_active: boolean;
};

type Tutorial = {
  id: string;
  module: string;
  module_id: string | null;
  title: string;
  description: string | null;
  cover_url: string | null;
  video_url: string | null;
  button1_label: string | null;
  button1_url: string | null;
  button2_label: string | null;
  button2_url: string | null;
  order_index: number;
  is_active: boolean;
  hls_url?: string | null;
  transcode_status?: string | null;
  transcode_error?: string | null;
};


/**
 * Converte os vídeos em streaming adaptativo (qualidade sobe conforme a
 * conexão). O trabalho pesado roda no servidor; aqui só enfileiramos e
 * acompanhamos o andamento.
 */
type TranscodeRow = {
  id: string; title: string; status: string; step: string | null; progress: number;
  error: string | null; started: string | null; done: string | null;
};

function TranscodeCard() {
  const [rows, setRows] = useState<TranscodeRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("sales_tutorials").select("*").not("video_url", "is", null);
    if (error) { setLoadError(error.message); return; }
    setLoadError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = ((data || []) as any[]).map((r) => ({
      id: r.id, title: r.title || "Sem título",
      status: r.transcode_status || "pending",
      step: r.transcode_step ?? null,
      progress: Number(r.transcode_progress) || 0,
      error: r.transcode_error ?? null,
      started: r.transcode_started_at ?? null,
      done: r.transcoded_at ?? null,
    })) as TranscodeRow[];
    const order: Record<string, number> = { processing: 0, error: 1, pending: 2, ready: 3 };
    list.sort((x, y) => (order[x.status] ?? 2) - (order[y.status] ?? 2));
    setRows(list);
    setLastSync(new Date());
  }, []);

  const active = rows?.some((r) => r.status === "processing" || r.status === "pending") ?? false;

  useEffect(() => {
    load();
    const t = window.setInterval(load, active ? 3000 : 10000);
    return () => window.clearInterval(t);
  }, [load, active]);

  async function transcodeAll() {
    setBusy(true);
    // Só coloca na fila o que ainda não está pronto — vídeos já convertidos continuam valendo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("sales_tutorials") as any)
      .update({ transcode_status: "pending", transcode_error: null, transcode_progress: 0, transcode_step: null })
      .not("video_url", "is", null)
      .or("transcode_status.is.null,transcode_status.in.(error,none,pending)");
    setBusy(false);
    if (error) return toast.error(`Não foi possível iniciar: ${error.message}`);
    toast.success("Conversão iniciada. Os vídeos continuam disponíveis enquanto isso.");
    load();
  }

  const total = rows?.length ?? 0;
  const ready = rows?.filter((r) => r.status === "ready").length ?? 0;
  const processing = rows?.filter((r) => r.status === "processing").length ?? 0;
  const pending = rows?.filter((r) => r.status === "pending").length ?? 0;
  const errors = rows?.filter((r) => r.status === "error").length ?? 0;
  const partial = rows?.reduce((acc, r) => acc + (r.status === "ready" ? 100 : r.status === "processing" ? r.progress : 0), 0) ?? 0;
  const pct = total ? Math.round(partial / total) : 0;

  const label = (r: TranscodeRow) =>
    r.status === "ready" ? "pronto" : r.status === "processing" ? (r.step || "convertendo") :
    r.status === "error" ? `erro: ${r.error || "desconhecido"}` : "na fila";

  return (
    <Card className="p-4 bg-gradient-to-r from-[#F0FBF7] to-white border-[#25D366]/20">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2 rounded-lg bg-[#25D366]/10">
          <Zap className="h-5 w-5 text-[#128C7E]" />
        </div>
        <div className="flex-1 min-w-[220px] space-y-2">
          <div>
            <p className="text-sm font-bold text-[#075E54]">Vídeos sem travar (qualidade adaptativa)</p>
            <p className="text-xs text-[#128C7E]/70">
              Converte todos os vídeos para começarem em qualidade baixa e melhorarem conforme a internet de
              quem assiste. Vídeos novos são convertidos sozinhos.
            </p>
          </div>
          {rows && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full bg-[#25D366] transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-[#075E54]">
                {pct}% · {ready} de {total} prontos
                {processing > 0 && ` · ${processing} convertendo agora`}
                {pending > 0 && ` · ${pending} na fila`}
                {errors > 0 && ` · ${errors} com erro`}
                {lastSync && ` · atualizado ${lastSync.toLocaleTimeString("pt-BR")}`}
              </p>
            </div>
          )}
          {loadError && <p className="text-[11px] text-red-600">Erro ao ler o andamento: {loadError}</p>}
        </div>
        <Button onClick={transcodeAll} disabled={busy} className="bg-[#25D366] hover:bg-[#128C7E] text-white">
          {busy || active ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
          Transcodificar todos
        </Button>
      </div>
      {rows && rows.length > 0 && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-[#E8F5F1] bg-white divide-y divide-[#E8F5F1]">
          {rows.map((r) => (
            <div key={r.id} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[#075E54] truncate">{r.title}</span>
                <span className={`shrink-0 ${r.status === "error" ? "text-red-600" : r.status === "ready" ? "text-[#128C7E]" : "text-slate-500"}`}>
                  {r.status === "processing" ? `${r.progress}%` : r.status === "ready" ? "✓" : ""}
                </span>
              </div>
              <p className={`break-words ${r.status === "error" ? "text-red-600" : "text-slate-500"}`}>{label(r)}</p>
              {r.status === "processing" && (
                <div className="mt-1 h-1 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#25D366] transition-all duration-700" style={{ width: `${r.progress}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

async function uploadFile(file: File, prefix: string): Promise<string | null> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `tutorials/${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("assets").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) {
    toast.error(`Upload falhou: ${error.message}`);
    return null;
  }
  const { data } = supabase.storage.from("assets").getPublicUrl(path);
  return data.publicUrl;
}

export default function TutorialsAdminPanel() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Module | null>(null);

  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [moduleForm, setModuleForm] = useState<Partial<Module>>({});
  const [savingModule, setSavingModule] = useState(false);
  const [uploadingModuleCover, setUploadingModuleCover] = useState(false);

  const loadModules = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sales_modules")
      .select("*")
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message);
    setModules((data as Module[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  function openNewModule() {
    setModuleForm({
      name: "",
      description: "",
      cover_url: "",
      order_index: modules.length,
      is_active: true,
    });
    setModuleDialogOpen(true);
  }

  function openEditModule(m: Module) {
    setModuleForm({ ...m });
    setModuleDialogOpen(true);
  }

  async function onModuleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Capa até 10MB");
      return;
    }
    setUploadingModuleCover(true);
    const url = await uploadFile(file, "module_cover");
    if (url) setModuleForm((p) => ({ ...p, cover_url: url }));
    setUploadingModuleCover(false);
  }

  async function saveModule() {
    if (!moduleForm.name?.trim()) return toast.error("Nome obrigatório");
    setSavingModule(true);
    const payload = {
      name: moduleForm.name,
      description: moduleForm.description || null,
      cover_url: moduleForm.cover_url || null,
      order_index: Number(moduleForm.order_index) || 0,
      is_active: moduleForm.is_active !== false,
    };
    const { error } = moduleForm.id
      ? await supabase.from("sales_modules").update(payload).eq("id", moduleForm.id)
      : await supabase.from("sales_modules").insert(payload);
    setSavingModule(false);
    if (error) return toast.error(error.message);
    toast.success("Salvo");
    setModuleDialogOpen(false);
    loadModules();
  }

  async function deleteModule(m: Module) {
    if (!confirm(`Excluir o módulo "${m.name}"? Os vídeos ficarão sem módulo.`)) return;
    const { error } = await supabase.from("sales_modules").delete().eq("id", m.id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    loadModules();
  }

  async function moveModule(m: Module, dir: -1 | 1) {
    const sorted = [...modules].sort((a, b) => a.order_index - b.order_index);
    const idx = sorted.findIndex((x) => x.id === m.id);
    const target = sorted[idx + dir];
    if (!target) return;
    await Promise.all([
      supabase.from("sales_modules").update({ order_index: target.order_index }).eq("id", m.id),
      supabase.from("sales_modules").update({ order_index: m.order_index }).eq("id", target.id),
    ]);
    loadModules();
  }

  async function toggleModuleActive(m: Module) {
    await supabase.from("sales_modules").update({ is_active: !m.is_active }).eq("id", m.id);
    loadModules();
  }

  if (selected) {
    return (
      <ModuleDetail
        module={selected}
        onBack={() => {
          setSelected(null);
          loadModules();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#075E54] flex items-center gap-2">
            <Layers className="h-5 w-5" /> Central de Tutoriais
          </h2>
          <p className="text-xs text-[#128C7E]/70 mt-1">
            Organize por <strong>módulos</strong>. Cada módulo agrupa vídeos com capa vertical
            (1080×1350). Capa do módulo é opcional (1920×1080).
          </p>
        </div>
        <Button onClick={openNewModule} className="bg-[#25D366] hover:bg-[#128C7E] text-white">
          <Plus className="h-4 w-4 mr-1" /> Novo módulo
        </Button>
      </div>

      <TranscodeCard />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[#128C7E]/60" />
        </div>
      ) : modules.length === 0 ? (
        <Card className="p-10 text-center bg-white border-[#E8F5F1]">
          <Layers className="h-10 w-10 mx-auto text-[#128C7E]/40 mb-3" />
          <p className="text-[#128C7E]/70 mb-4">
            Nenhum módulo ainda. Comece criando o primeiro.
          </p>
          <Button onClick={openNewModule} className="bg-[#25D366] hover:bg-[#128C7E] text-white">
            <Plus className="h-4 w-4 mr-1" /> Criar módulo
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, idx) => (
            <Card
              key={m.id}
              className="overflow-hidden bg-white border-[#E8F5F1] shadow-sm group"
            >
              <div
                className="aspect-video bg-gradient-to-br from-[#075E54] to-[#128C7E] relative cursor-pointer"
                onClick={() => setSelected(m)}
              >
                {m.cover_url ? (
                  <img
                    src={m.cover_url}
                    alt={m.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white/70">
                    <FolderOpen className="h-12 w-12" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                  <Badge className="opacity-0 group-hover:opacity-100 bg-white text-[#075E54] transition">
                    Abrir módulo
                  </Badge>
                </div>
                {!m.is_active && (
                  <Badge className="absolute top-2 right-2 bg-slate-600 text-white border-0">
                    Inativo
                  </Badge>
                )}
              </div>
              <div className="p-3 space-y-2">
                <div>
                  <div className="font-semibold text-[#075E54] truncate">{m.name}</div>
                  {m.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">
                      {m.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <Button size="sm" variant="outline" onClick={() => setSelected(m)} className="h-8 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <VideoIcon className="h-3 w-3 mr-1" /> Vídeos
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEditModule(m)} className="h-8 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleModuleActive(m)} className="h-8 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    {m.is_active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moveModule(m, -1)} disabled={idx === 0} className="h-8 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => moveModule(m, 1)} disabled={idx === modules.length - 1} className="h-8 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteModule(m)} className="h-8">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <DialogContent className="max-w-lg bg-white text-[#075E54]">
          <DialogHeader>
            <DialogTitle>{moduleForm.id ? "Editar módulo" : "Novo módulo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                value={moduleForm.name || ""}
                onChange={(e) => setModuleForm({ ...moduleForm, name: e.target.value })}
                placeholder="Ex: Primeiros Passos"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                value={moduleForm.description || ""}
                onChange={(e) => setModuleForm({ ...moduleForm, description: e.target.value })}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Capa do módulo (1920×1080, opcional, até 10MB)</Label>
              <Input type="file" accept="image/*" onChange={onModuleCoverChange} disabled={uploadingModuleCover} />
              {uploadingModuleCover && <p className="text-xs text-slate-500">Enviando...</p>}
              {moduleForm.cover_url && (
                <img src={moduleForm.cover_url} className="mt-1 aspect-video w-full object-cover rounded" />
              )}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={moduleForm.is_active !== false}
                onChange={(e) => setModuleForm({ ...moduleForm, is_active: e.target.checked })}
              />
              Ativo (exibir na página /vendas)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModuleDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={saveModule}
              disabled={savingModule || uploadingModuleCover}
              className="bg-[#25D366] hover:bg-[#128C7E] text-white"
            >
              {savingModule ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================
// ModuleDetail — Gestão dos vídeos de um módulo
// ============================================================

const emptyTutorial: Partial<Tutorial> = {
  title: "",
  description: "",
  cover_url: "",
  video_url: "",
  button1_label: "",
  button1_url: "",
  button2_label: "",
  button2_url: "",
  order_index: 0,
  is_active: true,
};

function ModuleDetail({ module, onBack }: { module: Module; onBack: () => void }) {
  const [videos, setVideos] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Tutorial>>(emptyTutorial);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);

  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("sales_tutorials")
      .select("*")
      .eq("module_id", module.id)
      .order("order_index", { ascending: true });
    if (error) toast.error(error.message);
    setVideos((data as Tutorial[]) || []);
    setLoading(false);
  }, [module.id]);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setEditing({ ...emptyTutorial, order_index: videos.length });
    setDialogOpen(true);
  }

  function openEdit(v: Tutorial) {
    setEditing({ ...v });
    setDialogOpen(true);
  }

  async function onCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("Capa até 10MB");
    setUploadingCover(true);
    const url = await uploadFile(file, "cover");
    if (url) setEditing((p) => ({ ...p, cover_url: url }));
    setUploadingCover(false);
  }

  async function onVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) return toast.error("Vídeo até 500MB");
    setUploadingVideo(true);
    setVideoProgress(0);
    const timer = setInterval(() => setVideoProgress((p) => Math.min(p + 4, 92)), 500);
    const url = await uploadFile(file, "video");
    clearInterval(timer);
    setVideoProgress(100);
    if (url) setEditing((p) => ({ ...p, video_url: url }));
    setUploadingVideo(false);
  }

  async function save() {
    if (!editing.title?.trim()) return toast.error("Título obrigatório");
    setSaving(true);
    const payload = {
      module: module.name, // legacy compat
      module_id: module.id,
      title: editing.title,
      description: editing.description || null,
      cover_url: editing.cover_url || null,
      video_url: editing.video_url || null,
      button1_label: editing.button1_label || null,
      button1_url: editing.button1_url || null,
      button2_label: editing.button2_label || null,
      button2_url: editing.button2_url || null,
      order_index: Number(editing.order_index) || 0,
      is_active: editing.is_active !== false,
    };
    const { error } = editing.id
      ? await supabase.from("sales_tutorials").update(payload).eq("id", editing.id)
      : await supabase.from("sales_tutorials").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Salvo");
    setDialogOpen(false);
    load();
  }

  async function remove(v: Tutorial) {
    if (!confirm(`Excluir "${v.title}"?`)) return;
    await supabase.from("sales_tutorials").delete().eq("id", v.id);
    load();
  }

  async function toggleActive(v: Tutorial) {
    await supabase.from("sales_tutorials").update({ is_active: !v.is_active }).eq("id", v.id);
    load();
  }

  async function move(v: Tutorial, dir: -1 | 1) {
    const sorted = [...videos].sort((a, b) => a.order_index - b.order_index);
    const idx = sorted.findIndex((x) => x.id === v.id);
    const target = sorted[idx + dir];
    if (!target) return;
    await Promise.all([
      supabase.from("sales_tutorials").update({ order_index: target.order_index }).eq("id", v.id),
      supabase.from("sales_tutorials").update({ order_index: v.order_index }).eq("id", target.id),
    ]);
    load();
  }

  async function runBulkUpload() {
    if (bulkFiles.length === 0) return;
    setBulkUploading(true);
    let baseOrder = videos.length;
    let ok = 0;
    for (let i = 0; i < bulkFiles.length; i++) {
      const f = bulkFiles[i];
      setBulkStatus(`Enviando ${i + 1}/${bulkFiles.length}: ${f.name}`);
      const url = await uploadFile(f, "video");
      if (!url) continue;
      const title = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      const { error } = await supabase.from("sales_tutorials").insert({
        module: module.name,
        module_id: module.id,
        title: `${baseOrder + i + 1}. ${title}`,
        video_url: url,
        order_index: baseOrder + i,
        is_active: true,
      });
      if (!error) ok++;
    }
    setBulkStatus("");
    setBulkFiles([]);
    setBulkUploading(false);
    toast.success(`${ok}/${bulkFiles.length} vídeos adicionados`);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Módulos
          </Button>
          <div>
            <h2 className="text-lg font-bold text-[#075E54]">{module.name}</h2>
            <p className="text-xs text-[#128C7E]/70">
              {videos.length} vídeo{videos.length !== 1 ? "s" : ""} · capas verticais 1080×1350
            </p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-[#25D366] hover:bg-[#128C7E] text-white">
          <Plus className="h-4 w-4 mr-1" /> Novo vídeo
        </Button>
      </div>

      {/* Bulk upload */}
      <Card className="p-4 bg-gradient-to-r from-[#F0FBF7] to-white border-[#25D366]/20">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="p-2 rounded-lg bg-[#25D366]/10">
            <Upload className="h-5 w-5 text-[#128C7E]" />
          </div>
          <div className="flex-1 min-w-[200px] space-y-2">
            <div>
              <p className="text-sm font-bold text-[#075E54]">Upload em massa</p>
              <p className="text-xs text-[#128C7E]/70">
                Selecione vários vídeos de uma vez. Numeração automática por nome do arquivo.
                Reordene depois nos botões ↑↓.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="file"
                accept="video/*"
                multiple
                onChange={(e) => setBulkFiles(Array.from(e.target.files || []))}
                disabled={bulkUploading}
                className="max-w-md"
              />
              <Button
                onClick={runBulkUpload}
                disabled={bulkUploading || bulkFiles.length === 0}
                className="bg-[#25D366] hover:bg-[#128C7E] text-white"
              >
                {bulkUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Upload className="h-4 w-4 mr-1" />
                )}
                Enviar {bulkFiles.length || ""}
              </Button>
            </div>
            {bulkStatus && <p className="text-xs text-[#128C7E]">{bulkStatus}</p>}
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#128C7E]/60" />
        </div>
      ) : videos.length === 0 ? (
        <Card className="p-8 text-center text-[#128C7E]/70 bg-white border-[#E8F5F1]">
          Nenhum vídeo neste módulo.
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {videos.map((v, idx) => (
            <Card key={v.id} className="overflow-hidden bg-white border-[#E8F5F1] shadow-sm">
              <div className="relative bg-slate-100" style={{ aspectRatio: "4/5" }}>
                {v.cover_url ? (
                  <SafeImage src={v.cover_url} alt={v.title} className="w-full h-full object-cover" fallback={<div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-destructive/10 text-destructive text-[10px] font-semibold text-center px-2"><ImageIcon className="h-8 w-8" />Capa perdida — envie de novo</div>} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-300 bg-gradient-to-br from-slate-100 to-slate-200">
                    <ImageIcon className="h-10 w-10" />
                  </div>
                )}
                <Badge className="absolute top-2 left-2 bg-black/70 text-white border-0 text-[10px]">
                  #{idx + 1}
                </Badge>
                {v.video_url && (
                  <Badge className="absolute top-2 right-2 bg-[#25D366] text-white border-0 gap-1 text-[10px]">
                    <VideoIcon className="h-2.5 w-2.5" />
                    {v.transcode_status === "ready" ? "HD auto" : v.transcode_status === "error" ? "erro" : v.transcode_status === "processing" ? "convertendo" : "na fila"}
                  </Badge>
                )}
                {!v.is_active && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Badge className="bg-slate-600 text-white border-0">Inativo</Badge>
                  </div>
                )}
              </div>
              <div className="p-2 space-y-1.5">
                <div className="font-semibold text-xs text-[#075E54] line-clamp-2 min-h-[2rem]">
                  {v.title}
                </div>
                <div className="flex flex-wrap gap-0.5">
                  <Button size="sm" variant="outline" onClick={() => openEdit(v)} className="h-7 px-1.5 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(v)} className="h-7 px-1.5 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    {v.is_active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => move(v, -1)} disabled={idx === 0} className="h-7 px-1.5 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => move(v, 1)} disabled={idx === videos.length - 1} className="h-7 px-1.5 border-[#075E54] text-[#075E54] hover:bg-[#075E54] hover:text-white">
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(v)} className="h-7 px-1.5">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white text-[#075E54]">
          <DialogHeader>
            <DialogTitle>{editing.id ? "Editar vídeo" : "Novo vídeo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Título *</Label>
                <Input
                  value={editing.title || ""}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ordem</Label>
                <Input
                  type="number"
                  value={editing.order_index ?? 0}
                  onChange={(e) => setEditing({ ...editing, order_index: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea
                value={editing.description || ""}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Capa vertical 1080×1350 (até 10MB)</Label>
                <Input type="file" accept="image/*" onChange={onCoverChange} disabled={uploadingCover} />
                {uploadingCover && <p className="text-xs text-slate-500">Enviando capa...</p>}
                {editing.cover_url && (
                  <img
                    src={editing.cover_url}
                    className="mt-1 w-full object-cover rounded"
                    style={{ aspectRatio: "4/5" }}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Vídeo (até 500MB)</Label>
                <Input type="file" accept="video/*" onChange={onVideoChange} disabled={uploadingVideo} />
                {uploadingVideo && (
                  <div className="space-y-1">
                    <div className="h-2 bg-slate-100 rounded overflow-hidden">
                      <div
                        className="h-full bg-[#25D366] transition-all"
                        style={{ width: `${videoProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500">{videoProgress}%</p>
                  </div>
                )}
                {editing.video_url && !uploadingVideo && (
                  <video src={editing.video_url} className="mt-1 w-full rounded" style={{ aspectRatio: "4/5", objectFit: "cover" }} />
                )}
              </div>
            </div>

            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-bold text-[#128C7E] uppercase">Botões (opcional)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Botão 1 - Texto</Label>
                  <Input
                    value={editing.button1_label || ""}
                    onChange={(e) => setEditing({ ...editing, button1_label: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Botão 1 - URL</Label>
                  <Input
                    value={editing.button1_url || ""}
                    onChange={(e) => setEditing({ ...editing, button1_url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Botão 2 - Texto</Label>
                  <Input
                    value={editing.button2_label || ""}
                    onChange={(e) => setEditing({ ...editing, button2_label: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Botão 2 - URL</Label>
                  <Input
                    value={editing.button2_url || ""}
                    onChange={(e) => setEditing({ ...editing, button2_url: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={editing.is_active !== false}
                onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
              />
              Ativo
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={save}
              disabled={saving || uploadingCover || uploadingVideo}
              className="bg-[#25D366] hover:bg-[#128C7E] text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}