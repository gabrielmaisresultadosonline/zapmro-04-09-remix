// Roteador principal do Edge Runtime self-hosted.
// Recebe /<nome-da-funcao> e executa supabase/functions/<nome-da-funcao>/index.ts
// no mesmo formato do Supabase Edge Functions (Deno.serve / serve()).
// @ts-nocheck
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token, x-acessor-admin-token, x-supabase-api-version",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const name = url.pathname.replace(/^\/+/, "").split("/")[0];
  // Endpoint sem nome usado pelo monitoramento da stack. Não tenta carregar uma
  // função e confirma apenas que o Edge Runtime e o roteador estão respondendo.
  if (!name) {
    return new Response(JSON.stringify({ status: "ok", service: "functions" }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${name}`;
  try {
    await Deno.stat(`${servicePath}/index.ts`);
  } catch {
    return new Response(JSON.stringify({ error: `function ${name} not found` }), {
      status: 404,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    // @ts-ignore API do edge-runtime
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: Number(Deno.env.get("FN_MEMORY_MB") ?? 512),
      workerTimeoutMs: Number(Deno.env.get("FN_TIMEOUT_MS") ?? 400_000),
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
      forceCreate: false,
    });
    return await worker.fetch(req);
  } catch (e) {
    console.error(`[${name}]`, e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
