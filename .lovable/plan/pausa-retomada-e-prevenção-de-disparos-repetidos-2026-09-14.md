# Pausa, retomada e prevenção de disparos repetidos

## Objetivo
Garantir que o histórico do disparador em `/crm` permita pausar, retomar e parar campanhas com segurança, continuando somente pelos destinatários ainda pendentes. Antes de criar uma nova campanha, avisar quando a lista contém números já usados em disparos anteriores e permitir manter todos ou remover os repetidos.

## Implementação
- Manter no histórico os controles separados **Pausar**, **Retomar** e **Parar**, com estado visual claro e atualização do progresso.
- Ao pausar, preservar integralmente a fila e impedir que o processador pegue um novo destinatário.
- Ao retomar, reativar o processador imediatamente e continuar pelos itens ainda pendentes, sem recriar a campanha nem reenviar itens já confirmados como enviados.
- Manter **Parar** como ação definitiva, marcando apenas os destinatários ainda pendentes como ignorados.
- Exibir alerta de possível travamento quando uma campanha ativa ficar sem sinal recente, mantendo **Pausar** e **Retomar** disponíveis para reiniciar o processamento com segurança.
- Consultar o histórico persistente da mesma conta e do mesmo número WhatsApp antes de iniciar qualquer nova campanha, incluindo listas coladas, CSV, Excel, VCard, contatos e etiquetas.
- Comparar números em formato normalizado, incluindo compatibilidade com campanhas antigas.
- Quando houver números já usados, abrir uma confirmação com três escolhas:
  - **Manter todos**: cria a campanha com a lista completa.
  - **Remover já usados**: cria a campanha somente com números ainda não usados.
  - **Cancelar**: volta à edição sem criar nada.
- Informar quantos números são repetidos e quantos novos permanecerão; se todos forem removidos, não criar campanha vazia.

## Segurança e preservação
- Alterações aditivas: não apagar histórico, campanhas, destinatários, contatos, mensagens, templates, fluxos, tokens, números ou configurações existentes.
- Considerar como enviado, com precisão, os itens persistentes confirmados como `sent`; para campanhas antigas sem detalhamento individual, usar a lista histórica concluída como compatibilidade.
- Restringir a comparação ao usuário autenticado e ao número WhatsApp atualmente selecionado, evitando mistura entre caixas.
- Manter a reivindicação atômica existente do processador para impedir dois workers no mesmo destinatário.
- Não reenviar automaticamente um item de resultado incerto após interrupção; ele permanece registrado para revisão, evitando duplicidade.

## Validação
- Testar pausar durante uma campanha, confirmar que nenhum novo item é iniciado, retomar e concluir apenas a fila restante.
- Testar parar definitivamente e confirmar que a campanha não pode ser retomada.
- Simular campanha sem sinal recente e confirmar o aviso e a retomada do motor.
- Testar listas coladas, CSV/Excel e VCard com números novos, repetidos e misturados.
- Confirmar as três escolhas do aviso de repetição e o isolamento entre números WhatsApp diferentes.
- Executar verificações de tipos, função de processamento, script da VPS e compilação final.

## Detalhes técnicos
- Criar uma migração idempotente com uma função parametrizada para consultar números usados anteriormente sem expor dados de outros usuários.
- Atualizar o disparador para preparar a campanha somente depois da escolha sobre repetidos.
- Reforçar a retomada e o diagnóstico de campanha parada, reutilizando a fila persistente atual.
- Atualizar os tipos e as validações do script de atualização da VPS sem alterar dados existentes.
