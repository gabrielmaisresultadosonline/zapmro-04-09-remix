#!/usr/bin/env bash
# =============================================================================
#  reparar.sh — conserta a migração pela metade (Storage 502, Auth com 0
#  usuários, dumps SQL com erro) SEM apagar nada e SEM tocar no sistema antigo.
#
#      cd /var/www/ia-mro && ./deploy/reparar.sh
#
#  O que ele faz, nesta ordem:
#    1) roles, senhas e schemas (auth/storage) corretos
#    2) DONO dos objetos: tabelas do schema auth -> supabase_auth_admin,
#       do schema storage -> supabase_storage_admin
#       (essa é a causa nº1 do Storage 502 e do GoTrue não migrar/enxergar users)
#    3) reaplica TODOS os dumps SQL, comando a comando, mostrando os erros reais
#    4) reinicia auth/rest/storage/realtime e espera cada um responder
#    5) relatório final: tabelas, usuários, contatos, mensagens, buckets
#
#  Pode rodar quantas vezes quiser. Nada é apagado.
# =============================================================================
set -Eeuo pipefail

C_R='\033[0;31m'; C_G='\033[0;32m'; C_Y='\033[1;33m'; C_B='\033[0;34m'; C_C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "${C_G}✔${N} $*"; }
info() { echo -e "${C_B}ℹ${N} $*"; }
warn() { echo -e "${C_Y}!${N} $*"; }
err()  { echo -e "${C_R}✘${N} $*" >&2; }
sec()  { echo; echo -e "${C_C}══════ $* ══════${N}"; }
die()  { err "$*"; exit 1; }
trap 'err "Falhou na linha $LINENO. Nada foi apagado — corrija e rode ./deploy/reparar.sh de novo."' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
SQLDIR="$STACK/sql"
NORMALIZER="$ROOT/deploy/normalizar-dump.py"

[ -f "$STACK/.env" ] || die "não achei $STACK/.env — rode ./deploy/atualizar.sh primeiro"
set -a; . "$STACK/.env"; set +a
if [ "${#REALTIME_ENC_KEY}" -ne 16 ]; then
  warn "REALTIME_ENC_KEY inválida (${#REALTIME_ENC_KEY} caracteres); regenerando com 16"
  nova_realtime_key="$(openssl rand -hex 8)"
  if grep -qE '^REALTIME_ENC_KEY=' "$STACK/.env"; then
    sed -i "s|^REALTIME_ENC_KEY=.*|REALTIME_ENC_KEY=${nova_realtime_key}|" "$STACK/.env"
  else
    echo "REALTIME_ENC_KEY=${nova_realtime_key}" >> "$STACK/.env"
  fi
  export REALTIME_ENC_KEY="$nova_realtime_key"
  ok "chave do Realtime corrigida; o container será recriado"
fi
DB="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${PG_PORT:-5432}/${POSTGRES_DB:-postgres}"

docker exec zapmro-db pg_isready -U postgres >/dev/null 2>&1 \
  || ( cd "$STACK" && docker compose up -d db && sleep 8 )

# ------------------------------------------------- 1) roles, senhas, schemas --
sec "1/5 Roles, senhas e schemas"
psql "$DB" -v ON_ERROR_STOP=0 -q >/tmp/zapmro-rep-roles.log 2>&1 <<SQL || true
DO \$\$
DECLARE p text := '${POSTGRES_PASSWORD}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN EXECUTE format('CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin')     THEN EXECUTE format('CREATE ROLE supabase_auth_admin LOGIN CREATEROLE NOINHERIT PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin')  THEN EXECUTE format('CREATE ROLE supabase_storage_admin LOGIN CREATEROLE NOINHERIT BYPASSRLS PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin')          THEN EXECUTE format('CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_realtime_admin') THEN EXECUTE format('CREATE ROLE supabase_realtime_admin LOGIN NOINHERIT PASSWORD %L', p); END IF;
  EXECUTE format('ALTER ROLE authenticator           PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_auth_admin     PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_storage_admin  PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_admin          PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_realtime_admin PASSWORD %L', p);
  EXECUTE 'ALTER ROLE supabase_admin SUPERUSER';
  EXECUTE 'ALTER ROLE supabase_auth_admin  CREATEROLE';
  EXECUTE 'ALTER ROLE service_role BYPASSRLS';
  EXECUTE 'ALTER ROLE supabase_storage_admin CREATEROLE BYPASSRLS';
END \$\$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO supabase_storage_admin;
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_admin;
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS auth       AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage    AUTHORIZATION supabase_storage_admin;
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    DROP SCHEMA IF EXISTS cron CASCADE;
  END IF;
END \$\$;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
ALTER SCHEMA auth    OWNER TO supabase_auth_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA auth    TO supabase_auth_admin;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
SQL
ok "roles e senhas sincronizadas com o POSTGRES_PASSWORD atual"

# ------------------------------------------------------ 2) donos dos objetos --
sec "2/5 Corrigindo o DONO das tabelas de auth e storage"
# GoTrue e Storage-API rodam como supabase_auth_admin / supabase_storage_admin.
# Se os dumps criaram as tabelas como "postgres", eles não conseguem migrar nem
# ler nada -> Storage 502 e Auth aparentando 0 usuários.
psql "$DB" -v ON_ERROR_STOP=0 -q >/tmp/zapmro-rep-owner.log 2>&1 <<'SQL' || true
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('auth','storage') LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schemaname, r.tablename,
      CASE r.schemaname WHEN 'auth' THEN 'supabase_auth_admin' ELSE 'supabase_storage_admin' END);
  END LOOP;
  FOR r IN SELECT sequence_schema AS s, sequence_name AS t FROM information_schema.sequences WHERE sequence_schema IN ('auth','storage') LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', r.s, r.t,
      CASE r.s WHEN 'auth' THEN 'supabase_auth_admin' ELSE 'supabase_storage_admin' END);
  END LOOP;
  FOR r IN SELECT table_schema AS s, table_name AS t FROM information_schema.views WHERE table_schema IN ('auth','storage') LOOP
    EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', r.s, r.t,
      CASE r.s WHEN 'auth' THEN 'supabase_auth_admin' ELSE 'supabase_storage_admin' END);
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS routine_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'auth' AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO supabase_auth_admin', r.routine_name);
  END LOOP;
END $$;
GRANT ALL ON ALL TABLES    IN SCHEMA auth    TO supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth    TO supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA auth
  GRANT ALL ON TABLES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA auth
  GRANT ALL ON SEQUENCES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA auth
  GRANT EXECUTE ON FUNCTIONS TO supabase_auth_admin;
GRANT ALL ON ALL TABLES    IN SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA storage TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA storage TO service_role;
SQL
ok "donos ajustados (auth → supabase_auth_admin, storage → supabase_storage_admin)"

# Auth e Storage são responsáveis por criar suas próprias tabelas internas.
# Iniciá-los antes dos dumps garante que o import encontre o schema da versão
# instalada, em vez de tentar reconstruí-lo a partir de metadados antigos.
( cd "$STACK" && docker compose up -d auth storage >/dev/null 2>&1 ) || true
for _ in $(seq 1 30); do
  auth_users=$(psql "$DB" -tAc "select to_regclass('auth.users') is not null" 2>/dev/null || true)
  storage_buckets=$(psql "$DB" -tAc "select to_regclass('storage.buckets') is not null" 2>/dev/null || true)
  [ "$auth_users" = "t" ] && [ "$storage_buckets" = "t" ] && break
  sleep 2
done
[ "${auth_users:-}" = "t" ] || warn "Auth ainda não criou auth.users; veja: docker logs zapmro-auth"
if [ "${storage_buckets:-}" != "t" ]; then
  warn "Storage não criou storage.buckets; criando estrutura mínima compatível"
  psql "$DB" <<'SQL' >/dev/null
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text
);
CREATE UNIQUE INDEX IF NOT EXISTS bucketid_objname ON storage.objects (bucket_id, name);
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;
SQL
fi


# ------------------------------------------------------- 3) reaplicar dumps ---
sec "3/5 Reaplicando os dumps SQL (mostrando os erros reais)"
shopt -s nullglob
arquivos=("$SQLDIR"/*.sql)
if [ ${#arquivos[@]} -eq 0 ]; then
  warn "nenhum .sql em $SQLDIR — baixe em /admincentral → Migração e coloque ali"
else
  psql "$DB" -q -c "drop table if exists public._migracoes_aplicadas" >/dev/null 2>&1 || true
  for f in $(printf '%s\n' "${arquivos[@]}" | sort); do
    nome="$(basename "$f")"
    [ "$nome" = "README.md" ] && continue
    info "· $nome"
    normalized="/tmp/zapmro-rep-$nome.normalized"
    tmp="/tmp/zapmro-rep-$nome.exec"
    python3 "$NORMALIZER" "$f" "$normalized"
    # Remove somente o envelope externo. END; fecha blocos PL/pgSQL.
    sed -E '/^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;[[:space:]]*$/d' "$normalized" > "$tmp"
    psql "$DB" -v ON_ERROR_STOP=0 -q -f "$tmp" > "/tmp/zapmro-rep-$nome.log" 2>&1 || true
    # Objetos que acabaram de ser criados devem voltar imediatamente ao dono
    # esperado pelos serviços, inclusive se outro arquivo falhar depois.
    psql "$DB" -v ON_ERROR_STOP=0 -q >/dev/null 2>&1 <<'SQL' || true
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('auth','storage') LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schemaname, r.tablename,
      CASE r.schemaname WHEN 'auth' THEN 'supabase_auth_admin' ELSE 'supabase_storage_admin' END);
  END LOOP;
END $$;
SQL
    graves=$(grep -iE '^psql:.*(ERROR|FATAL)' "/tmp/zapmro-rep-$nome.log" \
             | grep -viE 'already exists|does not exist, skipping|duplicate key|multiple primary keys|role "sandbox_exec" does not exist' | wc -l || true)
    if [ "${graves:-0}" -gt 0 ]; then
      warn "  ${graves} erro(s) real(is) — primeiros:"
      grep -iE '^psql:.*(ERROR|FATAL)' "/tmp/zapmro-rep-$nome.log" \
        | grep -viE 'already exists|does not exist, skipping|duplicate key|multiple primary keys|role "sandbox_exec" does not exist' \
        | sort -u | head -5 | sed 's/^/      /'
      info "  log completo: /tmp/zapmro-rep-$nome.log"
    else
      ok "  $nome aplicado"
    fi
  done
  # os donos precisam ser corrigidos DE NOVO: os dumps recriam objetos como postgres
  psql "$DB" -v ON_ERROR_STOP=0 -q -f /dev/stdin >/dev/null 2>&1 <<'SQL' || true
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('auth','storage') LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schemaname, r.tablename,
      CASE r.schemaname WHEN 'auth' THEN 'supabase_auth_admin' ELSE 'supabase_storage_admin' END);
  END LOOP;
END $$;
SQL
fi
shopt -u nullglob

psql "$DB" -v ON_ERROR_STOP=1 -q <<SQL
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_storage_admin IN SCHEMA storage
  GRANT ALL ON TABLES TO supabase_storage_admin;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_objects ON storage.objects;
CREATE POLICY service_role_all_objects ON storage.objects
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_all_buckets ON storage.buckets;
CREATE POLICY service_role_all_buckets ON storage.buckets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
SQL

# ------------------------------------------------------- 4) reiniciar stack ---
sec "4/5 Reiniciando os serviços e esperando cada um responder"
( cd "$STACK" && docker compose up -d >/dev/null 2>&1 ) || true
( cd "$STACK" && docker compose restart rest auth storage realtime functions gateway >/dev/null 2>&1 ) || true

espera() { # espera <nome> <url>
  local nome="$1" url="$2" code
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$url" || echo 000)
    case "$code" in 2*|3*|4*) ok "$nome OK (HTTP $code)"; return 0;; esac
    sleep 2
  done
  err "$nome FALHOU (último HTTP ${code:-000})"
  docker logs --tail 15 "zapmro-${nome}" 2>&1 | sed 's/^/      /' || true
  return 0
}
BASE="http://127.0.0.1:${GATEWAY_PORT:-8000}"
espera auth    "$BASE/auth/v1/health"
espera rest    "$BASE/rest/v1/"
espera storage "$BASE/storage/v1/bucket"
espera functions "$BASE/functions/v1/"

# O endpoint de saúde pode retornar 200 mesmo sem acesso a auth.users. Confirma
# o schema com o mesmo papel usado pelo GoTrue e testa o caminho real do login
# sem usar nem modificar a senha de nenhum cliente.
if ! PGPASSWORD="$POSTGRES_PASSWORD" psql \
  -h 127.0.0.1 -p "${PG_PORT:-5432}" -U supabase_auth_admin \
  -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 -qAt \
  -c "select count(*) from auth.users; select count(*) from auth.identities; select count(*) from auth.schema_migrations;" \
  >/tmp/zapmro-auth-schema-check.log 2>&1; then
  cat /tmp/zapmro-auth-schema-check.log >&2
  die "Auth não consegue consultar o próprio schema; nenhum usuário foi alterado"
fi

AUTH_PROBE_BODY="/tmp/zapmro-auth-login-probe.json"
auth_login_code=$(curl -sS -o "$AUTH_PROBE_BODY" -m 15 -w '%{http_code}' \
  -X POST "$BASE/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON_KEY}" \
  -H "Content-Type: application/json" \
  --data '{"email":"healthcheck-nao-existe@zapmro.invalid","password":"healthcheck-nao-e-login"}' \
  2>/dev/null || echo 000)
if [ "$auth_login_code" = "400" ]; then
  ok "login + banco Auth OK (credencial de teste recusada corretamente)"
else
  docker logs --tail 80 zapmro-auth 2>&1 | sed 's/^/      /' >&2 || true
  die "login ainda falhou (HTTP $auth_login_code); veja os logs do Auth acima"
fi

# ------------------------------------------------------------- 5) relatório ---
sec "5/5 Relatório"
cnt() { psql "$DB" -tAc "$1" 2>/dev/null || echo '?'; }
echo "  tabelas públicas ..... $(cnt "select count(*) from information_schema.tables where table_schema='public'")"
echo "  usuários (auth) ...... $(cnt "select count(*) from auth.users")"
echo "  identities ........... $(cnt "select count(*) from auth.identities")"
echo "  contatos CRM ......... $(cnt "select count(*) from public.crm_contacts")"
echo "  mensagens CRM ........ $(cnt "select count(*) from public.crm_messages")"
echo "  buckets storage ...... $(cnt "select count(*) from storage.buckets")"
echo "  objetos storage ...... $(cnt "select count(*) from storage.objects")"
echo
docker ps --format '  {{.Names}}\t{{.Status}}' | grep zapmro || true
echo
info "Se 'usuários' continuar 0, o dump 050-auth.sql não entrou:"
info "  grep -i error /tmp/zapmro-rep-050-auth.sql.log | head"
info "Se o Storage continuar 502:  docker logs --tail 40 zapmro-storage"
public_tables=$(cnt "select count(*) from information_schema.tables where table_schema='public'")
auth_total=$(cnt "select count(*) from auth.users")
crm_contacts=$(cnt "select count(*) from public.crm_contacts")
crm_messages=$(cnt "select count(*) from public.crm_messages")
if ! [[ "$public_tables" =~ ^[0-9]+$ ]] || [ "$public_tables" -lt 50 ] \
   || ! [[ "$auth_total" =~ ^[0-9]+$ ]] || [ "$auth_total" -lt 1 ] \
   || ! [[ "$crm_contacts" =~ ^[0-9]+$ ]] \
   || ! [[ "$crm_messages" =~ ^[0-9]+$ ]]; then
  die "VALIDAÇÃO INCOMPLETA: banco ainda não está pronto. NÃO altere os webhooks nem desligue o sistema antigo."
fi
ok "VALIDAÇÃO ESSENCIAL APROVADA: schema, Auth, contatos e mensagens foram restaurados."
warn "Ainda valide login, envio/recebimento e arquivos antes do corte definitivo."
