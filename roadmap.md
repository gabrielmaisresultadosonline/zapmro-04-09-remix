# Roadmap

- [x] Corrigir normalização, validação duplicada e persistência do token OpenAI.
- [x] Adicionar logs seguros para diagnóstico do Agente IA.
- [x] Atualizar os scripts da VPS para o novo repositório GitHub.
- [x] Preservar banco, volumes e secrets com backup antes da atualização.
- [x] Validar a sintaxe dos scripts de implantação.
- [x] Corrigir o callback Google sem depender de ON CONFLICT e validar a migration 094 no deploy.
- [x] Adicionar diagnóstico específico e seguro para o OAuth Google na VPS.
- [x] Corrigir importação Google sem ON CONFLICT legado, com paginação e erros explícitos.
- [x] Chat: envio de documentos (MIME por extensão no front e na Edge; Meta rejeitava octet-stream).
- [x] Chat: microfone confiável (stream único + AudioContext próprio, fallback MediaRecorder, cleanup total).
- [x] Chat: seletor de emojis funcional (Popover com categorias/recentes, insere no cursor).
- [x] Google Contatos: ligar a importação ao botão da conta, não mascarar erros como 0/0 e registrar exportações no diagnóstico.
- [x] Google Contatos: corrigir o botão genérico para importar e separar pendentes globais/por cadastro no diagnóstico.

- [x] Agente IA: organizador Kanban automático, opção de resposta agrupada e correções completas da sincronização Google.
- [x] Templates Meta: variáveis/imagem/botões editáveis no envio (disparador, agendamento, conversa), presets salvos (migration 096), validação estrutural na Edge Function, registro de cliques em resposta rápida e tutorial Utility no criador.

- [x] Módulo /acessor: landing, login/cadastro com 2 dias de teste, dashboard do cliente, admin (OpenAI + WhatsApp oficial/coexistência), webhook com transcrição de áudio e migration 097.
- [x] Corrigir remoção/desconexão de números WhatsApp sem colisão entre contatos, com autorização própria do AdminCentral e preservando as demais caixas.
- [x] Corrigir gatilhos de primeira mensagem após limpar a conversa e validar sua persistência no banco.
- [x] Tornar o diagnóstico dos gatilhos completo por caixa, histórico, decisão e execução do primeiro nó.
- [x] Catálogo de mídias (crm_media_assets) com contador de referências.
- [x] Lixeira de 7 dias (crm_media_gc_queue) + worker diário media-gc.
- [x] Corrigir ownership/permissões do schema Auth e validar o caminho real de login após atualizações da VPS.
- [x] Tornar o backup pré-atualização resiliente a reinícios transitórios do PostgreSQL, sem permitir atualização sem dump válido.

- [x] Criar e validar teste seguro de ocultação do botão de ligação Meta para +55 11 92083-7268.
- [x] Tornar o envio em massa persistente na nuvem, com pausa, retomada, parada e diagnóstico de travamento.
- [x] Impedir definitivamente que textos de anúncios/CTWA substituam o conteúdo real recebido no histórico.
- [x] Exibir a mídia real do anúncio separada da frase exata recebida e impedir gatilhos por texto inferido.
- [x] Tornar gatilhos automáticos fiéis, determinísticos e protegidos contra mensagens simultâneas.
- [x] Reforçar pausa/retomada do disparador e avisar sobre números já enviados antes de uma nova campanha.
- [x] Tornar Pausar/Retomar sempre visíveis no histórico e confirmar no banco cada mudança de estado.
- [x] Validar no deploy que o domínio publicou o frontend com Pausar/Retomar e tratar campanhas legadas em envio.
- [x] Garantir que o bloco Agente IA iniciado por um gatilho envie a abertura e responda sem depender da ativação global.
- [x] Acelerar a abertura das conversas com cache imediato, carga progressiva, fallback realtime paginado e índices compostos.
