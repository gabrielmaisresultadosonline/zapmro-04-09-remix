# Ampliar o controle de armazenamento do VPS

## Objetivo
Mostrar no AdminCentral o consumo real relacionado ao CRM, inclusive históricos e mídias antigas de números desconectados ou já removidos, e permitir limpeza segura sem apagar contatos, números ativos, configurações, fluxos ou templates.

## Implementação
- Corrigir a medição por WhatsApp para incluir todas as mensagens, mídias catalogadas e registros antigos, distinguindo conectado, desconectado e número removido.
- Criar uma área de “resíduos do VPS” com totais de mídias sem vínculo, fila de exclusão, banco, logs Docker e backups; os valores do sistema operacional serão coletados por um relatório seguro gerado na VPS.
- Adicionar limpeza por número também para registros cujo número não existe mais, usando a identidade histórica armazenada antes da remoção.
- Adicionar uma limpeza segura de resíduos antigos: mensagens órfãs/sem caixa, mídias sem referência e filas concluídas, sempre conferindo fluxos, templates e agendamentos antes de excluir arquivos.
- Ajustar o script da VPS para diagnosticar a origem do crescimento, limitar retenção de backups e executar manutenção física do banco quando necessário; nenhuma limpeza de infraestrutura ocorrerá sem ação administrativa explícita.
- Manter o aviso ao usuário quando o histórico de suas conversas for zerado.

## Proteções
- Preservar contatos, números ainda cadastrados, conexões, configurações, fluxos, templates e mídias ainda usadas por eles.
- Exigir confirmação separada para limpeza por WhatsApp e para resíduos gerais.
- Fazer operações em lotes e de forma reaplicável, evitando travar o banco.

## Validação
- Conferir métricas antes/depois, incluindo números desconectados e removidos.
- Testar que mensagens e mídias antigas são removidas, enquanto contatos, fluxos e templates permanecem.
- Validar o painel em computador e celular, scripts da VPS e compilação final.
