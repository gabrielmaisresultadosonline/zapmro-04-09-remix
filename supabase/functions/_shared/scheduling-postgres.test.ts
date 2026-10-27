import {describe,it,expect} from 'bun:test';
import {resolve} from 'node:path';
const database=process.env.SCHEDULING_TEST_DB;
if(!database)throw new Error('SCHEDULING_TEST_DB must identify a disposable PostgreSQL database');
function sql(query:string){const r=Bun.spawnSync(['psql',database as string,'-X','-v','ON_ERROR_STOP=1','-At','-c',query]);if(r.exitCode)throw new Error(r.stderr.toString());return r.stdout.toString().trim();}
const root=resolve(import.meta.dir,'../../..');
for(const file of ['deploy/postgres-stack/tests/scheduling-translation-fixture.sql','deploy/postgres-stack/sql/134-agendamentos-e-traducoes.sql']){
 const r=Bun.spawnSync(['psql',database,'-X','-v','ON_ERROR_STOP=1','-f',resolve(root,file)]);if(r.exitCode)throw new Error(r.stderr.toString());
}
const user='00000000-0000-4000-8000-000000000001',number='00000000-0000-4000-8000-000000000002',contact='00000000-0000-4000-8000-000000000003';
sql(`INSERT INTO auth.users VALUES('${user}');INSERT INTO crm_whatsapp_numbers VALUES('${number}','${user}');INSERT INTO crm_contacts VALUES('${contact}','${user}','${number}','5511999999999');`);
describe('actual scheduling and translation PostgreSQL migration',()=>{
 it('persists schedule owner and WhatsApp from the contact',()=>{
  sql(`INSERT INTO crm_scheduled_messages(contact_id,scheduled_for,message_data) VALUES('${contact}',now()-interval '1 minute','{"action":"sendTemplate"}');`);
  expect(sql('SELECT user_id::text||\'/\'||whatsapp_number_id::text FROM crm_scheduled_messages')).toBe(`${user}/${number}`);
 });
 it('claims a due schedule only once and never claims future sends',()=>{
  sql(`INSERT INTO crm_scheduled_messages(contact_id,scheduled_for,message_data) VALUES('${contact}',now()+interval '1 day','{"action":"sendTemplate"}');`);
  expect(sql('SELECT count(*) FROM crm_claim_scheduled_messages(10)')).toBe('1');expect(sql('SELECT count(*) FROM crm_claim_scheduled_messages(10)')).toBe('0');
 });
 it('fails abandoned claims without automatically resending',()=>{
  sql("UPDATE crm_scheduled_messages SET processed_at=now()-interval '11 minutes' WHERE status='processing'");
  expect(sql('SELECT count(*) FROM crm_claim_scheduled_messages(10)')).toBe('0');expect(sql("SELECT status FROM crm_scheduled_messages WHERE scheduled_for<now()")).toBe('failed');
 });
 it('saves translation settings per registration across sessions',()=>{
  sql(`INSERT INTO crm_translation_settings(user_id,enabled,target_language,auto_incoming,auto_outgoing) VALUES('${user}',true,'es',true,true)`);
  expect(sql('SELECT enabled::text||\'/\'||target_language||\'/\'||auto_incoming::text||\'/\'||auto_outgoing::text FROM crm_translation_settings')).toBe('true/es/true/true');
 });
 it('deleting a message removes its translation without deleting contacts',()=>{
  const message='00000000-0000-4000-8000-000000000004';
  sql(`INSERT INTO crm_messages(id,user_id,contact_id,content) VALUES('${message}','${user}','${contact}','Olá');INSERT INTO crm_message_translations(user_id,message_id,target_language,original_text,translated_text) VALUES('${user}','${message}','es','Olá','Hola');DELETE FROM crm_messages WHERE id='${message}'`);
  expect(sql('SELECT count(*) FROM crm_message_translations')).toBe('0');expect(sql('SELECT count(*) FROM crm_contacts')).toBe('1');
 });
});