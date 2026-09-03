import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  sendCrmSalesApprovedEmail,
  sendCrmSalesRegisteredEmail,
  sendCrmAccessReminderEmail,
} from "../_shared/zapmro-sales-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-admin-session",
};

const ADMIN_EMAIL = "mro@gmail.com";
const ADMIN_PASSWORD = "Ga145523@";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

/**
 * Executa tarefas lentas (e-mail) FORA do ciclo da resposta.
 *
 * Antes o painel esperava o provedor de e-mail antes de confirmar a operação —
 * quando o envio demorava, o botão ficava carregando até o tempo esgotar mesmo
 * com a gravação já concluída no banco. Agora a resposta sai imediatamente após
 * a escrita crítica e o envio continua em segundo plano.
 */
function background(label: string, task: () => Promise<unknown>) {
  const run = Promise.resolve()
    .then(task)
    .catch((e) => console.error(`[${label}] background error:`, e));
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(run);
  return run;
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { action, adminEmail, adminPassword } = body as any;

    if (
      (adminEmail || "").toString().trim().toLowerCase() !== ADMIN_EMAIL ||
      (adminPassword || "").toString() !== ADMIN_PASSWORD
    ) {
      return json({ success: false, error: "Credenciais inválidas" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (action === "login") {
      return json({ success: true });
    }

    /**
     * Dump em pedaços — evita estourar tempo/memória da edge function.
     * dump_structure: metadados + estrutura (leve)
     * dump_chunk: um bloco de dados por vez (rows/auth/storage)
     */
    if (action === "dump_structure" || action === "dump_chunk") {
      const rpcText = async (fn: string, args: Record<string, unknown> = {}): Promise<string> => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) throw new Error(`${fn}: ${error.message}`);
        return (data as string) || "";
      };
      const safe = async (fn: string, args: Record<string, unknown> = {}): Promise<string> => {
        try {
          return await rpcText(fn, args);
        } catch (e) {
          return `-- ERRO ao exportar ${fn}: ${(e as Error).message}`;
        }
      };

      if (action === "dump_structure") {
        const { data: tables, error: tErr } = await supabase.rpc("admin_list_public_tables");
        if (tErr) throw tErr;
        let usersCount = 0;
        try {
          const { data: uc } = await supabase.rpc("admin_count_auth_users");
          usersCount = Number(uc || 0);
        } catch (_e) { /* ignore */ }

        const [
          extensions, types, sequences, schema, functions,
          views, fks, indexes, policies, triggers, grants, cron,
        ] = await Promise.all([
          safe("admin_dump_extensions"),
          safe("admin_dump_types"),
          safe("admin_dump_sequences"),
          safe("admin_dump_schema"),
          safe("admin_dump_functions"),
          safe("admin_dump_views"),
          safe("admin_dump_fks"),
          safe("admin_dump_indexes"),
          safe("admin_dump_policies"),
          safe("admin_dump_triggers"),
          safe("admin_dump_grants"),
          safe("admin_dump_cron"),
        ]);

        return json({
          success: true,
          tables: tables || [],
          usersCount,
          sections: { extensions, types, sequences, schema, functions, views, fks, indexes, policies, triggers, grants, cron },
        });
      }

      // dump_chunk
      const { kind, table, offset = 0, limit } = body as any;
      let sql = "";
      if (kind === "rows") {
        sql = await safe("admin_dump_table_rows", {
          p_table: table,
          p_offset: Number(offset) || 0,
          p_limit: Number(limit) || 500,
        });
      } else if (kind === "auth_users") {
        sql = await safe("admin_dump_auth_users", { p_offset: Number(offset) || 0, p_limit: Number(limit) || 500 });
      } else if (kind === "auth_identities") {
        sql = await safe("admin_dump_auth_identities", { p_offset: Number(offset) || 0, p_limit: Number(limit) || 500 });
      } else if (kind === "storage") {
        sql = await safe("admin_dump_storage", { p_offset: Number(offset) || 0, p_limit: Number(limit) || 1000 });
      } else {
        return json({ success: false, error: "kind inválido" });
      }

      // Conta statements reais (valores podem conter quebras de linha)
      const lines = kind === "storage"
        ? (sql.match(/^-- FILE /gm) || []).length
        : sql.split("\n").filter((l) => l.startsWith("INSERT INTO ")).length;
      return json({ success: true, sql, lines });
    }



    if (action === "export_dump_sql") {
      const rpcText = async (fn: string, args: Record<string, unknown> = {}): Promise<string> => {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) throw new Error(`${fn}: ${error.message}`);
        return (data as string) || "";
      };
      const safe = async (fn: string, args: Record<string, unknown> = {}): Promise<string> => {
        try {
          return await rpcText(fn, args);
        } catch (e) {
          return `-- ERRO ao exportar ${fn}: ${(e as Error).message}`;
        }
      };

      // 1) Lista de tabelas
      const { data: tables, error: tErr } = await supabase.rpc("admin_list_public_tables");
      if (tErr) throw tErr;
      const tableList = (tables || []) as { table_name: string; row_count: number }[];

      // 2) Estrutura completa
      const extensionsSql = await safe("admin_dump_extensions");
      const typesSql = await safe("admin_dump_types");
      const sequencesSql = await safe("admin_dump_sequences");
      const schemaSql = await safe("admin_dump_schema");
      const viewsSql = await safe("admin_dump_views");
      const fksSql = await safe("admin_dump_fks");
      const indexesSql = await safe("admin_dump_indexes");
      const functionsSql = await safe("admin_dump_functions");
      const triggersSql = await safe("admin_dump_triggers");
      const policiesSql = await safe("admin_dump_policies");
      const grantsSql = await safe("admin_dump_grants");
      const cronSql = await safe("admin_dump_cron");

      // 3) Dados públicos, em blocos de 1000 linhas por tabela
      let rowsCount = 0;
      const dataParts: string[] = [];
      for (const t of tableList) {
        let offset = 0;
        for (;;) {
          const chunk = await rpcText("admin_dump_table_rows", {
            p_table: t.table_name,
            p_offset: offset,
            p_limit: 1000,
          });
          if (!chunk || !chunk.trim()) break;
          dataParts.push(`-- Tabela: ${t.table_name}\n${chunk}`);
          const lines = chunk.trim().split("\n").length;
          rowsCount += lines;
          if (lines < 1000) break;
          offset += 1000;
        }
      }

      // 4) Auth (usuários + identidades) — hashes de senha preservados
      let usersCount = 0;
      try {
        const { data: uc } = await supabase.rpc("admin_count_auth_users");
        usersCount = Number(uc || 0);
      } catch (_e) { /* ignore */ }

      const authParts: string[] = [];
      for (let off = 0; ; off += 500) {
        const chunk = await safe("admin_dump_auth_users", { p_offset: off, p_limit: 500 });
        if (!chunk || !chunk.trim()) break;
        authParts.push(chunk);
        if (chunk.trim().split("\n").length < 500) break;
        if (off > 100000) break;
      }
      const identityParts: string[] = [];
      for (let off = 0; ; off += 500) {
        const chunk = await safe("admin_dump_auth_identities", { p_offset: off, p_limit: 500 });
        if (!chunk || !chunk.trim()) break;
        identityParts.push(chunk);
        if (chunk.trim().split("\n").length < 500) break;
        if (off > 100000) break;
      }

      // 5) Storage: buckets + inventário de arquivos
      const storageParts: string[] = [];
      let filesCount = 0;
      for (let off = 0; ; off += 2000) {
        const chunk = await safe("admin_dump_storage", { p_offset: off, p_limit: 2000 });
        if (!chunk || !chunk.trim()) break;
        storageParts.push(chunk);
        const fileLines = (chunk.match(/^-- FILE /gm) || []).length;
        filesCount += fileLines;
        if (fileLines < 2000) break;
        if (off > 200000) break;
      }

      const generatedAt = new Date().toISOString();

      const header = [
        `-- ============================================================`,
        `-- MRO / ZAPMRO — DUMP COMPLETO DO BANCO`,
        `-- Gerado em: ${generatedAt}`,
        `-- Tabelas: ${tableList.length} | Linhas: ${rowsCount} | Usuarios Auth: ${usersCount} | Arquivos storage: ${filesCount}`,
        `-- Inclui: extensions, types/enums, sequences, tabelas, views, dados,`,
        `--         funcoes, triggers, RLS, indices, FKs, grants, cron, auth.users`,
        `-- Ordem de restauracao ja esta correta: basta rodar este arquivo inteiro.`,
        `-- ============================================================`,
        ``,
        `BEGIN;`,
        `SET session_replication_role = replica;`,
        ``,
      ].join("\n");

      const sql = [
        header,
        `-- ============ 1. EXTENSIONS ============`,
        extensionsSql,
        `-- ============ 2. TYPES / ENUMS / DOMAINS ============`,
        typesSql,
        `-- ============ 3. SEQUENCES ============`,
        sequencesSql,
        `-- ============ 4. ESTRUTURA (TABELAS) ============`,
        schemaSql,
        `-- ============ 5. FUNCOES POSTGRESQL ============`,
        functionsSql,
        `-- ============ 6. DADOS (SCHEMA PUBLIC) ============`,
        dataParts.join("\n\n"),
        ``,
        `-- ============ 7. AUTH — USUARIOS (senhas hash preservadas) ============`,
        authParts.join("\n"),
        ``,
        `-- ============ 8. AUTH — IDENTIDADES (Google/Facebook/email) ============`,
        identityParts.join("\n"),
        ``,
        `-- ============ 9. STORAGE — BUCKETS + INVENTARIO DE ARQUIVOS ============`,
        storageParts.join("\n"),
        ``,
        `-- ============ 10. VIEWS ============`,
        viewsSql,
        `-- ============ 11. RELACIONAMENTOS (FKs) ============`,
        fksSql,
        `-- ============ 12. INDICES ============`,
        indexesSql,
        `-- ============ 13. POLITICAS RLS ============`,
        policiesSql,
        `-- ============ 14. TRIGGERS ============`,
        triggersSql,
        `-- ============ 15. PERMISSOES (GRANTS) ============`,
        grantsSql,
        `-- ============ 16. CRON JOBS ============`,
        cronSql,
        ``,
        `SET session_replication_role = DEFAULT;`,
        `COMMIT;`,
      ].join("\n");

      const readme = [
        `# MIGRACAO ZAPMRO — COMO IMPORTAR NO NOVO BANCO`,
        ``,
        `Gerado em: ${generatedAt}`,
        `Tabelas: ${tableList.length} | Linhas: ${rowsCount} | Usuarios Auth: ${usersCount} | Arquivos storage: ${filesCount}`,
        ``,
        `## 1. O que o arquivo .sql ja contem (tudo automatico)`,
        `- Extensions (pgcrypto, pg_net, pg_cron, etc.)`,
        `- Types / Enums (ex: app_role) e domains`,
        `- Sequences com valor atual (setval)`,
        `- Todas as tabelas do schema public (colunas, defaults, NOT NULL, PK)`,
        `- Todos os dados (INSERT ... ON CONFLICT DO NOTHING)`,
        `- Usuarios do Auth (auth.users) com hash de senha + auth.identities`,
        `- Buckets do Storage + inventario completo dos arquivos (linhas "-- FILE bucket/caminho")`,
        `- Views e materialized views`,
        `- Foreign keys, indices, funcoes, triggers, politicas RLS, grants`,
        `- Cron jobs (comandos cron.schedule)`,
        ``,
        `## 2. Passo a passo da importacao`,
        `1. Crie o novo projeto Supabase (ou Postgres) e anote a connection string.`,
        `2. Rode o dump:`,
        `   psql "postgres://postgres:SENHA@HOST:5432/postgres" -f mro_backup_AAAA-MM-DD.sql`,
        `   (ou cole o conteudo no SQL Editor, em partes se for muito grande)`,
        `3. Se alguma extension nao existir no destino, comente a linha e rode de novo.`,
        `4. Confira: select count(*) from crm_contacts; select count(*) from auth.users;`,
        ``,
        `## 3. Arquivos do Storage (binarios)`,
        `O SQL recria os buckets e lista todos os arquivos, mas os binarios precisam ser copiados.`,
        `Use o script abaixo (Node) com as chaves dos dois projetos:`,
        ``,
        '```js',
        `import { createClient } from "@supabase/supabase-js";`,
        `const src = createClient(OLD_URL, OLD_SERVICE_ROLE);`,
        `const dst = createClient(NEW_URL, NEW_SERVICE_ROLE);`,
        `// para cada linha "-- FILE bucket/caminho" do dump:`,
        `const { data } = await src.storage.from(bucket).download(path);`,
        `await dst.storage.from(bucket).upload(path, data, { upsert: true });`,
        '```',
        ``,
        `## 4. O que NAO entra no SQL (feito fora do banco)`,
        `- Codigo das Edge Functions: ja esta no repositorio (pasta supabase/functions) — redeploy no projeto novo.`,
        `- Secrets/API keys: precisam ser cadastrados novamente no projeto novo (por seguranca nao sao exportaveis).`,
        `- Configuracao de provedores de login social (Google/Facebook) e URLs de redirect.`,
        `- Webhooks da Meta/WhatsApp: reapontar a callback URL para o novo dominio de functions.`,
        ``,
        `## 5. Pos-importacao (checklist)`,
        `- [ ] Rodar o SQL sem erros`,
        `- [ ] Conferir contagem de tabelas, contatos, mensagens e usuarios`,
        `- [ ] Copiar arquivos do storage`,
        `- [ ] Redeploy das edge functions + cadastrar secrets`,
        `- [ ] Reconfigurar provedores de auth e redirect URLs`,
        `- [ ] Reapontar webhooks Meta/InfinitePay`,
        `- [ ] Atualizar VITE_SUPABASE_URL / KEY no frontend`,
        `- [ ] Testar login, recebimento e envio de mensagem`,
        ``,
      ].join("\n");

      return json({
        success: true,
        sql,
        readme,
        tablesCount: tableList.length,
        rowsCount,
        usersCount,
        filesCount,
      });
    }



    if (action === "list_users") {
      // Get all auth users (paginated)
      const allUsers: any[] = [];
      let page = 1;
      while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        allUsers.push(...(data.users || []));
        if (!data.users || data.users.length < 1000) break;
        page++;
        if (page > 20) break;
      }

      const userIds = allUsers.map((u) => u.id);

      const { data: profiles } = await supabase
        .from("crm_profiles")
        .select("user_id, full_name, whatsapp_number, role, created_at, access_locked, access_lock_reason, access_locked_at")
        .in("user_id", userIds);


      const { data: settings } = await supabase
        .from("crm_settings")
        .select(
          "user_id, meta_phone_number_id, meta_display_phone_number, meta_verified_name, meta_waba_id, meta_access_token"
        )
        .in("user_id", userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      const settingsMap = new Map((settings || []).map((s: any) => [s.user_id, s]));

      const users = allUsers.map((u) => {
        const s: any = settingsMap.get(u.id) || {};
        const p: any = profileMap.get(u.id) || {};
        const connected = !!(s.meta_access_token && s.meta_phone_number_id);
        return {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          full_name: p.full_name || null,
          whatsapp_profile_number: p.whatsapp_number || null,
          role: p.role || "user",
          access_locked: p.access_locked === true,
          access_lock_reason: p.access_lock_reason || null,
          access_locked_at: p.access_locked_at || null,
          meta_display_phone_number: s.meta_display_phone_number || null,
          meta_verified_name: s.meta_verified_name || null,
          meta_phone_number_id: s.meta_phone_number_id || null,
          connected,
        };

      });

      // Sort newest first
      users.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return json({ success: true, users });
    }

    // ===== Travar / destravar o acesso de um cadastro =====
    if (action === "lock_user" || action === "unlock_user") {
      const { userId, reason } = body as any;
      if (typeof userId !== "string" || !userId) {
        return json({ success: false, error: "userId obrigatório" });
      }

      const locking = action === "lock_user";
      const cleanReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";

      const payload = locking
        ? {
            access_locked: true,
            access_lock_reason: cleanReason || "Pendência com a administração",
            access_locked_at: new Date().toISOString(),
          }
        : { access_locked: false, access_lock_reason: null, access_locked_at: null };

      const { error: lockError } = await supabase
        .from("crm_profiles")
        .update(payload)
        .eq("user_id", userId);

      if (lockError) {
        console.error(`[${action}] falhou:`, lockError.message);
        return json({ success: false, error: "Não foi possível atualizar o travamento" });
      }

      return json({ success: true, locked: locking });
    }



    if (action === "user_insights") {
      const { userId } = body as any;
      if (!userId) return json({ success: false, error: "userId obrigatório" });

      // Total messages
      const { count: totalReceived } = await supabase
        .from("crm_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("direction", "inbound");

      const { count: totalSent } = await supabase
        .from("crm_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("direction", "outbound");

      const { count: totalContacts } = await supabase
        .from("crm_contacts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      // Paid conversations: somente as mensagens onde a própria Meta marcou
      // pricing.billable = true no status retornado. Conversas dentro da janela
      // de 24h (free_customer_service) NÃO são cobradas e devem ficar fora.
      const { data: outboundMsgs } = await supabase
        .from("crm_messages")
        .select("contact_id, created_at, metadata")
        .eq("user_id", userId)
        .eq("direction", "outbound")
        .order("created_at", { ascending: true })
        .limit(50000);

      let paidConversations = 0;
      const seenConvKey = new Set<string>();
      for (const m of outboundMsgs || []) {
        const meta: any = (m as any).metadata || {};
        const src = meta.source;
        if (src === "echo_mobile_app" || src === "meta_webhook_echo") continue;

        const pricing = meta.last_meta_status?.pricing || meta.pricing;
        // Sem pricing confirmado pela Meta, não contamos como cobrada.
        if (!pricing) continue;
        // Meta envia billable=false para free_customer_service / free_entry_point.
        const isBillable =
          pricing.billable === true ||
          (pricing.category && pricing.category !== "service" && pricing.category !== "free_customer_service" && pricing.category !== "referral_conversion");
        if (!isBillable) continue;

        // Deduplica por contato + categoria + dia (1 conversa cobrada por janela)
        const day = new Date((m as any).created_at).toISOString().slice(0, 10);
        const key = `${(m as any).contact_id}-${pricing.category || "x"}-${day}`;
        if (seenConvKey.has(key)) continue;
        seenConvKey.add(key);
        paidConversations++;
      }

      return json({
        success: true,
        insights: {
          totalReceived: totalReceived || 0,
          totalSent: totalSent || 0,
          totalContacts: totalContacts || 0,
          paidConversations,
        },
      });
    }

    if (action === "set_password") {
      const { userId, newPassword } = body as any;
      const pwd = typeof newPassword === "string" ? newPassword.trim() : "";
      if (!userId || pwd.length < 6) {
        return json({ success: false, error: "Senha inválida (mínimo 6 caracteres)" });
      }

      // Porquê da ordem invertida: em instalações self-hosted o SDK admin às
      // vezes fica pendurado no proxy interno por dezenas de segundos. O painel
      // abortava por tempo limite e mostrava "não confirmada" mesmo com a senha
      // já trocada. A chamada REST direta ao GoTrue responde em milissegundos,
      // então ela vira a 1ª tentativa — com tempo limite próprio.
      const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      let restError: string | null = null;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              apikey: key,
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({ password: pwd }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }

        const raw = await res.text();
        if (res.ok) return json({ success: true });

        let detail = raw;
        try {
          const parsed = JSON.parse(raw);
          detail = parsed?.msg || parsed?.message || parsed?.error_description || raw;
        } catch { /* mantém texto cru */ }
        restError = detail || `HTTP ${res.status}`;
        console.error("[set_password] GoTrue falhou:", res.status, restError);
      } catch (e: any) {
        restError = e?.name === "AbortError" ? "GoTrue não respondeu em 8s" : (e?.message || "Falha no GoTrue");
        console.error("[set_password] GoTrue indisponível:", restError);
      }

      // 2ª tentativa: SDK admin, apenas se o caminho direto falhou.
      try {
        const { error } = await supabase.auth.admin.updateUserById(userId, { password: pwd });
        if (!error) return json({ success: true });
        console.error("[set_password] SDK falhou:", error.message);
        return json({
          success: false,
          error: `Não foi possível trocar a senha: ${error.message || restError}`,
        });
      } catch (e: any) {
        return json({
          success: false,
          error: `Não foi possível trocar a senha: ${e?.message || restError || "erro desconhecido"}`,
        });
      }
    }

    if (action === "impersonate") {
      const { userId } = body as any;
      if (!userId) return json({ success: false, error: "userId obrigatório" });

      const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(userId);
      if (userErr || !userData?.user?.email) {
        return json({ success: false, error: "Usuário não encontrado" });
      }
      // O acesso administrativo deve sempre abrir no domínio oficial, nunca no
      // domínio da prévia ou no link intermediário do provedor de autenticação.
      const APP_BASE_URL = "https://zapmro.com.br";
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: userData.user.email,
        options: { redirectTo: `${APP_BASE_URL}/crm` },
      });
      if (linkErr) throw linkErr;

      // Enviamos o hash de uso único ao próprio /crm. O AccessGate valida esse
      // token antes de verificar a sessão, evitando retorno indevido a /vendas.
      const props = (linkData as any)?.properties || {};
      const tokenHash = props.hashed_token;
      if (!tokenHash) {
        return json({ success: false, error: "Não foi possível gerar o acesso" }, 500);
      }

      const url = `${APP_BASE_URL}/crm?admin_token=${encodeURIComponent(tokenHash)}`;

      return json({ success: true, url, email: userData.user.email });
    }

    if (action === "send_reset_email" || action === "send_access_reminder") {
      const { email, userId: uidRaw } = body as any;
      if (!email && !uidRaw) return json({ success: false, error: "Email obrigatório" });

      // Find user
      let targetUser: any = null;
      if (uidRaw) {
        const { data } = await supabase.auth.admin.getUserById(uidRaw);
        targetUser = data?.user || null;
      }
      if (!targetUser && email) {
        let page = 1;
        const target = String(email).toLowerCase();
        while (true) {
          const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) throw error;
          const found = (data.users || []).find((u: any) => (u.email || "").toLowerCase() === target);
          if (found) { targetUser = found; break; }
          if (!data.users?.length || data.users.length < 1000) break;
          page++;
        }
      }
      if (!targetUser) return json({ success: false, error: "Usuário não encontrado" });

      // Generate a new temporary password
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
      let tempPwd = "";
      for (let i = 0; i < 10; i++) tempPwd += chars[Math.floor(Math.random() * chars.length)];
      tempPwd += "@1";

      const { error: updErr } = await supabase.auth.admin.updateUserById(targetUser.id, { password: tempPwd });
      if (updErr) throw updErr;

      const fullName =
        targetUser.user_metadata?.full_name ||
        targetUser.user_metadata?.name ||
        (targetUser.email || "").split("@")[0];

      // A senha já está trocada (parte crítica). O e-mail segue em segundo plano.
      background("send_access_reminder", () =>
        sendCrmAccessReminderEmail({
          to: targetUser.email,
          fullName,
          password: tempPwd,
        })
      );
      return json({ success: true, emailQueued: true });
    }

    if (action === "delete_user") {
      const { userId } = body as any;
      if (!userId) return json({ success: false, error: "userId obrigatório" });

      // Clean ALL dependent data first (FK to auth.users would block delete)
      const tables = [
        "crm_webhook_delivery_logs",
        "crm_webhooks",
        "crm_scheduled_messages",
        "crm_flow_executions",
        "crm_flow_steps",
        "crm_flows",
        "crm_broadcasts",
        "crm_activities",
        "crm_messages",
        "crm_metrics",
        "crm_statuses",
        "crm_templates",
        "crm_google_tokens",
        "crm_google_accounts",
        "crm_access_logs",
        "crm_contacts",
        "crm_settings",
        "crm_profiles",
        "mro_images",
        "mro_schedules",
        "mro_strategies",
        "mro_profiles",
        "user_roles",
      ];
      for (const t of tables) {
        const { error: delErr } = await supabase.from(t).delete().eq("user_id", userId);
        if (delErr) console.warn(`[delete_user] cleanup ${t}:`, delErr.message);
      }

      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) {
        console.error("[delete_user] auth.admin.deleteUser failed:", error);
        return json({
          success: false,
          error: `Falha ao excluir usuário: ${error.message}`,
        }, 500);
      }
      return json({ success: true });
    }

    if (action === "disconnect_whatsapp") {
      const { userId } = body as any;
      if (!userId) return json({ success: false, error: "userId obrigatório" });
      const { error } = await supabase
        .from("crm_settings")
        .update({
          meta_access_token: null,
          meta_phone_number_id: null,
          meta_waba_id: null,
          meta_app_id: null,
          meta_app_secret: null,
          meta_display_phone_number: null,
          meta_verified_name: null,
        })
        .eq("user_id", userId);
      if (error) throw error;
      return json({ success: true });
    }

    /* ===================== Multi WhatsApp por cadastro ===================== */

    if (action === "list_user_numbers") {
      const { userId } = body as any;
      if (!userId) return json({ success: false, error: "userId obrigatório" });

      const { data: profile } = await supabase
        .from("crm_profiles")
        .select("max_whatsapp_numbers")
        .eq("user_id", userId)
        .maybeSingle();

      const { data: numbers, error } = await supabase
        .from("crm_whatsapp_numbers")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (error) return json({ success: false, error: error.message });

      return json({
        success: true,
        maxNumbers: Number((profile as any)?.max_whatsapp_numbers ?? 1) || 1,
        numbers: numbers || [],
      });
    }

    if (action === "set_max_numbers") {
      const { userId, maxNumbers } = body as any;
      if (!userId) return json({ success: false, error: "userId obrigatório" });
      const value = Math.max(1, Math.min(20, Number(maxNumbers) || 1));

      const { data: existing } = await supabase
        .from("crm_profiles")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from("crm_profiles")
            .update({ max_whatsapp_numbers: value })
            .eq("user_id", userId)
        : await supabase
            .from("crm_profiles")
            .insert({ user_id: userId, max_whatsapp_numbers: value });

      if (error) return json({ success: false, error: error.message });
      return json({ success: true, maxNumbers: value });
    }

    if (action === "update_user_number") {
      const { numberId, label, accessPin } = body as any;
      if (!numberId) return json({ success: false, error: "numberId obrigatório" });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (label !== undefined) patch.label = label || null;
      if (accessPin !== undefined) {
        patch.access_pin = accessPin && String(accessPin).trim() ? String(accessPin).trim() : null;
      }
      const { error } = await supabase
        .from("crm_whatsapp_numbers")
        .update(patch)
        .eq("id", numberId);
      if (error) return json({ success: false, error: error.message });
      return json({ success: true });
    }

    if (action === "delete_user_number") {
      const { numberId } = body as any;
      if (!numberId) return json({ success: false, error: "numberId obrigatório" });
      const { error } = await supabase
        .from("crm_whatsapp_numbers")
        .delete()
        .eq("id", numberId);
      if (error) return json({ success: false, error: error.message });
      return json({ success: true });
    }

    if (action === "list_announcements") {
      const { data, error } = await supabase
        .from("admin_announcements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ success: true, announcements: data || [] });
    }

    if (action === "create_announcement") {
      const { title, message, frequency, start_date, end_date, active } = body as any;
      if (!title || !message) return json({ success: false, error: "Título e mensagem são obrigatórios" });
      const { data, error } = await supabase.from("admin_announcements").insert({
        title,
        message,
        frequency: frequency || "once",
        start_date: start_date || null,
        end_date: end_date || null,
        active: active !== false,
      }).select().single();
      if (error) throw error;
      return json({ success: true, announcement: data });
    }

    if (action === "update_announcement") {
      const { id, ...rest } = body as any;
      if (!id) return json({ success: false, error: "id obrigatório" });
      const patch: any = {};
      for (const k of ["title","message","frequency","start_date","end_date","active"]) {
        if (k in rest) patch[k] = rest[k];
      }
      const { error } = await supabase.from("admin_announcements").update(patch).eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "delete_announcement") {
      const { id } = body as any;
      if (!id) return json({ success: false, error: "id obrigatório" });
      const { error } = await supabase.from("admin_announcements").delete().eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "list_sales_orders") {
      // Auto-expire stale pendings
      await supabase
        .from("crm_sales_orders")
        .update({ status: "expired" })
        .eq("status", "pending")
        .lt("expires_at", new Date().toISOString());

      const { data, error } = await supabase
        .from("crm_sales_orders")
        .select("id, full_name, email, whatsapp, plan, plan_label, amount, nsu_order, infinitepay_link, status, expires_at, paid_at, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return json({ success: true, orders: data || [] });
    }

    if (action === "delete_sales_order") {
      const { id } = body as any;
      if (!id) return json({ success: false, error: "id obrigatório" });
      const { error } = await supabase.from("crm_sales_orders").delete().eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "approve_sales_order") {
      const { id, plan } = body as any;
      if (!id) return json({ success: false, error: "id obrigatório" });
      const PLANS: Record<string, { label: string; amount: number; days: number }> = {
        mensal: { label: "Plano Mensal", amount: 137, days: 30 },
        semestral: { label: "Plano 6 Meses", amount: 397, days: 180 },
        anual: { label: "Plano Anual (1 ano)", amount: 597, days: 365 },
      };
      const upd: any = {
        status: "approved",
        paid_at: new Date().toISOString(),
      };
      if (plan && PLANS[plan]) {
        upd.plan = plan;
        upd.plan_label = PLANS[plan].label;
        upd.amount = PLANS[plan].amount;
      }
      const { error } = await supabase.from("crm_sales_orders").update(upd).eq("id", id);
      if (error) return json({ success: false, error: `Falha ao aprovar o pedido: ${error.message}` });

      // Liberação do acesso é crítica: fica no caminho da resposta.
      const { data: order } = await supabase
        .from("crm_sales_orders")
        .select("email, full_name, plan_label, plan, amount")
        .eq("id", id).maybeSingle();

      let accessGranted = false;
      if (order?.email) {
        const days = PLANS[order.plan]?.days ?? 30;
        const { error: grantErr } = await supabase.rpc("grant_crm_access", {
          p_email: order.email,
          p_plan: order.plan,
          p_days: days,
        });
        if (grantErr) console.error("[approve_sales_order] grant_crm_access error:", grantErr);
        else accessGranted = true;

        // E-mail de boas-vindas em segundo plano: não atrasa a confirmação.
        background("approve_sales_order", () =>
          sendCrmSalesApprovedEmail({
            to: order.email,
            fullName: order.full_name,
            planLabel: order.plan_label || order.plan,
            amount: Number(order.amount) || 0,
          })
        );
      }
      return json({ success: true, status: "approved", accessGranted, emailQueued: !!order?.email });
    }

    if (action === "migrate_sales_order_plan") {
      const { id, plan } = body as any;
      if (!id || !plan) return json({ success: false, error: "id e plan obrigatórios" });
      const PLANS: Record<string, { label: string; amount: number }> = {
        mensal: { label: "Plano Mensal", amount: 137 },
        semestral: { label: "Plano 6 Meses", amount: 397 },
        anual: { label: "Plano Anual (1 ano)", amount: 597 },
      };
      if (!PLANS[plan]) return json({ success: false, error: "Plano inválido" });
      const { error } = await supabase.from("crm_sales_orders").update({
        plan,
        plan_label: PLANS[plan].label,
        amount: PLANS[plan].amount,
      }).eq("id", id);
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "list_trials") {
      // Fetch all auth users (paginated)
      const allUsers: any[] = [];
      let page = 1;
      while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        allUsers.push(...(data.users || []));
        if (!data.users || data.users.length < 1000) break;
        page++;
        if (page > 20) break;
      }
      const userIds = allUsers.map((u) => u.id);
      const { data: profiles } = await supabase
        .from("crm_profiles")
        .select("user_id, full_name, whatsapp_number, trial_ends_at, access_until, is_paid, plan, created_at")
        .in("user_id", userIds);
      const pMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
      // Detectar quem já conectou o WhatsApp (via crm_settings). Se estiver conectado
      // mas ainda não tiver trial_ends_at e não for pago, faz backfill de 2 dias
      // usando a data em que a conexão foi salva (updated_at) como referência.
      const { data: settings } = await supabase
        .from("crm_settings")
        .select("user_id, meta_phone_number_id, meta_access_token, meta_waba_id, updated_at, created_at")
        .in("user_id", userIds);
      const sMap = new Map(
        (settings || []).map((s: any) => [s.user_id, s])
      );
      const backfills: { user_id: string; trial_ends_at: string }[] = [];
      for (const u of allUsers) {
        const p: any = pMap.get(u.id) || {};
        const s: any = sMap.get(u.id);
        const connected = !!(s && s.meta_phone_number_id && s.meta_access_token && s.meta_waba_id);
        const nowMs = Date.now();
        const accessUntilMs = p.access_until ? new Date(p.access_until).getTime() : 0;
        const isPaidActive = !!p.is_paid && accessUntilMs > nowMs;
        if (connected && !p.trial_ends_at && !isPaidActive) {
          const base = s.updated_at ? new Date(s.updated_at).getTime() : nowMs;
          const trialEnds = new Date(base + 2 * 86400000).toISOString();
          backfills.push({ user_id: u.id, trial_ends_at: trialEnds });
          // atualiza mapa local para refletir imediatamente
          pMap.set(u.id, { ...p, trial_ends_at: trialEnds });
        }
      }
      if (backfills.length) {
        await Promise.all(
          backfills.map((b) =>
            supabase
              .from("crm_profiles")
              .upsert(
                { user_id: b.user_id, trial_ends_at: b.trial_ends_at },
                { onConflict: "user_id" }
              )
          )
        );
      }
      const now = Date.now();
      const trials = allUsers.map((u) => {
        const p: any = pMap.get(u.id) || {};
        const s: any = sMap.get(u.id);
        const connected = !!(s && s.meta_phone_number_id && s.meta_access_token && s.meta_waba_id);
        const trialEnds = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : null;
        const accessUntil = p.access_until ? new Date(p.access_until).getTime() : null;
        const isPaid = !!p.is_paid && accessUntil && accessUntil > now;
        const trialActive = !isPaid && trialEnds && trialEnds > now;
        const trialExpired = !isPaid && trialEnds && trialEnds <= now;
        let status: string;
        if (isPaid) status = "paid";
        else if (trialActive) status = "trial_active";
        else if (trialExpired) status = "trial_expired";
        else status = "no_trial";
        const msLeft = trialActive ? trialEnds! - now : 0;
        return {
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          full_name: p.full_name || null,
          whatsapp_number: p.whatsapp_number || null,
          trial_ends_at: p.trial_ends_at || null,
          access_until: p.access_until || null,
          is_paid: !!p.is_paid,
          plan: p.plan || null,
          status,
          hours_left: Math.max(0, Math.floor(msLeft / 3600000)),
          whatsapp_connected: connected,
        };
      });
      trials.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return json({ success: true, trials });
    }

    if (action === "grant_access") {
      const { email, plan, days, resetPassword } = body as any;
      if (!email || !plan) return json({ success: false, error: "email e plan obrigatórios" });
      const PLANS: Record<string, { label: string; amount: number; days: number }> = {
        mensal: { label: "Plano Mensal", amount: 97, days: 30 },
        semestral: { label: "Plano 6 Meses", amount: 397, days: 180 },
        anual: { label: "Plano Anual (1 ano)", amount: 597, days: 365 },
      };
      if (!PLANS[plan]) return json({ success: false, error: "Plano inválido" });
      const d = Number(days) || PLANS[plan].days;
      const cleanEmailGrant = String(email).trim().toLowerCase();
      const { data: ok, error } = await supabase.rpc("grant_crm_access", {
        p_email: cleanEmailGrant,
        p_plan: plan,
        p_days: d,
      });
      if (error) {
        console.error("[grant_access] rpc error:", error);
        return json({ success: false, error: `Falha ao liberar acesso: ${error.message}` });
      }
      if (ok === false) {
        return json({
          success: false,
          error: `Nenhuma conta cadastrada com o e-mail ${cleanEmailGrant}. Confira o e-mail usado no cadastro.`,
        });
      }


      // Localiza o usuário para pegar nome, data de expiração e (opcionalmente)
      // gerar uma senha temporária que vai junto no email de liberação.
      let grantUserId: string | null = null;
      let grantFullName = "";
      let grantAccessUntil: string | undefined;
      let grantPassword: string | undefined;
      try {
        let page = 1;
        while (!grantUserId && page <= 20) {
          const { data } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
          const found = (data?.users || []).find(
            (u: any) => (u.email || "").toLowerCase() === cleanEmailGrant
          );
          if (found) grantUserId = found.id;
          if (!data?.users || data.users.length < 1000) break;
          page++;
        }
        if (grantUserId) {
          const { data: prof } = await supabase
            .from("crm_profiles")
            .select("full_name, access_until")
            .eq("user_id", grantUserId)
            .maybeSingle();
          grantFullName = prof?.full_name || "";
          grantAccessUntil = prof?.access_until || undefined;

          // Porquê: liberar plano NÃO deve mexer na senha do cliente. Antes o
          // padrão era resetar (`!== false`), então quem já tinha cadastro
          // perdia o acesso ao ativar o plano. Agora só reseta se o painel
          // pedir explicitamente `resetPassword: true`.
          if (resetPassword === true) {
            grantPassword = `Zap${Math.random().toString(36).slice(2, 8)}${Math.floor(
              10 + Math.random() * 89
            )}`;
            const { error: pwErr } = await supabase.auth.admin.updateUserById(grantUserId, {
              password: grantPassword,
            });
            if (pwErr) {
              console.error("[grant_access] password reset error:", pwErr);
              grantPassword = undefined;
            }
          }
        }
      } catch (e) {
        console.error("[grant_access] lookup error:", e);
      }

      // Acesso já liberado no banco — o e-mail vai em segundo plano para que o
      // painel confirme a liberação na hora.
      background("grant_access", () =>
        sendCrmSalesApprovedEmail({
          to: cleanEmailGrant,
          fullName: grantFullName,
          planLabel: PLANS[plan].label,
          amount: PLANS[plan].amount,
          days: d,
          accessUntil: grantAccessUntil,
          password: grantPassword,
        })
      );
      return json({
        success: true,
        accessUntil: grantAccessUntil ?? null,
        plan,
        days: d,
        emailQueued: true,
      });
    }

    if (action === "cancel_access") {
      const { email } = body as any;
      if (!email) return json({ success: false, error: "email obrigatório" });
      const cleanEmail = String(email).trim().toLowerCase();

      // Localiza o usuário pelo email (paginado)
      let targetId: string | null = null;
      let page = 1;
      while (!targetId) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const found = (data.users || []).find(
          (u: any) => (u.email || "").toLowerCase() === cleanEmail
        );
        if (found) targetId = found.id;
        if (!data.users || data.users.length < 1000) break;
        page++;
        if (page > 20) break;
      }
      if (!targetId) return json({ success: false, error: "Usuário não encontrado" });

      const nowIso = new Date().toISOString();
      // Cancela o plano: acesso expirado imediatamente e teste também encerrado,
      // então o CRM mostra o popup de bloqueio pedindo pagamento.
      // Nada é desconectado — a conexão do WhatsApp permanece intacta.
      const { error } = await supabase
        .from("crm_profiles")
        .upsert(
          {
            user_id: targetId,
            is_paid: false,
            plan: null,
            access_until: nowIso,
            trial_ends_at: nowIso,
            updated_at: nowIso,
          },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      return json({ success: true });
    }

    if (action === "resend_access_email") {

      const { email } = body as any;
      if (!email) return json({ success: false, error: "email obrigatório" });
      const cleanEmail = String(email).trim().toLowerCase();

      // Latest sales order for this email (to reuse plan/label/link)
      const { data: order } = await supabase
        .from("crm_sales_orders")
        .select("full_name, plan, plan_label, amount, status, infinitepay_link")
        .eq("email", cleanEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Profile to know if user is already paid
      const { data: authUser } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = (authUser?.users || []).find(
        (u: any) => (u.email || "").toLowerCase() === cleanEmail
      );
      let isPaid = false;
      let fullName = order?.full_name || "";
      if (found) {
        const { data: prof } = await supabase
          .from("crm_profiles")
          .select("full_name, is_paid, access_until, plan")
          .eq("user_id", found.id)
          .maybeSingle();
        if (prof) {
          fullName = fullName || prof.full_name || "";
          const accessUntil = prof.access_until ? new Date(prof.access_until).getTime() : 0;
          isPaid = !!prof.is_paid && accessUntil > Date.now();
        }
      }

      // Envio em segundo plano: o painel confirma o reenvio sem esperar o provedor.
      background("resend_access_email", async () => {
        if (isPaid || order?.status === "approved") {
          await sendCrmSalesApprovedEmail({
            to: cleanEmail,
            fullName,
            planLabel: order?.plan_label || "Plano ZapMRO CRM",
            amount: Number(order?.amount) || 0,
          });
        } else if (order?.infinitepay_link) {
          await sendCrmSalesRegisteredEmail({
            to: cleanEmail,
            fullName,
            planLabel: order?.plan_label || "Plano ZapMRO CRM",
            amount: Number(order?.amount) || 0,
            password: "(a senha que você criou no cadastro — use 'Esqueci minha senha' no login se precisar redefinir)",
            paymentLink: order.infinitepay_link,
          });
        } else {
          // No order info — fall back to the approved-style access email
          await sendCrmSalesApprovedEmail({
            to: cleanEmail,
            fullName,
            planLabel: "Plano ZapMRO CRM",
            amount: 0,
          });
        }
      });
      return json({ success: true, emailQueued: true });
    }

    return json({ success: false, error: `Ação inválida: ${action}` });
  } catch (e: any) {
    console.error("[crm-central-admin] error:", e);
    return json({ success: false, error: e.message || "Erro interno" }, 500);
  }
});
