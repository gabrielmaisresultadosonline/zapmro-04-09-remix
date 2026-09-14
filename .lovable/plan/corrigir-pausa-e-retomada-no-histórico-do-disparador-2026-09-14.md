# Corrigir pausa e retomada no histórico do disparador

## Objetivo
Garantir que toda campanha **Em curso** ou **Pendente** mostre e execute **Pausar**, e que toda campanha **Pausada** mostre e execute **Retomar**, sem perder a fila nem reenviar destinatários concluídos.

## Implementação
- Reorganizar a linha de ações do histórico para que **Logs**, **Pausar/Retomar**, **Parar** e o estado não fiquem escondidos em painéis estreitos.
- Normalizar o estado recebido antes de decidir quais ações mostrar, mantendo compatibilidade com registros existentes.
- Bloquear cliques repetidos durante a alteração e confirmar no banco que o novo estado foi realmente salvo.
- Ao retomar, acordar o motor imediatamente e continuar apenas pelos destinatários ainda pendentes.
- Preservar a proteção atual do worker, que verifica pausa/parada antes de iniciar um novo envio.

## Validação
- Conferir visualmente campanhas em curso e pausadas em largura semelhante à imagem enviada.
- Testar os estados Em curso → Pausado → Em curso e confirmar que Parar continua separado e definitivo.
- Validar tipos e compilação sem alterar histórico, contatos, tokens, templates, fluxos ou configurações.
