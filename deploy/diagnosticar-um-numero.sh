#!/usr/bin/env bash
# Diagnóstico somente leitura de uma caixa ou contato WhatsApp.
# Uso: ./deploy/diagnosticar-um-numero.sh "+55 51 9283-5863" 120
set -uo pipefail

export PAGER=cat PSQL_PAGER=cat LESS=FRX

ALVO_BRUTO="${1:-}"
SEGUNDOS="${2:-120}"
ALVO="$(printf '%s' "$ALVO_BRUTO" | tr -cd '0-9')"

if [ ${#ALVO} -lt 8 ] || [ ${#ALVO} -gt 20 ]; then
  echo "Uso: $0 <telefone ou phone_number_id> [segundos]"
  echo "Exemplo: $0 '+55 51 9283-5863' 120"
  exit 1
fi
if ! [[ "$SEGUNDOS" =~ ^[0-9]+$ ]] || [ "$SEGUNDOS" -lt 5 ] || [ "$SEGUNDOS" -gt 1800 ]; then
  echo "Erro: a duração deve estar entre 5 e 1800 segundos."
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

carregar() {
  [ -f "$1" ] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$1"
  set +a
}
carregar "$ROOT/deploy/postgres-stack/.env"
carregar "$ROOT/deploy/postgres-stack/secrets.env"

DB_CONTAINER="${DB_CONTAINER:-zapmro-db}"
FN_CONTAINER="${FN_CONTAINER:-zapmro-functions}"
PGDB="${POSTGRES_DB:-postgres}"
PGUSER_="${POSTGRES_USER:-postgres}"
PGPASS="${POSTGRES_PASSWORD:-}"

ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
erro() { printf '\033[31m%s\033[0m\n' "$*"; }
titulo() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

q() {
  docker exec -e PGPASSWORD="$PGPASS" -e PAGER=cat "$DB_CONTAINER" \
    psql -U "$PGUSER_" -d "$PGDB" -X -P pager=off -v ON_ERROR_STOP=0 -c "$1" 2>&1
}
q1() {
  docker exec -e PGPASSWORD="$PGPASS" -e PAGER=cat "$DB_CONTAINER" \
    psql -U "$PGUSER_" -d "$PGDB" -X -tA -P pager=off -v ON_ERROR_STOP=0 -c "$1" 2>/dev/null
}

if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  erro "Banco $DB_CONTAINER não está em execução."
  exit 2
fi
if [ "$(q1 'select 1')" != "1" ]; then
  erro "Não foi possível consultar o banco."
  exit 2
fi

# O argumento contém apenas dígitos; ainda assim usamos uma variável do psql
# para evitar interpolar entrada livre nas consultas.
MATCH_NUMBER="regexp_replace(coalesce(n.meta_display_phone_number,''), '[^0-9]', '', 'g') = :'alvo' OR n.meta_phone_number_id = :'alvo'"

titulo "1) Serviços necessários"
for servico in "$DB_CONTAINER" "$FN_CONTAINER" zapmro-rest zapmro-realtime; do
  if docker ps --format '{{.Names}}' | grep -qx "$servico"; then
    ok "OK  $servico está em execução"
  else
    erro "FALHA  $servico não está em execução"
  fi
done

titulo "2) Cadastro da caixa WhatsApp"
NUMEROS="$(docker exec -e PGPASSWORD="$PGPASS" "$DB_CONTAINER" psql -U "$PGUSER_" -d "$PGDB" -X -tA -F'|' -v alvo="$ALVO" -c "
  select n.id, n.user_id, coalesce(n.label,''), coalesce(n.meta_display_phone_number,''),
         coalesce(n.meta_phone_number_id,''), coalesce(n.meta_waba_id,''),
         case when coalesce(n.meta_access_token,'') <> '' then 'sim' else 'nao' end,
         n.is_active, n.is_primary
    from public.crm_whatsapp_numbers n
   where $MATCH_NUMBER
   order by n.is_active desc, n.is_primary desc, n.created_at;" 2>/dev/null)"

if [ -z "$NUMEROS" ]; then
  warn "Nenhuma caixa cadastrada com esse telefone/ID. Procurando como contato..."
else
  q "\set alvo '$ALVO'
    select coalesce(u.email,'(sem e-mail)') as cadastro,
           coalesce(n.label,'(sem nome)') as caixa,
           coalesce(n.meta_display_phone_number,'-') as telefone,
           coalesce(n.meta_phone_number_id,'!! vazio') as phone_number_id,
           coalesce(n.meta_waba_id,'!! vazio') as waba_id,
           case when coalesce(n.meta_access_token,'') <> '' then 'SIM' else 'NAO' end as tem_token,
           n.is_active as ativa, n.is_primary as principal, n.updated_at
      from public.crm_whatsapp_numbers n
      left join auth.users u on u.id = n.user_id
     where $MATCH_NUMBER;"
fi

titulo "3) Agente, fluxos e recebimento"
if [ -n "$NUMEROS" ]; then
  q "\set alvo '$ALVO'
    select coalesce(u.email,'(sem e-mail)') as cadastro,
           s.ai_agent_enabled as agente_geral,
           s.ai_agent_trigger as gatilho_agente,
           case when coalesce(s.openai_api_key,'') <> '' then 'SIM' else 'NAO' end as tem_chave_ia,
           length(coalesce(s.ai_system_prompt,s.ai_agent_prompt,'')) as tamanho_prompt,
           (select count(*) from public.crm_flows f
             where f.user_id=n.user_id and f.is_active=true
               and (f.whatsapp_number_id=n.id or f.whatsapp_number_id is null)) as fluxos_ativos,
           (select count(*) from public.crm_contacts c where c.whatsapp_number_id=n.id) as contatos,
           (select count(*) from public.crm_messages m where m.whatsapp_number_id=n.id and m.direction='inbound') as recebidas,
           (select max(m.created_at) from public.crm_messages m where m.whatsapp_number_id=n.id and m.direction='inbound') as ultima_recebida,
           (select max(m.created_at) from public.crm_messages m where m.whatsapp_number_id=n.id) as ultima_mensagem
      from public.crm_whatsapp_numbers n
      left join auth.users u on u.id=n.user_id
      left join public.crm_settings s on s.user_id=n.user_id
     where $MATCH_NUMBER;"
fi

q "\set alvo '$ALVO'
  select coalesce(u.email,'(sem e-mail)') as cadastro,
         c.wa_id as contato, coalesce(c.name,'(sem nome)') as nome,
         coalesce(n.meta_display_phone_number,'(caixa antiga/sem vínculo)') as caixa,
         c.ai_active as agente_no_contato, c.flow_state,
         c.current_flow_id, c.last_message_received_at,
         (select count(*) from public.crm_messages m where m.contact_id=c.id and m.direction='inbound') as recebidas
    from public.crm_contacts c
    left join public.crm_whatsapp_numbers n on n.id=c.whatsapp_number_id
    left join auth.users u on u.id=c.user_id
   where regexp_replace(coalesce(c.wa_id,''), '[^0-9]', '', 'g') = :'alvo'
   order by c.last_message_received_at desc nulls last
   limit 20;"

titulo "4) Últimos registros (sem mostrar conteúdo)"
if [ -n "$NUMEROS" ]; then
  q "\set alvo '$ALVO'
    select m.direction, m.message_type, m.status,
           case when m.media_url is not null then 'SIM' else 'NAO' end as tem_midia,
           case when m.error_code is not null or m.error_message is not null
                then concat_ws(' - ',m.error_code,m.error_message) else '-' end as erro,
           m.created_at, c.wa_id as remetente
      from public.crm_messages m
      join public.crm_whatsapp_numbers n on n.id=m.whatsapp_number_id
      left join public.crm_contacts c on c.id=m.contact_id
     where $MATCH_NUMBER
     order by m.created_at desc limit 20;"
else
  q "\set alvo '$ALVO'
    select m.direction, m.message_type, m.status,
           case when m.media_url is not null then 'SIM' else 'NAO' end as tem_midia,
           case when m.error_code is not null or m.error_message is not null
                then concat_ws(' - ',m.error_code,m.error_message) else '-' end as erro,
           m.created_at
      from public.crm_messages m
      join public.crm_contacts c on c.id=m.contact_id
     where regexp_replace(coalesce(c.wa_id,''), '[^0-9]', '', 'g') = :'alvo'
     order by m.created_at desc limit 20;"
fi

titulo "5) Tempo real do CRM"
for tabela in crm_contacts crm_messages; do
  PUBLICADA="$(q1 "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='$tabela'")"
  if [ "$PUBLICADA" = "1" ]; then ok "OK  $tabela publicada no tempo real"; else erro "FALHA  $tabela não publicada no tempo real"; fi
done

titulo "6) Meta: credencial e assinatura do webhook"
if [ -z "$NUMEROS" ]; then
  warn "Teste da Meta ignorado: o alvo não corresponde a uma caixa cadastrada."
elif ! command -v jq >/dev/null; then
  warn "Instale jq para conferir a Meta: sudo apt-get install -y jq"
else
  while IFS='|' read -r _id _user label display pnid waba tem_token ativa primaria; do
    [ -n "$pnid" ] || { erro "${label:-Caixa}: phone_number_id vazio"; continue; }
    TOKEN="$(q1 "select meta_access_token from public.crm_whatsapp_numbers where id='$_id' limit 1")"
    [ -n "$TOKEN" ] || { erro "${label:-Caixa}: token ausente"; continue; }
    META="$(curl -sS -m 20 "https://graph.facebook.com/v21.0/${pnid}?fields=display_phone_number,verified_name,quality_rating,platform_type" -H "Authorization: Bearer ${TOKEN}" 2>/dev/null || true)"
    if echo "$META" | jq -e '.error' >/dev/null 2>&1; then
      erro "Meta recusou a credencial: $(echo "$META" | jq -r '.error.message // "erro desconhecido"')"
    elif echo "$META" | jq -e '.id' >/dev/null 2>&1; then
      ok "OK  Meta reconhece $(echo "$META" | jq -r '.display_phone_number // "número"') — qualidade $(echo "$META" | jq -r '.quality_rating // "não informada"')"
    else
      erro "Meta não retornou uma resposta válida para o número."
    fi
    if [ -n "$waba" ]; then
      APPS="$(curl -sS -m 20 "https://graph.facebook.com/v21.0/${waba}/subscribed_apps" -H "Authorization: Bearer ${TOKEN}" 2>/dev/null || true)"
      if echo "$APPS" | jq -e '.error' >/dev/null 2>&1; then
        erro "Não foi possível confirmar subscribed_apps: $(echo "$APPS" | jq -r '.error.message // "erro desconhecido"')"
      elif [ "$(echo "$APPS" | jq -r '.data | length' 2>/dev/null)" = "0" ]; then
        erro "WEBHOOK NÃO ASSINADO: a Meta não entregará mensagens desta WABA."
      else
        ok "OK  WABA possui aplicativo inscrito para entregar webhooks"
      fi
    else
      erro "WABA ID vazio; não é possível confirmar a assinatura do webhook."
    fi
  done <<< "$NUMEROS"
fi

titulo "7) Falhas recentes relacionadas"
if docker ps --format '{{.Names}}' | grep -qx "$FN_CONTAINER"; then
  IDS="$(printf '%s\n' "$NUMEROS" | awk -F'|' '{if ($5!="") print $5; if ($6!="") print $6}' | paste -sd'|' -)"
  PADRAO="$ALVO"
  [ -n "$IDS" ] && PADRAO="$PADRAO|$IDS"
  docker logs --since 2h "$FN_CONTAINER" 2>&1 \
    | grep -aiE "$PADRAO|\[WEBHOOK\].*(Failed|não encontrado|missing)|ON CONFLICT|PGRST|duplicate key" \
    | tail -n 80 || warn "Nenhuma falha relacionada encontrada nas últimas 2 horas."
else
  erro "Sem logs: $FN_CONTAINER está parado."
fi

titulo "8) Escuta ao vivo por ${SEGUNDOS}s"
echo "Envie uma mensagem de teste agora. O conteúdo da conversa não será exibido."
echo "Esperado: inbound_received -> inbound_routed -> Saved inbound message."
if docker ps --format '{{.Names}}' | grep -qx "$FN_CONTAINER"; then
  IDS="$(printf '%s\n' "$NUMEROS" | awk -F'|' '{if ($5!="") print $5; if ($6!="") print $6}' | paste -sd'|' -)"
  PADRAO="$ALVO"
  [ -n "$IDS" ] && PADRAO="$PADRAO|$IDS"
  timeout "$SEGUNDOS" docker logs -f --since 3s "$FN_CONTAINER" 2>&1 \
    | grep --line-buffered -aiE "$PADRAO|\[WEBHOOK-INBOUND\]|\[AI-AUTO-WEBHOOK\]|\[TRIGGER-(START|ERROR|CLAIM)\]|Saved inbound message|Failed to save inbound|Event received but no CRM user" \
    || true
fi

titulo "Como interpretar"
cat <<'TXT'
  Nada aparece na escuta       -> a Meta não entregou o webhook; confira callback e subscribed_apps.
  inbound_received apenas      -> chegou, mas falhou antes de salvar; veja a falha logo abaixo/acima.
  inbound_routed               -> número e dono foram identificados corretamente.
  Saved inbound message        -> recebimento e gravação estão funcionando.
  Mensagem salva, tela parada  -> problema está no serviço/publicação de tempo real ou no navegador.
  agente_geral = f             -> agente global desligado; fluxos ainda podem ativá-lo explicitamente.
  agente_no_contato = f        -> agente foi desativado nessa conversa.
TXT
