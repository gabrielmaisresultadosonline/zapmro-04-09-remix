# Corrigir mensagem e imagem de anúncios no CRM

## Objetivo
Exibir na conversa a referência visual real do anúncio e, separadamente, a frase exata enviada pelo cliente. O motor de gatilhos deve comparar somente essa frase real quando ela estiver disponível.

## Implementação
- Ampliar a leitura do `referral` da Meta para os formatos reais possíveis no evento, preservando imagem, vídeo/miniatura, título, texto e link do anúncio nos metadados da mensagem.
- Quando a Meta fornecer a mídia do anúncio apenas por identificador, buscar e armazenar uma cópia estável usando a credencial da própria caixa antes de salvar a mensagem.
- Gravar a frase exata do cliente como conteúdo da conversa, sem substituir por frase padrão, título do anúncio ou texto de boas-vindas.
- Separar candidatos de gatilho: com frase do cliente, usar somente ela; sem frase legível, não inventar conteúdo nem disparar um gatilho de frase completa.
- Atualizar o cartão da conversa para mostrar a imagem/miniatura real do anúncio, seus dados disponíveis e a frase do cliente fora do cartão.
- Manter compatibilidade com mensagens antigas e com eventos em que a Meta realmente não disponibiliza a mídia; nesses casos, mostrar um estado informativo sem falsificar a mensagem.
- Adicionar diagnósticos sem expor tokens, permitindo confirmar quais campos de anúncio e texto chegaram.

## Segurança e preservação
- Nenhum histórico, contato, fluxo, template, token, número ou configuração será apagado ou regravado em massa.
- A correção será aditiva e aplicada às novas mensagens; registros antigos permanecem intactos.
- Todo acesso continuará isolado por usuário e pela caixa WhatsApp que recebeu a mensagem.

## Validação
- Validar tipos e função de nuvem.
- Conferir visualmente uma conversa com anúncio em tela ampla e móvel.
- Testar que uma frase exata dispara somente o fluxo correspondente e que título/texto do anúncio não dispara outro fluxo.
- Validar o script de atualização da VPS e incluir uma verificação explícita desta correção.
