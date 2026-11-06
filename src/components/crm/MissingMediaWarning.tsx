import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/mediaUrl';

// Uma conferência por endereço enquanto a tela estiver aberta.
const cache = new Map<string, Promise<boolean>>();

function checkMediaExists(url: string): Promise<boolean> {
  const resolved = resolveMediaUrl(url);
  if (!/^https?:\/\//i.test(resolved)) return Promise.resolve(true);
  let pending = cache.get(resolved);
  if (!pending) {
    pending = fetch(resolved, { method: 'HEAD', cache: 'no-store' })
      .then((res) => res.ok)
      // Falha de rede do próprio navegador não prova que o arquivo sumiu.
      .catch(() => true);
    cache.set(resolved, pending);
  }
  return pending;
}

export function clearMediaAvailabilityCache(url?: string) {
  if (url) cache.delete(resolveMediaUrl(url));
  else cache.clear();
}

export function useMediaExists(url?: string | null) {
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    setExists(null);
    if (!url) return;
    checkMediaExists(url).then((ok) => { if (alive) setExists(ok); });
    return () => { alive = false; };
  }, [url]);
  return exists;
}

export function MissingMediaWarning({ url }: { url?: string | null }) {
  const exists = useMediaExists(url);
  if (!url || exists !== false) return null;
  return (
    <div className="mt-1.5 flex items-start gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-1 text-[9px] font-semibold leading-tight text-destructive">
      <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
      <span>Arquivo não encontrado — envie novamente</span>
    </div>
  );
}
