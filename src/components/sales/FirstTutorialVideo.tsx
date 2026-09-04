import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { resolveMediaUrl } from "@/lib/mediaUrl";
import { prefetchVideo, videoPrefetchHandlers } from "@/lib/videoPrefetch";
import { BadgeCheck, PlayCircle, X, Loader2 } from "lucide-react";

type Tutorial = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  video_url: string | null;
};

type Props = {
  headline?: string;
  subline?: string;
  orderIndex?: number;
};

export default function FirstTutorialVideo({
  headline = "Você precisa estar verificado",
  subline = "Assista o vídeo 01 antes de começar — ele explica por que a verificação é obrigatória para usar o sistema.",
  orderIndex = 0,
}: Props) {
  const [video, setVideo] = useState<Tutorial | null>(null);
  const [open, setOpen] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("sales_tutorials")
        .select("id,title,description,cover_url,video_url")
        .eq("is_active", true)
        .order("order_index", { ascending: true })
        .range(orderIndex, orderIndex)
        .maybeSingle();
      if (data) setVideo(data as Tutorial);
    })();
  }, [orderIndex]);

  if (!video?.video_url) return null;

  return (
    <>
      <button
        type="button"
        {...videoPrefetchHandlers(resolveMediaUrl(video.video_url))}
        onClick={() => {
          // Pré-aquece o início do arquivo antes do modal montar o <video>.
          prefetchVideo(resolveMediaUrl(video.video_url));
          setVideoLoading(true);
          setOpen(true);
        }}
        className="w-full group relative rounded-2xl overflow-hidden border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 shadow-md hover:shadow-xl transition-all text-left"
      >
        <div className="flex items-stretch">
          <div className="relative w-28 sm:w-32 shrink-0 bg-slate-900" style={{ aspectRatio: "4/5" }}>
            {video.cover_url ? (
              <img src={resolveMediaUrl(video.cover_url)} alt={video.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#075E54] to-[#25D366]" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/50 transition">
              <PlayCircle className="w-10 h-10 text-white drop-shadow-lg" />
            </div>
          </div>
          <div className="flex-1 p-3 sm:p-4 flex flex-col justify-center">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-700 uppercase tracking-wider mb-1">
              <BadgeCheck className="w-3.5 h-3.5" /> Assista antes
            </div>
            <div className="font-bold text-slate-900 text-sm sm:text-base leading-tight">
              {headline}
            </div>
            <div className="text-xs sm:text-sm text-slate-600 mt-1 line-clamp-2">
              {subline}
            </div>
            <div className="mt-2 text-xs font-bold text-orange-700 group-hover:text-orange-900">
              ▶ Assistir vídeo 01
            </div>
          </div>
        </div>
      </button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setVideoLoading(false);
        }}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 overflow-hidden border-0 bg-[#0b141a] text-white">
          <button
            onClick={() => setOpen(false)}
            className="absolute top-2 right-2 z-10 h-9 w-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur transition"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative bg-black w-full flex items-center justify-center" style={{ maxHeight: "75vh" }}>
            <SmoothVideo
              src={resolveMediaUrl(video.video_url)}
              poster={resolveMediaUrl(video.cover_url) || undefined}
              controls
              autoPlay
              controlsList="nodownload"
              containerClassName="flex items-center justify-center"
              className="w-full h-auto max-h-[75vh] object-contain bg-black"
              onPlaying={() => setVideoLoading(false)}
            />
          </div>
          <div className="p-4 md:p-6 bg-[#0b141a]">
            <DialogTitle className="text-lg md:text-2xl font-bold text-white leading-tight">
              {video.title}
            </DialogTitle>
            {video.description && (
              <p className="text-sm md:text-base text-white/70 whitespace-pre-wrap mt-2">
                {video.description}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}