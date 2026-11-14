#!/usr/bin/env bash
# Remove arquivos da pasta crm-media/templates com +30 dias que NÃO são citados
# em nenhum lugar do banco. Padrão: só mostra (teste). Para apagar: CONFIRMAR=1.
# Apaga pela Storage API (registro + arquivo juntos), em lotes de 100.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in "$ROOT/deploy/postgres-stack/.env" "$ROOT/deploy/postgres-stack/secrets.env"; do
  [ -f "$f" ] && { set -a; . "$f"; set +a; }
done
DB="${DB_CONTAINER:-zapmro-db}"; PGDB="${POSTGRES_DB:-postgres}"
GW="http://127.0.0.1:${GATEWAY_PORT:-8000}"
DIAS="${DIAS:-30}"
LISTA="$(mktemp /tmp/templates-sem-uso.XXXXXX)"; trap 'rm -f "$LISTA"' EXIT

echo "== Conferindo referências em TODAS as tabelas (pode levar minutos) =="
docker exec -i -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB" psql -U "${POSTGRES_USER:-postgres}" -d "$PGDB" -X -q -A -t -v ON_ERROR_STOP=1 >"$LISTA" <<SQL
SET statement_timeout='20min';
CREATE TEMP TABLE velhos AS
  SELECT name, regexp_replace(name,'^.*/','') AS base, coalesce((metadata->>'size')::bigint,0) sz
  FROM storage.objects
  WHERE bucket_id='crm-media' AND name LIKE 'templates/%'
    AND coalesce(updated_at,created_at) < now()-interval '${DIAS} days';
CREATE TEMP TABLE refs(src text, txt text);
DO \$\$ DECLARE r record; BEGIN
  FOR r IN SELECT table_schema s, table_name t, column_name c FROM information_schema.columns
           WHERE table_schema NOT LIKE 'pg_temp%' AND table_schema NOT LIKE 'pg_toast_temp%' AND table_schema NOT IN ('storage','pg_catalog','information_schema','pg_toast','cron','auth','_realtime','realtime','supabase_functions','net','vault','extensions','graphql','graphql_public','pgsodium')
             AND data_type IN ('text','jsonb','json','character varying','ARRAY')
  LOOP
    IF (r.s||'.'||r.t) = ANY(string_to_array('${IGNORAR:-}', ',')) THEN CONTINUE; END IF;
    EXECUTE format('INSERT INTO refs SELECT %L, %I::text FROM %I.%I WHERE %I::text LIKE %L', r.s||'.'||r.t||'.'||r.c, r.c, r.s, r.t, r.c, '%templates/%');
  END LOOP;
END \$\$;
-- protegido se o NOME DO ARQUIVO aparecer em qualquer lugar (mais rígido que o caminho)
CREATE TEMP TABLE hits AS SELECT DISTINCT v.name, r.src FROM velhos v JOIN refs r ON position(v.base IN r.txt) > 0;
CREATE TEMP TABLE usados AS SELECT DISTINCT name FROM hits;
SELECT 'ONDE|'||src||'|'||count(*) FROM hits GROUP BY src ORDER BY count(*) DESC;
SELECT 'RESUMO|'||(SELECT count(*) FROM velhos)||'|'||(SELECT count(*) FROM usados)||'|'||
       (SELECT count(*) FROM velhos v WHERE NOT EXISTS (SELECT 1 FROM usados u WHERE u.name=v.name))||'|'||
       coalesce((SELECT pg_size_pretty(sum(sz)) FROM velhos v WHERE NOT EXISTS (SELECT 1 FROM usados u WHERE u.name=v.name)),'0');
SELECT 'APAGAR|'||v.name FROM velhos v WHERE NOT EXISTS (SELECT 1 FROM usados u WHERE u.name=v.name)
  AND (to_regprocedure('public.crm_media_is_protected_asset(text,text)') IS NULL
       OR NOT public.crm_media_is_protected_asset(v.name, '/storage/v1/object/public/crm-media/'||v.name));
SQL

IFS='|' read -r _ TOTAL USADOS SEMUSO TAM < <(grep '^RESUMO|' "$LISTA")
N=$(grep -c '^APAGAR|' "$LISTA" || true)
echo "Arquivos de templates com +${DIAS} dias: $TOTAL"
echo "LIGADOS a algo (NUNCA serão apagados): $USADOS"
echo "Sem ligação nenhuma: $SEMUSO ($TAM na lista) | prontos para apagar: $N"
echo "Onde os arquivos são citados (tabela.coluna | quantos):"; grep '^ONDE|' "$LISTA" | cut -d'|' -f2- | sed 's/^/  /'
echo "Exemplos que sairiam:"; awk -F'|' '/^APAGAR\|/ && n++<10 {sub(/^APAGAR\|/,""); print}' "$LISTA"

if [ "${USADOS:-0}" -eq 0 ]; then echo "ERRO: nenhuma referência encontrada — por segurança nada será apagado."; exit 1; fi
if [ "${CONFIRMAR:-0}" != "1" ]; then echo; echo "MODO TESTE: nada foi apagado. Para apagar: CONFIRMAR=1 sudo -E bash $0"; exit 0; fi
[ -n "${SERVICE_ROLE_KEY:-}" ] || { echo "SERVICE_ROLE_KEY ausente"; exit 1; }

echo "== Apagando em lotes de 100 =="
OK=0
grep '^APAGAR|' "$LISTA" | cut -d'|' -f2- | split -l 100 - /tmp/tpl-lote.
for L in /tmp/tpl-lote.*; do
  BODY=$(python3 -c 'import json,sys;print(json.dumps({"prefixes":[l.strip() for l in open(sys.argv[1]) if l.strip()]}))' "$L")
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$GW/storage/v1/object/crm-media" \
    -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d "$BODY")
  [ "$CODE" = "200" ] && OK=$((OK+$(wc -l <"$L"))) || echo "lote falhou ($CODE), segue"
  rm -f "$L"
done
echo "Apagados: $OK de $N"; df -h / | tail -1
