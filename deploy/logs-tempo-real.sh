#!/usr/bin/env bash
# ============================================================
# LOGS EM TEMPO REAL — Arquivos do Agente I.A. + Disparo em massa
#
# Uso na VPS (pasta do projeto):
#   sudo bash deploy/logs-tempo-real.sh            # diagnóstico + escuta 10 min
#   sudo bash deploy/logs-tempo-real.sh 1800       # escuta 30 min
#   sudo bash deploy/logs-tempo-real.sh 0          # só diagnóstico, sem escutar
#
# Somente leitura: não altera nada. Não mostra tokens nem chaves.
# Tudo também é salvo em /tmp/logs-tempo-real.txt
# Ctrl+C para parar a escuta.
# ============================================================
set -uo pipefail
export PAGER=cat PSQL_PAGER=cat LESS=FRX

if [ -t 1 ] && [ -z "${LTR_NO_TTY:-}" ]; then
  LTR_NO_TTY=1 "$0" "$@" 2>&1 | tee /tmp/logs-tempo-real.txt
  echo ""
  echo "Log salvo em /tmp/logs-tempo-real.txt"
  exit 0
fi

SEGUNDOS="${1:-600}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
for f in "$ROOT/deploy/postgres-stack/.env" "$ROOT/deploy/postgres-stack/secrets.env"; do
  [ -f "$f" ] && { set -a; . "$f"; set +a; }
done

DB="${DB_CONTAINER:-zapmro-db}"
FN="${FN_CONTAINER:-zapmro-functions}"
GW="http://127.0.0.1:${GATEWAY_PORT:-8000}"
PGDB="${POSTGRES_DB:-postgres}"

sql() {
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB" \
    psql -U "${POSTGRES_USER:-postgres}" -d "$PGDB" -P pager=off -v ON_ERROR_STOP=0 -c "$1" 2>&1
}
sqlraw() {
  docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB" \
    psql -U "${POSTGRES_USER:-postgres}" -d "$PGDB" -At -F '|' -v ON_ERROR_STOP=0 -c "$1" 2>/dev/null
}
titulo() { echo ""; echo "========================================================"; echo " $1"; echo "========================================================"; }

titulo "0) Containers e serviços"
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'zapmro|gateway|storage|functions|db' || echo "nenhum container zapmro encontrado"
systemctl is-active zapmro-flow-ticker >/dev/null 2>&1 \
  && echo "zapmro-flow-ticker: ATIVO (fluxos + disparo em massa)" \
  || echo "zapmro-flow-ticker: PARADO  -> sudo systemctl restart zapmro-flow-ticker"

titulo "1) Arquivos do Agente I.A. — o arquivo existe de verdade?"
sqlraw "SELECT d.code, d.is_active, coalesce(n.meta_display_phone_number, n.label, 'sem número'), d.media_url
          FROM public.crm_ai_documents d
          LEFT JOIN public.crm_whatsapp_numbers n ON n.id = d.whatsapp_number_id
         ORDER BY d.created_at DESC LIMIT 40" | while IFS='|' read -r code ativo numero url; do
  [ -z "$code" ] && continue
  path="$(echo "$url" | sed -nE 's#.*/storage/v1/object/(public/)?##p')"
  if [ -n "$path" ]; then
    st=$(curl -s -o /dev/null -w '%{http_code}' -I -m 15 "$GW/storage/v1/object/public/$path" || echo 000)
  else
    st=$(curl -s -o /dev/null -w '%{http_code}' -I -m 15 "$url" || echo 000)
  fi
  if [ "$st" = "200" ]; then res="OK (arquivo existe)"; else res="FALTANDO (HTTP $st) -> remova e adicione de novo"; fi
  printf '%-22s ativo=%-5s numero=%-16s %s\n' "$code" "$ativo" "$numero" "$res"
done

titulo "2) Últimas tentativas de envio de arquivos pelo Agente (24h)"
sql "SELECT created_at::timestamp(0) AS quando, metadata->>'ai_document_code' AS codigo, status,
            coalesce(left(error_message, 120), '') AS erro
       FROM public.crm_messages
      WHERE metadata ? 'ai_document_code' AND created_at > now() - interval '24 hours'
      ORDER BY created_at DESC LIMIT 20;"

titulo "3) Disparo em massa — campanhas recentes"
sql "SELECT left(id::text, 8) AS id, left(name, 28) AS campanha, status, type,
            sent_count AS enviados, failed_count AS falhas, total_contacts AS total,
            next_run_at::timestamp(0) AS proximo_envio,
            coalesce(left(last_error, 90), '') AS ultimo_erro,
            updated_at::timestamp(0) AS atualizada
       FROM public.crm_broadcasts ORDER BY created_at DESC LIMIT 10;"

titulo "4) Disparo em massa — itens por status (campanhas ativas)"
sql "SELECT left(b.name, 28) AS campanha, i.status, count(*) AS qtd,
            coalesce(left(max(i.error_message), 90), '') AS exemplo_erro
       FROM public.crm_broadcast_items i
       JOIN public.crm_broadcasts b ON b.id = i.broadcast_id
      WHERE b.status IN ('pending','running','paused') OR b.updated_at > now() - interval '6 hours'
      GROUP BY b.name, i.status ORDER BY b.name, qtd DESC LIMIT 40;"

titulo "5) Agendador do banco (pg_cron) — jobs de disparo/fluxo"
sql "SELECT jobid, jobname, schedule, active, database FROM cron.job
      WHERE jobname ~* 'broadcast|scheduled|flow' ORDER BY jobname;"
sql "SELECT j.jobname, d.status, left(coalesce(d.return_message,''), 100) AS retorno,
            d.start_time::timestamp(0) AS inicio
       FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
      WHERE j.jobname ~* 'broadcast' ORDER BY d.start_time DESC LIMIT 5;"
sql "SELECT status_code, left(coalesce(error_msg, ''), 100) AS erro, count(*) AS qtd
       FROM net._http_response WHERE created > now() - interval '10 minutes'
      GROUP BY 1, 2 ORDER BY qtd DESC LIMIT 10;"

titulo "6) Chamada de teste ao broadcast-worker (pelo gateway local)"
if [ -n "${SERVICE_ROLE_KEY:-}" ]; then
  curl -s -m 90 -X POST "$GW/functions/v1/broadcast-worker" \
    -H "Content-Type: application/json" -H "apikey: ${ANON_KEY:-}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" --data '{}' | head -c 600; echo
else
  echo "SERVICE_ROLE_KEY ausente no .env — não foi possível testar."
fi

titulo "7) Últimos logs do ticker (fluxos + disparos)"
journalctl -u zapmro-flow-ticker --since "30 min ago" --no-pager 2>/dev/null | tail -n 20 || true

titulo "8) Erros recentes das functions (últimos 15 min)"
docker logs --since 15m "$FN" 2>&1 \
  | grep -aiE 'AI-DOC-FAIL|document_send|documents_|BROADCAST|\[UPLOAD\]|\[MEDIA\] ERRO|Falha ao baixar' \
  | tail -n 40 || true

[ "$SEGUNDOS" = "0" ] && exit 0

titulo "9) ESCUTANDO EM TEMPO REAL por ${SEGUNDOS}s — mande agora a mensagem de teste / inicie o disparo"
echo "(Ctrl+C para parar)"
{
  docker logs -f --since 2s "$FN" 2>&1 &
  journalctl -fu zapmro-flow-ticker -n 0 --no-pager 2>/dev/null &
  wait
} | timeout "$SEGUNDOS" grep -aiE --line-buffered \
    'AI-DOC-FAIL|document_|documents_|\[AI-AUTO\]|\[AI-AGENT\]|BROADCAST|broadcast-ticker|\[SEND-MESSAGE\]|\[UPLOAD\]|\[MEDIA|\[WINDOW\]|Falha|ERRO|error'
echo ""
echo "Escuta encerrada."
