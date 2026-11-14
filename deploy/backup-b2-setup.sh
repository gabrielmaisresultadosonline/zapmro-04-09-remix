#!/usr/bin/env bash
# =============================================================================
#  backup-b2-setup.sh — configura a cópia de segurança FORA do servidor
#                       (Backblaze B2) uma única vez.
#
#  O que você faz antes (2 minutos):
#    1) Crie um bucket PRIVADO em https://www.backblaze.com/console/home/buckets
#    2) Crie uma chave de aplicação em
#       https://www.backblaze.com/console/home/application-keys
#       (permissão de leitura e escrita no bucket)
#    3) Coloque estas 3 linhas no final de deploy/postgres-stack/.env:
#         ZAPMRO_B2_ACCOUNT_ID=<keyID>
#         ZAPMRO_B2_APPLICATION_KEY=<applicationKey>
#         ZAPMRO_B2_BUCKET=<nome-do-bucket>
#
#  Depois:
#      sudo bash deploy/backup-b2-setup.sh
#
#  A partir daí o backup das 03:30 guarda 2 dias no servidor e manda o resto
#  para o B2. Nada é apagado do servidor por este script.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_ENV="$ROOT/deploy/postgres-stack/.env"
[ -f "$STACK_ENV" ] || { echo "✘ não encontrei $STACK_ENV — rode este script na pasta do projeto na VPS"; exit 1; }
set -a; . "$STACK_ENV"; set +a

BUCKET="${ZAPMRO_B2_BUCKET:-}"
KEY_ID="${ZAPMRO_B2_ACCOUNT_ID:-}"
APP_KEY="${ZAPMRO_B2_APPLICATION_KEY:-}"

if [ -z "$BUCKET" ] || [ -z "$KEY_ID" ] || [ -z "$APP_KEY" ]; then
  echo "✘ faltam as chaves do Backblaze no $STACK_ENV. Acrescente no final do arquivo:"
  echo "      ZAPMRO_B2_ACCOUNT_ID=<keyID>"
  echo "      ZAPMRO_B2_APPLICATION_KEY=<applicationKey>"
  echo "      ZAPMRO_B2_BUCKET=<nome-do-bucket>"
  echo "  e rode de novo: sudo bash deploy/backup-b2-setup.sh"
  exit 1
fi

# -----------------------------------------------------------------------------
# 1) rclone
# -----------------------------------------------------------------------------
if ! command -v rclone >/dev/null 2>&1; then
  echo "· instalando o rclone (ferramenta que sobe e baixa os arquivos)"
  apt-get install -y rclone >/dev/null 2>&1 \
    || curl -fsSL https://rclone.org/install.sh | bash >/dev/null 2>&1
fi
command -v rclone >/dev/null 2>&1 || { echo "✘ não consegui instalar o rclone"; exit 1; }
echo "✔ rclone $(rclone version | head -1 | awk '{print $2}')"

# -----------------------------------------------------------------------------
# 2) Descobrir o endereço do bucket (cada bucket fica em uma região)
# -----------------------------------------------------------------------------
CANDIDATOS=()
[ -n "${ZAPMRO_B2_ENDPOINT:-}" ] && CANDIDATOS+=("$ZAPMRO_B2_ENDPOINT")
CANDIDATOS+=(
  s3.us-west.backblazeb2.com
  s3.us-east.backblazeb2.com
  s3.eu-central.backblazeb2.com
  s3.ap-southeast-1.backblazeb2.com
  s3.us-west-004.backblazeb2.com
  s3.us-east-005.backblazeb2.com
  s3.eu-central-003.backblazeb2.com
  s3.ap-northeast-1.backblazeb2.com
)

ESCOLHIDO=""
for EP in "${CANDIDATOS[@]}"; do
  rclone config create zapmro-b2 s3 provider Backblaze \
    access_key_id "$KEY_ID" secret_access_key "$APP_KEY" endpoint "$EP" >/dev/null 2>&1 || continue
  if rclone lsf "zapmro-b2:$BUCKET" --max-depth 1 >/dev/null 2>&1; then
    ESCOLHIDO="$EP"; break
  fi
done

if [ -z "$ESCOLHIDO" ]; then
  # bucket pode ainda não existir — tenta criar e testa de novo
  for EP in "${CANDIDATOS[@]}"; do
    rclone config create zapmro-b2 s3 provider Backblaze \
      access_key_id "$KEY_ID" secret_access_key "$APP_KEY" endpoint "$EP" >/dev/null 2>&1 || continue
    rclone mkdir "zapmro-b2:$BUCKET" >/dev/null 2>&1 || true
    if rclone lsf "zapmro-b2:$BUCKET" --max-depth 1 >/dev/null 2>&1; then ESCOLHIDO="$EP"; break; fi
  done
fi

if [ -z "$ESCOLHIDO" ]; then
  echo "✘ não consegui entrar no bucket '$BUCKET'. Confira: a chave é deste bucket?"
  echo "  o nome está igual ao do painel? se o bucket for de outra região, acrescente no .env:"
  echo "      ZAPMRO_B2_ENDPOINT=s3.<regiao>.backblazeb2.com"
  exit 1
fi
echo "✔ bucket acessível: $BUCKET ($ESCOLHIDO)"

# -----------------------------------------------------------------------------
# 3) Teste de escrita (grava e apaga um arquivo de teste)
# -----------------------------------------------------------------------------
TMP="$(mktemp /tmp/zapmro-b2-teste.XXXXXX)"
echo "teste de escrita $(date -Is)" > "$TMP"
if rclone copyto "$TMP" "zapmro-b2:$BUCKET/_teste.txt" --s3-no-check-bucket >/dev/null 2>&1 \
   && rclone deletefile "zapmro-b2:$BUCKET/_teste.txt" --s3-no-check-bucket >/dev/null 2>&1; then
  echo "✔ consigo gravar e apagar no bucket"
else
  rm -f "$TMP"
  echo "✘ não consegui gravar no bucket — a chave precisa de permissão de escrita"
  exit 1
fi
rm -f "$TMP"

echo "· guardando o endpoint escolhido no $STACK_ENV"
if grep -q '^ZAPMRO_B2_ENDPOINT=' "$STACK_ENV"; then
  sed -i "s|^ZAPMRO_B2_ENDPOINT=.*|ZAPMRO_B2_ENDPOINT=$ESCOLHIDO|" "$STACK_ENV"
else
  printf '\nZAPMRO_B2_ENDPOINT=%s\n' "$ESCOLHIDO" >> "$STACK_ENV"
fi

echo ""
echo "✔ pronto. O backup das 03:30 passa a guardar 2 dias no servidor e o resto no B2."
echo "  conferir:      sudo bash deploy/backup-diario.sh"
echo "  o que há fora: sudo bash deploy/restaurar-backup-b2.sh"
echo "  ⚠ o bucket guarda as conversas dos seus clientes: mantenha-o privado e a chave só com este backup."
