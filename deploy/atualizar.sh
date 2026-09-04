#!/usr/bin/env bash
# =============================================================================
#  atualizar.sh — COMANDO ÚNICO do ZapMRO 100% PostgreSQL próprio
#  (não usa e não depende de Supabase/Lovable Cloud para nada)
#
#      cd /var/www/ia-mro && ./deploy/atualizar.sh
#
#  Faz, de ponta a ponta e de forma idempotente (pode rodar quantas vezes quiser):
#    1) git pull   ................ baixa o código novo
#    2) dependências .............. docker, node, psql, nginx (instala se faltar)
#    3) .env / secrets ............ cria os arquivos e GERA os segredos que faltam
#    4) stack ..................... sobe Postgres + Auth + REST + Realtime +
#                                   Storage + Edge Runtime (Deno) + Gateway
#    5) banco ..................... cria/atualiza TODAS as tabelas, funções,
#                                   triggers, RLS, índices, grants, cron
#                                   (a partir dos dumps em deploy/postgres-stack/sql)
#    6) functions ................. recarrega as functions em Deno (código do repo)
#    7) frontend .................. npm install + build apontando para a SUA API
#    8) nginx/pm2 ................. publica o dist e reinicia os processos
#    9) validação ................. health-check de cada serviço + contagens
#
#  Os .env podem ser preenchidos DEPOIS: o script nunca apaga valor já existente,
#  só completa o que estiver vazio. Rode de novo após editar e tudo se ajusta.
# =============================================================================
set -Eeuo pipefail

C_R='\033[0;31m'; C_G='\033[0;32m'; C_Y='\033[1;33m'; C_B='\033[0;34m'; C_C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "${C_G}✔${N} $*"; }
info() { echo -e "${C_B}ℹ${N} $*"; }
warn() { echo -e "${C_Y}!${N} $*"; }
err()  { echo -e "${C_R}✘${N} $*" >&2; }
sec()  { echo; echo -e "${C_C}══════ $* ══════${N}"; }
die()  { err "$*"; exit 1; }
trap 'err "Falhou na linha $LINENO. Nada foi apagado — corrija e rode ./deploy/atualizar.sh de novo."' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
SQLDIR="$STACK/sql"
NORMALIZER="$ROOT/deploy/normalizar-dump.py"
SEM_BUILD="${SEM_BUILD:-0}"
REPO_URL="https://github.com/gabrielmaisresultadosonline/zapmro-04-09-remix.git"

sudo_() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

# ---------------------------------------------------------------- 1) código --
sec "1/9 Código"
cd "$ROOT"
if [ -d .git ]; then
  if [ -x "$ROOT/deploy/backup-antes-de-atualizar.sh" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx zapmro-db; then
    info "criando backup de segurança antes da atualização"
    "$ROOT/deploy/backup-antes-de-atualizar.sh"
  else
    warn "backup automático não executado (banco ainda não está ativo ou script indisponível)"
  fi
  origem_atual="$(git remote get-url origin 2>/dev/null || true)"
  if [ "$origem_atual" != "$REPO_URL" ]; then
    info "trocando origin antigo pelo novo repositório"
    git remote set-url origin "$REPO_URL"
    info "baixando a branch main do novo repositório"
    git fetch origin main
    git reset --hard origin/main
  else
    git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)" || warn "git pull não aplicado (siga com o código local)"
  fi
  info "origin: $(git remote get-url origin)"
fi
chmod +x "$ROOT/deploy/"*.sh 2>/dev/null || true
ok "código em $(git rev-parse --short HEAD 2>/dev/null || echo 'local')"

# ---------------------------------------------------------- 2) dependências --
sec "2/9 Dependências do sistema"
faltando=()
for b in docker node npm psql curl jq openssl nginx certbot; do command -v "$b" >/dev/null 2>&1 || faltando+=("$b"); done
docker compose version >/dev/null 2>&1 || faltando+=("docker-compose")
if [ ${#faltando[@]} -gt 0 ]; then
  info "instalando: ${faltando[*]}"
  export DEBIAN_FRONTEND=noninteractive
  sudo_ apt-get update -y
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    sudo_ apt-get install -y ca-certificates curl gnupg
    sudo_ install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo_ gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
    sudo_ chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      | sudo_ tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo_ apt-get update -y
    sudo_ apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo_ systemctl enable --now docker
  fi
  command -v node >/dev/null 2>&1 || { curl -fsSL https://deb.nodesource.com/setup_20.x | sudo_ -E bash -; sudo_ apt-get install -y nodejs; }
  command -v psql >/dev/null 2>&1 || sudo_ apt-get install -y postgresql-client
  sudo_ apt-get install -y nginx certbot python3-certbot-nginx jq openssl unzip >/dev/null 2>&1 || true
fi
ok "dependências prontas"

# --------------------------------------------------------- 3) env / secrets --
sec "3/9 Configuração (.env e secrets.env)"
[ -f "$STACK/.env" ]         || cp "$STACK/.env.example" "$STACK/.env"
[ -f "$STACK/secrets.env" ]  || cp "$STACK/secrets.env.example" "$STACK/secrets.env"

set_env() { # set_env VAR VALOR  (só grava se estiver vazio/ausente)
  local var="$1" val="$2"
  if grep -qE "^${var}=" "$STACK/.env"; then
    local atual; atual="$(grep -m1 -E "^${var}=" "$STACK/.env" | cut -d= -f2-)"
    [ -n "$atual" ] && return 0
    sed -i "s|^${var}=.*|${var}=${val}|" "$STACK/.env"
  else
    echo "${var}=${val}" >> "$STACK/.env"
  fi
}

replace_env() { # replace_env VAR VALOR (corrige configuração inválida existente)
  local var="$1" val="$2"
  if grep -qE "^${var}=" "$STACK/.env"; then
    sed -i "s|^${var}=.*|${var}=${val}|" "$STACK/.env"
  else
    echo "${var}=${val}" >> "$STACK/.env"
  fi
}

# segredos próprios da stack: gerados aqui, não vêm de lugar nenhum
gen() { openssl rand -hex 32; }
set_env POSTGRES_PASSWORD "$(gen)"
set_env JWT_SECRET "$(gen)"
# O Realtime/Cloak recebe DB_ENC_KEY como texto literal e exige exatamente
# 16 bytes. `-hex 8` gera 16 caracteres; `-hex 16` gerava 32 e causava loop.
set_env REALTIME_ENC_KEY "$(openssl rand -hex 8)"
set_env REALTIME_SECRET_KEY_BASE "$(openssl rand -hex 32)"

set -a; . "$STACK/.env"; set +a
if [ "${#REALTIME_ENC_KEY}" -ne 16 ]; then
  warn "REALTIME_ENC_KEY inválida (${#REALTIME_ENC_KEY} caracteres); regenerando com 16"
  replace_env REALTIME_ENC_KEY "$(openssl rand -hex 8)"
  set -a; . "$STACK/.env"; set +a
fi

# ANON_KEY / SERVICE_ROLE_KEY são JWTs assinados com o JWT_SECRET local
jwt() { # jwt <role>
  local role="$1" iat exp h p sig
  iat=$(date +%s); exp=$((iat + 60*60*24*3650))
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  p=$(printf '{"role":"%s","iss":"zapmro","iat":%s,"exp":%s}' "$role" "$iat" "$exp" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  sig=$(printf '%s.%s' "$h" "$p" | openssl dgst -binary -sha256 -hmac "$JWT_SECRET" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  printf '%s.%s.%s' "$h" "$p" "$sig"
}
[ -n "${ANON_KEY:-}" ]         || set_env ANON_KEY "$(jwt anon)"
[ -n "${SERVICE_ROLE_KEY:-}" ] || set_env SERVICE_ROLE_KEY "$(jwt service_role)"
set -a; . "$STACK/.env"; set +a

# as functions precisam enxergar as chaves da própria stack
touch "$STACK/secrets.env"
for kv in "APP_BASE_URL=${SITE_URL:-https://zapmro.com.br}" "SITE_URL=${SITE_URL:-https://zapmro.com.br}"; do
  grep -qE "^${kv%%=*}=" "$STACK/secrets.env" || echo "$kv" >> "$STACK/secrets.env"
done
vazios=$(grep -cE '^[A-Z0-9_]+=$' "$STACK/secrets.env" || true)
ok ".env pronto  |  secrets.env com ${vazios:-0} chave(s) ainda em branco (pode preencher depois)"

# aviso nominal: sem estas chaves o WhatsApp (webhook/assinaturas) nao funciona
faltando=""
for k in FACEBOOK_APP_ID FACEBOOK_APP_SECRET META_WEBHOOK_VERIFY_TOKEN; do
  grep -qE "^${k}=.+" "$STACK/secrets.env" || faltando="$faltando $k"
done
[ -z "$faltando" ] || printf '\033[33m  ATENCAO: chaves do WhatsApp em branco em secrets.env:%s\033[0m\n' "$faltando"

# ------------------------------------------------------------- 4) subir stack -
sec "4/9 Subindo a stack PostgreSQL"
cd "$STACK"
docker compose pull -q >/dev/null 2>&1 || true
docker compose up -d --remove-orphans
info "aguardando o banco…"
for i in $(seq 1 60); do
  docker exec zapmro-db pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
  [ "$i" = 60 ] && die "o Postgres não subiu — veja: docker compose logs db"
done
ok "Postgres, Auth, REST, Realtime, Storage, Functions e Gateway no ar"

DB="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${PG_PORT:-5432}/${POSTGRES_DB:-postgres}"

# ------------------------------------------------------------------ 5) banco --
sec "5/9 Banco (tabelas, funções, RLS, índices, cron)"
mkdir -p "$SQLDIR"

# 5.0 — base obrigatória (roles, schemas, senhas). Idempotente, roda SEMPRE.
#       Sem isso os dumps quebram com: role "supabase_admin" does not exist
info "garantindo roles, schemas e senhas do banco…"
psql "$DB" -v ON_ERROR_STOP=0 -q >/tmp/zapmro-bootstrap.log 2>&1 <<SQLBOOT || true
DO \$\$
DECLARE p text := '${POSTGRES_PASSWORD}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN EXECUTE format('CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin')    THEN EXECUTE format('CREATE ROLE supabase_auth_admin LOGIN CREATEROLE NOINHERIT PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN EXECUTE format('CREATE ROLE supabase_storage_admin LOGIN CREATEROLE NOINHERIT BYPASSRLS PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin')         THEN EXECUTE format('CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_realtime_admin') THEN EXECUTE format('CREATE ROLE supabase_realtime_admin LOGIN NOINHERIT PASSWORD %L', p); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dashboard_user')          THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pgbouncer')               THEN EXECUTE format('CREATE ROLE pgbouncer LOGIN PASSWORD %L', p); END IF;
  -- as senhas SEMPRE acompanham o POSTGRES_PASSWORD atual (evita o
  -- "password authentication failed for user authenticator" no PostgREST)
  EXECUTE format('ALTER ROLE authenticator            PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_auth_admin      PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_storage_admin   PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_admin           PASSWORD %L', p);
  EXECUTE format('ALTER ROLE supabase_realtime_admin  PASSWORD %L', p);
  EXECUTE format('ALTER ROLE pgbouncer                PASSWORD %L', p);
  EXECUTE 'ALTER ROLE supabase_admin SUPERUSER';
  EXECUTE 'ALTER ROLE supabase_auth_admin CREATEROLE';
  EXECUTE 'ALTER ROLE service_role BYPASSRLS';
  EXECUTE 'ALTER ROLE supabase_storage_admin CREATEROLE BYPASSRLS';
END \$\$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO supabase_storage_admin;
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_admin;
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB:-postgres} TO supabase_storage_admin;
GRANT ALL ON SCHEMA public TO postgres, supabase_admin;

CREATE SCHEMA IF NOT EXISTS extensions     AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS auth           AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage        AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS realtime       AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS _realtime      AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS graphql_public AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS vault          AUTHORIZATION supabase_admin;
GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA auth    TO supabase_auth_admin;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA storage TO service_role;
SQLBOOT
ok "roles e schemas prontos"

aplicados=0
shopt -s nullglob
arquivos=("$SQLDIR"/*.sql)
if [ ${#arquivos[@]} -eq 0 ]; then
  warn "nenhum .sql em deploy/postgres-stack/sql/"
  warn "coloque ali o dump gerado em /admincentral → Migração (ou por deploy/migrar-tudo.sh) e rode de novo"
else
  psql "$DB" -v ON_ERROR_STOP=0 -q -c "create table if not exists public._migracoes_aplicadas(arquivo text primary key, hash text, aplicado_em timestamptz default now())" >/dev/null
  # se o banco está praticamente vazio, execuções anteriores só "marcaram" sem
  # aplicar de fato — limpa o histórico para reaplicar tudo do zero.
  tab_atual="$(psql "$DB" -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo 0)"
  if [ "${tab_atual:-0}" -lt 5 ] || [ "${FORCAR_SQL:-0}" = "1" ]; then
    psql "$DB" -q -c "truncate public._migracoes_aplicadas" >/dev/null 2>&1 || true
    warn "banco vazio — reaplicando todos os dumps"
  fi
  for f in $(printf '%s\n' "${arquivos[@]}" | sort); do
    nome="$(basename "$f")"; h="$(sha256sum "$f" | cut -c1-16)"
    ja="$(psql "$DB" -tAc "select hash from public._migracoes_aplicadas where arquivo='${nome}'" 2>/dev/null || true)"
    if [ "$ja" = "$h" ]; then info "· $nome (já aplicado)"; continue; fi
    info "· aplicando $nome"
    # os dumps vêm com BEGIN;/COMMIT; — em transação única, UM erro aborta o
    # arquivo inteiro ("current transaction is aborted"). Removemos o
    # envelope para cada comando ser independente.
    normalized="/tmp/zapmro-sql-$nome.normalized"
    tmp="/tmp/zapmro-sql-$nome.exec"
    # O export administrativo contém pseudotipos do information_schema,
    # arrays JSON, colunas GENERATED do Auth e papéis internos da origem.
    # Sempre normalize uma cópia temporária; o dump original fica intacto.
    python3 "$NORMALIZER" "$f" "$normalized"
    sed -E '/^[[:space:]]*(BEGIN|COMMIT)[[:space:]]*;[[:space:]]*$/d' "$normalized" > "$tmp"
    psql "$DB" -v ON_ERROR_STOP=0 -q -f "$tmp" > "/tmp/zapmro-sql-$nome.log" 2>&1 || true
    erros=$(grep -ciE '^psql:.*(ERROR|FATAL)' "/tmp/zapmro-sql-$nome.log" || true)
    graves=$(grep -iE '^psql:.*(ERROR|FATAL)' "/tmp/zapmro-sql-$nome.log" \
             | grep -viE 'already exists|does not exist, skipping|duplicate key|multiple primary keys|is not a|violates' | wc -l || true)
    # A migration do OAuth é corretiva: qualquer erro nela (inclusive FK ou
    # duplicidade) significa que a UNIQUE não foi garantida e deve ser tentada
    # novamente. Não permita que seja marcada como aplicada silenciosamente.
    if [ "$nome" = "094-google-accounts-unique.sql" ]; then
      graves="${erros:-0}"
    fi
    if [ "$nome" = "095-ai-agent-kanban-and-whatsapp-primary.sql" ]; then
      graves="${erros:-0}"
    fi
    if [ "$nome" = "096-template-variable-presets.sql" ]; then
      graves="${erros:-0}"
    fi
    if [ "${erros:-0}" -gt 0 ]; then
      warn "  ${erros} aviso(s)/erro(s) em $nome → /tmp/zapmro-sql-$nome.log"
      grep -iE '^psql:.*(ERROR|FATAL)' "/tmp/zapmro-sql-$nome.log" | sort -u | head -3 | sed 's/^/      /' || true
    fi
    if [ "${graves:-0}" -gt 0 ]; then
      warn "  $nome NÃO foi marcado como aplicado (vai tentar de novo na próxima execução)"
    else
      psql "$DB" -q -c "insert into public._migracoes_aplicadas(arquivo,hash) values ('${nome}','${h}')
                        on conflict (arquivo) do update set hash=excluded.hash, aplicado_em=now()" >/dev/null
    fi
    aplicados=$((aplicados+1))
  done
fi
shopt -u nullglob
tabelas="$(psql "$DB" -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo '?')"
ok "banco atualizado — ${aplicados} arquivo(s) aplicado(s), ${tabelas} tabelas públicas"

# 5.1 — cron das Edge Functions apontando SEMPRE para esta VPS (nunca Supabase)
info "reagendando cron das functions para a API local…"
CRON_URL="${PUBLIC_API_URL:-http://gateway:${GATEWAY_PORT:-8000}}/functions/v1/meta-whatsapp-crm"
psql "$DB" -q -c "ALTER DATABASE ${POSTGRES_DB:-postgres} SET app.settings.functions_url = '${PUBLIC_API_URL:-http://gateway}'" >/dev/null 2>&1 || true
psql "$DB" -q -c "ALTER DATABASE ${POSTGRES_DB:-postgres} SET app.settings.service_role_key = '${SERVICE_ROLE_KEY}'" >/dev/null 2>&1 || true
psql "$DB" -v ON_ERROR_STOP=0 -q >/tmp/zapmro-cron.log 2>&1 <<SQLCRON || true
DO \$\$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobname, command FROM cron.job LOOP
    IF j.command ILIKE '%supabase.co%' THEN
      PERFORM cron.unschedule(j.jobname);
    END IF;
  END LOOP;
END \$\$;

-- O worker roda na VPS a cada 15 segundos. Assim delays curtos continuam mesmo
-- com todas as abas fechadas; o claim atômico em crm_contacts evita duplicidade.
SELECT cron.schedule('process-scheduled-flows-every-minute', '15 seconds', \$job\$
  SELECT net.http_post(
    url := '${CRON_URL}',
    headers := '{"Content-Type":"application/json","apikey":"${ANON_KEY}","Authorization":"Bearer ${SERVICE_ROLE_KEY}"}'::jsonb,
    body := jsonb_build_object('action','processScheduled','source','cron','ts', now()),
    timeout_milliseconds := 300000
  );
\$job\$);

SELECT cron.schedule('process-countdown-triggers', '*/2 * * * *', \$job\$
  SELECT net.http_post(
    url := '${CRON_URL}',
    headers := '{"Content-Type":"application/json","apikey":"${ANON_KEY}","Authorization":"Bearer ${SERVICE_ROLE_KEY}"}'::jsonb,
    body := '{"action": "processCountdownTriggers"}'::jsonb,
    timeout_milliseconds := 300000
  );
\$job\$);

SELECT cron.schedule('ai-recovery-every-10min', '*/10 * * * *', \$job\$
  SELECT net.http_post(
    url := '${CRON_URL}',
    headers := '{"Content-Type":"application/json","apikey":"${ANON_KEY}","Authorization":"Bearer ${SERVICE_ROLE_KEY}"}'::jsonb,
    body := '{"action": "processAiRecovery"}'::jsonb,
    timeout_milliseconds := 300000
  );
\$job\$);
SQLCRON
sobrou_supabase="$(psql "$DB" -tAc "select count(*) from cron.job where command ilike '%supabase.co%'" 2>/dev/null || echo '?')"
ok "cron apontando para ${CRON_URL} (jobs com Supabase restantes: ${sobrou_supabase})"

# depois de garantir roles/senhas, os serviços que conectam no banco precisam
# reconectar (PostgREST fica em Restarting se subiu antes das roles existirem)
info "reiniciando serviços que dependem do banco e recarregando o gateway…"
# O gateway usa nginx.conf montado como bind mount. `docker compose up -d` não
# reinicia um container já existente quando apenas esse arquivo muda; sem o
# restart, a correção de Upgrade/Host do WebSocket não entra em vigor.
( cd "$STACK" && docker compose restart rest auth storage realtime gateway >/dev/null 2>&1 ) || true
sleep 5

# -------------------------------------------------------------- 6) functions --
sec "6/9 Edge Functions (Deno, rodando na sua VPS)"
qtd=$(find "$ROOT/supabase/functions" -maxdepth 1 -mindepth 1 -type d ! -name '_shared' | wc -l)
# IMPORTANTE: `restart` reaproveita workers/cache do Deno e o container pode
# continuar executando o código ANTIGO das funções. `--force-recreate` garante
# que o novo index.ts entre em vigor. Volumes do Postgres/Auth não são tocados.
( cd "$STACK" && docker compose up -d --force-recreate functions >/dev/null )

ok "${qtd} funções recarregadas em ${PUBLIC_API_URL:-http://localhost:${GATEWAY_PORT:-8000}}/functions/v1/<nome>"

# --------------------------------------------------------------- 7) frontend --
sec "7/9 Frontend"
cd "$ROOT"
API="${PUBLIC_API_URL:-http://localhost:${GATEWAY_PORT:-8000}}"
cat > "$ROOT/.env" <<EOF
VITE_SUPABASE_URL="${API}"
VITE_SUPABASE_PUBLISHABLE_KEY="${ANON_KEY}"
VITE_SUPABASE_PROJECT_ID="zapmro"
EOF
ok ".env do frontend apontando para ${API} (sem Supabase)"
if [ "$SEM_BUILD" = "1" ]; then
  warn "build pulado (SEM_BUILD=1)"
else
  npm install --no-audit --no-fund --legacy-peer-deps
  rm -rf dist
  npm run build
  ok "build gerado em dist/ (vídeos, imagens e assets incluídos)"
fi

# ----------------------------------------------------------- 8) nginx / pm2 ---
sec "8/9 Publicação"
API_HOST="$(echo "$API" | sed -E 's#https?://##; s#/.*##')"
SITE_HOST="$(echo "${SITE_URL:-https://zapmro.com.br}" | sed -E 's#https?://##; s#/.*##')"
if command -v nginx >/dev/null 2>&1; then
  sudo_ tee /etc/nginx/sites-available/zapmro-api.conf >/dev/null <<EOF
server {
    listen 80;
    server_name ${API_HOST};
    client_max_body_size 512m;
    location / {
        proxy_pass http://127.0.0.1:${GATEWAY_PORT:-8000};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }
}
EOF
  sudo_ ln -sf /etc/nginx/sites-available/zapmro-api.conf /etc/nginx/sites-enabled/zapmro-api.conf
  if sudo_ nginx -t >/dev/null 2>&1; then
    sudo_ systemctl reload nginx
    ok "nginx recarregado (API em ${API_HOST}, site em ${SITE_HOST})"

    # O arquivo acima é recriado a cada atualização. Reaplique o certificado
    # depois disso para que o host da API nunca caia no vhost SSL padrão de
    # outro domínio (o navegador reportaria ERR_CERT_COMMON_NAME_INVALID).
    if command -v certbot >/dev/null 2>&1; then
      if sudo_ certbot --nginx -d "${API_HOST}" --non-interactive --agree-tos \
          -m "admin@${SITE_HOST}" --redirect --keep-until-expiring >/dev/null 2>&1; then
        ok "SSL válido aplicado em ${API_HOST}"
      else
        warn "SSL de ${API_HOST} pendente — confira o DNS e rode: sudo certbot --nginx -d ${API_HOST}"
      fi
    fi
  else
    warn "nginx com erro de config — rode: sudo nginx -t"
  fi
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart all --update-env >/dev/null 2>&1 && ok "processos PM2 reiniciados" || warn "PM2 sem processos"
  pm2 save >/dev/null 2>&1 || true
fi

# --------------------------------------------------------------- 9) validação -
sec "9/9 Validação"
G="http://127.0.0.1:${GATEWAY_PORT:-8000}"
chk() { # OK = serviço respondeu HTTP (404 de rota-raiz não é falha; 000 = fora do ar)
  local code
  printf '  %-24s' "$1"
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$2" ${3:+-H "$3"} 2>/dev/null || echo 000)
  if [ "$code" != "000" ] && [ "${code:0:1}" != "5" ]; then echo -e "${C_G}OK${N} (HTTP $code)"; else echo -e "${C_R}FALHOU${N} (HTTP $code)"; fi
}
chk "gateway"   "$G/health"
chk "auth"      "$G/auth/v1/health"
chk "rest"      "$G/rest/v1/"    "apikey: ${ANON_KEY}"
chk "storage"   "$G/storage/v1/bucket" "Authorization: Bearer ${SERVICE_ROLE_KEY}"
chk "functions" "$G/functions/v1/"
echo
q() { psql "$DB" -tAc "$1" 2>/dev/null || echo '?'; }
echo "  tabelas públicas : $(q "select count(*) from information_schema.tables where table_schema='public'")"
echo "  usuários auth    : $(q "select count(*) from auth.users")"
echo "  contatos CRM     : $(q "select count(*) from public.crm_contacts")"
echo "  mensagens CRM    : $(q "select count(*) from public.crm_messages")"
echo "  jobs cron        : $(q "select count(*) from cron.job")"
google_unique="$(q "select count(*) from pg_constraint where conrelid='public.crm_google_accounts'::regclass and contype in ('u','p') and conkey=ARRAY[(select attnum from pg_attribute where attrelid='public.crm_google_accounts'::regclass and attname='user_id'),(select attnum from pg_attribute where attrelid='public.crm_google_accounts'::regclass and attname='email')]::smallint[]")"
if [ "$google_unique" = "1" ]; then
  echo -e "  Google OAuth UNIQUE   : ${C_G}OK${N} (user_id, email)"
else
  die "Migration 094 não criou UNIQUE(user_id, email). Veja /tmp/zapmro-sql-094-google-accounts-unique.sql.log"
fi
google_primary_column="$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='crm_whatsapp_numbers' and column_name='is_primary'")"
ai_preferences_columns="$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='crm_settings' and column_name in ('ai_kanban_auto_organizer','ai_send_bundled')")"
if [ "$google_primary_column" = "1" ] && [ "$ai_preferences_columns" = "2" ]; then
  echo -e "  Migration 095         : ${C_G}OK${N} (WhatsApp principal + preferências IA)"
else
  die "Migration 095 incompleta. Veja /tmp/zapmro-sql-095-ai-agent-kanban-and-whatsapp-primary.sql.log"
fi
template_presets_table="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name='crm_template_variable_presets'")"
template_presets_rls="$(q "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='crm_template_variable_presets' and c.relrowsecurity")"
if [ "$template_presets_table" = "1" ] && [ "$template_presets_rls" = "1" ]; then
  echo -e "  Migration 096         : ${C_G}OK${N} (variáveis de templates salvas + RLS)"
else
  die "Migration 096 incompleta. Veja /tmp/zapmro-sql-096-template-variable-presets.sql.log"
fi
if grep -q "Sem depender da UNIQUE(user_id,email)" "$ROOT/supabase/functions/meta-whatsapp-crm/index.ts"; then
  echo -e "  Google OAuth function : ${C_G}OK${N} (update/insert sem ON CONFLICT)"
else
  die "Código antigo do OAuth Google ainda está no servidor; confirme o origin e a branch main"
fi
if grep -q "Não usar upsert ON CONFLICT (wa_id,user_id)" "$ROOT/supabase/functions/meta-whatsapp-crm/index.ts" \
  && ! grep -q "upsert(upsertBatch, { onConflict: 'wa_id,user_id' })" "$ROOT/supabase/functions/meta-whatsapp-crm/index.ts"; then
  echo -e "  Google Contacts import: ${C_G}OK${N} (insert sem conflito legado)"
else
  die "Importador Google antigo ainda usa ON CONFLICT (wa_id,user_id)"
fi
echo "  frontend aponta  : ${API}"

echo
ok "ATUALIZAÇÃO CONCLUÍDA — front, backend, banco, storage e functions rodando na sua VPS."
cat <<EOF

Preencher depois (opcional, o sistema já sobe sem isso):
  nano deploy/postgres-stack/secrets.env     # chaves das integrações (Meta, Google, DeepSeek, SMTP, InfinitePay…)
  nano deploy/postgres-stack/.env            # domínio, OAuth, SMTP do Auth
  ./deploy/atualizar.sh                      # rode de novo: aplica sem quebrar nada

Uma vez só, nos painéis externos:
  Meta/WhatsApp  → ${API}/functions/v1/meta-whatsapp-crm  (+ reassinar subscribed_apps)
  Google/Facebook OAuth → ${API}/auth/v1/callback
  InfinitePay / Z-API   → ${API}/functions/v1/<função>
EOF
