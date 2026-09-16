# Acelerar e tornar confiável a sincronização das conversas

## Objetivo
Fazer a lista de conversas aparecer imediatamente ao abrir ou atualizar o CRM e continuar sincronizada em tempo real, sem apagar ou alterar histórico, mensagens, tokens ou configurações.

## Implementação
1. Exibir imediatamente o cache recente da caixa WhatsApp selecionada assim que a sessão for reconhecida, sem esperar configurações, métricas, fluxos e integrações terminarem de carregar.
2. Trocar a carga integral bloqueante por sincronização progressiva: aplicar a primeira página de contatos assim que chegar e incorporar as páginas seguintes em segundo plano, mantendo o banco como fonte da verdade.
3. Preservar o marcador de sincronização somente após uma carga completa bem-sucedida; em falhas parciais, manter os dados já carregados e permitir recuperação automática na próxima tentativa.
4. Fortalecer o fallback do tempo real para buscar lotes consecutivos sem perder mensagens quando chegam mais de 100 eventos entre verificações.
5. Adicionar índices compostos idempotentes para as consultas reais de contatos e mensagens por usuário, número e data, sem alterar registros existentes.
6. Registrar a mudança no roteiro do projeto e validar tipos, SQL, build e comportamento inicial/realtime disponível localmente.

## Detalhes técnicos
- Escopo rigoroso por `user_id` e `whatsapp_number_id` será mantido em cache, consultas e eventos.
- Nenhum dado será removido ou regravado pela migração; ela criará somente índices.
- A tela poderá mostrar o cache recente primeiro e substituir/mesclar silenciosamente com os dados atuais do banco.
- O carregamento de itens secundários não bloqueará mais a exibição das conversas.
