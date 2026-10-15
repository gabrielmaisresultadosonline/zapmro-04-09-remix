#!/usr/bin/env bash
# Diagnóstico SOMENTE LEITURA dos disparos em massa e do painel Admin Central.
# Uso: sudo bash deploy/diagnosticar-disparos.sh
# Não mostra tokens nem chaves; só status, contagens e códigos de erro.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="deploy/postgres-stack/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Arquivo $ENV_FILE não encontrado. Rode na VPS, na pasta do projeto." >&2
  exit 1
fi

DB_CONTAINER="${DB_CONTAINER:-zapmro-db}"
if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "Container $DB_CONTAINER não está rodando." >&2
  exit 1
fi

run_sql() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1"
}

echo "============================================================"
echo " 1) Últimas 10 campanhas de disparo"
echo "============================================================"
run_sql "
SELECT id, LEFT(name, 30) AS campanha, status, type,
       sent_count, failed_count, total_contacts,
       COALESCE(LEFT(last_error, 80), '') AS ultimo_erro,
       created_at::timestamp(0) AS criada, updated_at::timestamp(0) AS atualizada
FROM public.crm_broadcasts
ORDER BY created_at DESC
LIMIT 10;"

echo
echo "============================================================"
echo " 2) Itens da campanha mais recente (resumo por status)"
echo "============================================================"
run_sql "
WITH ultima AS (SELECT id FROM public.crm_broadcasts ORDER BY created_at DESC LIMIT 1)
SELECT i.status, count(*) AS total,
       COALESCE(LEFT(i.error_code, 30), '') AS codigo_erro,
       COALESCE(LEFT(i.error_message, 80), '') AS mensagem_erro
FROM public.crm_broadcast_items i
JOIN ultima u ON u.id = i.broadcast_id
GROUP BY i.status, i.error_code, i.error_message
ORDER BY total DESC;"

echo
echo "============================================================"
echo " 3) Itens marcados como ENVIADOS mas que a Meta depois"
echo "    informou FALHA de entrega (mensagem não chegou)"
echo "============================================================"
run_sql "
SELECT count(*) AS enviados_com_falha_de_entrega
FROM public.crm_broadcast_items i
JOIN public.crm_messages m
  ON m.meta_message_id = i.meta_message_id AND m.user_id = i.user_id
WHERE i.status = 'sent' AND m.status = 'failed';"

echo
echo "============================================================"
echo " 4) Erros da Meta nas últimas 24h (códigos mais comuns)"
echo "============================================================"
run_sql "
SELECT COALESCE(error_code, '(sem código)') AS codigo, count(*) AS total,
       COALESCE(LEFT(error_message, 90), '') AS mensagem
FROM public.crm_messages
WHERE direction = 'outbound' AND status = 'failed'
  AND created_at > now() - interval '24 hours'
GROUP BY error_code, error_message
ORDER BY total DESC
LIMIT 10;"

echo
echo "============================================================"
echo " 5) Tabela do 'Conectados agora' (Admin Central)"
echo "============================================================"
run_sql "
SELECT CASE WHEN to_regclass('public.crm_client_reload_signals') IS NOT NULL
            THEN 'OK — tabela existe'
            ELSE 'FALTANDO — rode sudo bash deploy/atualizar.sh para aplicar a migração 129'
       END AS tabela_sinais;"
run_sql "
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
           AND tablename = 'crm_client_reload_signals')
            THEN 'OK — tempo real ligado'
            ELSE 'FALTANDO — tabela fora da publicação de tempo real'
       END AS realtime;"

echo
echo "============================================================"
echo " 6) Números de WhatsApp por cadastro (o que o Admin mostra)"
echo "============================================================"
run_sql "
SELECT u.email, count(n.id) AS numeros_na_lista,
       count(n.id) FILTER (WHERE n.meta_access_token IS NOT NULL AND n.meta_phone_number_id IS NOT NULL) AS conectados
FROM auth.users u
LEFT JOIN public.crm_whatsapp_numbers n ON n.user_id = u.id
GROUP BY u.email, u.created_at
ORDER BY u.created_at DESC
LIMIT 15;"
run_sql "
SELECT count(*) AS cadastros_com_conexao_so_em_crm_settings
FROM public.crm_settings s
WHERE s.meta_phone_number_id IS NOT NULL AND s.meta_access_token IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.crm_whatsapp_numbers n WHERE n.user_id = s.user_id);"

echo
echo "============================================================"
echo " 7) Worker de disparos: últimas campanhas com batimento"
echo "    (se updated_at estiver parado, o worker não está rodando)"
echo "============================================================"
run_sql "
SELECT id, LEFT(name, 30) AS campanha, status,
       last_heartbeat_at::timestamp(0) AS ultimo_batimento,
       now()::timestamp(0) AS agora
FROM public.crm_broadcasts
WHERE status IN ('pending', 'running')
ORDER BY updated_at DESC
LIMIT 5;"

echo
echo "Pronto. Se a campanha está 'running' sem batimento recente, o worker"
echo "não está sendo chamado — rode: sudo bash deploy/atualizar.sh"
echo "Se os itens estão 'sent' mas há falhas no item 3 ou 4, a Meta aceitou"
echo "o envio e depois recusou a entrega (veja o código do erro no item 4)."
