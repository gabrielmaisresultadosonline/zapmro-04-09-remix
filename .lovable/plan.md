# Cópia de fluxos e templates entre WhatsApps

## Objetivo
Na tela inicial do CRM, permitir copiar conteúdos de qualquer número salvo para outro número conectado, mantendo o original intacto. Números desconectados continuarão visíveis até uma exclusão explícita pela lixeira.

## O que será alterado

### 1. Números desconectados continuam na lista
- Trocar a ação **Desconectar WhatsApp** para apenas remover a conexão ativa e marcar o número como desconectado.
- Preservar contatos, conversas, fluxos, templates, nome e identificação desse número.
- Exibir o estado **Desconectado** no próprio cartão e impedir apenas a abertura operacional desse número.
- Adicionar uma lixeira com confirmação separada; somente ela fará a exclusão definitiva usando a limpeza segura já existente.
- O número desconectado continuará ocupando uma vaga do plano até ser excluído.

### 2. Copiar fluxos sem retirar do número original
- Adicionar uma ação **Copiar conteúdos** em cada número com fluxos ou templates.
- Mostrar os fluxos daquele número em uma seleção individual ou “selecionar todos”.
- Escolher um número conectado como destino.
- Criar novas cópias desligadas no destino, incluindo nós, conexões e demais configurações do fluxo.
- Manter o fluxo original inalterado no número de origem.

### 3. Copiar templates e enviar novamente para aprovação
- Mostrar os templates salvos do número de origem na mesma tela de cópia.
- Ao copiar, usar nome, idioma, categoria, corpo, cabeçalho, mídia, botões, exemplos e configurações já armazenadas.
- Enviar cada template à conta Meta do número de destino usando exclusivamente as credenciais desse destino.
- Salvar no destino o novo identificador e o status devolvido pela Meta, normalmente **Pendente**; nunca copiar o status **Aprovado** do número de origem.
- Exibir o resultado individual: enviado para análise, já existente ou falhou com o motivo retornado pela Meta.

### 4. Segurança e consistência
- Validar que origem e destino pertencem ao mesmo cadastro e que o destino está conectado.
- Executar a cópia de fluxos no banco de forma atômica para não gerar cópias incompletas.
- Manter o isolamento atual de contatos, históricos, configurações, campanhas, fluxos e templates por número.
- Não alterar o conteúdo original durante a cópia.

## Validação
- Conferir número conectado e desconectado na lista inicial.
- Copiar um fluxo e confirmar original + cópia independente e desligada.
- Copiar um template e confirmar que ele foi submetido pela conta do destino com novo status da Meta.
- Excluir um número somente pela lixeira após confirmação.
- Verificar visual em celular e computador, além da compilação e dos erros da tela.

## Detalhes técnicos
- Nova migração reaplicável para desconexão preservadora e RPC de cópia de fluxos.
- A exclusão definitiva continuará usando a rotina segura existente.
- A submissão dos templates será feita pela função oficial já usada para criar templates, com o número de destino informado explicitamente.
- As operações apresentarão progresso e falhas parciais dos templates sem desfazer cópias bem-sucedidas.
