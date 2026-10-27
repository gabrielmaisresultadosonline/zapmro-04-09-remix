import {useState} from 'react';
import {Languages,Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Switch} from '@/components/ui/switch';
import {Label} from '@/components/ui/label';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {translationCall,translationLanguages,type TranslationSettings as Settings} from '@/lib/conversationTranslation';
import {useToast} from '@/hooks/use-toast';

export function TranslationSettings({value,onChange}:{value:Settings;onChange:(value:Settings)=>void}) {
 const [saving,setSaving]=useState(false);
 const {toast}=useToast();
 const save=async()=>{
  setSaving(true);
  try{await translationCall('saveTranslationSettings',{settings:value});toast({title:'Tradução salva no cadastro'});}
  catch(e:any){toast({title:'Erro ao salvar tradução',description:e.message,variant:'destructive'});}
  finally{setSaving(false);}
 };
 return <section className="space-y-4 border-y border-border py-5">
  <h3 className="flex items-center gap-2 font-semibold"><Languages className="h-5 w-5 text-primary"/>Tradução de conversas</h3>
  <div className="flex items-center justify-between gap-3"><Label htmlFor="translation-enabled">Ativar tradução</Label><Switch id="translation-enabled" checked={value.enabled} onCheckedChange={enabled=>onChange({...value,enabled})}/></div>
  <div className="space-y-2"><Label>Idioma de destino</Label><Select value={value.target_language} onValueChange={language=>{if(language in translationLanguages) onChange({...value,target_language:language as Settings['target_language']});}}><SelectTrigger aria-label="Idioma de destino"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(translationLanguages).map(([code,name])=><SelectItem key={code} value={code}>{name}</SelectItem>)}</SelectContent></Select></div>
  <div className="flex items-center justify-between gap-3"><Label htmlFor="translation-incoming">Traduzir recebidas automaticamente</Label><Switch id="translation-incoming" disabled={!value.enabled} checked={value.auto_incoming} onCheckedChange={auto_incoming=>onChange({...value,auto_incoming})}/></div>
  <div className="flex items-center justify-between gap-3"><Label htmlFor="translation-outgoing">Traduzir textos ao enviar automaticamente</Label><Switch id="translation-outgoing" disabled={!value.enabled} checked={value.auto_outgoing} onCheckedChange={auto_outgoing=>onChange({...value,auto_outgoing})}/></div>
  <Button onClick={save} disabled={saving}><Save className="mr-2 h-4 w-4"/>{saving?'Salvando…':'Salvar tradução'}</Button>
 </section>;
}