import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';

// Runs the actual migration and RPCs, not a duplicate implementation.
// RETENTION_TEST_DB must identify a disposable database created for this test.
const database = process.env.RETENTION_TEST_DB;
if (!database) throw new Error('Set RETENTION_TEST_DB to a disposable PostgreSQL database.');
const base = resolve(import.meta.dir, '../../../');
function sql(query: string): string {
  const result = Bun.spawnSync(['psql', database as string, '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}
for (const file of ['deploy/postgres-stack/tests/retention-cleanup-fixture.sql', 'deploy/postgres-stack/sql/132-retencao-conversas-7-dias.sql']) {
  const result = Bun.spawnSync(['psql', database, '-X', '-v', 'ON_ERROR_STOP=1', '-f', resolve(base, file)]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}
const user = '00000000-0000-4000-8000-000000000001';
const contact = '00000000-0000-4000-8000-000000000002';
const url = 'https://local/storage/v1/object/public/crm-media/incoming/old.jpg';
function reset(): void {
  sql(`TRUNCATE crm_messages,crm_contacts,crm_media_assets,crm_media_gc_queue,crm_flows,crm_templates,crm_ai_documents,crm_broadcasts,crm_scheduled_messages,storage.objects;
  INSERT INTO crm_contacts VALUES ('${contact}','${user}','Contato preservado');`);
}
function message(age: string, media = 'NULL'): void {
  sql(`INSERT INTO crm_messages VALUES(gen_random_uuid(),'${user}','${contact}',now()-interval '${age}',${media},'Mensagem','{}');`);
}
describe('conversation retention — actual PostgreSQL migration', () => {
  it('deletes history older than seven days, including files, but preserves contacts', () => {
    reset(); message('7 days 1 second', `'${url}'`);
    expect(sql('SELECT deleted_messages FROM crm_cleanup_inactive_histories()')).toBe('1');
    expect(sql('SELECT count(*) FROM crm_contacts')).toBe('1');
    expect(sql("SELECT path FROM crm_media_gc_queue WHERE purge_after<=now()")).toBe('incoming/old.jpg');
  });
  it('preserves the complete history when a new message restarts the seven-day deadline', () => {
    reset(); message('20 days'); message('6 days 23 hours');
    expect(sql('SELECT deleted_messages FROM crm_cleanup_inactive_histories()')).toBe('0');
    expect(sql('SELECT count(*) FROM crm_messages')).toBe('2');
  });
  it('serializes a concurrent new message before deciding to delete an inactive history', async () => {
    reset(); message('20 days');
    const writer = Bun.spawn(['psql', database as string, '-X', '-v', 'ON_ERROR_STOP=1', '-At'], {
      stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    });
    writer.stdin.write(`BEGIN; INSERT INTO crm_messages VALUES(gen_random_uuid(),'${user}','${contact}',now(),NULL,'Retomada','{}'); SELECT pg_sleep(1); COMMIT;`);
    writer.stdin.end();
    // Wait until PostgreSQL confirms the writer has acquired its contact lock.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (sql("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(1)%' AND pid<>pg_backend_pid() AND state='active'") === '1') break;
      await Bun.sleep(10);
      if (attempt === 99) throw new Error('Concurrent writer did not acquire its lock');
    }
    const cleaner = Bun.spawn(['psql', database as string, '-X', '-At', '-c', 'SELECT deleted_messages FROM crm_cleanup_inactive_histories()'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await writer.exited).toBe(0);
    expect(await cleaner.exited).toBe(0);
    expect((await new Response(cleaner.stdout).text()).trim()).toBe('0');
    expect(sql('SELECT count(*) FROM crm_messages')).toBe('2');
  });
  it('manual message deletion queues uncatalogued media immediately without deleting contacts', () => {
    reset(); message('1 hour', `'${url}'`); sql('DELETE FROM crm_messages');
    expect(sql('SELECT count(*) FROM crm_media_purge_due(100)')).toBe('1');
    expect(sql('SELECT count(*) FROM crm_contacts')).toBe('1');
  });
  it('protects files used by another conversation and by templates, flows, AI documents and active campaigns', () => {
    reset();
    const fixtures = [
      `INSERT INTO crm_messages VALUES(gen_random_uuid(),gen_random_uuid(),NULL,now(),'${url}',NULL,'{}')`,
      `INSERT INTO crm_flows VALUES(gen_random_uuid(),'{"media":"${url}"}')`,
      `INSERT INTO crm_templates VALUES(gen_random_uuid(),'{"media":"${url}"}')`,
      `INSERT INTO crm_ai_documents VALUES(gen_random_uuid(),'${url}')`,
      `INSERT INTO crm_broadcasts VALUES(gen_random_uuid(),'paused','{"media":"${url}"}')`,
      `INSERT INTO crm_scheduled_messages VALUES(gen_random_uuid(),'pending','{"media":"${url}"}')`,
    ];
    for (const fixture of fixtures) {
      reset(); sql(fixture);
      expect(sql(`SELECT crm_media_is_referenced('${user}','${url}','incoming/old.jpg')`)).toBe('t');
    }
    reset(); expect(sql(`SELECT crm_media_is_referenced('${user}','${url}','incoming/old.jpg')`)).toBe('f');
  });
  it('retries failed physical removals in the next cycle', () => {
    reset(); message('8 days', `'${url}'`); sql('DELETE FROM crm_messages');
    sql("UPDATE crm_media_gc_queue SET status='failed'");
    expect(sql('SELECT count(*) FROM crm_media_purge_due(100)')).toBe('1');
  });
  it('extracts files nested in deleted message metadata', () => {
    reset(); message('8 days');
    sql(`UPDATE crm_messages SET metadata='{"attachment":{"url":"${url}"}}'; DELETE FROM crm_messages`);
    expect(sql('SELECT path FROM crm_media_gc_queue')).toBe('incoming/old.jpg');
  });
  it('does not expire incoming files still referenced by an active conversation', () => {
    reset(); message('1 hour', `'${url}'`);
    sql("INSERT INTO storage.objects VALUES('crm-media','incoming/old.jpg',now()-interval '20 days','{\"size\":100}')");
    expect(sql('SELECT count(*) FROM crm_incoming_media_expired_batch()')).toBe('0');
    sql('DELETE FROM crm_messages');
    expect(sql('SELECT count(*) FROM crm_incoming_media_expired_batch()')).toBe('1');
  });
});
