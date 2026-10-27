import {TranslationSettingsSchema,translateText,translateMessage,autoTranslateIncoming} from './conversation-translation.ts';

function assert(value:unknown,message:string){if(!value)throw new Error(message);}
Deno.test('translation preferences validate the selected language and automatic modes',()=>{
 assert(TranslationSettingsSchema.safeParse({enabled:true,target_language:'es',auto_incoming:true,auto_outgoing:true}).success,'Spanish and automatic modes must be supported');
 assert(!TranslationSettingsSchema.safeParse({enabled:true,target_language:'not-a-language',auto_incoming:true,auto_outgoing:true}).success,'Unknown languages must be rejected');
});
Deno.test('translation preserves the input and requests only the configured target language',async()=>{
 const previous=globalThis.fetch;
 const savedKey=Deno.env.get('OPENAI_API_KEY');
 Deno.env.set('OPENAI_API_KEY','test-translation-placeholder');
 let request:any;
 globalThis.fetch=(async(input:any,init:any)=>{
  if(String(input).includes('/models/'))return new Response('{}',{status:200});
  request=JSON.parse(init.body);
  return new Response(JSON.stringify({choices:[{message:{content:'Hola, João! https://example.com 123'}}]}),{status:200});
 }) as typeof fetch;
 const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:null,error:null})};
 try{
  const text='Olá, João! https://example.com 123';
  const result=await translateText({from:()=>chain},'translation-test-owner',null,text,'es');
  assert(result==='Hola, João! https://example.com 123','Must return provider translation');
  assert(request.messages[1].content===text,'Original must not be changed');
  assert(request.messages[0].content.includes('Español'),'Must request saved language');
 }finally{globalThis.fetch=previous;if(savedKey===undefined)Deno.env.delete('OPENAI_API_KEY');else Deno.env.set('OPENAI_API_KEY',savedKey);}
});
Deno.test('cached audio translation does not transcribe the same file again',async()=>{
 let transcriptions=0;
 const translation={original_text:'Olá',translated_text:'Hello',target_language:'en'};
 const db={from:(table:string)=>{
  const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:table==='crm_messages'?{id:'message',user_id:'owner',message_type:'audio',media_url:'https://example.com/audio.ogg'}:translation,error:null})};return chain;
 }};
 const result=await translateMessage(db,'owner','message',{target_language:'en'},async()=>{transcriptions++;return 'Olá';});
 assert(result===translation,'Existing translation should be reused');assert(transcriptions===0,'Must not retranscribe a cached translation');
});

Deno.test('automatic translation works with the AI agent disabled and preserves original message state',async()=>{
 const message={id:'incoming',user_id:'owner',message_type:'text',content:'Hello',metadata:{flow:'unchanged'}};
 const before=JSON.stringify(message);
 let messageReads=0;
 const db={from:(table:string)=>{
  const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>{
   if(table==='crm_translation_settings')return {data:{enabled:true,auto_incoming:true,target_language:'pt',ai_agent_enabled:false},error:null};
   if(table==='crm_messages'){messageReads++;return {data:message,error:null};}
   return {data:{original_text:'Hello',translated_text:'Olá'},error:null};
  }};return chain;
 }};
 await autoTranslateIncoming(db,'owner','incoming',async()=>{throw new Error('Unexpected transcription');});
 assert(messageReads===1,'Translation must run even with AI disabled');
 assert(JSON.stringify(message)===before,'Translation must preserve the AI input and flow metadata');
});

Deno.test('disabled translator performs no translation even when AI is enabled',async()=>{
 let messageReads=0;
 const db={from:(table:string)=>{
  if(table!=='crm_translation_settings')messageReads++;
  const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{enabled:false,auto_incoming:true,ai_agent_enabled:true},error:null})};return chain;
 }};
 await autoTranslateIncoming(db,'owner','incoming',async()=>{throw new Error('Unexpected transcription');});
 assert(messageReads===0,'AI activation must not enable translation');
});

Deno.test('automatic translation errors do not propagate to the incoming AI reply caller',async()=>{
 const db={from:()=>{throw new Error('Translation settings unavailable');}};
 let continued=false;
 await autoTranslateIncoming(db,'owner','incoming',async()=>{throw new Error('Unexpected transcription');});
 continued=true;
 assert(continued,'Caller must continue when translation fails');
});