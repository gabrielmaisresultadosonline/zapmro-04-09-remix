import { supabase } from '@/integrations/supabase/client';
export const translationLanguages = {pt:'Português',en:'Inglês',es:'Espanhol',fr:'Francês',de:'Alemão',it:'Italiano',ar:'Árabe',ja:'Japonês',zh:'Chinês',ru:'Russo',ko:'Coreano',hi:'Hindi'};
export type TranslationSettings = {enabled:boolean;target_language:keyof typeof translationLanguages;auto_incoming:boolean;auto_outgoing:boolean};
export type MessageTranslation = {message_id:string;target_language:string;original_text:string;translated_text:string};
export const defaultTranslationSettings:TranslationSettings={enabled:false,target_language:'pt',auto_incoming:false,auto_outgoing:false};
export async function translationCall(action:string,params:Record<string,unknown>={}) {
  const {data,error}=await supabase.functions.invoke('meta-whatsapp-crm',{body:{action,...params}});
  if(error) throw error;
  if(!data?.success) throw new Error(data?.error||'Não foi possível concluir a tradução');
  return data;
}