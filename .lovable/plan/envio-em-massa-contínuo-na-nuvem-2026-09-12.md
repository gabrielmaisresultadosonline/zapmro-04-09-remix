# Envio em massa contínuo na nuvem

## Objetivo
Fazer cada campanha continuar na VPS mesmo com o computador desligado ou a tela fechada, preservando destinatários, progresso e erros. Acrescentar ações separadas para pausar, retomar e parar definitivamente.

## Implementação
- Criar uma migração aditiva para persistir na campanha tudo que o processador precisa: configuração do envio, posição atual, próxima execução, bloqueio temporário, último sinal de vida e último erro.
- Criar uma função de processamento em nuvem que reivindica campanhas sem duplicar envios, processa poucos destinatários por chamada, respeita o intervalo aleatório e salva o progresso após cada tentativa.
- Reutilizar as rotinas existentes de mensagem, template e fluxo, mantendo o número WhatsApp ativo, variáveis, histórico, logs e contadores atuais.
- Agendar o processador na VPS em intervalos curtos e também acioná-lo imediatamente ao criar ou retomar uma campanha.
- Trocar o laço que hoje roda no navegador pela criação persistente da campanha; fechar a tela não interromperá a fila.
- Adicionar no histórico os controles **Pausar**, **Retomar** e **Parar**, com estados claros para pendente, em curso, pausado, parado, concluído e erro.
- Exibir o último erro e detectar campanhas sem sinal recente, permitindo retomar com segurança do ponto salvo.

## Segurança e preservação
- Alterações apenas aditivas; nenhuma campanha, contato, mensagem, template, fluxo, token ou configuração existente será removida.
- Isolamento por usuário e por número WhatsApp será mantido.
- O processador usará bloqueio no banco e índice da próxima posição para evitar dois workers enviando ao mesmo contato.
- **Parar** será definitivo; **Pausar** preservará a fila; **Retomar** continuará no próximo destinatário ainda não processado.

## Validação
- Validar criação, execução sem aba aberta, pausa, retomada, parada e recuperação após falha simulada.
- Conferir contadores, logs de falha, escopo por número e ausência de duplicidade.
- Executar as verificações locais existentes e conferir o estado final da compilação.

## Detalhes técnicos
- Nova migração PostgreSQL idempotente com colunas/índices/RLS compatíveis com dados antigos.
- Nova Edge Function `broadcast-worker`, invocada pelo frontend e pelo `pg_cron` da VPS.
- Atualização focada em `Broadcaster.tsx`, tipos gerados e agendamento de implantação.
