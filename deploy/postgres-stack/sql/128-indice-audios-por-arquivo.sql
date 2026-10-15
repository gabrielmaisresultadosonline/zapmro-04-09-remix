-- Busca de transcrição de áudio por arquivo (cache de áudios repetidos).
-- Sem índice, cada áudio varria todas as mensagens e travava a leitura do
-- "Gerar prompt pelos meus atendimentos". Índice parcial: só mensagens de áudio.
-- CONCURRENTLY não bloqueia a chegada de mensagens enquanto o índice é criado.

DO $$
BEGIN
  -- Remove um índice que tenha ficado inválido numa tentativa interrompida.
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'crm_messages_audio_media_url_idx' AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX public.crm_messages_audio_media_url_idx';
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_messages_audio_media_url_idx
  ON public.crm_messages (media_url)
  WHERE message_type = 'audio' AND media_url IS NOT NULL;
