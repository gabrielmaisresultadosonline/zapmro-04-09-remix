#!/usr/bin/env bash
# Diagnóstico SOMENTE LEITURA das chaves da OpenAI usadas pelo Agente I.A.
# e pelo "Gerar prompt pelos meus atendimentos". Nunca imprime a chave.
# Uso: sudo bash deploy/diagnosticar-chave-openai.sh email@do.cadastro
set -uo pipefail
export PAGER=cat PSQL_PAGER=cat LESS=FRX

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "Uso: $0 <email do cadastro>"
  exit 1
fi
EMAIL_SQL="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9@._+-')"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
carregar() { [ -f "$1" ] || return 0; set -a; source "$1"; set +a; }
carregar "$ROOT/deploy/postgres-stack/.env"
carregar "$ROOT/deploy/postgres-stack/secrets.env"

DB_CONTAINER="${DB_CONTAINER:-zapmro-db}"
FN_CONTAINER="${FN_CONTAINER:-zapmro-functions}"
PGDB="${POSTGRES_DB:-postgres}"
PGUSER_="${POSTGRES_USER:-postgres}"
PGPASS="${POSTGRES_PASSWORD:-}"

ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
erro() { printf '\033[31m%s\033[0m\n' "$*"; }
titulo() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

q() { docker exec -e PGPASSWORD="$PGPASS" "$DB_CONTAINER" psql -U "$PGUSER_" -d "$PGDB" -X -P pager=off -c "$1" 2>&1; }
q1() { docker exec -e PGPASSWORD="$PGPASS" "$DB_CONTAINER" psql -U "$PGUSER_" -d "$PGDB" -X -tA -P pager=off -c "$1" 2>/dev/null; }

USER_ID="$(q1 "select id from auth.users where lower(email) = '$EMAIL_SQL' limit 1")"
if [ -z "$USER_ID" ]; then erro "Cadastro $EMAIL não encontrado."; exit 2; fi
ok "Cadastro encontrado."

# Testa uma chave sem mostrar o valor: consulta de modelo + geração de 1 token.
testar() {
  local origem="$1" chave="$2"
  chave="$(printf '%s' "$chave" | tr -d '[:space:]')"
  if [ -z "$chave" ]; then warn "  $origem: vazia"; return; fi
  local r1 r2 c1 c2 m
  r1="$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $chave" https://api.openai.com/v1/models/gpt-4o-mini)"
  c1="$(printf '%s' "$r1" | tail -n1)"
  m="$(printf '%s' "$r1" | sed '$d' | grep -o '"message": *"[^"]*"' | head -1 | sed -E 's/sk-[A-Za-z0-9_*.-]+/sk-…/g')"
  if [ "$c1" != "200" ]; then erro "  $origem: RECUSADA ($c1) $m"; return; fi
  r2="$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $chave" -H 'Content-Type: application/json' \
    -d '{"model":"gpt-4o","max_tokens":1,"messages":[{"role":"user","content":"ping"}]}' https://api.openai.com/v1/chat/completions)"
  c2="$(printf '%s' "$r2" | tail -n1)"
  if [ "$c2" = "200" ]; then ok "  $origem: OK (gpt-4o-mini e gpt-4o)"; else warn "  $origem: OK no gpt-4o-mini, gpt-4o respondeu $c2"; fi
}

titulo "Chaves encontradas"
testar "Cadastro (Agente I.A. e gerador)" "$(q1 "select coalesce(openai_api_key,'') from public.crm_settings where user_id = '$USER_ID'")"
testar "Cadastro legado" "$(q1 "select coalesce(openai_api_key,'') from public.crm_settings where id = '00000000-0000-0000-0000-000000000001'")"
SRV_KEY="$(docker exec "$FN_CONTAINER" printenv OPENAI_API_KEY 2>/dev/null || true)"
testar "Servidor (OPENAI_API_KEY)" "$SRV_KEY"
echo "  Última alteração das configurações: $(q1 "select updated_at from public.crm_settings where user_id = '$USER_ID'")"

titulo "Últimos trabalhos do gerador de prompt"
q "select created_at, status, phase, cursor || '/' || total as progresso, left(coalesce(error,''), 140) as erro
   from public.crm_ai_prompt_jobs where user_id = '$USER_ID' order by created_at desc limit 5"

titulo "Logs recentes (gerador e Agente)"
docker logs --since 2h "$FN_CONTAINER" 2>&1 | grep -E 'PROMPT-BUILDER|PROMPT-JOB|AI-KEY' | sed -E 's/sk-[A-Za-z0-9_*.-]+/sk-…/g' | tail -n 25
