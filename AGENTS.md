## Decisões de arquitetura

- Scheduled messages are claimed atomically in PostgreSQL and dispatched by the existing server ticker through the central send actions; ambiguous sends fail without automatic retries to prevent duplicates.
- Conversation translation settings and cached results live in dedicated owner-scoped PostgreSQL tables; provider calls use the shared OpenAI key resolver, preserve originals and never alter AI/flow state.
- Translated message display uses one shared content-selection rule for the comparison and ordinary body; only text is replaced so media and interactive controls remain intact.

- The AI agent uses the shared response policy and an internal silence marker after contextual reasoning; classification remains active while silence skips sends and alert renewals without changing flow state.

- A gestão de armazenamento do CRM usa RPCs `service_role` pelo AdminCentral; isso mantém métricas e exclusões fora do navegador e isoladas por número.
- Conversation retention uses a server-side batch RPC and a durable message-delete trigger; media removal runs through the Storage API with global reference checks and retryable failures, preserving contacts and automation records.
- Métricas do sistema operacional são registradas por cron local em snapshots; o navegador apenas solicita manutenções e nunca acessa Docker ou o disco diretamente.
- O inventário completo por cadastro é calculado pelo cron em snapshots somente leitura; a tela nunca varre todas as tabelas em tempo real.
- Incoming media expires after the configured retention (crm_incoming_media_expired_batch floor) even inside active conversations, and top-level incoming files older than 24h that no message cites are removed sooner; only flows, templates, AI documents and pending schedules/broadcasts protect them. Files are named by Meta media id so webhook retries never duplicate. Disk-orphan detection lives only in deploy/lib-orfaos-storage.sh (layout global/tenant/bucket/name/version) and refuses deletion above a safety percentage.
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
- Tutorial videos stream as adaptive HLS produced by the host service zapmro-tutorial-transcoder (queue in sales_tutorials.transcode_status); the original MP4 is never modified and remains the player fallback.
- Daily host backups (deploy/backup-diario.sh via zapmro-backup.timer) dump the database and rsync the Storage volume incrementally with --link-dest into /var/backups/zapmro-diario; cleanup scripts must never touch that directory, because media lives only on that one volume. The backup measures new media with an rsync dry-run first and saves only the database when copying would leave under 5 GB free, so a backup never fills the disk.
- Flow media blocks whose file is missing from Storage are skipped at send time (the flow continues) and flagged in the editor via MissingMediaWarning, so one lost file never stops a whole flow.
- One-time user popups are rows in crm_user_notices seeded by migration for the target audience; the popup shows while dismissed_at is NULL, so new signups never get past notices and dismissal follows the user across devices.
- Deduplicated uploads (uploadDedupedMedia) reuse a hash path only when mediaFileOpens reads its first byte, and every new upload is read back before reporting success; Storage metadata (list/HEAD) can outlive lost files.
- The open WhatsApp number is per browser tab (sessionStorage) and its credentials overlay shared crm_settings in the UI, so switching numbers in one browser never changes another.
- Orphan-scan lists under /tmp/zapmro-orfaos-* are deleted when automatic cleanup ends and swept daily after 24h; the 10-minute storage cron rescans the disk at most hourly, so maintenance never fills /tmp or burns CPU.
