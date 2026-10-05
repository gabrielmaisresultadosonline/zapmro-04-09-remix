## Decisões de arquitetura

- A gestão de armazenamento do CRM usa RPCs `service_role` pelo AdminCentral; isso mantém métricas e exclusões fora do navegador e isoladas por número.
- A retenção automática de conversas é de 30 dias de inatividade; contatos, números, configurações, fluxos e templates nunca são removidos por essa rotina.
- Métricas do sistema operacional são registradas por cron local em snapshots; o navegador apenas solicita manutenções e nunca acessa Docker ou o disco diretamente.
- O inventário completo por cadastro é calculado pelo cron em snapshots somente leitura; a tela nunca varre todas as tabelas em tempo real.- Mídias recebidas (crm-media/incoming) expiram após 15 dias via edge function incoming-media-expire pela Storage API; mídia citada em fluxos/templates/agendadas nunca é apagada.
- Remover um número arquiva seus fluxos (desligados, whatsapp_number_id NULL, origem em archived_from_*) em vez de apagá-los; a tela de escolha de número permite transferi-los.
- A leitura de uma conversa só avança por ação explícita do usuário; sincronizações automáticas preservam o cursor `last_read_at` monotônico.
- O histórico de templates enviados guarda o texto final já interpolado e a mídia efetiva; a conversa nunca reconstrói novos envios pelos exemplos aprovados.
- A janela de atendimento (24h desde a última mensagem recebida; 72h desde o evento Click-to-WhatsApp em ctwa_opened_at) é calculada só por getConversationWindow (_shared/conversation-window.ts, espelhada em src/lib/conversationWindow.ts) e aplicada no envio livre central (handleInternalSendMessage e crm-webhook); envios da empresa nunca estendem a janela.
