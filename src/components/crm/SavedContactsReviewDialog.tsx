import { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Users } from 'lucide-react';

export interface SavedContact { wa_id: string; name: string }

export interface SavedContactsReviewDialogProps {
  open: boolean;
  total: number;
  saved: SavedContact[];
  /** Recebe os números que devem SAIR do disparo; null = cancelar. */
  onResolve: (removed: string[] | null) => void;
}

/** Aviso antes do disparo: manter, excluir todos ou personalizar os contatos já salvos. */
export function SavedContactsReviewDialog({ open, total, saved, onResolve }: SavedContactsReviewDialogProps) {
  const [mode, setMode] = useState<'ask' | 'custom'>('ask');
  const [query, setQuery] = useState('');
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  useEffect(() => { if (open) { setMode('ask'); setQuery(''); setRemoved(new Set()); } }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return saved;
    return saved.filter((c) => c.name.toLowerCase().includes(q) || c.wa_id.includes(q.replace(/\D/g, '') || '§'));
  }, [saved, query]);

  const toggle = (id: string) => setRemoved((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredMarked = filtered.length > 0 && filtered.every((c) => removed.has(c.wa_id));
  const markFiltered = () => setRemoved((prev) => {
    const next = new Set(prev);
    filtered.forEach((c) => (allFilteredMarked ? next.delete(c.wa_id) : next.add(c.wa_id)));
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onResolve(null); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Contatos salvos na lista</DialogTitle>
          <DialogDescription>
            Temos <strong>{saved.length}</strong> número(s) salvo(s) com nome entre os {total} da sua lista. Deseja enviar para todos?
          </DialogDescription>
        </DialogHeader>

        {mode === 'custom' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar pelo nome ou número" className="pl-9" />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{filtered.length} na pesquisa · {removed.size} marcado(s) para remover</span>
              <Button type="button" size="sm" variant="outline" onClick={markFiltered} disabled={filtered.length === 0}>
                {allFilteredMarked ? 'Desmarcar todos da pesquisa' : 'Selecionar todos da pesquisa'}
              </Button>
            </div>
            <ScrollArea className="h-72 rounded-md border">
              <ul className="divide-y">
                {filtered.map((c) => (
                  <li key={c.wa_id}>
                    <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40">
                      <input type="checkbox" checked={removed.has(c.wa_id)} onChange={() => toggle(c.wa_id)} className="h-4 w-4" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">+{c.wa_id}</span>
                      </span>
                    </label>
                  </li>
                ))}
                {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</li>}
              </ul>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {mode === 'ask' ? (
            <>
              <Button variant="outline" onClick={() => onResolve([])}>Manter todos</Button>
              <Button variant="destructive" onClick={() => onResolve(saved.map((c) => c.wa_id))}>Excluir todos</Button>
              <Button onClick={() => setMode('custom')}>Personalizar</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('ask')}>Voltar</Button>
              <Button onClick={() => onResolve(Array.from(removed))}>
                Remover {removed.size} e disparar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
