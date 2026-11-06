import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const NOTICE_KEY = 'incidente-2026-11-05';

/**
 * Aviso único do incidente de 05/11/2026. Só aparece para quem tem a linha
 * pendente em crm_user_notices (usuários que já existiam); some para sempre
 * depois de "Fechar".
 */
export function IncidentNoticeDialog({ userId }: { userId: string | null }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (supabase as any)
      .from('crm_user_notices')
      .select('dismissed_at')
      .eq('user_id', userId)
      .eq('notice_key', NOTICE_KEY)
      .is('dismissed_at', null)
      .maybeSingle()
      .then(({ data, error }: any) => {
        if (alive && !error && data) setOpen(true);
      });
    return () => { alive = false; };
  }, [userId]);

  const close = async () => {
    if (!userId) return;
    setSaving(true);
    await (supabase as any)
      .from('crm_user_notices')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('notice_key', NOTICE_KEY);
    setSaving(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) void close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Aviso importante
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-2 text-sm text-foreground">
              <p>
                Tivemos uma sobrecarga em nosso servidor, que <strong>já foi corrigida</strong>.
              </p>
              <p>
                Porém, todas as imagens, vídeos, PDFs e demais arquivos que estavam salvos
                em nosso banco de dados se perderam.
              </p>
              <p>
                Alguns históricos de mensagens também foram afetados: nosso histórico de
                mensagens vai até <strong>05/11 às 00h</strong>. Depois disso, não temos mais
                histórico de mensagens.
              </p>
              <p>
                Está tudo funcionando normalmente a partir de agora. É só continuar usando
                o sistema normalmente. Se algum fluxo ou template usava imagem, vídeo, áudio
                ou PDF, envie o arquivo novamente.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={close} disabled={saving} className="w-full sm:w-auto">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
