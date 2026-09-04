// ============================================================
// /acessor — API administrativa
// Login próprio (mro@gmail.com / senha por env), estatísticas,
// cadastros, ativação de clientes, configuração da OpenAI e do
// WhatsApp Cloud API (com ou sem coexistência).
// Nada aqui toca no CRM existente.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-acessor-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADMIN_EMAIL = (Deno.env.get("ACESSOR_ADMIN_EMAIL") || "mro@gmail.com").trim().toLowerCase();
const ADMIN_PASSWORD = Deno.env.get("ACESSOR_ADMIN_PASSWORD") || "Ga145523@";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Assina "expiração" com HMAC-SHA256 usando a senha do admin como chave. */
async function sign(expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ADMIN_PASSWORD + ADMIN_EMAIL),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(expiresAt)));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${expiresAt}.${hex}`;
}

async function verifyToken(token: string | null): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  const [expiresRaw] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return (await sign(expiresAt)) === token;
}

const digits = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Método não permitido" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ success: false, error: "Requisição inválida" }, 400);
  }

  const action = String(payload.action ?? "");

  // ---------- login ----------
  if (action === "login") {
    const email = String(payload.email ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return json({ success: false, error: "Credenciais inválidas" }, 401);
    }
    return json({ success: true, token: await sign(Date.now() + TOKEN_TTL_MS) });
  }

  // ---------- daqui para baixo exige token ----------
  const token = req.headers.get("x-acessor-admin-token");
  if (!(await verifyToken(token))) {
    return json({ success: false, error: "Sessão expirada. Entre novamente." }, 401);
  }

  try {
    switch (action) {
      case "overview": {
        const [profiles, numbers, entries, appointments] = await Promise.all([
          admin.from("acessor_profiles").select("id,email,full_name,whatsapp,status,trial_ends_at,active_until,created_at").order("created_at", { ascending: false }).limit(500),
          admin.from("acessor_numbers").select("id,user_id,phone,label,is_active"),
          admin.from("acessor_entries").select("id,user_id,kind,amount", { count: "exact" }).limit(5000),
          admin.from("acessor_appointments").select("id,user_id,status", { count: "exact" }).limit(5000),
        ]);

        const rows = profiles.data ?? [];
        const numbersByUser = new Map<string, { phone: string; is_active: boolean }[]>();
        for (const n of numbers.data ?? []) {
          const list = numbersByUser.get(n.user_id) ?? [];
          list.push({ phone: n.phone, is_active: n.is_active });
          numbersByUser.set(n.user_id, list);
        }

        const settings = await admin.from("acessor_settings").select("*").eq("id", 1).maybeSingle();
        const s = settings.data ?? {};

        return json({
          success: true,
          stats: {
            total: rows.length,
            trial: rows.filter((r) => r.status === "trial").length,
            active: rows.filter((r) => r.status === "active").length,
            expired: rows.filter((r) => r.status === "expired").length,
            entries: entries.count ?? (entries.data?.length ?? 0),
            appointments: appointments.count ?? (appointments.data?.length ?? 0),
            numbers: (numbers.data ?? []).length,
          },
          users: rows.map((r) => ({ ...r, numbers: numbersByUser.get(r.id) ?? [] })),
          settings: {
            openai_model: s.openai_model ?? "gpt-4o-mini",
            has_openai_key: Boolean(s.openai_api_key),
            meta_phone_number_id: s.meta_phone_number_id ?? "",
            meta_waba_id: s.meta_waba_id ?? "",
            meta_business_id: s.meta_business_id ?? "",
            meta_app_id: s.meta_app_id ?? "",
            meta_display_phone_number: s.meta_display_phone_number ?? "",
            meta_verify_token: s.meta_verify_token ?? "",
            has_meta_token: Boolean(s.meta_access_token),
            coexistence: Boolean(s.coexistence),
            agent_prompt: s.agent_prompt ?? "",
            unregistered_prompt: s.unregistered_prompt ?? "",
            trial_days: s.trial_days ?? 2,
          },
        });
      }

      case "save_settings": {
        const input = (payload.settings ?? {}) as Record<string, unknown>;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        const textFields = [
          "openai_model", "meta_phone_number_id", "meta_waba_id", "meta_business_id",
          "meta_app_id", "meta_display_phone_number", "meta_verify_token",
          "agent_prompt", "unregistered_prompt",
        ];
        for (const f of textFields) {
          if (typeof input[f] === "string") patch[f] = (input[f] as string).trim();
        }
        // Segredos só são sobrescritos quando o admin envia um valor novo.
        for (const f of ["openai_api_key", "meta_access_token", "meta_app_secret"]) {
          const value = input[f];
          if (typeof value === "string" && value.trim()) patch[f] = value.trim();
        }
        if (typeof input.coexistence === "boolean") patch.coexistence = input.coexistence;
        if (Number.isFinite(Number(input.trial_days))) patch.trial_days = Number(input.trial_days);

        const { error } = await admin.from("acessor_settings").upsert({ id: 1, ...patch });
        if (error) throw error;
        return json({ success: true });
      }

      case "test_openai": {
        const { data } = await admin.from("acessor_settings").select("openai_api_key,openai_model").eq("id", 1).maybeSingle();
        const key = typeof payload.openai_api_key === "string" && payload.openai_api_key.trim()
          ? payload.openai_api_key.trim()
          : data?.openai_api_key;
        if (!key) return json({ success: false, error: "Nenhuma chave da OpenAI configurada." }, 400);
        const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) {
          return json({ success: false, error: `OpenAI recusou a chave (${res.status}).` }, 400);
        }
        return json({ success: true, model: data?.openai_model ?? "gpt-4o-mini" });
      }

      case "test_whatsapp": {
        const { data } = await admin.from("acessor_settings").select("meta_access_token,meta_phone_number_id").eq("id", 1).maybeSingle();
        if (!data?.meta_access_token || !data?.meta_phone_number_id) {
          return json({ success: false, error: "Configure o token e o Phone Number ID primeiro." }, 400);
        }
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${data.meta_phone_number_id}?fields=display_phone_number,verified_name,quality_rating`,
          { headers: { Authorization: `Bearer ${data.meta_access_token}` } },
        );
        const body = await res.json();
        if (!res.ok) return json({ success: false, error: body?.error?.message ?? "Falha na Meta", details: body }, 400);
        await admin.from("acessor_settings").update({
          meta_display_phone_number: body.display_phone_number ?? null,
          updated_at: new Date().toISOString(),
        }).eq("id", 1);
        return json({ success: true, number: body });
      }

      case "set_user_status": {
        const userId = String(payload.user_id ?? "");
        const status = String(payload.status ?? "");
        if (!userId || !["trial", "active", "expired", "blocked"].includes(status)) {
          return json({ success: false, error: "Dados inválidos" }, 400);
        }
        const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
        if (status === "active") {
          const days = Number(payload.days ?? 30);
          patch.active_until = new Date(Date.now() + (Number.isFinite(days) ? days : 30) * 86400000).toISOString();
        }
        const { error } = await admin.from("acessor_profiles").update(patch).eq("id", userId);
        if (error) throw error;
        return json({ success: true });
      }

      case "add_number": {
        const userId = String(payload.user_id ?? "");
        const phone = digits(payload.phone);
        if (!userId || phone.length < 10) return json({ success: false, error: "Número inválido" }, 400);
        const { data: existing } = await admin.from("acessor_numbers").select("id,user_id").eq("phone", phone).maybeSingle();
        if (existing && existing.user_id !== userId) {
          return json({ success: false, error: "Este número já está ativo em outro cadastro." }, 409);
        }
        if (existing) {
          await admin.from("acessor_numbers").update({ is_active: true }).eq("id", existing.id);
        } else {
          const { error } = await admin.from("acessor_numbers").insert({
            user_id: userId,
            phone,
            label: typeof payload.label === "string" ? payload.label : null,
            is_active: true,
          });
          if (error) throw error;
        }
        return json({ success: true });
      }

      case "toggle_number": {
        const id = String(payload.number_id ?? "");
        if (!id) return json({ success: false, error: "Número inválido" }, 400);
        const { error } = await admin.from("acessor_numbers")
          .update({ is_active: Boolean(payload.is_active) }).eq("id", id);
        if (error) throw error;
        return json({ success: true });
      }

      case "user_detail": {
        const userId = String(payload.user_id ?? "");
        if (!userId) return json({ success: false, error: "Cadastro inválido" }, 400);
        const [entries, appointments, messages] = await Promise.all([
          admin.from("acessor_entries").select("*").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(200),
          admin.from("acessor_appointments").select("*").eq("user_id", userId).order("starts_at", { ascending: true }).limit(200),
          admin.from("acessor_messages").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
        ]);
        return json({
          success: true,
          entries: entries.data ?? [],
          appointments: appointments.data ?? [],
          messages: messages.data ?? [],
        });
      }

      default:
        return json({ success: false, error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (error) {
    console.error("[acessor-admin]", action, error);
    return json({ success: false, error: error instanceof Error ? error.message : "Erro interno" }, 500);
  }
});
