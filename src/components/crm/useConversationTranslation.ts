import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {defaultTranslationSettings,translationCall,type MessageTranslation,type TranslationSettings} from '@/lib/conversationTranslation';
import {useToast} from '@/hooks/use-toast';

export function useConversationTranslation(userId:string|null,contactId:string|undefined,messages:any[]) {
 const [settings,setSettings]=useState<TranslationSettings>(defaultTranslationSettings);
 const [translations,setTranslations]=useState<Record<string,MessageTranslation>>({});
 const [selected,setSelected]=useState<string[]>([]);
 const [busy,setBusy]=useState(false);
 const generation=useRef(0);
 const {toast}=useToast();
 useEffect(()=>{
  let live=true;setSettings(defaultTranslationSettings);
  if(userId) translationCall('getTranslationSettings').then(data=>{if(live)setSettings(data.settings);}).catch(()=>{});
  return()=>{live=false;};
 },[userId]);
 const messageKey=messages.map(m=>m.id).join(',');
 useEffect(()=>{
  generation.current++;setSelected([]);setTranslations({});
 },[contactId]);
 useEffect(()=>{
  if(!userId||!contactId||!settings.enabled) return;
  let live=true;
  const ids=messageKey.split(',').filter(id=>/^[a-f\d-]{36}$/i.test(id));
  const load=async()=>{
   const found:Record<string,MessageTranslation>={};
   for(let i=0;i<ids.length;i+=40){
    const {data,error}=await (supabase as any).from('crm_message_translations').select('*').eq('user_id',userId).eq('target_language',settings.target_language).in('message_id',ids.slice(i,i+40));
    if(error)return;
    for(const row of data||[])found[row.message_id]=row;
   }
   if(live)setTranslations(found);
  };
  void load();const timer=setInterval(load,5000);
  return()=>{live=false;clearInterval(timer);};
 },[userId,contactId,messageKey,settings.enabled,settings.target_language]);
 const translate=async(ids:string[])=>{
  if(!ids.length||busy)return;
  const current=generation.current;setBusy(true);
  try{
   // Small batches prevent long Edge Function requests for audio selections.
   for(const id of ids){
    const data=await translationCall('translateMessages',{messageIds:[id]});
    if(current!==generation.current)break;
    setTranslations(prev=>({...prev,...Object.fromEntries(data.translations.map((row:MessageTranslation)=>[row.message_id,row]))}));
   }
   if(current===generation.current)setSelected([]);
  }catch(e:any){toast({title:'Erro ao traduzir',description:e.message,variant:'destructive'});}
  finally{setBusy(false);}
 };
 const toggle=(id:string)=>setSelected(prev=>prev.includes(id)?prev.filter(value=>value!==id):prev.length<20?[...prev,id]:prev);
 return {settings,setSettings,translations,selected,busy,translate,toggle};
}