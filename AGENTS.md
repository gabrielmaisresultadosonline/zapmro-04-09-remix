## Decisões de arquitetura

- A gestão de armazenamento do CRM usa RPCs `service_role` pelo AdminCentral; isso mantém métricas e exclusões fora do navegador e isoladas por número.
- A retenção automática de conversas é de 30 dias de inatividade; contatos, números, configurações, fluxos e templates nunca são removidos por essa rotina.
- Métricas do sistema operacional são registradas por cron local em snapshots; o navegador apenas solicita manutenções e nunca acessa Docker ou o disco diretamente.
- O inventário completo por cadastro é calculado pelo cron em snapshots somente leitura; a tela nunca varre todas as tabelas em tempo real.- Mídias recebidas (crm-media/incoming) expiram após 15 dias via edge function incoming-media-expire pela Storage API; mídia citada em fluxos/templates/agendadas nunca é apagada.
- Remover um número arquiva seus fluxos (desligados, whatsapp_number_id NULL, origem em archived_from_*) em vez de apagá-los; a tela de escolha de número permite transferi-los.
- A leitura de uma conversa só avança por ação explícita do usuário; sincronizações automáticas preservam o cursor `last_read_at` monotônico.
