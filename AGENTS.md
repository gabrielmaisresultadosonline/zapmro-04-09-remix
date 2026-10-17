## Decisões de arquitetura

- The AI agent uses the shared response policy and an internal silence marker after contextual reasoning; classification remains active while silence skips sends and alert renewals without changing flow state.

- A gestão de armazenamento do CRM usa RPCs `service_role` pelo AdminCentral; isso mantém métricas e exclusões fora do navegador e isoladas por número.
- A retenção automática de conversas é de 30 dias de inatividade; contatos, números, configurações, fluxos e templates nunca são removidos por essa rotina.
- Métricas do sistema operacional são registradas por cron local em snapshots; o navegador apenas solicita manutenções e nunca acessa Docker ou o disco diretamente.
- O inventário completo por cadastro é calculado pelo cron em snapshots somente leitura; a tela nunca varre todas as tabelas em tempo real.- Mídias recebidas (crm-media/incoming) expiram após 15 dias via edge function incoming-media-expire pela Storage API; mídia citada em fluxos/templates/agendadas nunca é apagada.
- Remover um número arquiva seus fluxos (desligados, whatsapp_number_id NULL, origem em archived_from_*) em vez de apagá-los; a tela de escolha de número permite transferi-los.
- A leitura de uma conversa só avança por ação explícita do usuário; sincronizações automáticas preservam o cursor `last_read_at` monotônico.
- O histórico de templates enviados guarda o texto final já interpolado e a mídia efetiva; a conversa nunca reconstrói novos envios pelos exemplos aprovados.
- A janela de atendimento (24h desde a última mensagem recebida; 72h desde o evento Click-to-WhatsApp em ctwa_opened_at) é calculada só por getConversationWindow (_shared/conversation-window.ts, espelhada em src/lib/conversationWindow.ts) e aplicada no envio livre central (handleInternalSendMessage e crm-webhook); envios da empresa nunca estendem a janela.
- Desconectar um WhatsApp apenas limpa suas credenciais e preserva a caixa; exclusão definitiva é uma ação separada, enquanto cópias de fluxos/templates sempre mantêm a origem intacta.
- Automações (Agente I.A., Recuperador, gatilho de 24h, prompt, fluxo inicial, horário) ficam em crm_whatsapp_numbers.number_settings e sobrepõem crm_settings (_shared/number-settings.ts ↔ src/lib/numberSettings.ts); jobs rodam uma unidade por número conectado para que números do mesmo cadastro nunca compartilhem configuração.
- Fluxos agendados (esperas, timeouts) avançam por um serviço systemd no host (deploy/zapmro-flow-ticker.sh) que chama processScheduled pelo gateway local, além do pg_cron; o navegador nunca é necessário e a reserva atômica em crm_contacts evita duplicidade.
- A geração de prompt pelos atendimentos roda em crm_ai_prompt_jobs (_shared/prompt-builder.ts): rodadas pequenas com trava, avançadas pelo processScheduled e pela tela; nunca processa tudo numa chamada só.
- O teste grátis bloqueia Disparo em massa e Agente I.A. na tela (planAccess/PaidFeatureLock) e no servidor (_shared/plan-access.ts); a regra de plano deve ficar igual nos dois lados.
- 'Reiniciar' do AdminCentral grava em crm_client_reload_signals (só service_role); cada CRM aberto anuncia presença no canal crm-online-v1 e recarrega ao receber o sinal.
- A chave da OpenAI é escolhida só por _shared/openai-key.ts (resolveOpenAiKey: cadastro → dono do contato/número → legado → servidor, testada e em cache) para Agente I.A., Recuperador e gerador de prompt; assim nunca caem numa chave antiga cancelada.
