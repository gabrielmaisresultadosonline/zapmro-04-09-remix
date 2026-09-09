import { useMemo, useState } from "react";
import { X, Download, Maximize2, Minimize2, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadMediaFile } from "@/lib/mediaDownload";

export interface DocumentPopupProps {
  /** Public URL of the document */
  url: string;
  /** Original file name (used for the download attribute and extension detection) */
  fileName?: string;
  onClose: () => void;
}

const OFFICE_EXTENSIONS = ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"];
const TEXT_EXTENSIONS = ["txt", "csv", "json", "md", "log"];

function getExtension(url: string, fileName?: string): string {
  const source = (fileName || url).split("?")[0].split("#")[0];
  const parts = source.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

/**
 * Preview popup for documents (PDF / Office / plain text).
 * Nothing is downloaded automatically — the user explicitly chooses to download.
 */
export const DocumentPopup = ({ url, fileName, onClose }: DocumentPopupProps) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);

  const ext = useMemo(() => getExtension(url, fileName), [url, fileName]);
  const displayName = fileName || `documento${ext ? "." + ext : ""}`;

  const viewerUrl = useMemo(() => {
    if (ext === "pdf" || TEXT_EXTENSIONS.includes(ext)) return url;
    if (OFFICE_EXTENSIONS.includes(ext)) {
      // Microsoft's public Office viewer renders docx/xlsx/pptx from a public URL
      return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
    }
    // Unknown type: try Google's generic viewer
    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
  }, [url, ext]);

  const canPreview = ext !== "zip" && ext !== "rar" && ext !== "7z";

  const handleDownload = async () => {
    // Preserva o nome original do documento (ex.: contrato.pdf).
    await downloadMediaFile(url, displayName);
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-background rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden w-full",
          fullscreen ? "h-full max-w-none rounded-none" : "max-w-4xl h-[85vh]"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card shrink-0">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium truncate flex-1" title={displayName}>
            {displayName}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFullscreen((v) => !v)} title="Expandir">
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.open(url, "_blank", "noopener,noreferrer")} title="Abrir em nova aba">
            <ExternalLink className="w-4 h-4" />
          </Button>
          <Button variant="default" size="sm" className="h-8 gap-1.5" onClick={handleDownload}>
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Baixar</span>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Fechar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 bg-muted/30 overflow-hidden">
          {canPreview && !failed ? (
            <iframe
              src={viewerUrl}
              title={displayName}
              className="w-full h-full border-0 bg-white"
              onError={() => setFailed(true)}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center p-6">
              <FileText className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Não foi possível exibir a pré-visualização deste tipo de arquivo.
              </p>
              <Button onClick={handleDownload} className="gap-2">
                <Download className="w-4 h-4" /> Baixar arquivo
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentPopup;
