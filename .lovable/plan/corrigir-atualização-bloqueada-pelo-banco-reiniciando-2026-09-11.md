# Corrigir atualização bloqueada pelo banco reiniciando

## Objetivo
Impedir que uma condição momentânea de reinício do contêiner do banco derrube o atualizador sem diagnóstico, mantendo o backup obrigatório e sem alterar dados, tokens ou volumes.

## Implementação
- Fazer o backup aguardar o PostgreSQL ficar realmente pronto e estável antes do `pg_dumpall`.
- Se o banco estiver parado ou reiniciando, tentar subir somente o serviço do banco e aguardar novamente.
- Repetir o dump apenas para falhas transitórias, validando que o arquivo gerado não ficou vazio.
- Em falha persistente, preservar tudo, remover somente o backup incompleto e mostrar estado e últimas linhas do banco para diagnóstico.
- Ajustar o atualizador para chamar o backup sempre que a stack existente estiver disponível, delegando ao próprio backup a recuperação segura.

## Validação
- Validar a sintaxe dos scripts.
- Simular os estados `running`, `restarting` e indisponível com comandos Docker controlados por mocks.
- Confirmar que nenhuma rotina destrutiva, troca de segredo ou remoção de volume foi introduzida.
