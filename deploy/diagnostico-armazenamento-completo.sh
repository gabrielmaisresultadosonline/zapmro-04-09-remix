#!/usr/bin/env bash
# Diagnóstico SOMENTE LEITURA do armazenamento da VPS.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
if [ ! -f "$STACK/.env" ]; then
  echo "ERRO: $STACK/.env não encontrado." >&2
  exit 1
fi
set -a; . "$STACK/.env"; set +a
DB_CONT="${DB_CONT:-zapmro-db}"
DB_NAME="${POSTGRES_DB:-postgres}"
q() { docker exec -i "$DB_CONT" psql -U postgres -d "$DB_NAME" "$@"; }

echo "============================================================"
echo " DIAGNÓSTICO COMPLETO DE ARMAZENAMENTO — SOMENTE LEITURA"
echo " Data UTC: $(date -u '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"
echo
echo "[1/8] Discos e partições"
df -hT
echo
echo "[2/8] Maiores diretórios da raiz (não atravessa outros discos)"
du -xhd1 / 2>/dev/null | sort -h | tail -n 25
echo
echo "[3/8] Detalhe de /var"
du -xhd2 /var 2>/dev/null | sort -h | tail -n 30
echo
echo "[4/8] Docker — imagens, containers, volumes e cache"
docker system df -v 2>/dev/null || true
echo
echo "[5/8] Maiores logs de containers"
du -ah /var/lib/docker/containers/*/*-json.log 2>/dev/null | sort -h | tail -n 30 || true
echo
echo "[6/8] Arquivos apagados que continuam abertos por processos"
if command -v lsof >/dev/null 2>&1; then
  lsof +L1 2>/dev/null | awk 'NR==1 || $7 ~ /^[0-9]+$/' | sort -k7 -n | tail -n 30 || true
else
  echo "lsof não instalado; rode: sudo apt-get install -y lsof"
fi
echo
echo "[7/8] Banco PostgreSQL — bases e maiores tabelas/índices"
q -P pager=off -c "SELECT datname AS banco, pg_size_pretty(pg_database_size(datname)) AS tamanho FROM pg_database ORDER BY pg_database_size(datname) DESC;"
q -P pager=off -c "SELECT schemaname||'.'||relname AS tabela, pg_size_pretty(pg_total_relation_size(relid)) AS total, pg_size_pretty(pg_relation_size(relid)) AS dados, pg_size_pretty(pg_indexes_size(relid)) AS indices FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 40;"
echo
echo "[8/8] Backups, projeto e arquivos grandes"
du -sh /var/backups/zapmro "$ROOT" 2>/dev/null || true
find /var /opt /home "$ROOT" -xdev -type f -size +250M -printf '%s %p\n' 2>/dev/null | sort -n | tail -n 40 | awk '{size=$1; $1=""; printf "%.2f GB%s\n", size/1073741824, $0}' || true
echo
echo "Diagnóstico concluído. Nenhum arquivo ou registro foi apagado."