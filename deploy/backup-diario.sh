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
# Só backups concluídos servem de base; pastas .tmp são cópias interrompidas.
ANTERIOR="$(find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.tmp' 2>/dev/null | sort | tail -1 || true)"
# Remove cópias interrompidas de dias anteriores antes de medir o espaço.
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*.tmp' -exec rm -rf {} + 2>/dev/null || true
trap 'st=$?; if [ $st -ne 0 ] && [ -d "$ALVO.tmp" ]; then rm -rf "$ALVO.tmp"; echo "✘ backup interrompido; cópia parcial removida"; fi' EXIT
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
# Mede antes quanto será copiado de verdade; se não couber com folga de
# 5 GB, pula as mídias para nunca encher o disco e derrubar o banco.
NOVOS_BYTES="$(rsync -a --delete --dry-run --stats "${LINK[@]}" "$STORAGE_SRC/" "$ALVO.tmp/storage/" 2>/dev/null \
  | awk -F: '/Total transferred file size/{gsub(/[^0-9]/,"",$2); print $2}' || true)"
LIVRE_B="$(( $(df -Pk "$DESTINO" | awk 'NR==2{print $4}') * 1024 ))"
FOLGA_B=$((5 * 1024 * 1024 * 1024))
if [ -z "$NOVOS_BYTES" ] || [ $((NOVOS_BYTES + FOLGA_B)) -gt "$LIVRE_B" ]; then
  echo "✘ mídias: copiar $(( ${NOVOS_BYTES:-0} / 1048576 )) MB deixaria menos de 5 GB livres — mídias puladas hoje, só o banco foi salvo"
  mkdir -p "$DESTINO/somente-banco"
  mv "$ALVO.tmp/banco.sql.gz" "$DESTINO/somente-banco/$DIA-banco.sql.gz"
  mv "$ALVO.tmp/roles.sql.gz" "$DESTINO/somente-banco/$DIA-roles.sql.gz"
  rm -rf "$ALVO.tmp"
  ls -1t "$DESTINO/somente-banco"/*-banco.sql.gz 2>/dev/null | tail -n +"$((MANTER + 1))" | while read -r v; do rm -f "$v" "${v%-banco.sql.gz}-roles.sql.gz"; done
  exit 0
fi
echo "· mídias novas a copiar: $(( NOVOS_BYTES / 1048576 )) MB"
rsync -a --delete "${LINK[@]}" "$STORAGE_SRC/" "$ALVO.tmp/storage/"
echo "✔ mídias: $(find "$ALVO.tmp/storage" -type f | wc -l) arquivos"

mv "$ALVO.tmp" "$ALVO"

# 3) Mantém só os últimos N dias
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.tmp' | sort | head -n -"$MANTER" | while read -r velho; do
  rm -rf "$velho" && echo "· removido backup antigo $(basename "$velho")"
done
rm -rf "$DESTINO"/*.tmp 2>/dev/null || true

echo "✔ concluído. Espaço total dos backups: $(du -sh "$DESTINO" | cut -f1)"
echo "  ⚠ o backup está no mesmo disco. Para ficar 100% seguro, copie de vez em quando para fora da VPS."
