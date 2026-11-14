#!/usr/bin/env bash
# =============================================================================
#  restaurar-backup-b2.sh — confere e restaura a cópia que está FORA do servidor
#
#      sudo bash deploy/restaurar-backup-b2.sh                 # só mostra o que há
#      sudo bash deploy/restaurar-backup-b2.sh --banco <DATA>  # banco numa base nova
#      sudo bash deploy/restaurar-backup-b2.sh --midias        # mídias de volta
#      sudo bash deploy/restaurar-backup-b2.sh --tudo <DATA>   # os dois
#
#  <DATA> é o nome da pasta, ex.: 20261114-0330
#
#  --banco  : não mexe no banco em uso. Cria a base zapmro_restore e mostra os
#             comandos para trocar, depois de você conferir que está tudo lá.
#  --midias : substitui os arquivos do servidor pelos que estão no B2.
#             Só roda com CONFIRMAR=1.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_ENV="$ROOT/deploy/postgres-stack/.env"
[ -f "$STACK_ENV" ] || { echo "✘ não encontrei $STACK_ENV"; exit 1; }
set -a; . "$STACK_ENV"; set +a

BUCKET="${ZAPMRO_B2_BUCKET:-}"
KEY_ID="${ZAPMRO_B2_ACCOUNT_ID:-}"
APP_KEY="${ZAPMRO_B2_APPLICATION_KEY:-}"
EP="${ZAPMRO_B2_ENDPOINT:-s3.us-west.backblazeb2.com}"
[ -n "$BUCKET" ] && [ -n "$KEY_ID" ] && [ -n "$APP_KEY" ] \
  || { echo "✘ faltam ZAPMRO_B2_* no $STACK_ENV — rode sudo bash deploy/backup-b2-setup.sh"; exit 1; }
command -v rclone >/dev/null 2>&1 || { echo "✘ rclone não instalado — rode sudo bash deploy/backup-b2-setup.sh"; exit 1; }

rclone config create zapmro-b2 s3 provider Backblaze \
  access_key_id "$KEY_ID" secret_access_key "$APP_KEY" endpoint "$EP" >/dev/null 2>&1 || true
rclone lsf "zapmro-b2:$BUCKET" --max-depth 1 >/dev/null 2>&1 \
  || { echo "✘ sem acesso ao bucket $BUCKET ($EP). Confira a chave e a região."; exit 1; }
REMOTO="zapmro-b2:$BUCKET"

MODO="${1:-listar}"
DATA="${2:-}"

listar() {
  echo "── dumps do banco no B2 (mais novos no fim) ──"
  rclone lsf "$REMOTO/banco" --dirs-only 2>/dev/null | sort | tail -30 || echo "  (nenhum)"
  echo ""
  echo "── espelho das mídias ──"
  rclone size "$REMOTO/midias" 2>/dev/null || echo "  (ainda não há espelho)"
  echo ""
  echo "── espaço no servidor ──"
  df -h / | awk 'NR==2{print "  "$3" usados, "$4" livres ("$5")"}'
  echo ""
  echo "Restaurar: sudo bash deploy/restaurar-backup-b2.sh --banco <DATA>   (banco numa base nova)"
  echo "           sudo CONFIRMAR=1 bash deploy/restaurar-backup-b2.sh --midias"
}

restaurar_banco() {
  [ -n "$DATA" ] || { echo "✘ diga o dia: --banco 20261114-0330"; exit 1; }
  rclone lsf "$REMOTO/banco/$DATA/banco.sql.gz" >/dev/null 2>&1 \
    || { echo "✘ não encontrei banco/$DATA/banco.sql.gz"; listar; exit 1; }
  PASTA="/tmp/zapmro-restaurar-$DATA"
  mkdir -p "$PASTA"
  echo "· baixando o dump do banco"
  rclone copy "$REMOTO/banco/$DATA" "$PASTA" --s3-no-check-bucket --retries 3
  echo "· criando a base nova zapmro_restore (o banco em uso não é tocado)"
  docker exec -i zapmro-db psql -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='zapmro_restore' AND pid<>pg_backend_pid();
DROP DATABASE IF EXISTS zapmro_restore;
CREATE DATABASE zapmro_restore;
SQL
  echo "· restaurando (pode demorar alguns minutos)"
  gunzip -c "$PASTA/banco.sql.gz" | docker exec -i zapmro-db psql -U postgres -d zapmro_restore -q \
    || echo "! apareceram avisos; confira se as tabelas chegaram"
  echo ""
  echo "✔ restaurado em zapmro_restore. Conferir:"
  echo "   docker exec -it zapmro-db psql -U postgres -d zapmro_restore -c '\\dt'"
  echo "   docker exec -it zapmro-db psql -U postgres -d zapmro_restore -c 'select count(*) from crm_contacts'"
  echo ""
  echo "Se estiver tudo certo, para trocar pela base atual:"
  echo "   docker compose -f deploy/postgres-stack/docker-compose.yml stop auth rest realtime storage edge"
  echo "   docker exec -i zapmro-db psql -U postgres -d postgres <<'FIM'"
  echo "   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid();"
  echo "   ALTER DATABASE postgres RENAME TO postgres_antes;"
  echo "   ALTER DATABASE zapmro_restore RENAME TO postgres;"
  echo "   FIM"
  echo "   docker compose -f deploy/postgres-stack/docker-compose.yml up -d"
}

restaurar_midias() {
  [ "${CONFIRMAR:-0}" = "1" ] || { echo "✘ isso substitui os arquivos do servidor: rode com CONFIRMAR=1"; exit 1; }
  rclone size "$REMOTO/midias" >/dev/null 2>&1 || { echo "✘ não há espelho das mídias no B2"; exit 1; }
  STORAGE_SRC="$(docker volume inspect zapmro-postgres_storage-data --format '{{.Mountpoint}}' 2>/dev/null || true)"
  [ -n "$STORAGE_SRC" ] && [ -d "$STORAGE_SRC" ] || { echo "✘ pasta das mídias não encontrada"; exit 1; }
  REMOTE_COUNT="$(rclone size --json "$REMOTO/midias" 2>/dev/null | tr -d " \t" | grep -oE '"count":[0-9]+' | head -1 | cut -d: -f2 || true)"
  LOCAL_COUNT="$(find "$STORAGE_SRC" -type f 2>/dev/null | wc -l)"
  echo "· servidor: $LOCAL_COUNT arquivos · B2: ${REMOTE_COUNT:-?} arquivos"
  [ "${REMOTE_COUNT:-0}" -gt 0 ] || { echo "✘ espelho vazio no B2 — nada para restaurar"; exit 1; }
  echo "· copiando as mídias do B2 para o servidor"
  rclone sync "$REMOTO/midias/" "$STORAGE_SRC/" \
    --s3-no-check-bucket --fast-list \
    --transfers 4 --checkers 8 --bwlimit "${ZAPMRO_BACKUP_BWLIMIT:-20M}" \
    --timeout 60s --retries 3 --low-level-retries 10 \
    --stats-one-line --stats 120s
  echo "✔ mídias restauradas. Confira no CRM se as fotos e vídeos abrem."
}

case "$MODO" in
  listar)   listar ;;
  --banco)  restaurar_banco ;;
  --midias) restaurar_midias ;;
  --tudo)   restaurar_banco; restaurar_midias ;;
  *)        echo "✘ não entendi '$MODO'"; listar ;;
esac
