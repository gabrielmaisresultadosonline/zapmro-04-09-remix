#!/usr/bin/env bash
# =============================================================================
#  backup-antes-de-atualizar.sh — snapshot COMPLETO antes de qualquer update
#
#      cd /var/www/ia-mro && ./deploy/backup-antes-de-atualizar.sh
#
#  Salva em /var/backups/zapmro/<data-hora>/ :
#    · banco.sql.gz  → dump completo (todos os schemas: public, auth, storage…)
#    · env/          → .env e secrets.env da stack (tokens, chaves, senhas)
#    · volumes.txt   → lista dos volumes docker (nada é apagado)
#  Não altera nada no servidor: só lê e copia.
# =============================================================================
set -Eeuo pipefail

C_G='\033[0;32m'; C_Y='\033[1;33m'; C_R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${C_G}✔${N} $*"; }
warn() { echo -e "${C_Y}!${N} $*"; }
die()  { echo -e "${C_R}✘${N} $*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] || die "não encontrei $STACK/.env — rode este script na pasta do projeto na VPS"

set -a; . "$STACK/.env"; set +a

DEST="/var/backups/zapmro/$(date +%Y%m%d-%H%M%S)"
sudo_() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
sudo_ mkdir -p "$DEST/env"
sudo_ chown "$(id -u):$(id -g)" "$DEST" "$DEST/env"

# ---- 1) tokens e configuração ------------------------------------------------
# Estes arquivos são copiados antes do banco para que uma falha do container
# nunca impeça o backup das credenciais existentes.
cp "$STACK/.env" "$DEST/env/postgres-stack.env"
[ -f "$STACK/secrets.env" ] && cp "$STACK/secrets.env" "$DEST/env/secrets.env"
[ -f "$ROOT/.env" ]         && cp "$ROOT/.env" "$DEST/env/raiz.env"
chmod -R 600 "$DEST/env"/* || true
ok "tokens e chaves copiados para $DEST/env/"

# ---- 2) banco completo -------------------------------------------------------
db_status() {
  docker inspect --format '{{.State.Status}}' zapmro-db 2>/dev/null || printf 'ausente'
}

db_ready() {
  [ "$(db_status)" = "running" ] \
    && docker exec zapmro-db pg_isready -U postgres >/dev/null 2>&1
}

wait_for_db() {
  local attempt
  for attempt in $(seq 1 60); do
    if db_ready; then
      # Evita a janela em que o container responde e reinicia logo em seguida.
      sleep 2
      db_ready && return 0
    fi
    [ "$attempt" -eq 1 ] || [ $((attempt % 10)) -ne 0 ] \
      || warn "aguardando PostgreSQL ficar estável (${attempt}/60; estado: $(db_status))"
    sleep 2
  done
  return 1
}

if ! wait_for_db; then
  warn "PostgreSQL não ficou pronto; tentando subir somente o serviço do banco"
  (cd "$STACK" && docker compose up -d db) || true
fi

if ! wait_for_db; then
  warn "estado do zapmro-db: $(db_status)"
  docker logs --tail 40 zapmro-db 2>&1 | sed 's/^/    /' >&2 || true
  die "PostgreSQL continua reiniciando; tokens foram salvos, nada foi alterado e a atualização foi bloqueada"
fi

dump_tmp="$DEST/banco.sql.gz.incompleto"
dump_ok=0
for attempt in 1 2 3; do
  rm -f "$dump_tmp"
  if docker exec zapmro-db pg_dumpall -U postgres --clean --if-exists \
      | gzip > "$dump_tmp" && [ -s "$dump_tmp" ]; then
    mv "$dump_tmp" "$DEST/banco.sql.gz"
    dump_ok=1
    break
  fi
  rm -f "$dump_tmp"
  warn "dump não concluiu (tentativa ${attempt}/3; estado: $(db_status))"
  [ "$attempt" -eq 3 ] || wait_for_db || true
done

if [ "$dump_ok" -ne 1 ]; then
  docker logs --tail 40 zapmro-db 2>&1 | sed 's/^/    /' >&2 || true
  die "não foi possível criar um dump válido; backup incompleto removido e atualização bloqueada"
fi
ok "dump do banco: $DEST/banco.sql.gz ($(du -h "$DEST/banco.sql.gz" | cut -f1))"

# ---- 3) inventário -----------------------------------------------------------
docker volume ls > "$DEST/volumes.txt" 2>/dev/null || true
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$DEST/containers.txt" 2>/dev/null || true
psql "postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${PG_PORT:-5432}/${POSTGRES_DB:-postgres}" \
  -tAc "select table_name||' = '||(xpath('/r/text()', query_to_xml(format('select count(*) from public.%I', table_name), false, true, '')))[1]::text
        from information_schema.tables where table_schema='public' order by table_name" \
  > "$DEST/contagens.txt" 2>/dev/null || warn "não consegui gerar contagens (opcional)"

ok "backup concluído em $DEST"
echo
echo "Para restaurar (só se precisar):"
echo "  gunzip -c $DEST/banco.sql.gz | docker exec -i zapmro-db psql -U postgres"
