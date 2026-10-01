#!/usr/bin/env bash
# Mede banco, arquivos, logs e backups. Executa apenas pedidos seguros criados
# pelo AdminCentral. Contatos, números, configurações, fluxos e templates não são tocados.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] || exit 0
set -a; . "$STACK/.env"; set +a

DB_CONT="${DB_CONT:-zapmro-db}"
ST_CONT="${ST_CONT:-zapmro-storage}"
DB_NAME="${POSTGRES_DB:-postgres}"
q() { docker exec -i "$DB_CONT" psql -U postgres -d "$DB_NAME" -At -c "$1"; }
bytes_dir() { [ -d "$1" ] && du -sb "$1" 2>/dev/null | awk '{print $1}' || echo 0; }

database_bytes="$(q "select pg_database_size(current_database())" 2>/dev/null || echo 0)"
storage_bytes="$(docker exec "$ST_CONT" du -sb /var/lib/storage 2>/dev/null | awk '{print $1}' || echo 0)"
docker_logs_bytes="$(du -cb /var/lib/docker/containers/*/*-json.log 2>/dev/null | tail -1 | cut -f1 || echo 0)"
backups_bytes="$(bytes_dir /var/backups/zapmro)"
root_total_bytes="$(df -B1 --output=size / | tail -1 | tr -d ' ')"
root_used_bytes="$(df -B1 --output=used / | tail -1 | tr -d ' ')"
root_available_bytes="$(df -B1 --output=avail / | tail -1 | tr -d ' ')"
docker_total_bytes="$(bytes_dir /var/lib/docker)"
project_bytes="$(bytes_dir "$ROOT")"
system_logs_bytes="$(bytes_dir /var/log)"

# Espaço órfão no disco: arquivo sem linha correspondente em storage.objects.
db_objects="$(mktemp)"; disk_objects="$(mktemp)"; trap 'rm -f "$db_objects" "$disk_objects"' EXIT
q "select bucket_id || '/' || name from storage.objects" 2>/dev/null | sort -u > "$db_objects"
docker exec "$ST_CONT" find /var/lib/storage -type f -mmin +120 -printf '%P\n' 2>/dev/null | sort -u > "$disk_objects" || true
orphan_disk_bytes=0
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  without_tenant="${rel#*/}"
  if ! grep -Fqx -- "$rel" "$db_objects" \
     && [ "$without_tenant" != "$rel" ] \
     && ! grep -Fqx -- "$without_tenant" "$db_objects" \
     && [[ "$without_tenant" == */* ]] \
     && [[ "$rel" != *.metadata ]]; then
    size="$(docker exec "$ST_CONT" stat -c %s "/var/lib/storage/$rel" 2>/dev/null || echo 0)"
    orphan_disk_bytes=$((orphan_disk_bytes + size))
  fi
done < "$disk_objects"

q "insert into public.crm_vps_storage_snapshots(database_bytes,storage_bytes,docker_logs_bytes,backups_bytes,orphan_disk_bytes,root_total_bytes,root_used_bytes,root_available_bytes,docker_total_bytes,project_bytes,system_logs_bytes,details) values (${database_bytes:-0},${storage_bytes:-0},${docker_logs_bytes:-0},${backups_bytes:-0},${orphan_disk_bytes:-0},${root_total_bytes:-0},${root_used_bytes:-0},${root_available_bytes:-0},${docker_total_bytes:-0},${project_bytes:-0},${system_logs_bytes:-0},jsonb_build_object('host',current_setting('server_version'),'measured_at',now())); select public.crm_refresh_customer_storage_snapshots(); delete from public.crm_vps_storage_snapshots where created_at < now() - interval '90 days';" >/dev/null

request_id="$(q "update public.crm_vps_maintenance_requests set status='running',started_at=now(),updated_at=now() where id=(select id from public.crm_vps_maintenance_requests where status='pending' order by requested_at for update skip locked limit 1) returning id" 2>/dev/null | head -1 || true)"
[ -n "$request_id" ] || exit 0

before=$((database_bytes + storage_bytes + docker_logs_bytes + backups_bytes))
if CONFIRMAR=1 IDADE_MIN=120 bash "$ROOT/deploy/limpar-armazenamento.sh" >/tmp/zapmro-storage-maintenance.log 2>&1; then
  curl -sS --max-time 300 -X POST \
    "${PUBLIC_API_URL:-http://localhost:${GATEWAY_PORT:-8000}}/functions/v1/media-gc" \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    --data '{"limit":1000}' >/dev/null 2>&1 || true
  # Backups automáticos são segurança, mas sem retenção viravam uma nova cópia
  # grande a cada atualização. Mantém os 7 mais recentes e nunca menos de 2.
  if [ -d /var/backups/zapmro ]; then
    mapfile -t old_backups < <(ls -1dt /var/backups/zapmro/* 2>/dev/null | tail -n +8 || true)
    [ "${#old_backups[@]}" -eq 0 ] || rm -rf -- "${old_backups[@]}"
  fi
  q "update public.crm_vps_maintenance_requests set status='completed',completed_at=now(),updated_at=now(),result=jsonb_build_object('monitored_bytes_before',$before) where id='$request_id'" >/dev/null
else
  safe_error="$(tail -n 5 /tmp/zapmro-storage-maintenance.log 2>/dev/null | tr '\n' ' ' | sed "s/'/''/g" | cut -c1-1000)"
  q "update public.crm_vps_maintenance_requests set status='failed',completed_at=now(),updated_at=now(),last_error='$safe_error' where id='$request_id'" >/dev/null
fi