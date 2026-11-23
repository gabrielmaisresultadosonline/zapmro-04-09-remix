#!/usr/bin/env bash
# Raio-X do que CRESCEU no disco. SÓ MOSTRA, NÃO APAGA NADA.
set -u
H="${HORAS:-30}"; M=$((H*60))
echo "===== DISCO ====="; df -h / /tmp 2>/dev/null
echo; echo "===== PASTAS DE PRIMEIRO NÍVEL ====="
du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -15
echo; echo "===== ONDE CRESCEU NAS ÚLTIMAS ${H}h (soma por pasta) ====="
find / -xdev -type f -mmin -"$M" -size +1M -printf '%s %h\n' 2>/dev/null \
 | awk '{s[$2]+=$1} END{for(d in s) printf "%10.2f GB  %s\n", s[d]/1073741824, d}' | sort -rn | head -30
echo; echo "===== 40 MAIORES ARQUIVOS NOVOS (${H}h) ====="
find / -xdev -type f -mmin -"$M" -size +50M -printf '%s\t%TY-%Tm-%Td %TH:%TM\t%p\n' 2>/dev/null \
 | sort -rn | head -40 | awk -F'\t' '{printf "%8.2f GB  %s  %s\n",$1/1073741824,$2,$3}'
echo; echo "===== ARQUIVOS APAGADOS MAS AINDA PRESOS (ocupam espaço) ====="
lsof -nP +L1 2>/dev/null | awk 'NR==1||$7>104857600' | head -20
echo; echo "===== LOGS DOS CONTAINERS ====="
for f in /var/lib/docker/containers/*/*-json.log; do [ -f "$f" ] && du -h "$f"; done 2>/dev/null | sort -rh | head -10
echo; echo "===== DOCKER ====="; docker system df 2>/dev/null
echo; echo "===== VOLUMES ====="
du -sh /var/lib/docker/volumes/* 2>/dev/null | sort -rh | head -10
echo; echo "===== BACKUPS ====="; ls -la /var/backups/zapmro-diario 2>/dev/null
du -sh /var/backups/zapmro-diario/* 2>/dev/null
echo; echo "===== WAL DO BANCO ====="
docker exec zapmro-db sh -c 'du -sh $PGDATA/pg_wal 2>/dev/null; psql -U postgres -Atc "select slot_name,active,pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)) from pg_replication_slots"' 2>/dev/null
echo; echo "===== JOURNAL / TMP ====="; journalctl --disk-usage 2>/dev/null; du -sh /tmp/* 2>/dev/null | sort -rh | head -10
echo; echo "Fim. Nada foi apagado."
