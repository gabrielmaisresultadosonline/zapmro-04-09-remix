#!/usr/bin/env bash
# =============================================================================
#  zapmro-flow-ticker.sh — mantém fluxos, esperas e gatilhos rodando na VPS
#  mesmo com TODAS as abas do CRM fechadas.
#
#  Por que existe: o pg_cron chama processScheduled pelo pg_net (de dentro do
#  container do banco, muitas vezes pela URL pública). Se esse caminho falhar
#  (DNS/hairpin, fila do pg_net, job não criado), os delays só avançavam quando
#  o navegador estava aberto, porque o CRM também chama processScheduled.
#
#  Este serviço roda no host (systemd) e chama a function diretamente pelo
#  gateway local 127.0.0.1. Cada chamada processa os delays vencidos e fica
#  ~13s olhando a fila a cada 1s, então o laço é praticamente contínuo.
#  A reserva atômica em crm_contacts impede envio duplicado, mesmo com o
#  pg_cron e o navegador chamando em paralelo. Não altera nenhum dado além
#  do que processScheduled já altera.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"

load_env() {
  if [ -f "$STACK/.env" ]; then
    set -a; . "$STACK/.env"; set +a
  fi
}

load_env

# --- Disparo em massa: mesmo motivo dos fluxos. Se o pg_cron/pg_net não chamar
# o broadcast-worker (ex.: banco restaurado sem os jobs), a fila não anda.
# Este laço chama o worker pelo gateway local; o "lease" no banco impede que
# duas chamadas mandem a mesma campanha ao mesmo tempo.
broadcast_loop() {
  local streak=0
  while true; do
    load_env
    if [ -z "${SERVICE_ROLE_KEY:-}" ]; then sleep 30; continue; fi
    local bcode
    bcode=$(curl -s -o /tmp/zapmro-broadcast-ticker.last.json -w '%{http_code}' -m 90 \
      -X POST "http://127.0.0.1:${GATEWAY_PORT:-8000}/functions/v1/broadcast-worker" \
      -H "Content-Type: application/json" \
      -H "apikey: ${ANON_KEY:-}" \
      -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
      --data '{}' 2>/dev/null || echo 000)
    if grep -q '"processed":1' /tmp/zapmro-broadcast-ticker.last.json 2>/dev/null; then
      echo "[broadcast-ticker] $(date -u +%FT%TZ) enviou: $(head -c 200 /tmp/zapmro-broadcast-ticker.last.json)"
    fi
    if [ "${bcode:0:1}" = "2" ]; then
      streak=0
      sleep 5
    else
      streak=$((streak + 1))
      if [ "$streak" -eq 1 ] || [ $((streak % 20)) -eq 0 ]; then
        echo "[broadcast-ticker] $(date -u +%FT%TZ) falha HTTP $bcode (seguidas: $streak): $(head -c 300 /tmp/zapmro-broadcast-ticker.last.json 2>/dev/null)"
      fi
      sleep 15
    fi
  done
}
broadcast_loop &
trap 'kill $(jobs -p) 2>/dev/null' EXIT

fail_streak=0
last_env_reload=$(date +%s)

while true; do
  # Recarrega as chaves a cada 5 min (caso o .env seja atualizado).
  now=$(date +%s)
  if [ $((now - last_env_reload)) -ge 300 ]; then
    load_env
    last_env_reload=$now
  fi

  if [ -z "${SERVICE_ROLE_KEY:-}" ]; then
    echo "[flow-ticker] SERVICE_ROLE_KEY ausente em $STACK/.env — aguardando"
    sleep 30
    load_env
    continue
  fi

  url="http://127.0.0.1:${GATEWAY_PORT:-8000}/functions/v1/meta-whatsapp-crm"
  code=$(curl -s -o /tmp/zapmro-flow-ticker.last.json -w '%{http_code}' -m 90 \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "apikey: ${ANON_KEY:-}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    --data "{\"action\":\"processScheduled\",\"source\":\"host-ticker\",\"ts\":\"$(date -u +%FT%TZ)\"}" \
    2>/dev/null || echo 000)

  if [ "${code:0:1}" = "2" ]; then
    if [ "$fail_streak" -gt 0 ]; then
      echo "[flow-ticker] $(date -u +%FT%TZ) voltou a responder (HTTP $code)"
    fi
    fail_streak=0
    sleep 1
  else
    fail_streak=$((fail_streak + 1))
    # Evita encher o log: registra a 1ª falha e depois a cada 20.
    if [ "$fail_streak" -eq 1 ] || [ $((fail_streak % 20)) -eq 0 ]; then
      echo "[flow-ticker] $(date -u +%FT%TZ) falha HTTP $code (seguidas: $fail_streak): $(head -c 300 /tmp/zapmro-flow-ticker.last.json 2>/dev/null)"
    fi
    # Recuo curto: functions podem estar reiniciando durante uma atualização.
    sleep $(( fail_streak < 6 ? 5 : 15 ))
  fi
done
