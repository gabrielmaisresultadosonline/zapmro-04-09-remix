# Corrigir sincronização das conversas do CRM

## Objetivo
Fazer a lista mostrar imediatamente as conversas e horários mais recentes, inclusive após atualizar a página, perder conexão ou reabrir o CRM.

## Alterações
- Uniformizar o filtro da caixa WhatsApp para que contatos e mensagens antigos sem vínculo preenchido sejam recuperados pela carga inicial e pela sincronização periódica.
- Manter filtros estritos onde a separação por número é obrigatória, como templates e fluxos.
- Ao reconectar o canal principal em tempo real, executar uma reconciliação completa da lista em vez de aguardar apenas novos eventos.
- Preservar integralmente contatos, mensagens, mídias, tokens, números e configurações existentes.

## Validação
- Verificar compilação e erros do preview.
- Testar abertura do CRM, atualização da página e reconexão.
- Confirmar que a ordenação e o horário refletem mensagens recentes sem misturar caixas WhatsApp.

## Detalhes técnicos
A causa confirmada é uma divergência: o canal em tempo real aceita registros legados com `whatsapp_number_id` vazio, mas a carga inicial e a recuperação periódica os excluem. A correção alinha esses caminhos e adiciona reconciliação no retorno da conexão.
