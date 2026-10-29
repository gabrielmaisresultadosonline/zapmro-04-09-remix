#!/usr/bin/env bash
# liberar-espaco-diario.sh — roda todo dia (cron) e pode ser rodado na mão:
#   sudo bash deploy/liberar-espaco-diario.sh
# Mostra onde o disco está sendo usado e libera o que é seguro:
#  · backups de atualização antigos (cada atualização criava uma cópia
#    inteira do banco e nada apagava as antigas) — mantém os 3 mais recentes
#  · registros internos do banco e fila de arquivos já removidos
#  · arquivos de conversas apagadas (media-gc) e espaço morto do PostgreSQL
#  · logs do sistema e imagens Docker sem uso
# Não apaga contatos, fluxos, templates, conversas ativas nem volumes.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] && { set -a; . "$STACK/.env"; set +a; }
DB_CONT="${DB_CONT:-zapmro-db}"; ST_CONT="${ST_CONT:-zapmro-storage}"
q() { docker exec -i "$DB_CONT" psql -U postgres -d postgres -At -c "$1" 2>&1; }
used() { df -B1 --output=used / | tail -1 | tr -d ' '; }
mb() { echo "$(( ${1:-0} / 1024 / 1024 )) MB"; }

echo "== $(date '+%F %T') — liberar espaço =="
before="$(used)"
echo "-- Uso antes: $(mb "$before")"
du -sh /var/backups/zapmro /var/lib/docker /var/log 2>/dev/null
docker exec "$ST_CONT" du -sh /var/lib/storage 2>/dev/null | sed 's/^/arquivos (storage): /'
q "select 'banco: '||pg_size_pretty(pg_database_size('postgres'))"
q "select relname||': '||pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','cron','net','storage') order by pg_total_relation_size(c.oid) desc limit 10"
q "select 'fila de arquivos: '||status||' = '||count(*) from public.crm_media_gc_queue group by status"

# 1) backups de atualização: mantém os 3 mais novos
if [ -d /var/backups/zapmro ]; then
  mapfile -t old < <(ls -1dt /var/backups/zapmro/*/ 2>/dev/null | tail -n +4)
  [ "${#old[@]}" -eq 0 ] || { rm -rf -- "${old[@]}"; echo "✔ ${#old[@]} backups antigos removidos"; }
fi

# 2) faxina interna do banco
q "select public.crm_daily_storage_housekeeping()" | sed 's/^/✔ faxina do banco: /'

# 3) apaga os arquivos das conversas já apagadas (pela API de arquivos)
for i in 1 2 3 4 5; do
  curl -sS --max-time 300 -X POST "${PUBLIC_API_URL:-http://localhost:${GATEWAY_PORT:-8000}}/functions/v1/media-gc" \
    -H "apikey: ${ANON_KEY:-}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY:-}" \
    -H "Content-Type: application/json" --data '{"limit":1000}' >/dev/null 2>&1 || break
done
echo "✔ arquivos de conversas apagadas processados"

# 4) devolve espaço morto das tabelas que mais apagam (sem travar o CRM)
for t in public.crm_messages public.crm_media_gc_queue public.crm_media_assets cron.job_run_details net._http_response storage.objects; do
  q "VACUUM (ANALYZE) $t" >/dev/null
done
echo "✔ espaço morto do banco reaproveitado"

# 5) logs e Docker sem uso (nunca volumes)
command -v journalctl >/dev/null && journalctl --vacuum-size=200M >/dev/null 2>&1
find /var/log -type f \( -name '*.gz' -o -name '*.[0-9]' \) -mtime +7 -delete 2>/dev/null
for f in /var/lib/docker/containers/*/*-json.log; do
  [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 104857600 ] && : > "$f"
done
docker image prune -f >/dev/null 2>&1; docker builder prune -f >/dev/null 2>&1
echo "✔ logs e imagens sem uso limpos"

after="$(used)"
echo "-- Uso depois: $(mb "$after") (liberado: $(mb $(( before > after ? before - after : 0 ))))"
