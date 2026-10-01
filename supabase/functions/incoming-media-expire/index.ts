/**
 * incoming-media-expire — apaga mídias recebidas (crm-media/incoming/*) com mais
 * de 15 dias que não estão em fluxos, templates ou agendamentos.
 *
 * Remoção pela Storage API (apaga arquivo + registro juntos). Depois marca as
 * mensagens como "mídia expirada". Contatos e históricos de texto permanecem.
 * Exige service_role (cron ou AdminCentral).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface ExpiredRow { name: string; size_bytes: number }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("Authorization") ?? "";
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) return json({ success: false, error: "unauthorized" }, 401);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    let batches = 5;
    try {
      const body = await req.json();
      if (typeof body?.batches === "number") batches = Math.min(50, Math.max(1, Math.floor(body.batches)));
    } catch { /* cron sem corpo */ }

    let files = 0;
    let bytes = 0;
    let messages = 0;
    const startedAt = Date.now();

    for (let i = 0; i < batches && Date.now() - startedAt < 240_000; i++) {
      const { data, error } = await supabase.rpc("crm_incoming_media_expired_batch", { p_days: 15, p_limit: 300 });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as ExpiredRow[];
      if (rows.length === 0) break;

      for (let j = 0; j < rows.length; j += 100) {
        const chunk = rows.slice(j, j + 100);
        const names = chunk.map((r) => r.name);
        const { error: removeError } = await supabase.storage.from("crm-media").remove(names);
        if (removeError) throw new Error(removeError.message);
        const { data: marked, error: markError } = await supabase.rpc("crm_incoming_media_mark_expired", { p_names: names });
        if (markError) console.error("[INCOMING-EXPIRE] marcar mensagens falhou", markError.message);
        files += chunk.length;
        bytes += chunk.reduce((s, r) => s + Number(r.size_bytes || 0), 0);
        messages += Number(marked || 0);
      }
    }

    console.log(`[INCOMING-EXPIRE] arquivos=${files} bytes=${bytes} mensagens=${messages}`);
    return json({ success: true, files, bytes, messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[INCOMING-EXPIRE] erro", message);
    return json({ success: false, error: message }, 500);
  }
});
