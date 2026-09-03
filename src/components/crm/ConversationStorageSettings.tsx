import { useState } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Database, Download, Eraser, HardDrive, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  clearConversationHistory,
  downloadBlob,
  exportConversations,
  saveConversationBackup,
} from "@/lib/conversationArchive";

export interface ConversationStorageSettingsProps {
  userId?: string | null;
  /** Chamado após limpar, para o CRM recarregar as conversas em memória. */
  onHistoryCleared?: () => void;
}

type BusyAction = "export" | "backup" | "clear" | null;

export const ConversationStorageSettings = ({
  userId,
  onHistoryCleared,
}: ConversationStorageSettingsProps) => {
  const { toast } = useToast();
  const [includeFiles, setIncludeFiles] = useState(true);
  const [purgeStorage, setPurgeStorage] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [progress, setProgress] = useState<string>("");
  const [confirmClear, setConfirmClear] = useState(false);

  const handleExport = async () => {
    setBusy("export");
    try {
      const result = await exportConversations({ includeFiles, userId }, setProgress);
      downloadBlob(result.blob, result.filename);
      toast({
        title: "Exportação concluída",
        description: `${result.totalMessages} mensagens${
          includeFiles ? ` e ${result.filesIncluded} arquivos` : ""
        } no arquivo ${result.filename}.`,
      });
    } catch (error) {
      console.error("[ConversationStorageSettings] export falhou", error);
      toast({
        title: "Erro ao exportar",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const handleBackup = async () => {
    setBusy("backup");
    try {
      const result = await saveConversationBackup({ userId, includeFiles });
      toast({
        title: "Backup salvo",
        description: `${result.totalMessages} mensagens guardadas em ${result.path}.`,
      });
    } catch (error) {
      console.error("[ConversationStorageSettings] backup falhou", error);
      toast({
        title: "Erro ao salvar backup",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    setBusy("clear");
    try {
      const result = await clearConversationHistory({ userId, purgeStorage });
      toast({
        title: "Histórico limpo",
        description: `${result.deletedMessages} mensagens apagadas. ${result.removedFiles} arquivos removidos do armazenamento (${result.keptFiles} preservados por ainda estarem em uso).`,
      });
      onHistoryCleared?.();
    } catch (error) {
      console.error("[ConversationStorageSettings] limpeza falhou", error);
      toast({
        title: "Erro ao limpar",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      setConfirmClear(false);
    }
  };

  return (
    <AccordionItem value="conversas-armazenamento" className="border rounded-2xl bg-card overflow-hidden shadow-sm">
      <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-3 text-left">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-lg">Conversas e armazenamento</CardTitle>
            <CardDescription className="text-[11px]">
              Exporte, salve um backup ou limpe o histórico liberando espaço.
            </CardDescription>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-6 pb-6 pt-4 space-y-5 border-t">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Incluir arquivos</Label>
              <p className="text-[11px] text-muted-foreground">
                Imagens, vídeos, áudios e documentos entram dentro do .zip.
              </p>
            </div>
            <Switch checked={includeFiles} onCheckedChange={setIncludeFiles} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs font-bold uppercase tracking-wider">Apagar mídia ao limpar</Label>
              <p className="text-[11px] text-muted-foreground">
                Remove do armazenamento os arquivos que nenhum fluxo ou mensagem usa mais.
              </p>
            </div>
            <Switch checked={purgeStorage} onCheckedChange={setPurgeStorage} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl font-semibold"
            disabled={busy !== null}
            onClick={handleExport}
          >
            {busy === "export" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Exportar conversas
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl font-semibold"
            disabled={busy !== null}
            onClick={handleBackup}
          >
            {busy === "backup" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar conversas
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 rounded-xl font-semibold"
            disabled={busy !== null}
            onClick={() => setConfirmClear(true)}
          >
            {busy === "clear" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eraser className="w-4 h-4 mr-2" />}
            Limpar conversas
          </Button>
        </div>

        {progress && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" /> {progress}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground flex items-start gap-2">
          <Database className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Limpar conversas apaga apenas o histórico de mensagens e a mídia órfã. Os contatos, etiquetas,
          fluxos e configurações continuam intactos.
        </p>

        <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Limpar todo o histórico de conversas?</AlertDialogTitle>
              <AlertDialogDescription>
                Todas as mensagens serão apagadas{purgeStorage ? " e os arquivos sem uso serão removidos do armazenamento" : ""}.
                Os contatos permanecem na lista. Recomendamos exportar ou salvar um backup antes. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy === "clear"}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={busy === "clear"}
                onClick={(event) => {
                  event.preventDefault();
                  void handleClear();
                }}
              >
                Limpar agora
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AccordionContent>
    </AccordionItem>
  );
};

export default ConversationStorageSettings;
