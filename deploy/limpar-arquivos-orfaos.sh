#!/usr/bin/env bash
# limpar-arquivos-orfaos.sh — encontra arquivos que ocupam o disco do storage
# mas não existem mais no banco (sobras de exclusões antigas e versões
# substituídas). Eles não aparecem em nenhuma tela, mas ocupam espaço.
#
#   sudo bash deploy/limpar-arquivos-orfaos.sh            # só mostra (não apaga)
#   sudo bash deploy/limpar-arquivos-orfaos.sh --apagar   # apaga os órfãos
#
# Segurança: só considera arquivos com mais de 6 horas (envios em andamento
# ficam de fora) e nunca toca em arquivos que ainda têm registro no banco.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
[ -f "$STACK/.env" ] && { set -a; . "$STACK/.env"; set +a; }
DB_CONT="${DB_CONT:-zapmro-db}"; ST_CONT="${ST_CONT:-zapmro-storage}"
APAGAR=0; [ "${1:-}" = "--apagar" ] && APAGAR=1
W=/tmp/zapmro-orfaos; rm -rf "$W"; mkdir -p "$W"
OUT=/tmp/arquivos-orfaos.txt; : > "$OUT"
log() { echo "$*" | tee -a "$OUT"; }

log "== $(date '+%F %T') — arquivos órfãos do storage =="
log "-- disco antes: $(df -h / | tail -1 | awk '{print $3" usados de "$2}')"

. "$ROOT/deploy/lib-orfaos-storage.sh"
orf_coletar "$W" 360 "$DB_CONT" "$ST_CONT" "${POSTGRES_DB:-postgres}" || { log "falha ao ler banco/disco"; exit 1; }
log "registros no banco: $(wc -l < "$W/db.tsv")"
log "arquivos no disco (mais de 6h): $(wc -l < "$W/disk.tsv")"

total=$(awk -F'\t' '{s+=$1} END {printf "%.2f", s/1024/1024/1024}' "$W/orfaos.tsv")
log "ÓRFÃOS: $(wc -l < "$W/orfaos.tsv") arquivos = ${total} GB"
awk -F'\t' '{split($2,p,"/"); k=p[3]" ("$3")"; s[k]+=$1; c[k]++} END {for (k in s) printf "  %-40s %7d arquivos  %8.2f GB\n", k, c[k], s[k]/1024/1024/1024}' "$W/orfaos.tsv" | sort -k4 -nr | tee -a "$OUT"

# 4) Uso por pasta do storage (para ver o que mais pesa)
log "-- maiores pastas do storage:"
docker exec "$ST_CONT" sh -c 'du -sh /var/lib/storage/*/* /var/lib/storage/*/*/* 2>/dev/null | sort -rh | head -15' | tee -a "$OUT"
# 5) Mídias recebidas repetidas (mesmo nome antes do horário)
log "-- mídias recebidas gravadas mais de uma vez:"
docker exec -i "$DB_CONT" psql -U postgres -d postgres -At -c "
  select count(*)||' grupos repetidos, '||pg_size_pretty(coalesce(sum(extra),0)::bigint)||' em cópias extras'
  from (select sum((metadata->>'size')::bigint) - max((metadata->>'size')::bigint) extra
        from storage.objects where bucket_id='crm-media' and name like 'incoming/%'
        group by regexp_replace(name,'_[0-9]{13}\.[a-z0-9]+$',''), metadata->>'size' having count(*)>1) t" | tee -a "$OUT"
log "-- mídias recebidas que nenhuma conversa usa (apagadas pelo botão Limpar mídias antigas):"
docker exec -i "$DB_CONT" psql -U postgres -d postgres -At -c "
  select count(*)||' arquivos, '||pg_size_pretty(coalesce(sum((s.metadata->>'size')::bigint),0))
  from storage.objects s where s.bucket_id='crm-media' and s.name like 'incoming/%' and s.name not like 'incoming/%/%'
    and s.created_at < now()-interval '24 hours'
    and not exists (select 1 from public.crm_messages m where m.media_url like '%/crm-media/incoming/%'
      and substring(m.media_url from '/crm-media/(incoming/[^?#]+)') = s.name)" | tee -a "$OUT"
log "-- volumes Docker sem uso (não apagados):"
docker volume ls -qf dangling=true | while read -r v; do
  log "  $v $(docker run --rm -v "$v":/v alpine du -sh /v 2>/dev/null | cut -f1)"; done

if [ "$APAGAR" = 1 ] && [ -s "$W/orfaos.tsv" ]; then
  if ! orf_seguro "$W"; then
    log "✘ Órfãos acima de ${ORF_MAX_PCT}% dos arquivos — conferência suspeita, NADA foi apagado. Envie este relatório."
  else
    orf_apagar "$W" "$ST_CONT"
    log "✔ órfãos apagados"
    log "-- disco depois: $(df -h / | tail -1 | awk '{print $3" usados de "$2}')"
  fi
elif [ -s "$W/orfaos.tsv" ]; then
  log "Nada foi apagado. Para apagar: sudo bash deploy/limpar-arquivos-orfaos.sh --apagar"
fi
log "Relatório salvo em $OUT"
