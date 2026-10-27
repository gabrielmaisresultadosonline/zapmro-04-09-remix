import {describe,it,expect} from 'bun:test';
import {scheduledRequest,dispatchScheduled} from './scheduled-dispatch';
const contact={id:'contact',user_id:'user-a',wa_id:'5511999999999',whatsapp_number_id:'number-a'};
const row={id:'schedule',user_id:'user-a',whatsapp_number_id:'number-a',message_data:{action:'sendTemplate',templateName:'aviso',languageCode:'es',templateConfig:{body:{1:'Cliente'}}}};
describe('scheduled dispatch ownership and stored payload',()=>{
 it('preserves template variables, language and the selected WhatsApp',()=>{
  const request=scheduledRequest(row,contact);
  expect(request.whatsapp_number_id).toBe('number-a');expect(request.templateConfig).toEqual({body:{1:'Cliente'}});expect(request.languageCode).toBe('es');expect(request.contactId).toBe('contact');
 });
 it('rejects a schedule belonging to a different registration',()=>expect(()=>scheduledRequest({...row,user_id:'user-b'},contact)).toThrow('Cadastro'));
 it('rejects a different WhatsApp within the same registration',()=>expect(()=>scheduledRequest({...row,whatsapp_number_id:'number-b'},contact)).toThrow('WhatsApp'));
 it('derives the WhatsApp for a legacy schedule from its contact',()=>expect(scheduledRequest({...row,whatsapp_number_id:null},contact).whatsapp_number_id).toBe('number-a'));
 it('never accepts credentials or user overrides from stored payload',()=>{
  const request=scheduledRequest({...row,message_data:{...row.message_data,user_id:'other',meta_access_token:'invalid',contactId:'other'}},contact);
  expect(request.contactId).toBe('contact');expect('meta_access_token' in request).toBe(false);
 });
 it('records an execution failure rather than pretending it sent',async()=>{
  const saved:any[]=[];
  const db={rpc:async()=>({data:[{...row,message_data:{action:'bad'}}]}),from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:contact})})})}),update:(patch:any)=>{saved.push(patch);return{eq:()=>({eq:async()=>({error:null})})};}})};
  const result=await dispatchScheduled(db);
  expect(result[0].success).toBe(false);expect(saved[0].status).toBe('failed');expect(saved[0].last_error).toContain('Tipo');
 });
});