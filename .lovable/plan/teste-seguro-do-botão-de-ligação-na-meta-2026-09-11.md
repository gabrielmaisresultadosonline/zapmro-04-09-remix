# Teste seguro do botão de ligação na Meta

## Objetivo
Criar um único script para a VPS que teste `call_icon_visibility: DISABLE_ALL` exclusivamente no número `+55 11 92083-7268`, sem alterar qualquer outra configuração.

## Implementação
- Localizar exatamente uma caixa pelo telefone em `crm_whatsapp_numbers`, com fallback somente leitura para `crm_settings` legado.
- Recuperar `PHONE_NUMBER_ID` e token internamente, sem imprimir nem gravar o token nos relatórios.
- Fazer o GET inicial, capturar corpo e HTTP status, validar JSON e erro da Meta, e gravar o backup `ANTES` com data/hora UTC e São Paulo.
- Bloquear o POST se o backup não existir, estiver vazio, for inválido ou se o GET inicial não retornar HTTP 2xx.
- Pedir confirmação digitada vinculada ao número e aplicar apenas o corpo autorizado para `calling`.
- Parar imediatamente caso o POST falhe; preservar resposta completa e status em arquivos de diagnóstico.
- Fazer o GET final somente após POST bem-sucedido, salvar `DEPOIS` e gerar comparação `ANTES x DEPOIS` sem incluir credenciais.
- Manter todos os arquivos em `/root`, com permissões restritas, e imprimir os passos de teste manual ao final.

## Validação
- Validar sintaxe Bash.
- Simular banco e API Meta para cobrir sucesso, falha no GET inicial e falha no POST.
- Confirmar que nenhuma ação de remoção, desconexão, alteração de storage ou desativação de chamadas existe no script.
