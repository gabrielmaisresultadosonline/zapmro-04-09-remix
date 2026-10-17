/**
 * media-gc — esvazia a lixeira de mídias.
 *
 * Por quê: quando um fluxo, template ou conversa é apagado, o arquivo NÃO é
 * removido do disco na hora. Ele entra em crm_media_gc_queue com prazo de
 * 7 dias para fluxos; conversas apagadas entram com vencimento imediato.
 * Esta função roda a cada cinco minutos, pega apenas os itens vencidos e,
 * antes de apagar, confere de novo se ninguém voltou a usar o arquivo.
 *
 * Segurança: qualquer dúvida (arquivo ainda referenciado, erro na remoção)
 * preserva o arquivo. Nada ativo é apagado.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueueItem {
  id: string;
  user_id: string;
  bucket: string;
  path: string;
  public_url: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const backendUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !backendUrl) return new Response("Missing configuration", { status: 500, headers: corsHeaders });
  if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      backendUrl,
      serviceKey,
    );

    let limit = 200;
    try {
      const body = await req.json();
      if (typeof body?.limit === "number") limit = Math.min(1000, Math.max(1, body.limit));
    } catch {
      /* chamada sem corpo (cron) */
    }

    const { data: due, error: dueError } = await supabase.rpc("crm_media_purge_due", {
      p_limit: limit,
    });
    if (dueError) throw new Error(dueError.message);

    const items = (due ?? []) as QueueItem[];
    console.log(`[MEDIA-GC] itens vencidos: ${items.length}`);

    let purged = 0;
    let restored = 0;
    let failed = 0;

    const startedAt = Date.now();
    let checked = 0;
    for (const item of items) {
      if (Date.now() - startedAt > 50_000) break;
      checked += 1;
      try {
        // Última conferência: alguém voltou a usar este arquivo?
        const stillUsed = await isStillReferenced(supabase, item);
        if (stillUsed) {
          await supabase.rpc("crm_media_mark_purged", {
            p_id: item.id,
            p_status: "restored",
            p_error: null,
          });
          restored += 1;
          console.log(`[MEDIA-GC] preservado (em uso): ${item.bucket}/${item.path}`);
          continue;
        }

        const { error: removeError } = await supabase.storage
          .from(item.bucket)
          .remove([item.path]);
        if (removeError) throw new Error(removeError.message);

        const { error: markError } = await supabase.rpc("crm_media_mark_purged", {
          p_id: item.id,
          p_status: "purged",
          p_error: null,
        });
        if (markError) throw new Error(markError.message);
        purged += 1;
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[MEDIA-GC] falha em ${item.bucket}/${item.path}: ${message}`);
        await supabase.rpc("crm_media_mark_purged", {
          p_id: item.id,
          p_status: "failed",
          p_error: message,
        });
      }
    }

    console.log(`[MEDIA-GC] concluído — apagados=${purged} preservados=${restored} falhas=${failed}`);
    return new Response(
      JSON.stringify({ success: failed === 0, checked, purged, restored, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[MEDIA-GC] erro geral:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** true quando alguma mensagem, fluxo ou template ainda aponta para o arquivo. */
async function isStillReferenced(
  supabase: SupabaseClient,
  item: QueueItem,
): Promise<boolean> {
  const url = item.public_url;
  if (!url) return true; // sem URL não dá para conferir: preserva

  const centralizedCheck = await supabase.rpc("crm_media_is_referenced", {
    p_user_id: item.user_id,
    p_public_url: url,
    p_path: item.path,
  });
  if (centralizedCheck.error) return true;
  if (centralizedCheck.data === true) return true;

  // A RPC central inclui mensagens, metadados, fluxos, templates, documentos
  // e campanhas/agendamentos ativos em todos os cadastros. Falha preserva.
  return centralizedCheck.data !== false;
}
