#!/usr/bin/env bash
# Diagnóstico de um número na Meta (não mostra o token).
# Uso: sudo bash deploy/diagnostico-numero-meta.sh 75992171512 [numero_destino_teste]
set -u
FINAL="${1:?Informe o número conectado (só dígitos)}"; DEST="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in "$ROOT/deploy/postgres-stack/.env" "$ROOT/deploy/postgres-stack/secrets.env"; do [ -f "$f" ] && { set -a; . "$f"; set +a; }; done
DB="${DB_CONTAINER:-zapmro-db}"; G="https://graph.facebook.com/v25.0"
FIM="${FINAL: -8}"
LINHA=$(docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$DB" psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -At -F '|' -c \
 "select meta_phone_number_id, meta_waba_id, meta_access_token from public.crm_whatsapp_numbers where regexp_replace(coalesce(meta_display_phone_number,''),'\D','','g') like '%${FIM}' and meta_access_token is not null order by updated_at desc nulls last limit 1" 2>/dev/null)
[ -z "$LINHA" ] && { echo "Número terminado em $FIM não encontrado com credenciais."; exit 1; }
IFS='|' read -r PID WABA TOKEN <<<"$LINHA"
echo "phone_number_id=$PID  waba_id=$WABA"
api(){ curl -sS -H "Authorization: Bearer $TOKEN" "$@"; echo; }
echo; echo "== NÚMERO (status, qualidade, limite, saúde) =="
api "$G/$PID?fields=display_phone_number,verified_name,status,name_status,quality_rating,messaging_limit_tier,code_verification_status,platform_type,is_on_biz_app,health_status"
echo; echo "== CONTA WABA (revisão, país, pagamento, saúde) =="
api "$G/$WABA?fields=name,account_review_status,business_verification_status,country,currency,primary_funding_id,ownership_type,health_status"
echo; echo "== TEMPLATES APROVADOS (primeiros 5) =="
api "$G/$WABA/message_templates?fields=name,status,language,category&limit=5"
if [ -n "$DEST" ]; then
  echo; echo "== ENVIO DE TESTE (template hello_world) para $DEST =="
  api -X POST "$G/$PID/messages" -H 'Content-Type: application/json' \
    -d "{\"messaging_product\":\"whatsapp\",\"to\":\"$DEST\",\"type\":\"template\",\"template\":{\"name\":\"hello_world\",\"language\":{\"code\":\"en_US\"}}}"
fi
echo; echo "Procure em health_status.entities os itens 'can_send_message: BLOCKED' e o campo 'errors' (motivo e solução da Meta)."
