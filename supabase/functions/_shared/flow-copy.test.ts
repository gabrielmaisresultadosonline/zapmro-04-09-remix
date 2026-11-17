import { beforeEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

// Exige um PostgreSQL descartável, como no teste de retenção.
const database = process.env.FLOW_COPY_TEST_DB;
if (!database) throw new Error('Set FLOW_COPY_TEST_DB to a disposable PostgreSQL database.');
const base = resolve(import.meta.dir, '../../../');
for (const file of ['deploy/postgres-stack/tests/flow-copy-fixture.sql', 'deploy/postgres-stack/sql/144-admin-copiar-fluxos-entre-cadastros.sql']) {
  const result = Bun.spawnSync(['psql', database, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve(base, file)]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
function sql(query: string): string {
  const result = Bun.spawnSync(['psql', database, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
function sqlError(query: string): string {
  const result = Bun.spawnSync(['psql', database, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query]);
  if (result.exitCode === 0) throw new Error('A operação deveria ter sido recusada.');
  return result.stderr.toString();
}
const sourceUser = '00000000-0000-4000-8000-000000000001';
const targetUser = '00000000-0000-4000-8000-000000000002';
const sourceNumber = '10000000-0000-4000-8000-000000000001';
const targetNumber = '10000000-0000-4000-8000-000000000002';
const sourceFlow = '20000000-0000-4000-8000-000000000001';
const call = `SELECT public.crm_admin_copy_flows_between_numbers(ARRAY['${sourceFlow}']::uuid[],'${targetNumber}')`;
function reset(): void {
  sql(`TRUNCATE public.crm_flow_steps,public.crm_flows,public.crm_whatsapp_numbers;
    INSERT INTO public.crm_whatsapp_numbers(id,user_id,meta_access_token,meta_phone_number_id) VALUES
      ('${sourceNumber}','${sourceUser}','origem-token','origem-phone'),
      ('${targetNumber}','${targetUser}','destino-token','destino-phone');
    INSERT INTO public.crm_flows(id,name,is_active,nodes,edges,user_id,whatsapp_number_id) VALUES
      ('${sourceFlow}','Entrega',true,'[{"type":"ai"}]','[]','${sourceUser}','${sourceNumber}');
    INSERT INTO public.crm_flow_steps(flow_id,step_order,message_text,user_id) VALUES
      ('${sourceFlow}',1,'Conteúdo original','${sourceUser}');`);
}
beforeEach(reset);

describe('AdminCentral — cópia real de fluxos entre cadastros', () => {
  it('copia para outro cadastro com o dono e o número do destino', () => {
    sql(`SELECT set_config('request.jwt.claim.role','service_role',false); ${call};`);
    expect(sql(`SELECT user_id||':'||whatsapp_number_id FROM public.crm_flows WHERE id<>'${sourceFlow}'`)).toBe(`${targetUser}:${targetNumber}`);
    expect(sql(`SELECT user_id FROM public.crm_flow_steps WHERE flow_id<>'${sourceFlow}'`)).toBe(targetUser);
  });
  it('preserva integralmente o fluxo e o passo de origem', () => {
    sql(`SELECT set_config('request.jwt.claim.role','service_role',false); ${call};`);
    expect(sql(`SELECT name||':'||is_active||':'||user_id||':'||whatsapp_number_id FROM public.crm_flows WHERE id='${sourceFlow}'`)).toBe(`Entrega:true:${sourceUser}:${sourceNumber}`);
    expect(sql(`SELECT message_text||':'||user_id FROM public.crm_flow_steps WHERE flow_id='${sourceFlow}'`)).toBe(`Conteúdo original:${sourceUser}`);
  });
  it('cria a cópia desligada, mantendo os blocos do fluxo', () => {
    sql(`SELECT set_config('request.jwt.claim.role','service_role',false); ${call};`);
    expect(sql(`SELECT is_active||':'||nodes FROM public.crm_flows WHERE id<>'${sourceFlow}'`)).toBe('false:[{"type": "ai"}]');
  });
  it('recusa a operação fora do service_role do AdminCentral', () => {
    expect(sqlError(`SELECT set_config('request.jwt.claim.role','authenticated',false); ${call};`)).toContain('Operação exclusiva do AdminCentral');
    expect(sql('SELECT count(*) FROM public.crm_flows')).toBe('1');
  });
  it('não copia para um WhatsApp desconectado', () => {
    sql(`UPDATE public.crm_whatsapp_numbers SET meta_access_token=NULL WHERE id='${targetNumber}'`);
    expect(sqlError(`SELECT set_config('request.jwt.claim.role','service_role',false); ${call};`)).toContain('destino não está conectado');
    expect(sql('SELECT count(*) FROM public.crm_flows')).toBe('1');
  });
});
