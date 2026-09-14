import { useState } from "react";
import { ExternalLink, Megaphone, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AdReferralData {
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
  welcome_message?: { text?: string };
  persisted_media_url?: string;
  persisted_media_type?: "image" | "video";
}

export interface AdReferralCardProps {
  referral: AdReferralData;
}

export const AdReferralCard = ({ referral }: AdReferralCardProps) => {
  const [mediaFailed, setMediaFailed] = useState(false);
  const mediaUrl = referral.persisted_media_url
    || referral.thumbnail_url
    || referral.image_url
    || referral.video_url;
  const isVideo = referral.persisted_media_type === "video"
    || (!referral.thumbnail_url && !referral.image_url && !!referral.video_url)
    || referral.media_type === "video";
  const suggestedText = referral.welcome_message?.text?.trim();
  const Wrapper = referral.source_url ? "a" : "div";

  return (
    <Wrapper
      {...(referral.source_url
        ? { href: referral.source_url, target: "_blank", rel: "noopener noreferrer" }
        : {})}
      className={cn(
        "mt-2 block w-[min(280px,75vw)] overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-sm",
        referral.source_url && "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title={referral.source_url ? "Abrir anúncio original" : "Anúncio de origem"}
    >
      {!mediaFailed && mediaUrl ? (
        isVideo ? (
          <video
            src={mediaUrl}
            className="aspect-video w-full bg-muted object-cover"
            controls
            muted
            playsInline
            preload="metadata"
            onError={() => setMediaFailed(true)}
          />
        ) : (
          <img
            src={mediaUrl}
            alt={referral.headline ? `Anúncio: ${referral.headline}` : "Imagem do anúncio de origem"}
            className="aspect-video w-full bg-muted object-cover"
            loading="lazy"
            onError={() => setMediaFailed(true)}
          />
        )
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
          {isVideo ? <Video className="h-7 w-7" aria-hidden="true" /> : <Megaphone className="h-7 w-7" aria-hidden="true" />}
        </div>
      )}

      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
          <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
          Anúncio de origem
        </div>
        {referral.headline && <p className="text-xs font-semibold leading-snug">{referral.headline}</p>}
        {referral.body && <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{referral.body}</p>}
        {suggestedText && (
          <div className="border-t border-border pt-1.5">
            <p className="text-[9px] font-semibold uppercase text-muted-foreground">Mensagem sugerida no anúncio</p>
            <p className="mt-0.5 text-[11px] leading-relaxed">{suggestedText}</p>
          </div>
        )}
        {referral.source_url && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
            Abrir anúncio <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </div>
    </Wrapper>
  );
};

export default AdReferralCard;