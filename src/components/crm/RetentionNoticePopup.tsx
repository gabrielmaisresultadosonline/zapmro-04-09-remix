import { useEffect, useState } from "react";
import { AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const NOTICE_ID = "10810810-0000-4000-8000-000000000001";
const NOTICE_DELAY_MS = 4 * 60 * 1000;

export default function RetentionNoticePopup() {
  const [open, setOpen] = useState(false);
  const [cleanupEventId, setCleanupEventId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleNotice = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: cleanupEvent } = await supabase
        .from("crm_storage_cleanup_events")
        .select("id")
        .eq("user_id", user.id)
        .is("acknowledged_at", null)
        .order("cleaned_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cleanupEvent?.id && !cancelled) {
        setCleanupEventId(cleanupEvent.id);
        setOpen(true);
        return;
      }

      const { data: existing, error: readError } = await supabase
        .from("admin_announcement_views")
        .select("id")
        .eq("user_id", user.id)
        .eq("announcement_id", NOTICE_ID)
        .maybeSingle();

      if (readError || existing || cancelled) return;

      timer = setTimeout(async () => {
        const { error: insertError } = await supabase
          .from("admin_announcement_views")
          .insert({
            user_id: user.id,
            announcement_id: NOTICE_ID,
            view_count: 1,
            last_viewed_at: new Date().toISOString(),
            dismissed_at: new Date().toISOString(),
          });

        if (!insertError && !cancelled) setOpen(true);
      }, NOTICE_DELAY_MS);
    };

    void scheduleNotice();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const closeNotice = async () => {
    if (cleanupEventId) {
      const { error } = await supabase
        .from("crm_storage_cleanup_events")
        .update({ acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", cleanupEventId);
      if (error) return;
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle>{cleanupEventId ? "Seu armazenamento foi apagado" : "Atenção: política de armazenamento"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm text-muted-foreground">
          <p>
            {cleanupEventId
              ? "O histórico de conversas armazenado no sistema foi zerado pelo administrador."
              : "Conversas sem nenhuma nova mensagem recebida ou enviada por mais de 30 dias terão o histórico apagado automaticamente."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
              <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>Mensagens, imagens, vídeos, áudios e documentos serão removidos daqui e do servidor quando não estiverem em uso.</p>
            </div>
            <div className="flex gap-3 rounded-md border bg-muted/40 p-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>Seus contatos e números continuam no CRM. Uma nova mensagem inicia um novo histórico.</p>
            </div>
          </div>
          <Alert className="border-destructive/40 bg-destructive/10 text-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <AlertTitle className="text-destructive">Importante</AlertTitle>
            <AlertDescription>
               Salve seus contatos e acompanhe o histórico mais completo pelo celular. Aqui manteremos as conversas ativas para melhorar o funcionamento.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button onClick={() => void closeNotice()}>Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}