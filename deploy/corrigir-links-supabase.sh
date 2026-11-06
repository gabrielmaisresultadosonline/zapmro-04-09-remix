#!/usr/bin/env bash
# Troca links antigos de mídia (*.supabase.co/storage/...) pelo Storage da VPS
# em todas as tabelas do CRM (fluxos, templates, documentos I.A., mensagens...).
# Também lista quais arquivos citados NÃO existem no Storage da VPS.
#
#   sudo bash deploy/corrigir-links-supabase.sh            # só mostra (não altera)
#   sudo bash deploy/corrigir-links-supabase.sh --aplicar  # troca os links
set -euo pipefail
cd "$(dirname "$0")/postgres-stack"
APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
BASE="$(grep -E '^PUBLIC_API_URL=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ' | sed 's#/$##')"
[ -n "$BASE" ] || { echo "PUBLIC_API_URL não encontrado em deploy/postgres-stack/.env"; exit 1; }
OUT=/tmp/links-supabase.txt
psql_() { docker exec -i zapmro-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

psql_ -v base="$BASE" -v aplicar="$APLICAR" <<'SQL' | tee "$OUT"
\pset footer off
SELECT set_config('zap.base', :'base', false), set_config('zap.aplicar', :'aplicar', false) \gset _
CREATE TEMP TABLE _links(tabela text, coluna text, linhas bigint);
CREATE TEMP TABLE _arquivos(caminho text PRIMARY KEY);
DO $$
DECLARE r record; n bigint; aplicar boolean := current_setting('zap.aplicar') = '1'; base text := current_setting('zap.base');
BEGIN
  FOR r IN
    SELECT c.table_schema s, c.table_name t, c.column_name col, c.data_type dt
      FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
     WHERE c.table_schema='public' AND c.data_type IN ('text','character varying','jsonb','json')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text ~ ''https?://[a-z0-9]+\.supabase\.co/storage/v1/object/''', r.s, r.t, r.col) INTO n;
    CONTINUE WHEN n = 0;
    INSERT INTO _links VALUES (r.t, r.col, n);
    EXECUTE format($q$INSERT INTO _arquivos SELECT DISTINCT m[1] FROM %I.%I, regexp_matches(%I::text, 'supabase\.co/storage/v1/object/(?:public/|sign/)?([^"?\s\\]+)', 'g') m ON CONFLICT DO NOTHING$q$, r.s, r.t, r.col);
    IF aplicar THEN
      EXECUTE format($q$UPDATE %I.%I SET %I = regexp_replace(%I::text, 'https?://[a-z0-9]+\.supabase\.co/storage/v1/object/', %L, 'g')::%s WHERE %I::text ~ 'supabase\.co/storage/v1/object/'$q$,
        r.s, r.t, r.col, r.col, base || '/storage/v1/object/', r.dt, r.col);
    END IF;
  END LOOP;
END $$;
\echo '== Links antigos encontrados (tabela / coluna / linhas)'
SELECT * FROM _links ORDER BY linhas DESC;
\echo '== Arquivos citados que NÃO existem no Storage da VPS'
SELECT a.caminho FROM _arquivos a
 WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = split_part(a.caminho,'/',1)
                     AND o.name = substr(a.caminho, length(split_part(a.caminho,'/',1))+2))
 ORDER BY 1 LIMIT 200;
SELECT count(*) AS total_arquivos_citados,
       count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = split_part(a.caminho,'/',1)
                     AND o.name = substr(a.caminho, length(split_part(a.caminho,'/',1))+2))) AS faltando_na_vps
  FROM _arquivos a;
SQL
if [ "$APLICAR" = 1 ]; then echo "✔ links trocados para $BASE"; else echo "Nada foi alterado. Para trocar: sudo bash deploy/corrigir-links-supabase.sh --aplicar"; fi
echo "Relatório: $OUT"
