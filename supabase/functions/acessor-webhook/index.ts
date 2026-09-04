// ============================================================
// /acessor — Webhook do WhatsApp Cloud API (Meta oficial)
// Recebe texto e áudio, identifica o cadastro pelo número que
// enviou, interpreta com a OpenAI e grava gastos, entradas,
// investimentos, anotações e agendamentos. Responde no WhatsApp.
// Independente do CRM: usa somente as tabelas acessor_*.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v21.0";

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

type Settings = {
  openai_api_key: string | null;
  openai_model: string | null;
  meta_access_token: string | null;
  meta_phone_number_id: string | null;
  meta_verify_token: string | null;
  agent_prompt: string | null;
  unregistered_prompt: string | null;
};

type Interpretation = {
  reply: string;
  entries?: { kind: string; description: string; amount?: number | null; category?: string | null }[];
  appointments?: { title: string; starts_at: string; notes?: string | null }[];
};

const log = (...args: unknown[]) => console.log("[ACESSOR-WEBHOOK]", ...args);

async function loadSettings(): Promise<Settings | null> {
  const { data, error } = await admin.from("acessor_settings").select("*").eq("id", 1).maybeSingle();
  if (error) log("erro ao ler settings:", error.message);
  return (data as Settings) ?? null;
}

async function sendText(settings: Settings, to: string, body: string) {
  if (!settings.meta_access_token || !settings.meta_phone_number_id) {
    log("sem credenciais Meta — resposta não enviada");
    return null;
  }
  const res = await fetch(`${GRAPH}/${settings.meta_phone_number_id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.meta_access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: body.slice(0, 4000) },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) log("falha ao enviar:", res.status, JSON.stringify(json));
  return json;
}

/** Baixa o áudio na Meta e transcreve com a OpenAI. */
async function transcribeAudio(settings: Settings, mediaId: string): Promise<string> {
  if (!settings.meta_access_token || !settings.openai_api_key) return "";
  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${settings.meta_access_token}` },
  });
  const meta = await metaRes.json();
  if (!meta?.url) return "";
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${settings.meta_access_token}` },
  });
  const buffer = await fileRes.arrayBuffer();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: meta.mime_type || "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-1");
  form.append("language", "pt");
  const openaiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.openai_api_key}` },
    body: form,
  });
  const out = await openaiRes.json().catch(() => ({}));
  if (!openaiRes.ok) {
    log("falha na transcrição:", openaiRes.status, JSON.stringify(out));
    return "";
  }
  return String(out.text ?? "");
}

/** Interpreta a mensagem e devolve registros estruturados + resposta. */
async function interpret(settings: Settings, text: string, userName: string): Promise<Interpretation> {
  if (!settings.openai_api_key) {
    return { reply: "Recebi sua mensagem, mas o agente ainda não está configurado. Tente novamente em instantes." };
  }

  const system = `${settings.agent_prompt ?? "Você é o Acessor, assistente de agendamentos e organização financeira."}
Hoje é ${new Date().toISOString()} (UTC). O cliente se chama ${userName || "cliente"}.
Responda SEMPRE com JSON no formato:
{"reply":"texto curto de confirmação em português",
 "entries":[{"kind":"gasto|entrada|investimento|nota","description":"...","amount":número ou null,"category":"..."}],
 "appointments":[{"title":"...","starts_at":"ISO-8601 com timezone","notes":"..."}]}
Use listas vazias quando não houver nada a registrar.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.openai_api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.openai_model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    log("OpenAI falhou:", res.status, JSON.stringify(out).slice(0, 500));
    return { reply: "Não consegui processar agora. Pode repetir em alguns segundos?" };
  }
  try {
    const parsed = JSON.parse(out.choices?.[0]?.message?.content ?? "{}") as Interpretation;
    return {
      reply: parsed.reply || "Anotado!",
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
    };
  } catch {
    return { reply: "Anotado!" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const settings = await loadSettings();

  // ---------- verificação do webhook na Meta ----------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = settings?.meta_verify_token || Deno.env.get("ACESSOR_VERIFY_TOKEN") || "acessor";
    if (mode === "subscribe" && token === expected) {
      log("webhook verificado");
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  // A Meta exige 200 rápido: processamos e sempre respondemos 200.
  try {
    if (!settings) {
      log("sem configuração salva");
      return new Response("ok", { status: 200 });
    }

    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
    const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts ?? [];
    const pushName = contacts?.[0]?.profile?.name ?? "";

    for (const message of messages) {
      const from = String(message.from ?? "").replace(/\D/g, "");
      if (!from) continue;

      let text = "";
      if (message.type === "text") text = String(message.text?.body ?? "");
      else if (message.type === "audio" && message.audio?.id) {
        text = await transcribeAudio(settings, message.audio.id);
      } else if (message.type === "image" && message.image?.caption) {
        text = String(message.image.caption);
      }

      // Localiza o cadastro pelo número ativo (aceita variação do 9 no Brasil).
      const variants = new Set<string>([from]);
      if (from.startsWith("55") && from.length === 12) {
        variants.add(`${from.slice(0, 4)}9${from.slice(4)}`);
      }
      if (from.startsWith("55") && from.length === 13) {
        variants.add(from.slice(0, 4) + from.slice(5));
      }

      const { data: numberRow } = await admin
        .from("acessor_numbers")
        .select("id,user_id,is_active")
        .in("phone", Array.from(variants))
        .eq("is_active", true)
        .maybeSingle();

      await admin.from("acessor_messages").insert({
        user_id: numberRow?.user_id ?? null,
        wa_id: from,
        direction: "in",
        body: text || `[${message.type}]`,
        meta_message_id: message.id ?? null,
      });

      if (!numberRow) {
        const reply = settings.unregistered_prompt ||
          "Não encontrei este número em um cadastro ativo. Faça seu cadastro e ative este número para usar o agente.";
        log("número sem cadastro ativo:", from);
        await sendText(settings, from, reply);
        await admin.from("acessor_messages").insert({ wa_id: from, direction: "out", body: reply });
        continue;
      }

      const { data: profile } = await admin
        .from("acessor_profiles")
        .select("id,full_name,status,trial_ends_at,active_until")
        .eq("id", numberRow.user_id)
        .maybeSingle();

      const now = Date.now();
      const trialOk = profile?.status === "trial" && new Date(profile.trial_ends_at).getTime() > now;
      const activeOk = profile?.status === "active" &&
        (!profile.active_until || new Date(profile.active_until).getTime() > now);

      if (!trialOk && !activeOk) {
        const reply = "Seu período de acesso terminou. Ative seu plano no painel do Acessor para continuar usando o agente.";
        await sendText(settings, from, reply);
        await admin.from("acessor_messages").insert({ user_id: numberRow.user_id, wa_id: from, direction: "out", body: reply });
        continue;
      }

      if (!text.trim()) {
        const reply = "Recebi seu envio, mas não consegui ler o conteúdo. Pode mandar em texto ou áudio?";
        await sendText(settings, from, reply);
        continue;
      }

      const result = await interpret(settings, text, profile?.full_name ?? pushName);
      log("interpretado:", JSON.stringify({
        user: numberRow.user_id,
        entries: result.entries?.length ?? 0,
        appointments: result.appointments?.length ?? 0,
      }));

      const validKinds = ["gasto", "entrada", "investimento", "nota"];
      const entries = (result.entries ?? [])
        .filter((e) => e?.description)
        .map((e) => ({
          user_id: numberRow.user_id,
          kind: validKinds.includes(String(e.kind)) ? String(e.kind) : "nota",
          description: String(e.description).slice(0, 500),
          amount: Number.isFinite(Number(e.amount)) ? Number(e.amount) : null,
          category: e.category ? String(e.category).slice(0, 100) : null,
          raw_message: text.slice(0, 2000),
        }));
      if (entries.length) {
        const { error } = await admin.from("acessor_entries").insert(entries);
        if (error) log("erro ao gravar anotações:", error.message);
      }

      const appointments = (result.appointments ?? [])
        .filter((a) => a?.title && a?.starts_at && !Number.isNaN(Date.parse(a.starts_at)))
        .map((a) => ({
          user_id: numberRow.user_id,
          title: String(a.title).slice(0, 300),
          starts_at: new Date(a.starts_at).toISOString(),
          notes: a.notes ? String(a.notes).slice(0, 1000) : null,
          raw_message: text.slice(0, 2000),
        }));
      if (appointments.length) {
        const { error } = await admin.from("acessor_appointments").insert(appointments);
        if (error) log("erro ao gravar agendamentos:", error.message);
      }

      await sendText(settings, from, result.reply);
      await admin.from("acessor_messages").insert({
        user_id: numberRow.user_id,
        wa_id: from,
        direction: "out",
        body: result.reply,
      });
    }
  } catch (error) {
    console.error("[ACESSOR-WEBHOOK] erro:", error);
  }

  return new Response("ok", { status: 200, headers: corsHeaders });
});
