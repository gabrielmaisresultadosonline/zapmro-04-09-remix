#!/usr/bin/env bash
# ============================================================================
# Script: Configurar Chamadas WhatsApp (Meta Cloud API)
# ============================================================================
set -uo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. Requisitos e Verificações Iniciais
PNID="${1:-}"
if [ -z "$PNID" ]; then
    echo -e "${RED}Erro: Phone Number ID não fornecido.${NC}"
    echo "Uso: $0 <PHONE_NUMBER_ID>"
    exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$RAIZ/deploy/postgres-stack/.env"
SECRETS_FILE="$RAIZ/deploy/postgres-stack/secrets.env"
API_VERSION="v21.0"
API_BASE="https://graph.facebook.com/$API_VERSION"

# Verificar dependências
for cmd in psql jq curl diff; do
    if ! command -v $cmd &> /dev/null; then
        echo -e "${RED}Erro: Dependência '$cmd' não encontrada.${NC}"
        exit 1
    fi
done

# Carregar variáveis de ambiente
if [ -f "$ENV_FILE" ]; then source "$ENV_FILE"; fi
if [ -f "$SECRETS_FILE" ]; then source "$SECRETS_FILE"; fi

# Construir string de conexão (Compatibilidade com stack existente)
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${PG_PORT:-5432}/${POSTGRES_DB:-postgres}"

# 2. Buscar Token (Sem exibir no terminal)
echo -n "Buscando token no banco de dados... "
TOKEN=$(psql "$DB_URL" -t -A -c "SELECT meta_access_token FROM public.crm_whatsapp_numbers WHERE meta_phone_number_id = '$PNID' LIMIT 1;")

if [ -z "$TOKEN" ] || [ "$TOKEN" == "NULL" ]; then
    echo -e "${RED}FALHA${NC}"
    echo "Erro: Token não encontrado para o número $PNID em crm_whatsapp_numbers."
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# Função para chamadas API com log e status code
call_api() {
    local method="$1"
    local path="$2"
    local data="${3:-}"
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local output_file="backup_${path//\//_}_${timestamp}.json"
    
    local curl_opts=("-s" "-w" "%{http_code}" "-o" "$output_file" "-H" "Authorization: Bearer $TOKEN")
    if [ -n "$data" ]; then
        curl_opts+=("-X" "$method" "-H" "Content-Type: application/json" "-d" "$data")
    else
        curl_opts+=("-X" "$method")
    fi

    local status_code=$(curl "${curl_opts[@]}" "$API_BASE/$PNID/$path")
    
    if [[ "$status_code" -lt 200 || "$status_code" -gt 299 ]]; then
        echo -e "${RED}Erro na API ($status_code). Verifique $output_file${NC}"
        cat "$output_file" | jq . 2>/dev/null || cat "$output_file"
        exit 1
    fi
    
    echo "$output_file"
}

# 3. GET Inicial (Backup)
echo -n "Realizando backup das configurações atuais... "
BACKUP_BEFORE=$(call_api "GET" "settings")
echo -e "${GREEN}Concluído ($BACKUP_BEFORE)${NC}"

# 4. Aplicar Configurações
# Payload: calling.status=ENABLED, call_icon_visibility=DISABLE_ALL
echo -n "Aplicando novas configurações (calling: ENABLED, visibility: DISABLE_ALL)... "
PAYLOAD='{"calling":{"status":"ENABLED"},"call_icon_visibility":"DISABLE_ALL"}'
UPDATE_RES=$(call_api "POST" "settings" "$PAYLOAD")
echo -e "${GREEN}OK${NC}"

# 5. GET Posterior e Comparação
echo -n "Verificando alterações... "
BACKUP_AFTER=$(call_api "GET" "settings")

# Comparar campos específicos usando jq
BEFORE_VALS=$(jq -c '{calling: .calling, call_icon_visibility: .call_icon_visibility}' "$BACKUP_BEFORE")
AFTER_VALS=$(jq -c '{calling: .calling, call_icon_visibility: .call_icon_visibility}' "$BACKUP_AFTER")

if [ "$BEFORE_VALS" == "$AFTER_VALS" ]; then
    echo -e "${YELLOW}Aviso: Nenhuma alteração detectada nos campos alvo (já estavam configurados?).${NC}"
else
    echo -e "${GREEN}Alteração detectada e confirmada.${NC}"
    diff <(echo "$BEFORE_VALS" | jq .) <(echo "$AFTER_VALS" | jq .) || true
fi

echo -e "\n${GREEN}Processo concluído com sucesso.${NC}"
