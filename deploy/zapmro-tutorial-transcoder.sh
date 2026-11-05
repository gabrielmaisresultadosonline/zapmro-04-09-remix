#!/usr/bin/env bash
# Serviço contínuo (systemd) que converte os vídeos dos tutoriais em HLS
# adaptativo. Um vídeo por vez, com prioridade baixa de CPU para não pesar
# no CRM. Vídeos novos entram na fila sozinhos; o botão "Transcodificar"
# do painel recoloca todos na fila.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK="$ROOT/deploy/postgres-stack"
while true; do
  [ -f "$STACK/.env" ] && { set -a; . "$STACK/.env"; set +a; }
  nice -n 15 ionice -c3 python3 "$ROOT/deploy/transcodificar-tutoriais.py"
  rc=$?
  if [ "$rc" -eq 0 ]; then sleep 2; else sleep 20; fi
done
