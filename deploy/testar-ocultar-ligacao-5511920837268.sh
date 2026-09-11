#!/usr/bin/env bash
# Teste controlado da visibilidade do botão de ligação para +55 11 92083-7268.
# Faz backup integral do GET /settings ANTES de qualquer POST, altera somente
# calling.status e calling.call_icon_visibility, e salva o estado DEPOIS.

set -Eeuo pipefail
umask 077

readonly TARGET_DISPLAY="+55 11 92083-7268"
readonly TARGET_E164="5511920837268"
readonly TARGET_NATIONAL="11920837268"
readonly API_BASE="https://graph.facebook.com/v21.0"
readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ENV_FILE="$ROOT/deploy/postgres-stack/.env"
readonly SECRETS_FILE="$ROOT/deploy/postgres-stack/secrets.env"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
section() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
die() { red "ERRO: $*"; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "execute como root: sudo bash deploy/testar-ocultar-ligacao-5511920837268.sh"
[[ -f "$ENV_FILE" ]] || die "não encontrei $ENV_FILE"
command -v psql >/dev/null || die "psql não está instalado"
command -v curl >/dev/null || die "curl não está instalado"
command -v jq >/dev/null || die "jq não está instalado"

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
[[ ! -f "$SECRETS_FILE" ]] || . "$SECRETS_FILE"
set +a

readonly DB="postgresql://postgres:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD ausente}@127.0.0.1:${PG_PORT:-5432}/${POSTGRES_DB:-postgres}"
q1() { psql "$DB" -v ON_ERROR_STOP=1 -X -qAt -P pager=off -c "$1"; }
[[ "$(q1 'select 1')" == "1" ]] || die "não foi possível consultar o PostgreSQL"

section "1) Localizando o número no banco"

# A busca é fixa e exata após remover pontuação. O token permanece somente em
# memória e é enviado ao curl pela entrada padrão; ele nunca é impresso.
ROWS="$(psql "$DB" -v ON_ERROR_STOP=1 -X -qAt -F $'\t' -P pager=off -c "
    select n.id::text,
           coalesce(n.meta_phone_number_id, ''),
           coalesce(n.meta_access_token, ''),
           coalesce(n.meta_display_phone_number, ''),
           'crm_whatsapp_numbers'
      from public.crm_whatsapp_numbers n
     where regexp_replace(coalesce(n.meta_display_phone_number, ''), '[^0-9]', '', 'g')
           in ('5511920837268', '11920837268');")"

if [[ -z "$ROWS" ]]; then
  LEGACY_COLUMNS="$(q1 "select count(*) from information_schema.columns where table_schema='public' and table_name='crm_settings' and column_name in ('meta_display_phone_number','meta_phone_number_id','meta_access_token')")"
  if [[ "$LEGACY_COLUMNS" == "3" ]]; then
    ROWS="$(psql "$DB" -v ON_ERROR_STOP=1 -X -qAt -F $'\t' -P pager=off -c "
        select s.user_id::text,
               coalesce(s.meta_phone_number_id, ''),
               coalesce(s.meta_access_token, ''),
               coalesce(s.meta_display_phone_number, ''),
               'crm_settings (legado)'
          from public.crm_settings s
         where regexp_replace(coalesce(s.meta_display_phone_number, ''), '[^0-9]', '', 'g')
               in ('5511920837268', '11920837268');")"
  fi
fi

ROW_COUNT="$(printf '%s\n' "$ROWS" | sed '/^$/d' | wc -l | tr -d ' ')"
[[ "$ROW_COUNT" == "1" ]] || die "esperava exatamente 1 cadastro para $TARGET_DISPLAY, mas encontrei $ROW_COUNT; nada foi alterado"

IFS=$'\t' read -r RECORD_ID PHONE_NUMBER_ID ACCESS_TOKEN STORED_NUMBER SOURCE <<< "$ROWS"
[[ -n "$PHONE_NUMBER_ID" ]] || die "PHONE_NUMBER_ID está vazio; nada foi alterado"
[[ "$PHONE_NUMBER_ID" =~ ^[0-9]+$ ]] || die "PHONE_NUMBER_ID inválido; nada foi alterado"
[[ -n "$ACCESS_TOKEN" ]] || die "meta_access_token está vazio; nada foi alterado"

printf 'Cadastro: %s\n' "$RECORD_ID"
printf 'Origem: %s\n' "$SOURCE"
printf 'Número armazenado: %s\n' "${STORED_NUMBER:-$TARGET_DISPLAY}"
printf 'PHONE_NUMBER_ID: %s\n' "$PHONE_NUMBER_ID"
printf 'meta_access_token: localizado e mantido em sigilo (%s caracteres)\n' "${#ACCESS_TOKEN}"

readonly STAMP="$(date -u +%Y%m%d-%H%M%S)"
readonly BEFORE="/root/backup-whatsapp-settings-${TARGET_E164}-ANTES-${STAMP}.json"
readonly AFTER="/root/backup-whatsapp-settings-${TARGET_E164}-DEPOIS-${STAMP}.json"
readonly POST_RESPONSE="/root/backup-whatsapp-settings-${TARGET_E164}-POST-${STAMP}.json"
readonly REPORT="/root/backup-whatsapp-settings-${TARGET_E164}-RELATORIO-${STAMP}.txt"
readonly DIFF_FILE="/root/backup-whatsapp-settings-${TARGET_E164}-COMPARACAO-${STAMP}.diff"
TMP_BODY="$(mktemp /root/.whatsapp-settings-body.XXXXXX)"
trap 'rm -f "$TMP_BODY"' EXIT

meta_request() {
  local method="$1" output="$2" payload="${3:-}" status
  local -a args=(--silent --show-error --connect-timeout 10 --max-time 45
    --request "$method" --output "$TMP_BODY" --write-out '%{http_code}'
    --header 'Accept: application/json')

  if [[ "$method" == "POST" ]]; then
    args+=(--header 'Content-Type: application/json' --data "$payload")
  fi

  : > "$TMP_BODY"
  # --config - evita expor o token na linha de comando/process list.
  if ! status="$(printf 'header = "Authorization: Bearer %s"\n' "$ACCESS_TOKEN" \
      | curl --config - "${args[@]}" "$API_BASE/$PHONE_NUMBER_ID/settings")"; then
    cp "$TMP_BODY" "$output"
    printf '%s' "000"
    return 1
  fi
  cp "$TMP_BODY" "$output"
  printf '%s' "$status"
}

is_success_response() {
  local status="$1" file="$2"
  [[ "$status" =~ ^2[0-9][0-9]$ ]] && jq -e . "$file" >/dev/null 2>&1 \
    && ! jq -e 'has("error")' "$file" >/dev/null 2>&1
}

write_report_header() {
  {
    printf 'Teste: ocultar botão de ligação — %s\n' "$TARGET_DISPLAY"
    printf 'PHONE_NUMBER_ID: %s\n' "$PHONE_NUMBER_ID"
    printf 'Data/hora UTC: %s\n' "$(date -u --iso-8601=seconds)"
    printf 'Data/hora São Paulo: %s\n' "$(TZ=America/Sao_Paulo date --iso-8601=seconds)"
    printf 'Backup ANTES: %s\n' "$BEFORE"
    printf 'Resposta POST: %s\n' "$POST_RESPONSE"
    printf 'Backup DEPOIS: %s\n' "$AFTER"
  } > "$REPORT"
}

write_report_header

section "2) Backup obrigatório do estado ANTES"
BEFORE_STATUS="$(meta_request GET "$BEFORE")" || {
  printf 'HTTP GET ANTES: %s\nResultado: falha de transporte; nenhum POST executado\n' "$BEFORE_STATUS" >> "$REPORT"
  die "GET inicial falhou (HTTP $BEFORE_STATUS). Resposta preservada em $BEFORE; nenhum POST foi executado"
}
printf 'HTTP GET ANTES: %s\n' "$BEFORE_STATUS" >> "$REPORT"
if ! is_success_response "$BEFORE_STATUS" "$BEFORE"; then
  printf 'Resultado: GET inicial recusado ou resposta inválida; nenhum POST executado\n' >> "$REPORT"
  red "Resposta completa da Meta:"
  cat "$BEFORE" >&2
  die "GET inicial inválido (HTTP $BEFORE_STATUS); nenhum POST foi executado"
fi
[[ -s "$BEFORE" ]] || die "backup ANTES ficou vazio; nenhum POST foi executado"
jq . "$BEFORE" > "${BEFORE}.validado" && mv "${BEFORE}.validado" "$BEFORE"
green "Backup ANTES salvo: $BEFORE"
printf 'HTTP status: %s\n' "$BEFORE_STATUS"
cat "$BEFORE"

section "3) Confirmação da única alteração autorizada"
cat <<EOF
Será enviado SOMENTE:
{
  "calling": {
    "status": "ENABLED",
    "call_icon_visibility": "DISABLE_ALL"
  }
}

Nenhuma configuração de storage, WABA, Cloud API ou Coexistência será alterada.
EOF
read -r -p "Para prosseguir, digite exatamente ${TARGET_E164}: " CONFIRMATION
[[ "$CONFIRMATION" == "$TARGET_E164" ]] || die "confirmação não confere; backup mantido e nenhum POST foi executado"

readonly PAYLOAD='{"calling":{"status":"ENABLED","call_icon_visibility":"DISABLE_ALL"}}'

section "4) Aplicando somente a configuração de calling"
POST_STATUS="$(meta_request POST "$POST_RESPONSE" "$PAYLOAD")" || {
  printf 'HTTP POST: %s\nResultado: falha de transporte; nenhuma nova alteração será tentada\n' "$POST_STATUS" >> "$REPORT"
  die "POST falhou (HTTP $POST_STATUS). Resposta preservada em $POST_RESPONSE; pare o teste"
}
printf 'HTTP POST: %s\n' "$POST_STATUS" >> "$REPORT"
if ! is_success_response "$POST_STATUS" "$POST_RESPONSE"; then
  printf 'Resultado: POST recusado; nenhuma nova alteração será tentada\n' >> "$REPORT"
  red "Resposta completa da Meta:"
  cat "$POST_RESPONSE" >&2
  die "Meta recusou o POST (HTTP $POST_STATUS); pare o teste"
fi
green "POST aceito pela Meta (HTTP $POST_STATUS)."
cat "$POST_RESPONSE"

section "5) Consultando e salvando o estado DEPOIS"
AFTER_STATUS="$(meta_request GET "$AFTER")" || {
  printf 'HTTP GET DEPOIS: %s\nResultado: falha ao confirmar; não faça novas alterações\n' "$AFTER_STATUS" >> "$REPORT"
  die "GET posterior falhou (HTTP $AFTER_STATUS). Não faça novas alterações"
}
printf 'HTTP GET DEPOIS: %s\n' "$AFTER_STATUS" >> "$REPORT"
if ! is_success_response "$AFTER_STATUS" "$AFTER"; then
  printf 'Resultado: GET posterior recusado ou inválido; não faça novas alterações\n' >> "$REPORT"
  red "Resposta completa da Meta:"
  cat "$AFTER" >&2
  die "GET posterior inválido (HTTP $AFTER_STATUS). Não faça novas alterações"
fi
jq . "$AFTER" > "${AFTER}.validado" && mv "${AFTER}.validado" "$AFTER"
green "Backup DEPOIS salvo: $AFTER"
cat "$AFTER"

section "6) Comparação ANTES x DEPOIS"
diff -u "$BEFORE" "$AFTER" > "$DIFF_FILE" || true
cat "$DIFF_FILE"
printf 'HTTP GET DEPOIS: %s\nComparação: %s\nResultado: teste de API concluído\n' "$AFTER_STATUS" "$DIFF_FILE" >> "$REPORT"

cat <<EOF

Arquivos preservados (permissão somente root):
  ANTES:     $BEFORE
  POST:      $POST_RESPONSE
  DEPOIS:    $AFTER
  COMPARAÇÃO:$DIFF_FILE
  RELATÓRIO: $REPORT

Teste prático agora:
  1. Em outro celular, abra o WhatsApp deste número e confira se “Ligar” sumiu.
  2. No celular com WhatsApp Business, confirme que ele continua conectado.
  3. Teste mensagens nos dois sentidos.
  4. Teste uma ligação iniciada pelo próprio WhatsApp Business.
  5. Confirme envio e recebimento pelo SaaS/Cloud API.

Não apague o arquivo ANTES até confirmar todo o teste. Se algo falhar, não faça
novas alterações; envie os arquivos acima e os HTTP status do relatório.
EOF
