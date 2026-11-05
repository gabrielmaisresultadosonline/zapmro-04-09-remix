-- 140: progresso em tempo real da transcodificação dos tutoriais (lido pelo Admin Central).
ALTER TABLE public.sales_tutorials ADD COLUMN IF NOT EXISTS transcode_step text;
ALTER TABLE public.sales_tutorials ADD COLUMN IF NOT EXISTS transcode_progress integer NOT NULL DEFAULT 0;
