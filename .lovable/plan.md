# Explicar mensagens vazias no CRM

## Objetivo
Eliminar bolhas que mostram somente o horário e informar claramente o que aconteceu quando o WhatsApp não entrega conteúdo legível ao CRM.

## Alterações
- Exibir uma explicação segura para formatos não disponibilizados pela Meta, usando os dados técnicos já guardados na própria mensagem.
- Exibir um aviso neutro quando uma mídia chegou sem arquivo acessível ou quando qualquer outro registro não possui texto, mídia ou anúncio renderizável.
- Não alterar nem reconstruir mensagens antigas; apenas melhorar sua apresentação.
- Preservar histórico, mídia, contatos, gatilhos, tokens e configurações.

## Validação
- Confirmar que toda bolha possui texto, mídia, anúncio ou explicação.
- Manter a mensagem real quando ela existe.
- Verificar compilação e erros do preview.

## Detalhes técnicos
A tela já calcula explicações para mensagens `unsupported`, mas atualmente retorna `null` justamente quando o conteúdo não é legível. Isso cria a bolha vazia da captura. A correção renderiza essa explicação e adiciona fallback para mídia indisponível e registros incompletos.
