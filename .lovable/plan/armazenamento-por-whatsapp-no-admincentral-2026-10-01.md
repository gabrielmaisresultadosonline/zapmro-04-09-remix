# Armazenamento por WhatsApp no AdminCentral

## Objetivo
Adicionar uma aba **Armazenamento** no AdminCentral para visualizar o espaço ocupado por cada cadastro e cada número conectado ou já conectado, com limpeza manual segura e limpeza automática após 30 dias.

## O que será construído
- Nova aba **Armazenamento**, separada das demais, com busca por cadastro, nome e número.
- Uma linha por número de WhatsApp, inclusive desconectado, mostrando cadastro, identificação do número, estado da conexão, mensagens armazenadas e tamanho estimado em MB/GB.
- Resumo do total ocupado e data da última limpeza por número.
- Botão **Zerar histórico** por número com confirmação clara e bloqueio contra clique duplicado.
- A limpeza apagará mensagens e colocará mídias exclusivas na fila de exclusão física, mas manterá contatos, números, credenciais, configurações, fluxos e templates.
- Mídias compartilhadas com mensagens, fluxos, templates ou agendamentos permanecerão protegidas.
- Registro auditável de cada limpeza manual ou automática, incluindo quantidade de mensagens e bytes estimados liberados.
- Aviso pendente por cadastro após uma limpeza; ao abrir o CRM, o usuário verá que o histórico foi apagado, os contatos foram mantidos e o histórico completo continua disponível no celular.
- A regra automática existente será ajustada de 10 para 30 dias de inatividade, além da opção manual no AdminCentral.

## Segurança e consistência
- Métricas e exclusões serão executadas no servidor com a credencial administrativa já usada pelo AdminCentral.
- A rotina validará que o número pertence ao cadastro informado e fará a exclusão em transação.
- A exclusão será isolada por `whatsapp_number_id`; mensagens legadas sem número serão atribuídas somente à caixa principal do cadastro.
- A lista continuará mostrando números que já foram conectados enquanto o registro do número existir.
- Contatos não serão excluídos; somente seus campos de resumo da última mensagem serão zerados quando necessário para não exibir conteúdo apagado.

## Validação
- Testar métricas vazias e com vários números no mesmo cadastro.
- Testar limpeza manual, repetição segura e preservação de contatos/números/configurações.
- Testar mídia ainda referenciada e mídia sem referência.
- Testar aviso após entrar no CRM e confirmação única pelo usuário.
- Verificar compilação, alterações SQL, tela em desktop/celular e ausência de erros no navegador.

## Detalhes técnicos
- Criar migration idempotente com tabela de eventos de limpeza, funções administrativas de métricas/limpeza e permissões restritas ao `service_role`.
- Estimar bytes com `pg_column_size` das mensagens e o tamanho catalogado das mídias quando disponível, sem contar o mesmo arquivo duas vezes.
- Ampliar `crm-central-admin` com ações de listar armazenamento e zerar um número.
- Criar painel React dedicado e integrar ao conjunto de abas do AdminCentral.
- Adaptar o popup de retenção para priorizar avisos reais de limpeza pendente e confirmar a leitura no banco.
- Atualizar `retention-cleanup` e o texto do aviso geral para 30 dias, mantendo o cron diário que encontra históricos vencidos.
