# Lentidão na expiração de mídias

O relatório recebido mostra consultas `crm_incoming_media_expired_batch` ativas por até 15 horas, CPU sem tempo ocioso e carga acima de 32. O espaço em disco também está em 91%, mas isso não prova que seja a causa da CPU alta. Nomes de usuários dos processos no host podem ser o mapeamento dos usuários dos containers; o relatório não comprova invasão.

## Alívio imediato, sem apagar dados

Execute na VPS para interromper somente as leituras antigas da limpeza:

```bash
sudo docker exec zapmro-db psql -U postgres -c "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND query LIKE '%\"public\".\"crm_incoming_media_expired_batch\"%' AND query_start<clock_timestamp()-interval '30 seconds';"
```

Não interrompa `START_REPLICATION`: é uma conexão contínua esperada.

## Proteção permanente

```bash
cd /var/www/ia-mro && git pull --ff-only origin main && sudo bash deploy/destravar-limpeza-midias.sh && sudo bash deploy/atualizar.sh
```

A migração 135 limita a seleção a 20 candidatos antes das verificações, avança um cursor por arquivos protegidos, evita varreduras simultâneas e impõe intervalo mínimo de um minuto. Um vigia do PostgreSQL cancela leituras desta RPC que ultrapassem 30 segundos na próxima execução de um minuto (não é um limite exato de 30 segundos). As verificações globais continuam protegendo conversas, fluxos, templates, documentos e campanhas/agendamentos ativos. A remoção física permanece pela Storage API; contatos, números e configurações não são removidos.

## Confirmar na VPS

```bash
sudo docker exec zapmro-db psql -U postgres -c "SELECT arquivo,aplicado_em FROM public._migracoes_aplicadas WHERE arquivo='135-limitar-expiracao-midias.sql'; SELECT jobname,schedule,active FROM cron.job WHERE jobname IN ('incoming-media-query-guard','incoming-media-expire');"
sudo bash deploy/destravar-limpeza-midias.sh
top -bn1 | head -25
df -h /
```

Confira após alguns minutos e novamente após 20 minutos: não devem reaparecer várias leituras de horas. Testes locais não substituem a medição na VPS; CPU, plano de execução com volume real, liberação física de disco e abertura do CRM ainda precisam ser conferidos no servidor.