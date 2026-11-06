#!/usr/bin/env bash
# Backup diário do banco e de TODAS as mídias do Storage, guardando 7 dias.
# As mídias usam cópias incrementais (rsync --link-dest): arquivos que não
# mudaram entre um dia e outro ocupam espaço uma vez só.
#
#   sudo bash deploy/backup-diario.sh            # roda agora
#   ls /var/backups/zapmro-diario                # backups existentes
#
# Restaurar (só se precisar):
#   banco : gunzip -c <dia>/banco.sql.gz | docker exec -i zapmro-db psql -U postgres
#   mídias: sudo rsync -a <dia>/storage/ /var/lib/docker/volumes/zapmro-postgres_storage-data/_data/
set -euo pipefail

DESTINO="${ZAPMRO_BACKUP_DIR:-/var/backups/zapmro-diario}"
MANTER="${ZAPMRO_BACKUP_DIAS:-7}"
LOG="/var/log/zapmro-backup.log"
mkdir -p "$DESTINO"
exec 9>"$DESTINO/.lock"
flock -n 9 || { echo "outro backup já está rodando"; exit 0; }
exec > >(tee -a "$LOG") 2>&1

DIA="$(date +%Y%m%d-%H%M)"
ALVO="$DESTINO/$DIA"
ANTERIOR="$(ls -1d "$DESTINO"/2* 2>/dev/null | sort | tail -1 || true)"
echo "══ $(date '+%F %T') backup diário → $ALVO"

command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq rsync >/dev/null; }

STORAGE_SRC="$(docker volume inspect zapmro-postgres_storage-data --format '{{.Mountpoint}}' 2>/dev/null || true)"
[ -n "$STORAGE_SRC" ] && [ -d "$STORAGE_SRC" ] || { echo "✘ pasta das mídias não encontrada"; exit 1; }

# Espaço: precisa caber o banco + as mídias novas, com folga de 3 GB.
LIVRE_KB="$(df -Pk "$DESTINO" | awk 'NR==2{print $4}')"
if [ "${LIVRE_KB:-0}" -lt $((3 * 1024 * 1024)) ]; then
  echo "✘ menos de 3 GB livres no disco — backup não foi feito (libere espaço)"; exit 1
fi

mkdir -p "$ALVO.tmp"

# 1) Banco
docker exec zapmro-db pg_dumpall -U postgres --globals-only | gzip -1 > "$ALVO.tmp/roles.sql.gz"
docker exec zapmro-db pg_dump -U postgres -d postgres | gzip -1 > "$ALVO.tmp/banco.sql.gz"
[ "$(stat -c %s "$ALVO.tmp/banco.sql.gz")" -gt 1048576 ] || { echo "✘ dump do banco muito pequeno — algo errado"; rm -rf "$ALVO.tmp"; exit 1; }
echo "✔ banco: $(du -h "$ALVO.tmp/banco.sql.gz" | cut -f1)"

# 2) Mídias (incremental)
LINK=()
[ -n "$ANTERIOR" ] && [ -d "$ANTERIOR/storage" ] && LINK=(--link-dest="$ANTERIOR/storage")
rsync -a --delete "${LINK[@]}" "$STORAGE_SRC/" "$ALVO.tmp/storage/"
echo "✔ mídias: $(find "$ALVO.tmp/storage" -type f | wc -l) arquivos"

mv "$ALVO.tmp" "$ALVO"

# 3) Mantém só os últimos N dias
ls -1d "$DESTINO"/2* 2>/dev/null | sort | head -n -"$MANTER" | while read -r velho; do
  rm -rf "$velho" && echo "· removido backup antigo $(basename "$velho")"
done
rm -rf "$DESTINO"/*.tmp 2>/dev/null || true

echo "✔ concluído. Espaço total dos backups: $(du -sh "$DESTINO" | cut -f1)"
echo "  ⚠ o backup está no mesmo disco. Para ficar 100% seguro, copie de vez em quando para fora da VPS."
