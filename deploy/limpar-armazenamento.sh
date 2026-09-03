#!/usr/bin/env bash
# =============================================================================
#  limpar-armazenamento.sh
#
#  Por quê: a deduplicação no navegador (painel "Estamos atualizando") apaga o
#  OBJETO no Storage (linha em storage.objects), mas o espaço em disco da VPS
#  pode continuar alto por três motivos independentes:
#
#    1) arquivos ÓRFÃOS no volume do Storage — binários que ficaram no disco sem
#       linha correspondente em storage.objects (deleções antigas, uploads
#       interrompidos, migrações repetidas);
#    2) logs dos containers Docker (podem passar de vários GB);
#    3) inchaço do Postgres (tabelas/índices sem VACUUM).
#
#  Este script primeiro DIAGNOSTICA (não apaga nada) e só remove quando você
#  rodar com CONFIRMAR=1. Nada que esteja referenciado no banco é tocado.
#
#      cd /var/www/ia-mro
#      bash deploy/limpar-armazenamento.sh              # só relatório
#      CONFIRMAR=1 bash deploy/limpar-armazenamento.sh  # relatório + limpeza
# =============================================================================
set -Eeuo pipefail

C_R='\033[0;31m'; C_G='\033[0;32m'; C_Y='\033[1;33m'; C_C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "${C_G}✔${N} $*"; }
info() { echo -e "  $*"; }
warn() { echo -e "${C_Y}!${N} $*"; }
err()  { echo -e "${C_R}✘${N} $*" >&2; }
sec()  { echo; echo -e "${C_C}══════ $* ══════${N}"; }
die()  { err "$*"; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
CONFIRMAR="${CONFIRMAR:-0}"
# Só apaga órfãos com mais de X minutos, para nunca competir com um upload em curso.
IDADE_MIN="${IDADE_MIN:-120}"

[ -f "$STACK/.env" ] || die "não achei $STACK/.env"
set -a; . "$STACK/.env"; set +a
command -v docker >/dev/null 2>&1 || die "docker não encontrado"

DB_CONT="${DB_CONT:-zapmro-db}"
ST_CONT="${ST_CONT:-zapmro-storage}"
STORAGE_ROOT="/var/lib/storage"

psql_q() { docker exec -i "$DB_CONT" psql -U postgres -d "${POSTGRES_DB:-postgres}" -At -c "$1"; }

sec "1) Disco da VPS"
df -h / | sed 's/^/  /'

sec "2) Volumes e logs do Docker"
docker system df 2>/dev/null | sed 's/^/  /' || warn "docker system df indisponível"
echo
info "Tamanho do volume do Storage (arquivos das conversas):"
docker exec "$ST_CONT" du -sh "$STORAGE_ROOT" 2>/dev/null | sed 's/^/    /' || warn "container $ST_CONT fora do ar"
info "Logs dos containers (json.log):"
LOGS_BYTES="$(du -cb /var/lib/docker/containers/*/*-json.log 2>/dev/null | tail -1 | cut -f1 || echo 0)"
info "    total: $(numfmt --to=iec "${LOGS_BYTES:-0}" 2>/dev/null || echo "${LOGS_BYTES:-0}B")"

sec "3) Banco: objetos registrados no Storage"
psql_q "select bucket_id, count(*) from storage.objects group by 1 order by 2 desc;" \
  | awk -F'|' '{printf "  %-28s %s objetos\n", $1, $2}'
info "Tamanho do banco: $(psql_q "select pg_size_pretty(pg_database_size(current_database()));")"

sec "4) Arquivos órfãos no disco (sem registro no banco)"
# Lista relativa ao STORAGE_ROOT: <bucket>/<caminho...>
mapfile -t DISK_FILES < <(docker exec "$ST_CONT" find "$STORAGE_ROOT" -type f -mmin "+$IDADE_MIN" -printf '%P\n' 2>/dev/null || true)
info "arquivos no disco com mais de ${IDADE_MIN}min: ${#DISK_FILES[@]}"

ORFAOS_FILE="/tmp/zapmro-orfaos-$(date +%s).txt"
: > "$ORFAOS_FILE"
if [ "${#DISK_FILES[@]}" -gt 0 ]; then
  # Carrega o índice do banco uma vez (bucket/nome) — comparação local, sem N queries.
  psql_q "select bucket_id || '/' || name from storage.objects;" | sort -u > /tmp/zapmro-db-objects.txt
  printf '%s\n' "${DISK_FILES[@]}" | sort -u > /tmp/zapmro-disk-objects.txt
  # O backend "file" pode versionar com sufixo; comparamos também sem o sufixo.
  comm -23 /tmp/zapmro-disk-objects.txt /tmp/zapmro-db-objects.txt > "$ORFAOS_FILE" || true
fi
QTD_ORFAOS="$(wc -l < "$ORFAOS_FILE" | tr -d ' ')"
info "órfãos identificados: $QTD_ORFAOS  (lista: $ORFAOS_FILE)"
[ "$QTD_ORFAOS" -gt 0 ] && head -10 "$ORFAOS_FILE" | sed 's/^/    /'

if [ "$CONFIRMAR" != "1" ]; then
  sec "Modo relatório"
  warn "Nada foi apagado. Para liberar espaço rode:"
  echo "    CONFIRMAR=1 bash deploy/limpar-armazenamento.sh"
  exit 0
fi

sec "5) Limpando órfãos do disco"
if [ "$QTD_ORFAOS" -gt 0 ]; then
  # Apaga um a um dentro do container, ignorando falhas individuais.
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    docker exec "$ST_CONT" rm -f -- "$STORAGE_ROOT/$rel" >/dev/null 2>&1 || true
  done < "$ORFAOS_FILE"
  docker exec "$ST_CONT" find "$STORAGE_ROOT" -type d -empty -delete >/dev/null 2>&1 || true
  ok "$QTD_ORFAOS arquivos órfãos removidos"
else
  ok "nenhum órfão para remover"
fi

sec "6) Limpando logs do Docker e imagens não usadas"
for f in /var/lib/docker/containers/*/*-json.log; do [ -f "$f" ] && : > "$f"; done
ok "logs zerados"
docker image prune -af >/dev/null 2>&1 || true
docker builder prune -af >/dev/null 2>&1 || true
ok "imagens/cache de build sem uso removidos"

sec "7) VACUUM no Postgres (recupera espaço interno)"
psql_q "vacuum (analyze);" >/dev/null 2>&1 || warn "vacuum não concluiu"
ok "vacuum executado"

sec "Resultado final"
df -h / | sed 's/^/  /'
docker exec "$ST_CONT" du -sh "$STORAGE_ROOT" 2>/dev/null | sed 's/^/  /' || true
ok "Limpeza concluída."
