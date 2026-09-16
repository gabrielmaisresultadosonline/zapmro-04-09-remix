/**
 * media-gc — esvazia a lixeira de mídias.
 *
 * Por quê: quando um fluxo, template ou conversa é apagado, o arquivo NÃO é
 * removido do disco na hora. Ele entra em crm_media_gc_queue com prazo de
 * 7 dias. Esta função roda uma vez por dia, pega apenas os itens vencidos e,
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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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

    for (const item of items) {
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

        await supabase.rpc("crm_media_mark_purged", {
          p_id: item.id,
          p_status: "purged",
          p_error: null,
        });
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
      JSON.stringify({ success: true, checked: items.length, purged, restored, failed }),
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

  const byMedia = await supabase
    .from("crm_messages")
    .select("id")
    .eq("media_url", url)
    .limit(1);
  if (byMedia.error) return true;
  if ((byMedia.data?.length ?? 0) > 0) return true;

  const byContent = await supabase
    .from("crm_messages")
    .select("id")
    .eq("content", url)
    .limit(1);
  if (byContent.error) return true;
  if ((byContent.data?.length ?? 0) > 0) return true;

  const needle = `%${item.path}%`;

  const flows = await supabase
    .from("crm_flows")
    .select("id")
    .eq("user_id", item.user_id)
    .or(`nodes::text.ilike.${needle},edges::text.ilike.${needle}`)
    .limit(1);
  if (flows.error) {
    // Fallback: varre no cliente (poucos fluxos por usuário).
    const all = await supabase.from("crm_flows").select("nodes, edges").eq("user_id", item.user_id);
    if (all.error) return true;
    if (JSON.stringify(all.data ?? []).includes(item.path)) return true;
  } else if ((flows.data?.length ?? 0) > 0) {
    return true;
  }

  const templates = await supabase
    .from("crm_templates")
    .select("components")
    .eq("user_id", item.user_id);
  if (templates.error) return true;
  if (JSON.stringify(templates.data ?? []).includes(item.path)) return true;

  // Mensagens agendadas ainda não foram enviadas, mas podem apontar para a
  // mesma mídia. Em caso de erro, preserva o arquivo.
  const scheduled = await supabase
    .from("crm_scheduled_messages")
    .select("message_data")
    .eq("user_id", item.user_id)
    .in("status", ["pending", "processing"]);
  if (scheduled.error) return true;
  if (JSON.stringify(scheduled.data ?? []).includes(item.path)) return true;

  return false;
}
