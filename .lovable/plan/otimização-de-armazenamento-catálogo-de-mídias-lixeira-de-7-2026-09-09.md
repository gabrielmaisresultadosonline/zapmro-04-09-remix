# Otimização de armazenamento — catálogo de mídias + lixeira de 7 dias

## O que já existe hoje
- Deduplicação por hash **já está feita**: todo arquivo enviado pelo CRM, editor de fluxos e criador de templates é salvo em um caminho derivado do SHA-256 do conteúdo. O mesmo vídeo enviado para 10.000 contatos ocupa 1 arquivo só.
- Já existe a varredura única por cliente que unifica os arquivos antigos (anteriores à deduplicação).
- Já existe limpeza de arquivos sem uso quando uma conversa é apagada ou um fluxo é removido — mas ela apaga **na hora**, sem período de segurança.

## O que falta (e será feito agora)
1. **Catálogo de mídias** — uma tabela que registra cada arquivo físico uma única vez.
2. **Contador de referências** — quantas mensagens, fluxos e templates usam aquele arquivo.
3. **Lixeira de 7 dias** — quando o contador chega a zero, o arquivo entra numa fila e só é apagado do disco 7 dias depois. Nada é apagado na hora, nada some por engano.

Nada existente é removido, renomeado ou desligado. Mídias ativas (templates aprovados, fluxos em uso, conversas atuais) nunca entram na fila.

## Detalhes técnicos

### Banco — nova migração `102-catalogo-de-midias.sql`
- `public.crm_media_assets`: `id uuid`, `user_id`, `sha256`, `bucket`, `path`, `public_url`, `mime_type`, `size_bytes`, `reference_count int default 0`, `created_at`, `updated_at`. Único por (`user_id`, `bucket`, `path`); índice por `sha256` e por `reference_count`.
- `public.crm_media_gc_queue`: `id`, `media_asset_id`, `user_id`, `bucket`, `path`, `public_url`, `queued_at`, `purge_after timestamptz default now() + interval '7 days'`, `status text check (status in ('pending','purged','restored','failed'))`, `reason`, `last_error`.
- Ambas com GRANTs (`authenticated` leitura/escrita própria, `service_role` total) + RLS por `auth.uid()`.
- Funções `security definer`:
  - `crm_media_register(...)` — upsert do asset, devolve o id.
  - `crm_media_addref(asset_id, delta)` — soma/subtrai referências, nunca abaixo de zero; ao chegar a 0 insere na fila (se ainda não houver item `pending`); ao voltar a ≥1 marca o item da fila como `restored`.
  - `crm_media_purge_due(limit)` — lista itens vencidos para o worker.
  - `crm_media_mark_purged(id, ok, err)`.
- Migração é idempotente (`if not exists`), não altera nenhuma tabela existente.

### Frontend
- `src/lib/mediaStorage.ts`:
  - `uploadDedupedMedia` passa a registrar o arquivo no catálogo (best-effort: se o registro falhar, o upload continua funcionando como hoje).
  - `deleteMediaUrlsIfUnused` deixa de apagar direto do Storage e passa a **enfileirar** para purga em 7 dias (mesma checagem de "ainda em uso" de hoje, mais a checagem de templates). Um parâmetro `immediate` mantém o comportamento antigo onde for necessário.
  - Nova `releaseMediaUrls` / `retainMediaUrls` para ajustar o contador quando fluxos/templates ganham ou perdem mídia.
- Chamadas já existentes em `CRM.tsx`, `FlowEditor.tsx`, `TemplateBuilder.tsx`, `TemplateVariablesDialog.tsx` e `conversationArchive.ts` continuam com a mesma assinatura — só mudam de "apaga" para "agenda a remoção".

### Worker de limpeza
- Nova função `supabase/functions/media-gc/index.ts`: lê os itens vencidos, confirma uma última vez que a URL não aparece em mensagens, fluxos nem templates, apaga do Storage e marca como `purged`. Se ainda estiver em uso, marca `restored`.
- `deploy/atualizar.sh` agenda `media-gc-daily` (uma vez por dia, 4h) apontando para a API local, no mesmo bloco dos outros crons.

### Faxina do disco
- `deploy/limpar-armazenamento.sh` ganha um resumo do catálogo (assets, referências, fila pendente e espaço a liberar), continuando em modo relatório por padrão.

## Validação
- `npx tsgo --noEmit -p tsconfig.app.json`, `bash -n deploy/atualizar.sh`, `git diff --check` e leitura do log de build.
- Deploy na VPS: `sudo bash deploy/atualizar.sh` aplica a migração 102 e o novo cron sem tocar em dados, tokens ou `.env`.
