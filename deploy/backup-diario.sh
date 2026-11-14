#!/usr/bin/env bash
# =============================================================================
#  backup-diario.sh — backup do banco + mídias, dentro e FORA do servidor
#
#      sudo bash deploy/backup-diario.sh          # roda agora
#      sudo bash deploy/backup-b2-setup.sh        # configura o B2 uma vez
#      sudo bash deploy/restaurar-backup-b2.sh    # confere / restaura de fora
#
#  NO SERVIDOR (/var/backups/zapmro-diario):
#    · guarda os últimos 2 dias (7 quando o backup remoto ainda não foi
#      configurado, para nunca ficar sem nenhuma cópia local)
#    · mídias em cópias incrementais (rsync --link-dest): o que não mudou
#      entre um dia e outro ocupa espaço uma vez só
#
#  FORA DO SERVIDOR (Backblaze B2, se as chaves estiverem no .env):
#    · banco/<data>/banco.sql.gz + roles.sql.gz  → dump de todo dia,
#      guardando ZAPMRO_BACKUP_REMOTO_DIAS dias (padrão 14)
#    · midias/  → espelho do volume de mídias; só envia o que mudou
#
#  Restaurar à mão (só se precisar):
#    banco : gunzip -c <dia>/banco.sql.gz | docker exec -i zapmro-db psql -U postgres
#    mídias: sudo rsync -a <dia>/storage/ /var/lib/docker/volumes/zapmro-postgres_storage-data/_data/
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

echo "══ $(date '+%F %T') backup diário"

# -----------------------------------------------------------------------------
# 0) Backup remoto (Backblaze B2) configurado?
# -----------------------------------------------------------------------------
REMOTO=""
B2_BUCKET="${ZAPMRO_B2_BUCKET:-}"
if command -v rclone >/dev/null 2>&1 \
   && [ -n "${ZAPMRO_B2_ACCOUNT_ID:-}" ] && [ -n "${ZAPMRO_B2_APPLICATION_KEY:-}" ] && [ -n "$B2_BUCKET" ]; then
  if rclone lsf "zapmro-b2:$B2_BUCKET" --max-depth 1 >/dev/null 2>&1; then
    REMOTO="zapmro-b2:$B2_BUCKET"
    echo "· backup remoto: $B2_BUCKET (Backblaze B2)"
  else
    echo "! backup remoto configurado mas sem acesso — rode: sudo bash deploy/backup-b2-setup.sh"
  fi
fi

# No servidor ficam sempre 2 dias; a retenção longa fica na cópia fora (B2).
MANTER="${ZAPMRO_BACKUP_DIAS:-2}"
REMOTO_DIAS="${ZAPMRO_BACKUP_REMOTO_DIAS:-14}"

DIA="$(date +%Y%m%d-%H%M)"
ALVO="$DESTINO/$DIA"
# Só backups concluídos servem de base; pastas .tmp são cópias interrompidas.
ANTERIOR="$(find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.tmp' 2>/dev/null | sort | tail -1 || true)"
# Remove cópias interrompidas de dias anteriores antes de medir o espaço.
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*.tmp' -exec rm -rf {} + 2>/dev/null || true
trap 'st=$?; if [ $st -ne 0 ] && [ -d "$ALVO.tmp" ]; then rm -rf "$ALVO.tmp"; echo "✘ backup interrompido; cópia parcial removida"; fi' EXIT

command -v rsync >/dev/null || { apt-get update -qq && apt-get install -y -qq rsync >/dev/null; }

STORAGE_SRC="$(docker volume inspect zapmro-postgres_storage-data --format '{{.Mountpoint}}' 2>/dev/null || true)"
[ -n "$STORAGE_SRC" ] && [ -d "$STORAGE_SRC" ] || { echo "✘ pasta das mídias não encontrada"; exit 1; }

# Espaço: precisa caber o banco + as mídias novas, com folga de 3 GB.
LIVRE_KB="$(df -Pk "$DESTINO" | awk 'NR==2{print $4}')"
if [ "${LIVRE_KB:-0}" -lt $((3 * 1024 * 1024)) ]; then
  echo "✘ menos de 3 GB livres no disco — backup não foi feito (libere espaço)"; exit 1
fi

mkdir -p "$ALVO.tmp"

# -----------------------------------------------------------------------------
# 1) Banco
# -----------------------------------------------------------------------------
docker exec zapmro-db pg_dumpall -U postgres --globals-only | gzip -1 > "$ALVO.tmp/roles.sql.gz"
docker exec zapmro-db pg_dump -U postgres -d postgres | gzip -1 > "$ALVO.tmp/banco.sql.gz"
[ "$(stat -c %s "$ALVO.tmp/banco.sql.gz")" -gt 1048576 ] || { echo "✘ dump do banco muito pequeno — algo errado"; rm -rf "$ALVO.tmp"; exit 1; }
echo "✔ banco: $(du -h "$ALVO.tmp/banco.sql.gz" | cut -f1)"

# -----------------------------------------------------------------------------
# 2) Mídias no servidor (incremental)
# -----------------------------------------------------------------------------
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
  if [ -n "$REMOTO" ]; then
    rclone copyto "$DESTINO/somente-banco/$DIA-banco.sql.gz" "$REMOTO/banco/$DIA/banco.sql.gz" --s3-no-check-bucket --retries 3 || echo "! banco não subiu para o B2 hoje"
    rclone copyto "$DESTINO/somente-banco/$DIA-roles.sql.gz" "$REMOTO/banco/$DIA/roles.sql.gz" --s3-no-check-bucket --retries 3 || true
  fi
  rm -rf "$ALVO.tmp"
  ls -1t "$DESTINO/somente-banco"/*-banco.sql.gz 2>/dev/null | tail -n +"$((MANTER + 1))" | while read -r v; do rm -f "$v" "${v%-banco.sql.gz}-roles.sql.gz"; done
  exit 0
fi
echo "· mídias novas a copiar: $(( NOVOS_BYTES / 1048576 )) MB"
rsync -a --delete "${LINK[@]}" "$STORAGE_SRC/" "$ALVO.tmp/storage/"
echo "✔ mídias: $(find "$ALVO.tmp/storage" -type f | wc -l) arquivos"

mv "$ALVO.tmp" "$ALVO"

# -----------------------------------------------------------------------------
# 3) Cópia para fora (Backblaze B2)
# -----------------------------------------------------------------------------
if [ -n "$REMOTO" ]; then
  # 3a) dump do banco do dia
  if rclone copyto "$ALVO/banco.sql.gz" "$REMOTO/banco/$DIA/banco.sql.gz" --s3-no-check-bucket --retries 3; then
    rclone copyto "$ALVO/roles.sql.gz" "$REMOTO/banco/$DIA/roles.sql.gz" --s3-no-check-bucket --retries 3 || true
    echo "✔ banco no B2: banco/$DIA"
  else
    echo "! banco não subiu para o B2 hoje (rede?); a cópia local continua salva"
  fi

  # 3b) espelho das mídias — só envia o que mudou.
  # Trava de segurança: se o tanto de arquivo sumiu do servidor, não apaga fora.
  LOCAL_COUNT="$(find "$STORAGE_SRC" -type f 2>/dev/null | wc -l)"
  REMOTE_COUNT="$(rclone size --json "$REMOTO/midias" 2>/dev/null | tr -d " \t" | grep -oE '"count":[0-9]+' | head -1 | cut -d: -f2 || true)"
  if [ "${LOCAL_COUNT:-0}" -eq 0 ]; then
    echo "! espelho das mídias pulado: nada para enviar"
  elif [ -n "$REMOTE_COUNT" ] && [ "$REMOTE_COUNT" -gt 0 ] && [ "$((LOCAL_COUNT * 2))" -lt "$REMOTE_COUNT" ]; then
    echo "! espelho das mídias pulado: servidor tem $LOCAL_COUNT arquivos e o B2 tem $REMOTE_COUNT — confira antes de sincronizar"
  else
    echo "· espelhando mídias no B2 (só o que mudou)"
    rclone sync "$STORAGE_SRC/" "$REMOTO/midias" \
      --s3-no-check-bucket --fast-list \
      --transfers 4 --checkers 8 --bwlimit "${ZAPMRO_BACKUP_BWLIMIT:-20M}" \
      --timeout 60s --retries 3 --low-level-retries 10 \
      --stats-one-line --stats 120s \
      && echo "✔ mídias espelhadas no B2" \
      || echo "! espelho das mídias falhou hoje; a cópia local continua salva"
  fi

  # 3c) mantém só os últimos N dias de dump de banco fora
  rclone delete "$REMOTO/banco" --min-age "${REMOTO_DIAS}d" --rmdirs --s3-no-check-bucket 2>/dev/null \
    && echo "· dumps do banco no B2: guardando os últimos $REMOTO_DIAS dias" || true
fi

# -----------------------------------------------------------------------------
# 4) Mantém só os últimos N dias no servidor
# -----------------------------------------------------------------------------
find "$DESTINO" -mindepth 1 -maxdepth 1 -type d -name '2*' ! -name '*.tmp' | sort | head -n -"$MANTER" | while read -r velho; do
  rm -rf "$velho" && echo "· removido backup antigo $(basename "$velho")"
done
rm -rf "$DESTINO"/*.tmp 2>/dev/null || true

echo "✔ concluído. Espaço no servidor: $(du -sh "$DESTINO" | cut -f1) ($MANTER dias)"
[ -n "$REMOTO" ] && echo "  cópia fora do servidor: $B2_BUCKET (banco $REMOTO_DIAS dias + espelho das mídias)"
