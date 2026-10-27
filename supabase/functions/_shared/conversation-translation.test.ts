import {TranslationSettingsSchema,translateText,translateMessage} from './conversation-translation.ts';

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