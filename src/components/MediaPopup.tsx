import { X, ZoomIn, ZoomOut, RotateCcw, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface MediaPopupProps {
  url: string;
  type: 'image' | 'video';
  onClose: () => void;
}

export const MediaPopup = ({ url, type, onClose }: MediaPopupProps) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleZoomIn = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setScale(prev => Math.min(prev + 0.5, 5));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setScale(prev => {
      const newScale = Math.max(prev - 0.5, 0.5);
      if (newScale <= 1) setPosition({ x: 0, y: 0 });
      return newScale;
    });
  };

  const handleReset = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement('a');
    link.href = url;
    link.download = `media_${Date.now()}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center backdrop-blur-md animate-in fade-in duration-300" 
      onClick={onClose}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute top-4 right-4 flex gap-2 z-[110]" onClick={(e) => e.stopPropagation()}>
        {type === 'image' && (
          <>
            <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white border-none" onClick={handleZoomIn}>
              <ZoomIn className="w-5 h-5" />
            </Button>
            <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white border-none" onClick={handleZoomOut}>
              <ZoomOut className="w-5 h-5" />
            </Button>
            <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white border-none" onClick={handleReset}>
              <RotateCcw className="w-5 h-5" />
            </Button>
          </>
        )}
        <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white border-none" onClick={handleDownload}>
          <Download className="w-5 h-5" />
        </Button>
        <Button variant="secondary" size="icon" className="rounded-full bg-white/10 hover:bg-white/20 text-white border-none" onClick={onClose}>
          <X className="w-6 h-6" />
        </Button>
      </div>

      <div 
        className="relative w-full h-full flex items-center justify-center overflow-hidden cursor-default" 
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'image' ? (
          <img 
            src={url} 
            alt="Preview" 
            className={cn(
              "max-w-full max-h-full object-contain transition-transform duration-200 select-none",
              scale > 1 ? "cursor-move" : "cursor-default"
            )}
            style={{ 
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            }}
            onMouseDown={handleMouseDown}
            draggable={false}
          />
        ) : (
          <SmoothVideo
            src={url}
            controls
            autoPlay
            containerClassName="flex items-center justify-center"
            className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
          />
        )}
      </div>
    </div>
  );
};
