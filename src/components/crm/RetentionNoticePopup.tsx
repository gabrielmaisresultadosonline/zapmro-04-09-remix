import { useEffect, useState } from "react";
import { AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const NOTICE_VERSION = "history-retention-10-days-v1";
const NOTICE_DELAY_MS = 4 * 60 * 1000;

export default function RetentionNoticePopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNotice = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const untypedClient = supabase as unknown as {
        from: (table: string) => ReturnType<typeof supabase.from>;
      };
      const { data: existing, error: readError } = await untypedClient
        .from("crm_retention_notice_views")
        .select("id")
        .eq("user_id", user.id)
        .eq("notice_version", NOTICE_VERSION)
        .maybeSingle();

      if (readError || existing || cancelled) return;

      timer = setTimeout(async () => {
        const { error: insertError } = await untypedClient
          .from("crm_retention_notice_views")
          .insert({ user_id: user.id, notice_version: NOTICE_VERSION });

        if (!insertError && !cancelled) setOpen(true);
      }, NOTICE_DELAY_MS);
    };

    void scheduleNotice();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle>Atenção: mudamos algumas configurações de armazenamento</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm text-muted-foreground">
          <p>
            Conversas sem nenhuma nova mensagem recebida ou enviada por mais de 10 dias terão o histórico apagado automaticamente.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>Mensagens, imagens, vídeos, áudios e documentos serão removidos daqui e do servidor quando não estiverem em uso.</p>
            </div>
            <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>O contato e a conversa continuam no CRM. Uma nova mensagem reinicia a contagem de 10 dias.</p>
            </div>
          </div>
          <Alert className="border-destructive/40 bg-destructive/10 text-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <AlertTitle className="text-destructive">Importante</AlertTitle>
            <AlertDescription>
              Seu histórico continuará no seu celular. Aqui manteremos o histórico apenas das conversas ativas para economizar espaço e evitar sobrecarga.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}