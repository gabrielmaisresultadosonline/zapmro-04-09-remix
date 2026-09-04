import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Play, ExternalLink, BookOpen, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { prefetchVideo, videoPrefetchHandlers } from "@/lib/videoPrefetch";

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
};

type SalesTutorialsProps = {
  variant?: "light" | "dark";
};

export default function SalesTutorials({ variant = "light" }: SalesTutorialsProps) {
  const [modules, setModules] = useState<Module[]>([]);
  const [videos, setVideos] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Tutorial | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const [m, t] = await Promise.all([
        supabase
          .from("sales_modules")
          .select("*")
          .eq("is_active", true)
          .order("order_index", { ascending: true }),
        supabase
          .from("sales_tutorials")
          .select("*")
          .eq("is_active", true)
          .order("order_index", { ascending: true }),
      ]);
      setModules((m.data as Module[]) || []);
      setVideos((t.data as Tutorial[]) || []);
      setLoading(false);
    })();
  }, []);

  const isDark = variant === "dark";

  // Group videos: by module_id (preferred) with fallback to legacy `module` text
  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; module: Module | null; videos: Tutorial[] }>();

    modules.forEach((m) => {
      map.set(m.id, { key: m.id, module: m, videos: [] });
    });

    videos.forEach((v) => {
      if (v.module_id && map.has(v.module_id)) {
        map.get(v.module_id)!.videos.push(v);
      } else {
        const legacyKey = `legacy:${v.module || "Geral"}`;
        if (!map.has(legacyKey)) {
          map.set(legacyKey, {
            key: legacyKey,
            module: {
              id: legacyKey,
              name: v.module || "Geral",
              description: null,
              cover_url: null,
              order_index: 999,
              is_active: true,
            },
            videos: [],
          });
        }
        map.get(legacyKey)!.videos.push(v);
      }
    });

    return Array.from(map.values()).filter((g) => g.videos.length > 0);
  }, [modules, videos]);

  return (
    <section
      className={cn(
        "py-8 md:py-14 h-full overflow-y-auto",
        isDark ? "bg-[#0c1317] text-white" : "bg-gradient-to-b from-white via-green-50/40 to-white"
      )}
    >
      <div className="container mx-auto px-4">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10 md:mb-14">
          <div
            className={cn(
              "inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold mb-4",
              isDark ? "bg-[#00a884]/15 text-[#00a884]" : "bg-green-100 text-green-700"
            )}
          >
            <BookOpen className="w-4 h-4" /> Central de Tutoriais
          </div>
          <h2 className={cn("text-3xl md:text-5xl font-bold mb-3 tracking-tight", isDark ? "text-white" : "text-slate-900")}>
            Aprenda no seu ritmo
          </h2>
          <p className={cn("text-base md:text-lg", isDark ? "text-white/60" : "text-slate-600")}>
            Vídeos curtos e diretos, organizados por módulo.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className={cn("h-8 w-8 animate-spin", isDark ? "text-white/40" : "text-slate-400")} />
          </div>
        ) : grouped.length === 0 ? (
          <Card
            className={cn(
              "p-10 text-center max-w-xl mx-auto",
              isDark ? "bg-[#111b21] text-white/60 border-white/5" : "text-slate-500"
            )}
          >
            Nenhum tutorial disponível ainda.
          </Card>
        ) : (
          <div className="space-y-12 md:space-y-16 max-w-7xl mx-auto">
            {grouped.map((g) => (
              <ModuleSection
                key={g.key}
                module={g.module}
                videos={g.videos}
                isDark={isDark}
                onPlay={(v) => {
                  // Garante que o início do arquivo já esteja a caminho antes do modal montar.
                  prefetchVideo(resolveMediaUrl(v.video_url));
                  setVideoLoading(true);
                  setActive(v);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Video Player Modal */}
      <Dialog
        open={!!active}
        onOpenChange={(o) => {
          if (!o) {
            setActive(null);
            setVideoLoading(false);
          }
        }}
      >
        <DialogContent
          className={cn(
            "max-w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 overflow-hidden border-0",
            isDark ? "bg-[#0b141a] text-white" : "bg-slate-950 text-white"
          )}
        >
          {active && (
            <div className="flex flex-col">
              <button
                onClick={() => setActive(null)}
                className="absolute top-2 right-2 z-10 h-9 w-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur transition"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="relative bg-black w-full flex items-center justify-center" style={{ maxHeight: "75vh" }}>
                {active.video_url ? (
                  <SmoothVideo
                    key={active.id}
                    src={resolveMediaUrl(active.video_url)}
                    poster={resolveMediaUrl(active.cover_url) || undefined}
                    controls
                    autoPlay
                    controlsList="nodownload"
                    containerClassName="flex items-center justify-center"
                    className="w-full h-auto max-h-[75vh] object-contain bg-black"
                    onPlaying={() => setVideoLoading(false)}
                  />
                ) : (
                  <div className="w-full aspect-video flex items-center justify-center text-white/60">
                    Vídeo não disponível
                  </div>
                )}
              </div>
              <div className="p-4 md:p-6 space-y-3 bg-[#0b141a]">
                <DialogTitle className="text-lg md:text-2xl font-bold text-white leading-tight">
                  {active.title}
                </DialogTitle>
                {active.description && (
                  <p className="text-sm md:text-base text-white/70 whitespace-pre-wrap">
                    {active.description}
                  </p>
                )}
                {(active.button1_url || active.button2_url) && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {active.button1_url && (
                      <Button asChild className="bg-[#25D366] hover:bg-[#128C7E] text-white">
                        <a href={active.button1_url} target="_blank" rel="noopener noreferrer">
                          {active.button1_label || "Abrir link"}
                          <ExternalLink className="w-4 h-4 ml-1.5" />
                        </a>
                      </Button>
                    )}
                    {active.button2_url && (
                      <Button
                        asChild
                        variant="outline"
                        className="bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
                      >
                        <a href={active.button2_url} target="_blank" rel="noopener noreferrer">
                          {active.button2_label || "Abrir link"}
                          <ExternalLink className="w-4 h-4 ml-1.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ModuleSection({
  module,
  videos,
  isDark,
  onPlay,
}: {
  module: Module | null;
  videos: Tutorial[];
  isDark: boolean;
  onPlay: (v: Tutorial) => void;
}) {
  return (
    <div>
      {/* Module banner */}
      {module?.cover_url ? (
        <div className="relative rounded-2xl overflow-hidden mb-5 aspect-[16/9] sm:aspect-[21/9] shadow-lg">
          <img src={resolveMediaUrl(module.cover_url)} alt={module.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
          <div className="absolute inset-x-0 bottom-0 p-5 md:p-8">
            <h3 className="text-white text-2xl md:text-4xl font-bold drop-shadow-lg">{module.name}</h3>
            {module.description && (
              <p className="text-white/80 text-sm md:text-base mt-1 max-w-2xl">{module.description}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-5 flex items-baseline gap-3">
          <span className={cn("w-1.5 h-6 md:h-8 rounded-full", isDark ? "bg-[#00a884]" : "bg-green-600")} />
          <div>
            <h3
              className={cn(
                "text-xl md:text-3xl font-bold",
                isDark ? "text-white" : "text-slate-900"
              )}
            >
              {module?.name}
            </h3>
            {module?.description && (
              <p className={cn("text-sm mt-0.5", isDark ? "text-white/60" : "text-slate-500")}>
                {module.description}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Vertical cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-5">
        {videos.map((v, i) => (
          <button
            key={v.id}
            onClick={() => onPlay(v)}
            {...videoPrefetchHandlers(resolveMediaUrl(v.video_url))}
            className={cn(
              "group relative rounded-xl overflow-hidden text-left transition-all hover:-translate-y-1 hover:shadow-2xl",
              isDark ? "bg-[#111b21] ring-1 ring-white/5" : "bg-white shadow-md ring-1 ring-slate-100"
            )}
          >
            <div className="relative bg-slate-900" style={{ aspectRatio: "4/5" }}>
              {v.cover_url ? (
                <img
                  src={resolveMediaUrl(v.cover_url)}
                  alt={v.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#075E54] via-[#128C7E] to-[#25D366] flex items-center justify-center">
                  <span className="text-white/40 text-4xl font-bold">{i + 1}</span>
                </div>
              )}

              {/* dark bottom fade for text */}
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/90 to-transparent" />

              {/* Number badge */}
              <div className="absolute top-2 left-2 h-7 w-7 rounded-full bg-black/60 backdrop-blur text-white text-xs font-bold flex items-center justify-center">
                {i + 1}
              </div>

              {/* Play overlay */}
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/40 transition">
                <div className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/95 flex items-center justify-center shadow-2xl group-hover:scale-110 transition">
                  <Play className="w-5 h-5 md:w-6 md:h-6 text-[#128C7E] ml-0.5" fill="currentColor" />
                </div>
              </div>

              {/* Title */}
              <div className="absolute inset-x-0 bottom-0 p-2.5 md:p-3">
                <div className="text-white font-semibold text-xs md:text-sm line-clamp-2 leading-snug drop-shadow-lg">
                  {v.title}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}