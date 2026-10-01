import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pending") }).strict(),
  z.object({ action: z.literal("acknowledge"), eventId: z.string().uuid() }).strict(),
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ success: false, error: "Backend configuration is missing" }, 500);

  const authorization = req.headers.get("authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ success: false, error: "Unauthorized" }, 401);

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ success: false, error: parsed.error.flatten().fieldErrors }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  if (parsed.data.action === "pending") {
    const { data, error } = await admin
      .from("crm_storage_cleanup_events")
      .select("id, cleaned_at, deleted_messages")
      .eq("user_id", user.id)
      .is("acknowledged_at", null)
      .order("cleaned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, event: data || null });
  }

  const { data, error } = await admin
    .from("crm_storage_cleanup_events")
    .update({ acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", parsed.data.eventId)
    .eq("user_id", user.id)
    .is("acknowledged_at", null)
    .select("id")
    .maybeSingle();
  if (error) return json({ success: false, error: error.message }, 500);
  return json({ success: true, acknowledged: Boolean(data) });
});