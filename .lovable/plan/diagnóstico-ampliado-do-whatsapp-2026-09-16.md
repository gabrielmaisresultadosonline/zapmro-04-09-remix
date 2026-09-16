# Diagnóstico ampliado do WhatsApp

## Objetivo
Identificar por que a mensagem enviada ao número informado não chegou ao webhook nem apareceu no CRM, sem alterar conversas, tokens ou configurações.

## Alterações
- Ampliar o diagnóstico para localizar caixas por telefone completo, sufixo e variações brasileiras de DDI/DDD.
- Quando não houver correspondência exata, exibir uma lista segura de caixas cadastradas com telefone parcialmente mascarado e indicar a provável correspondência.
- Se existir uma única caixa ativa ou uma correspondência provável inequívoca, verificar automaticamente credencial, `phone_number_id`, WABA e assinatura `subscribed_apps`.
- Melhorar a escuta para distinguir claramente: webhook não entregue pela Meta, roteamento não reconhecido ou falha antes de salvar.
- Manter o script estritamente somente leitura e sem exibir tokens nem conteúdo de mensagens.

## Validação
- Validar sintaxe do script e integridade das alterações.
- Confirmar que nenhum comando de escrita no banco ou na Meta foi adicionado.
- Conferir o estado de compilação do projeto.
