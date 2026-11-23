#!/usr/bin/env bash
# =============================================================================
#  backup-diario.sh — backup SÓ DO BANCO (cadastros, usuários, números,
#  conversas, fluxos, templates, configurações). Mídias NÃO são copiadas.
#
#      sudo bash deploy/backup-diario.sh
#
#  NO SERVIDOR (/var/backups/zapmro-diario): guarda só o último dia
#  (ZAPMRO_BACKUP_DIAS, padrão 1). Pastas antigas com cópia de mídias
#  são apagadas automaticamente.
#  FORA (Backblaze B2, se as chaves estiverem no .env): só o dump do banco,
#  guardando ZAPMRO_BACKUP_REMOTO_DIAS dias (padrão 14).
#
#  Restaurar: gunzip -c <dia>/banco.sql.gz | docker exec -i zapmro-db psql -U postgres
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_ENV="$ROOT/deploy/postgres-stack/.env"
if [ -f "$STACK_ENV" ]; then set -a; . "$STACK_ENV"; set +a; fi

DESTINO="${ZAPMRO_BACKUP_DIR:-/var/backups/zapmro-diario}"
LOG="/var/log/zapmro-backup.log"
mkdir -p "$DESTINO"
exec 9>"$DESTINO/.lock"
flock -n 9 || { echo "outro backup já está rodando"; exit 0; }
exec > >(tee -a "$LOG") 2>&1

echo "══ $(date '+%F %T') backup diário (só banco)"

MANTER="${ZAPMRO_BACKUP_DIAS:-1}"
[ "$MANTER" -ge 1 ] 2>/dev/null || MANTER=1
REMOTO_DIAS="${ZAPMRO_BACKUP_REMOTO_DIAS:-14}"

REMOTO=""
B2_BUCKET="${ZAPMRO_B2_BUCKET:-}"
if command -v rclone >/dev/null 2>&1 \
   && [ -n "${ZAPMRO_B2_ACCOUNT_ID:-}" ] && [ -n "${ZAPMRO_B2_APPLICATION_KEY:-}" ] && [ -n "$B2_BUCKET" ] \
   && rclone lsf "zapmro-b2:$B2_BUCKET" --max-depth 1 >/dev/null 2>&1; then
  REMOTO="zapmro-b2:$B2_BUCKET"
fi

DIA="$(date +%Y%m%d-%H%M)"
ALVO="$DESTINO/$DIA"
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*.tmp' -exec rm -rf {} + 2>/dev/null || true
trap 'st=$?; if [ $st -ne 0 ] && [ -d "$ALVO.tmp" ]; then rm -rf "$ALVO.tmp"; echo "✘ backup interrompido; cópia parcial removida"; fi' EXIT

LIVRE_KB="$(df -Pk "$DESTINO" | awk 'NR==2{print $4}')"
if [ "${LIVRE_KB:-0}" -lt $((2 * 1024 * 1024)) ]; then
  echo "✘ menos de 2 GB livres — backup não foi feito"; exit 1
fi

mkdir -p "$ALVO.tmp"
docker exec zapmro-db pg_dumpall -U postgres --globals-only | gzip -1 > "$ALVO.tmp/roles.sql.gz"
docker exec zapmro-db pg_dump -U postgres -d postgres | gzip -1 > "$ALVO.tmp/banco.sql.gz"
[ "$(stat -c %s "$ALVO.tmp/banco.sql.gz")" -gt 1048576 ] || { echo "✘ dump do banco muito pequeno — algo errado"; exit 1; }
mv "$ALVO.tmp" "$ALVO"
echo "✔ banco: $(du -h "$ALVO/banco.sql.gz" | cut -f1)"

if [ -n "$REMOTO" ]; then
  rclone copyto "$ALVO/banco.sql.gz" "$REMOTO/banco/$DIA/banco.sql.gz" --s3-no-check-bucket --retries 3 \
    && rclone copyto "$ALVO/roles.sql.gz" "$REMOTO/banco/$DIA/roles.sql.gz" --s3-no-check-bucket --retries 3 \
    && echo "✔ banco no B2: banco/$DIA" || echo "! banco não subiu para o B2 hoje"
  rclone delete "$REMOTO/banco" --min-age "${REMOTO_DIAS}d" --rmdirs --s3-no-check-bucket 2>/dev/null || true
fi

# Só depois do banco salvo: mantém os últimos N dias e apaga o resto
# (inclui cópias antigas de mídias e a pasta somente-banco).
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.tmp' | sort | head -n -"$MANTER" | while read -r velho; do
  rm -rf "$velho" && echo "· removido backup antigo $(basename "$velho")"
done
for d in "$DESTINO"/2*/storage; do [ -d "$d" ] && rm -rf "$d" && echo "· cópia de mídias removida: $d"; done
rm -rf "$DESTINO/somente-banco" 2>/dev/null || true

echo "✔ concluído. Espaço do backup: $(du -sh "$DESTINO" | cut -f1)"
