# Corrigir o nó Aguardar nos fluxos

## Objetivo
Fazer o nó **Aguardar** respeitar corretamente segundos, minutos e horas, preservando os fluxos existentes e a retomada automática na nuvem.

## Implementação
- Converter o tempo configurado no editor para segundos antes de gravar a próxima execução.
- Manter fluxos antigos sem unidade funcionando em segundos.
- Validar valores inválidos para impedir datas quebradas ou contatos presos.
- Preservar a conexão de saída, o encerramento de atrasos sem saída e a trava contra execução duplicada.
- Garantir que o agendamento automático da VPS continue retomando fluxos com a tela fechada.

## Validação
- Conferir atrasos em segundos, minutos, horas e o formato legado sem unidade.
- Confirmar que pergunta, botões, agente IA e demais nós não foram alterados.
- Validar diferenças de código e compilação do projeto.

## Detalhes técnicos
A correção será limitada ao executor compartilhado do fluxo visual. O construtor legado baseado em etapas usa outro executor e permanecerá intacto.
