# Corrigir caixas e conversas em tempo real

## Objetivo
Fazer cada caixa do WhatsApp mostrar somente seus próprios contatos e manter a lista e a conversa aberta atualizadas ao vivo, com indicação visível da sincronização.

## Alterações
- Tratar contatos antigos sem caixa apenas na caixa principal; as caixas adicionais usarão filtro estrito.
- Aplicar a mesma regra na carga inicial, cache local, recuperação periódica e eventos em tempo real.
- Reiniciar corretamente os cursores e caches ao trocar de caixa, impedindo dados da caixa anterior de permanecerem na tela.
- Adicionar estado visível “Sincronizado” / “Reconectando” na lista de conversas.
- Reconciliar mensagens e contatos automaticamente ao conectar ou recuperar a conexão, mantendo o fallback periódico existente.
- Restringir os canais em tempo real ao usuário e à caixa ativa sempre que suportado, mantendo validação local defensiva.

## Segurança e preservação
- Não excluir nem reatribuir mensagens, contatos, mídias, tokens ou configurações.
- Manter RLS por proprietário e não expor dados entre usuários.
- Não alterar o envio de mensagens nem os gatilhos do agente.

## Validação
- Conferir build e erros de execução.
- Verificar troca entre duas caixas sem mistura de contatos.
- Verificar chegada de nova mensagem na lista e na conversa aberta sem recarregar a página.
- Verificar mudança do indicador durante conexão e recuperação.
