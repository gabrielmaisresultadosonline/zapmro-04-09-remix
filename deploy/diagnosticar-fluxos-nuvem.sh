#!/usr/bin/env bash
# Diagnóstico somente leitura: mostra se os fluxos estão avançando sem o
# navegador aberto (serviço do host + pg_cron + fila de delays).
#   sudo bash deploy/diagnosticar-fluxos-nuvem.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] && { set -a; . "$STACK/.env"; set +a; }
DB_NAME="${POSTGRES_DB:-postgres}"
q() { docker exec -i zapmro-db psql -U postgres -d "$DB_NAME" -At -c "$1" 2>&1; }

echo "== Serviço do host (zapmro-flow-ticker) =="
systemctl is-active zapmro-flow-ticker 2>/dev/null || echo "inativo"
journalctl -u zapmro-flow-ticker -n 10 --no-pager 2>/dev/null | sed 's/^/  /'
echo "  última resposta: $(head -c 300 /tmp/zapmro-flow-ticker.last.json 2>/dev/null)"

echo; echo "== Job pg_cron de fluxos =="
q "select jobid, schedule, active from cron.job where jobname='process-scheduled-flows-every-minute'"
echo "  últimas execuções:"
q "select status, start_time, left(coalesce(return_message,''),120) from cron.job_run_details where jobid=(select jobid from cron.job where jobname='process-scheduled-flows-every-minute') order by start_time desc limit 5" | sed 's/^/  /'
echo "  respostas HTTP recentes do pg_net (status, erro):"
q "select status_code, left(coalesce(error_msg,''),120), created from net._http_response order by created desc limit 5" | sed 's/^/  /'

echo; echo "== Esperas atrasadas agora =="
q "select count(*) as atrasadas_mais_de_30s from public.crm_contacts where flow_state not in ('idle','waiting_response') and next_execution_time is not null and next_execution_time < now() - interval '30 seconds'"
q "select wa_id, flow_state, next_execution_time from public.crm_contacts where flow_state not in ('idle','waiting_response') and next_execution_time is not null and next_execution_time < now() order by next_execution_time limit 10" | sed 's/^/  /'
