import {Languages} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import type {MessageTranslation as Translation} from '@/lib/conversationTranslation';

export function MessageTranslation({message,translation,enabled,selected,busy,onSelect,onTranslate}:{message:any;translation?:Translation;enabled:boolean;selected:boolean;busy:boolean;onSelect:()=>void;onTranslate:()=>void}) {
 const eligible=['text','template','audio','voice'].includes(message.message_type)&&!message.isOptimistic;
 const original=message.metadata?.translation_original;
 return <>
  {enabled&&eligible&&<div className="flex items-center justify-end gap-2 mb-1">
   <Checkbox aria-label="Selecionar mensagem para tradução" checked={selected} onCheckedChange={onSelect}/>
   <Button variant="ghost" size="icon" className="h-6 w-6" title="Traduzir mensagem" aria-label="Traduzir mensagem" disabled={busy} onClick={onTranslate}><Languages className="h-3.5 w-3.5"/></Button>
  </div>}
  {(translation||original)&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border mt-2 pt-2 text-xs clear-both">
   <div className="min-w-0"><span className="font-semibold text-muted-foreground">{['audio','voice'].includes(message.message_type)?'Transcrição original':'Original'}</span><p className="whitespace-pre-wrap break-words" dir="auto">{translation?.original_text||original}</p></div>
   <div className="min-w-0"><span className="font-semibold text-primary">Tradução</span><p className="whitespace-pre-wrap break-words" dir="auto">{translation?.translated_text||message.content}</p></div>
  </div>}
 </>;
}