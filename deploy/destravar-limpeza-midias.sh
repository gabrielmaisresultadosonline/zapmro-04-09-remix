#!/usr/bin/env bash
set -euo pipefail
# Interrompe APENAS consultas antigas de seleção de órfãos. Não apaga dados.
DB_CONTAINER="${DB_CONTAINER:-zapmro-db}"
docker exec -i "$DB_CONTAINER" psql -U postgres -d "${POSTGRES_DB:-postgres}" -X -v ON_ERROR_STOP=1 <<'SQL'
SELECT pid, now()-query_start AS duracao, wait_event_type, wait_event
FROM pg_stat_activity
WHERE state='active' AND query LIKE '%"public"."crm_incoming_media_expired_batch"%'
ORDER BY query_start;
SELECT pg_cancel_backend(pid) AS consulta_interrompida
FROM pg_stat_activity
WHERE pid<>pg_backend_pid() AND state='active'
  AND query LIKE '%"public"."crm_incoming_media_expired_batch"%'
  AND query_start<clock_timestamp()-interval '30 seconds';
SQL
printf '\nConsultas antigas interrompidas; aplique atualizar.sh para instalar a proteção permanente.\n'