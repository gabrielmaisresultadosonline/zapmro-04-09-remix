# Diagnóstico completo de um número WhatsApp

## Objetivo
Criar um comando seguro para executar na VPS informando o número `+55 51 9283-5863`, mostrando se ele está cadastrado, ativo, conectado à Meta, recebendo mensagens e associado ao agente correto.

## Implementação
- Criar `deploy/diagnosticar-um-numero.sh`, somente leitura, aceitando telefone exibido, ID do número da Meta ou telefone de contato.
- Mostrar serviços da VPS, cadastro da caixa, presença das credenciais sem revelar tokens, usuário proprietário, agente IA, fluxos ativos e estado do contato.
- Conferir na Meta se o token reconhece o número e se a WABA possui aplicativo inscrito para receber webhooks.
- Exibir contagem e horários das mensagens recentes, registros sem caixa, falhas de persistência e situação da publicação em tempo real.
- Adicionar escuta ao vivo com duração configurável e resultado final claro: mensagem chegou ao webhook, foi salva, acionou fluxo/IA ou falhou em alguma etapa.
- Acrescentar ao webhook um evento técnico estruturado com identificadores não secretos da caixa e remetente, facilitando o filtro exato no terminal.

## Segurança e preservação
- Não alterar contatos, mensagens, tokens, agentes, fluxos ou configurações.
- Nunca imprimir tokens, segredos ou conteúdo das conversas.
- Validar o argumento para impedir comandos ou consultas indevidas.

## Validação
- Verificar sintaxe do script e formatação do código.
- Confirmar compilação e fornecer o comando exato para uso na VPS após a atualização.
