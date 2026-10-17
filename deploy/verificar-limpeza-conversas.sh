#!/usr/bin/env bash
# Somente leitura. Não imprime headers/chaves dos jobs nem altera dados.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] || { echo 'Configuração da VPS não encontrada.' >&2; exit 1; }
set -a; . "$STACK/.env"; set +a
q() { docker exec -i "${DB_CONT:-zapmro-db}" psql -U postgres -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 -c "$1"; }
echo '=== Espaço físico da VPS ==='
df -h /
docker exec "${ST_CONT:-zapmro-storage}" du -sh /var/lib/storage
echo '=== Agendamento (retenção horária; arquivos a cada 5 minutos) ==='
q "SELECT jobname,schedule,active FROM cron.job WHERE jobname IN ('inactive-history-cleanup-daily','media-gc-daily');"
echo '=== Conversas elegíveis: 7 dias sem mensagem recebida ou enviada ==='
q "SELECT count(*) AS historicos_inativos FROM (SELECT contact_id FROM public.crm_messages WHERE contact_id IS NOT NULL GROUP BY contact_id HAVING max(created_at)<now()-interval '7 days') x;"
echo '=== Fila de arquivos e falhas que serão repetidas ==='
q "SELECT status,count(*) AS arquivos,count(*) FILTER(WHERE purge_after<=now()) AS vencidos FROM public.crm_media_gc_queue GROUP BY status;"
echo '=== Últimas execuções do agendador (não confirma por si só a remoção física) ==='
q "SELECT j.jobname,r.status,r.start_time,r.end_time FROM cron.job_run_details r JOIN cron.job j ON j.jobid=r.jobid WHERE j.jobname IN ('inactive-history-cleanup-daily','media-gc-daily') ORDER BY r.start_time DESC LIMIT 12;"
echo '=== Banco: espaço reutilizável após apagar mensagens ==='
q "SELECT pg_size_pretty(pg_database_size(current_database())) AS banco; SELECT relname,n_dead_tup,last_autovacuum FROM pg_stat_user_tables WHERE relname IN ('crm_messages','crm_media_assets','crm_media_gc_queue');"
echo '=== Resultado recente da limpeza física ==='
# Não mostra logs de outras funções: evita dados privados e tokens.
docker logs --since 30m --tail 500 "${FUNCTIONS_CONT:-zapmro-functions}" 2>&1 | grep -E '\[MEDIA-GC\] (itens vencidos|concluído|erro geral)' || true
