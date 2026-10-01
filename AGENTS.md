## Decisões de arquitetura

- A gestão de armazenamento do CRM usa RPCs `service_role` pelo AdminCentral; isso mantém métricas e exclusões fora do navegador e isoladas por número.
- A retenção automática de conversas é de 30 dias de inatividade; contatos, números, configurações, fluxos e templates nunca são removidos por essa rotina.