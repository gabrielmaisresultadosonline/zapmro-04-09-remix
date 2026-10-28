#!/usr/bin/env bash
# Diagnostica lentidão do banco e faz manutenção segura (VACUUM ANALYZE, sem apagar dados).
# Uso: sudo bash deploy/diagnosticar-lentidao-banco.sh  > /tmp/lentidao-banco.txt 2>&1
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] || { echo 'Configuração da VPS não encontrada.' >&2; exit 1; }
set -a; . "$STACK/.env"; set +a
DB="${DB_CONT:-zapmro-db}"
q() { docker exec -i "$DB" psql -U postgres -d "${POSTGRES_DB:-postgres}" -c "$1" || true; }

echo '=== VPS: CPU, memória e disco ==='
uptime; free -h; df -h /
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null || true

echo '=== Conexões abertas por estado ==='
q "SELECT state, count(*) FROM pg_stat_activity GROUP BY state ORDER BY 2 DESC;"
q "SHOW max_connections;"

echo '=== Consultas rodando há mais de 10 segundos ==='
q "SELECT pid, now()-query_start AS tempo, state, wait_event_type, left(query,160) AS consulta FROM pg_stat_activity WHERE state<>'idle' AND now()-query_start > interval '10 seconds' ORDER BY tempo DESC LIMIT 20;"

echo '=== Travas esperando ==='
q "SELECT count(*) AS esperando_trava FROM pg_locks WHERE NOT granted;"

echo '=== Maiores tabelas e linhas mortas ==='
q "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS tamanho, n_live_tup, n_dead_tup, last_autovacuum FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15;"

echo '=== Agendador: execuções lentas/falhas recentes ==='
q "SELECT j.jobname, r.status, r.end_time-r.start_time AS duracao, r.start_time FROM cron.job_run_details r JOIN cron.job j ON j.jobid=r.jobid WHERE r.start_time > now()-interval '2 hours' AND (r.status<>'succeeded' OR r.end_time-r.start_time > interval '20 seconds') ORDER BY r.start_time DESC LIMIT 20;"

echo '=== Encerrando consultas travadas há mais de 15 minutos (apenas leitura/ociosas em transação) ==='
q "SELECT pg_terminate_backend(pid), left(query,100) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND ((state='idle in transaction' AND now()-state_change > interval '15 minutes') OR (state='active' AND query ILIKE 'select%' AND now()-query_start > interval '15 minutes'));"

echo '=== Limpando histórico antigo do agendador (só registros de execução) ==='
q "DELETE FROM cron.job_run_details WHERE end_time < now()-interval '3 days';"

echo '=== Manutenção: VACUUM ANALYZE nas tabelas principais ==='
for t in crm_whatsapp_numbers crm_settings crm_profiles crm_contacts crm_messages crm_media_gc_queue crm_scheduled_messages crm_message_translations; do
  echo "-> $t"; q "VACUUM (ANALYZE) public.$t;"
done
q "VACUUM (ANALYZE) cron.job_run_details;"

echo '=== Teste de velocidade da lista de números ==='
q "EXPLAIN ANALYZE SELECT * FROM public.crm_whatsapp_numbers ORDER BY created_at LIMIT 50;"
echo 'Concluído.'
