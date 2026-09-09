import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ADMIN_TIMEOUTS,
  adminCall,
  adminErrorMessage,
  adminRead,
  isUnconfirmed,
  newRequestId,
  type AdminCreds,
} from "@/lib/adminCentralApi";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AnnouncementsAdminPanel from "@/components/admin/AnnouncementsAdminPanel";
import SalesOrdersPanel from "@/components/admin/SalesOrdersPanel";
import TutorialsAdminPanel from "@/components/admin/TutorialsAdminPanel";
import TrialsPanel from "@/components/admin/TrialsPanel";
import MigrationExtras from "@/components/admin/MigrationExtras";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  KeyRound,
  Mail,
  Power,
  RefreshCw,
  BarChart3,
  Search,
  CheckCircle2,
  XCircle,
  Users,
  MessageCircle,
  TrendingUp,
  Zap,
  ExternalLink,
  Database,
  Download,
  FileText,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Shield,
  Lock,
  Unlock,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";


type AdminUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  full_name: string | null;
  whatsapp_profile_number: string | null;
  role: string;
  access_locked?: boolean;
  access_lock_reason?: string | null;
  access_locked_at?: string | null;
  meta_display_phone_number: string | null;
  meta_verified_name: string | null;
  meta_phone_number_id: string | null;
  connected: boolean;

};

type Insights = {
  totalReceived: number;
  totalSent: number;
  totalContacts: number;
  paidConversations: number;
};

type DumpProgress = {
  phase: string;
  current: number;
  total: number;
  detail: string;
};

const STORAGE_KEY = "admincentral_creds_v1";

/**
 * Todas as operações passam pelo cliente único (`@/lib/adminCentralApi`), que
 * garante tempo limite, cancelamento e mensagem de erro acionável. Antes cada
 * painel chamava a função sem limite próprio e o botão girava para sempre.
 */



/**
 * Credenciais do Admin Central.
 *
 * O login é validado localmente (SHA-256) para nunca depender de uma Edge
 * Function remota — era isso que causava o carregamento infinito. O acesso real
 * aos dados continua protegido no servidor: toda ação reenvia as credenciais
 * para a função, que valida antes de tocar no banco.
 */
const ADMIN_EMAIL_FALLBACK = "mro@gmail.com";
const ADMIN_PASSWORD_SHA256_FALLBACK =
  "e800958c05300aa6f60f0eff21813a641bfdf39dcd21fbbbd594e4fde8a1d344";

const ADMIN_EMAIL = (
  (import.meta.env.VITE_ADMIN_CENTRAL_EMAIL as string | undefined) || ADMIN_EMAIL_FALLBACK
)
  .trim()
  .toLowerCase();

const ADMIN_PASSWORD_SHA256 = (
  (import.meta.env.VITE_ADMIN_CENTRAL_PASSWORD_SHA256 as string | undefined) ||
  ADMIN_PASSWORD_SHA256_FALLBACK
)
  .trim()
  .toLowerCase();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type AdminLoginResult = { success: boolean; error?: string };

/**
 * Login local: nunca depende da rede, portanto nunca pode "esgotar o tempo".
 */
async function invokeAdminLogin(email: string, password: string): Promise<AdminLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return { success: false, error: "Informe e-mail e senha" };
  }

  if (normalizedEmail !== ADMIN_EMAIL) {
    return { success: false, error: "Credenciais inválidas" };
  }

  try {
    const digest = await sha256Hex(password);
    if (digest !== ADMIN_PASSWORD_SHA256) {
      return { success: false, error: "Credenciais inválidas" };
    }
    return { success: true };
  } catch (error) {
    // crypto.subtle exige contexto seguro (https ou localhost). Em HTTP puro
    // ele não existe — nesse caso validamos no servidor (função leve dedicada).
    console.warn("[AdminCentral] crypto.subtle indisponível, validando no servidor:", error);
    try {
      const data = await adminCall(
        "login",
        { email: normalizedEmail, password },
        {},
        { fn: "crm-central-admin-login", timeoutMs: 10000 }
      );
      return { success: Boolean(data?.success), error: data?.error };
    } catch (serverError) {
      return { success: false, error: adminErrorMessage(serverError, "Falha no login") };
    }
  }
}





function ReportStat({
  icon,
  label,
  value,
  hint,
  gradient,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  gradient: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
        onClick ? "cursor-pointer" : ""
      } ${active ? "border-[#25D366] ring-2 ring-[#25D366]/30" : "border-[#E8F5F1]"}`}
    >
      <div className={`absolute -right-4 -top-4 h-16 w-16 rounded-full bg-gradient-to-br ${gradient} opacity-10 group-hover:opacity-20 transition-opacity`} />
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} text-white shadow-sm mb-2`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-[#075E54] tabular-nums">{value.toLocaleString("pt-BR")}</div>
      <div className="text-xs text-[#128C7E]/80 font-medium">{label}</div>
      {hint && <div className="text-[10px] text-[#25D366] mt-0.5 font-semibold">{hint}</div>}
      {onClick && (
        <div className="text-[10px] text-[#128C7E] mt-1 font-semibold">
          {active ? "Ocultar lista ▲" : "Ver lista ▼"}
        </div>
      )}
    </div>
  );
}

/**
 * MigrationPanel — exporta dump SQL do banco conectado
 */
type DumpFile = { name: string; content: string };

function MigrationPanel({ creds }: { creds: AdminCreds }) {
  const [dumping, setDumping] = useState(false);
  const [progress, setProgress] = useState<DumpProgress | null>(null);
  const [dumpResult, setDumpResult] = useState<{
    sql: string;
    readme?: string;
    files?: DumpFile[];
    tablesCount: number;
    rowsCount: number;
    usersCount?: number;
    filesCount?: number;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);


  async function startDump() {
    setDumping(true);
    setDumpResult(null);
    setProgress({ phase: "Conectando...", current: 0, total: 100, detail: "" });

    // Exportação tem orçamento de tempo próprio (mais longo), mas ainda finito:
    // se um bloco travar, a tela informa o erro em vez de ficar carregando.
    const call = async (payload: Record<string, unknown>) => {
      const { action, ...extra } = payload as any;
      return (await adminCall(String(action), creds, extra, {
        timeoutMs: ADMIN_TIMEOUTS.export,
      })) as any;
    };


    try {
      setProgress({ phase: "Mapeando estrutura...", current: 5, total: 100, detail: "Tabelas, funções, RLS" });
      const meta = await call({ action: "dump_structure" });
      const tables = (meta.tables || []) as { table_name: string; row_count: number }[];
      const s = meta.sections || {};

      // Coleta de dados, tabela por tabela, em blocos pequenos
      const dataParts: string[] = [];
      let rowsCount = 0;
      const PAGE = 500;
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i];
        setProgress({
          phase: "Exportando dados...",
          current: 10 + Math.round((i / Math.max(tables.length, 1)) * 70),
          total: 100,
          detail: `${t.table_name} (${i + 1}/${tables.length})`,
        });
        if (!t.row_count) continue;
        for (let off = 0; ; off += PAGE) {
          const chunk = await call({ action: "dump_chunk", kind: "rows", table: t.table_name, offset: off, limit: PAGE });
          if (!chunk.sql || !chunk.sql.trim()) break;
          dataParts.push(`-- Tabela: ${t.table_name}\n${chunk.sql}`);
          rowsCount += chunk.lines;
          if (chunk.lines < PAGE) break;
        }
      }

      // Auth + storage
      const collect = async (kind: string, page: number, phase: string) => {
        const parts: string[] = [];
        for (let off = 0; ; off += page) {
          setProgress({ phase, current: 85, total: 100, detail: `${off + parts.length} registros` });
          const chunk = await call({ action: "dump_chunk", kind, offset: off, limit: page });
          if (!chunk.sql || !chunk.sql.trim()) break;
          parts.push(chunk.sql);
          if (chunk.lines < page) break;
          if (off > 200000) break;
        }
        return parts;
      };

      const authParts = await collect("auth_users", 500, "Exportando Auth...");
      const identityParts = await collect("auth_identities", 500, "Exportando identidades...");
      const storageParts = await collect("storage", 1000, "Inventariando Storage...");
      const filesCount = storageParts.join("\n").match(/^-- FILE /gm)?.length || 0;

      setProgress({ phase: "Montando arquivo...", current: 95, total: 100, detail: "Gerando SQL" });
      const generatedAt = new Date().toISOString();
      const sql = [
        `-- ============================================================`,
        `-- MRO / ZAPMRO — DUMP COMPLETO DO BANCO`,
        `-- Gerado em: ${generatedAt}`,
        `-- Tabelas: ${tables.length} | Linhas: ${rowsCount} | Usuarios Auth: ${meta.usersCount} | Arquivos storage: ${filesCount}`,
        `-- ============================================================`,
        ``,
        `BEGIN;`,
        `SET session_replication_role = replica;`,
        ``,
        `-- ============ 1. EXTENSIONS ============`, s.extensions,
        `-- ============ 2. TYPES / ENUMS ============`, s.types,
        `-- ============ 3. SEQUENCES ============`, s.sequences,
        `-- ============ 4. ESTRUTURA (TABELAS) ============`, s.schema,
        `-- ============ 5. FUNCOES POSTGRESQL ============`, s.functions,
        `-- ============ 6. DADOS (SCHEMA PUBLIC) ============`, dataParts.join("\n\n"),
        `-- ============ 7. AUTH — USUARIOS ============`, authParts.join("\n"),
        `-- ============ 8. AUTH — IDENTIDADES ============`, identityParts.join("\n"),
        `-- ============ 9. STORAGE — BUCKETS + INVENTARIO ============`, storageParts.join("\n"),
        `-- ============ 10. VIEWS ============`, s.views,
        `-- ============ 11. FKs ============`, s.fks,
        `-- ============ 12. INDICES ============`, s.indexes,
        `-- ============ 13. POLITICAS RLS ============`, s.policies,
        `-- ============ 14. TRIGGERS ============`, s.triggers,
        `-- ============ 15. GRANTS ============`, s.grants,
        `-- ============ 16. CRON JOBS ============`, s.cron,
        ``,
        `SET session_replication_role = DEFAULT;`,
        `COMMIT;`,
      ].join("\n");

      // ---- Dumps separados, prontos para deploy/postgres-stack/sql/ ----------
      const wrap = (titulo: string, corpo: string) =>
        [
          `-- ============================================================`,
          `-- ZAPMRO — ${titulo}`,
          `-- Gerado em: ${generatedAt}`,
          `-- ============================================================`,
          `BEGIN;`,
          `SET session_replication_role = replica;`,
          ``,
          corpo || `-- (vazio)`,
          ``,
          `SET session_replication_role = DEFAULT;`,
          `COMMIT;`,
        ].join("\n");

      const files: DumpFile[] = [
        { name: "010-extensions-types-sequences.sql", content: wrap("1. EXTENSIONS / TYPES / SEQUENCES", [s.extensions, s.types, s.sequences].filter(Boolean).join("\n\n")) },
        { name: "020-schema.sql", content: wrap("2. ESTRUTURA (TABELAS)", s.schema || "") },
        { name: "030-funcoes.sql", content: wrap("3. FUNCOES POSTGRESQL", s.functions || "") },
        { name: "040-dados.sql", content: wrap("4. DADOS (SCHEMA PUBLIC)", dataParts.join("\n\n")) },
        { name: "050-auth.sql", content: wrap("5. AUTH (USUARIOS + IDENTIDADES)", [authParts.join("\n"), identityParts.join("\n")].filter(Boolean).join("\n\n")) },
        { name: "060-storage.sql", content: wrap("6. STORAGE (BUCKETS + INVENTARIO)", storageParts.join("\n")) },
        { name: "070-views-fks-indices.sql", content: wrap("7. VIEWS / FKs / INDICES", [s.views, s.fks, s.indexes].filter(Boolean).join("\n\n")) },
        { name: "080-rls-triggers-grants.sql", content: wrap("8. RLS / TRIGGERS / GRANTS", [s.policies, s.triggers, s.grants].filter(Boolean).join("\n\n")) },
        { name: "090-cron.sql", content: wrap("9. CRON JOBS", s.cron || "") },
      ];

      const readme = [
        `# MIGRACAO ZAPMRO — COMO IMPORTAR NO NOVO BANCO`,
        ``,
        `Gerado em: ${generatedAt}`,
        `Tabelas: ${tables.length} | Linhas: ${rowsCount} | Usuarios Auth: ${meta.usersCount} | Arquivos Storage: ${filesCount}`,
        ``,
        `## Opcao A — comando unico na VPS (recomendado)`,
        `1. Descompacte este pacote dentro do projeto, em: deploy/postgres-stack/sql/`,
        `   unzip dumps-sql.zip -d /var/www/ia-mro/deploy/postgres-stack/sql/`,
        `2. Rode: cd /var/www/ia-mro && ./deploy/atualizar.sh`,
        `   O script aplica os arquivos em ordem (010 -> 090), registra o que ja foi aplicado`,
        `   em public._migracoes_aplicadas e nao reaplica o que nao mudou.`,
        ``,
        `## Opcao B — manual, arquivo por arquivo`,
        files.map((f) => `psql "$DB" -f ${f.name}`).join("\n"),
        ``,
        `## Opcao C — arquivo unico`,
        `psql "postgres://postgres:SENHA@HOST:5432/postgres" -f mro_backup.sql | tee restore.log`,
        ``,
        `## Fora do SQL (baixe nos outros botoes desta aba)`,
        `- Binarios do Storage (script Node)`,
        `- Codigo das Edge Functions (.zip)`,
        `- Secrets, OAuth/Google/Meta e webhooks: recriar manualmente`,
      ].join("\n");

      setDumpResult({
        sql,
        readme,
        files,
        tablesCount: tables.length,
        rowsCount,
        usersCount: meta.usersCount,
        filesCount,
      });

      toast.success("Dump completo gerado com sucesso!");
    } catch (err) {
      toast.error(adminErrorMessage(err, "Falha ao exportar dump"));

    } finally {
      setDumping(false);
      setProgress(null);
    }
  }


  function triggerDownload(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadDump() {
    if (!dumpResult) return;
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(dumpResult.sql, `mro_backup_${date}.sql`, "text/sql;charset=utf-8");
    toast.success("Download iniciado!");
  }

  /** Baixa todos os dumps separados (010..090) em um ZIP pronto para deploy/postgres-stack/sql/ */
  async function downloadSqlPack() {
    if (!dumpResult?.files?.length) return;
    try {
      const zip = new JSZip();
      dumpResult.files.forEach((f) => zip.file(f.name, f.content));
      if (dumpResult.readme) zip.file("LEIA-ME.md", dumpResult.readme);
      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dumps-sql-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${dumpResult.files.length} dumps baixados em ZIP`);
    } catch (err: any) {
      toast.error(err?.message || "Falha ao gerar o ZIP dos dumps");
    }
  }

  /** Baixa um dump específico da lista */
  function downloadOne(file: DumpFile) {
    triggerDownload(file.content, file.name, "text/sql;charset=utf-8");
  }


  function downloadReadme() {
    if (!dumpResult?.readme) return;
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(dumpResult.readme, `MIGRACAO_INSTRUCOES_${date}.md`, "text/markdown;charset=utf-8");
    toast.success("Documentação baixada!");
  }

  function copyToClipboard() {
    if (!dumpResult) return;
    navigator.clipboard.writeText(dumpResult.sql);
    toast.success("SQL copiado para a área de transferência");
  }

  return (
    <div className="space-y-6">
      {/* Card de instrução */}
      <Card className="p-5 bg-gradient-to-br from-[#075E54] to-[#128C7E] border-0 text-white shadow-xl">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Database className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold mb-1">Exportar Dump SQL Completo</h3>
            <p className="text-sm text-white/80 leading-relaxed">
              Exporta <strong>tudo</strong>: extensions, types/enums, sequences, tabelas, dados, views,
              funções, triggers, políticas RLS, índices, FKs, grants, cron jobs, usuários do Auth
              (com hash de senha) e identidades sociais, além dos buckets e do inventário completo dos
              arquivos do Storage. Junto vem a documentação passo a passo para importar no novo banco.
              Apenas os binários do Storage e os secrets precisam ser copiados fora do SQL.
            </p>
          </div>
        </div>
      </Card>


      {/* Info boxes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 bg-white border-[#E8F5F1]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#075E54]">Auth exportado (INSERT)</p>
              <p className="text-xs text-[#128C7E]/70">auth.users + identidades — testar em banco descartável antes de restaurar</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 bg-white border-[#E8F5F1]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <FileText className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#075E54]">SQL puro (INSERT)</p>
              <p className="text-xs text-[#128C7E]/70">Compatível com psql — não usa COPY/pg_restore</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 bg-white border-[#E8F5F1]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#075E54]">Funciona offline</p>
              <p className="text-xs text-[#128C7E]/70">Arquivo .sql pode ser guardado localmente</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Progress ou Resultado */}
      {dumping && progress && (
        <Card className="p-6 bg-white border-[#E8F5F1]">
          <div className="flex items-center gap-4 mb-4">
            <Loader2 className="h-6 w-6 animate-spin text-[#25D366]" />
            <div>
              <p className="font-semibold text-[#075E54]">{progress.phase}</p>
              <p className="text-xs text-[#128C7E]/70">{progress.detail}</p>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-[#E8F5F1] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#25D366] to-[#128C7E] transition-all duration-500"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
            />
          </div>
        </Card>
      )}

      {dumpResult && !dumping && (
        <>
          {/* Stats do dump */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-[#F0FDF4] border-[#E8F5F1] text-center">
              <p className="text-2xl font-bold text-[#075E54]">{dumpResult.tablesCount}</p>
              <p className="text-xs text-[#128C7E]/70">Tabelas exportadas</p>
            </Card>
            <Card className="p-4 bg-[#F0FDF4] border-[#E8F5F1] text-center">
              <p className="text-2xl font-bold text-[#075E54]">{dumpResult.rowsCount.toLocaleString("pt-BR")}</p>
              <p className="text-xs text-[#128C7E]/70">Linhas exportadas</p>
            </Card>
            <Card className="p-4 bg-[#F0FDF4] border-[#E8F5F1] text-center">
              <p className="text-2xl font-bold text-[#075E54]">{(dumpResult.sql.length / 1024 / 1024).toFixed(1)} MB</p>
              <p className="text-xs text-[#128C7E]/70">Tamanho do arquivo</p>
            </Card>
            <Card className="p-4 bg-[#F0FDF4] border-[#E8F5F1] text-center">
              <p className="text-2xl font-bold text-green-600">✓</p>
              <p className="text-xs text-[#128C7E]/70">Dump pronto</p>
            </Card>
          </div>

          {/* Preview */}
          <Card className="bg-white border-[#E8F5F1] overflow-hidden">
            <div
              className="flex items-center justify-between p-3 border-b border-[#E8F5F1] bg-slate-50 cursor-pointer"
              onClick={() => setPreviewOpen((v) => !v)}
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#128C7E]" />
                <span className="text-sm font-medium text-[#075E54]">Prévia do SQL (primeiras 50 linhas)</span>
              </div>
              {previewOpen ? (
                <ChevronUp className="h-4 w-4 text-[#128C7E]" />
              ) : (
                <ChevronDown className="h-4 w-4 text-[#128C7E]" />
              )}
            </div>
            {previewOpen && (
              <pre className="p-4 text-xs text-slate-600 font-mono overflow-x-auto max-h-64 bg-slate-900 text-green-400 leading-relaxed">
                {dumpResult.sql.split("\n").slice(0, 50).join("\n")}
                {dumpResult.sql.split("\n").length > 50 && "\n\n-- ... (continua no arquivo baixado)"}
              </pre>
            )}
          </Card>

          {/* Pacote de dumps separados (deploy/postgres-stack/sql/) */}
          {dumpResult.files && dumpResult.files.length > 0 && (
            <Card className="p-5 bg-white border-[#E8F5F1] space-y-4">
              <div className="flex flex-col gap-1">
                <h4 className="text-base font-bold text-[#075E54]">
                  Pacote de dumps separados ({dumpResult.files.length} arquivos)
                </h4>
                <p className="text-xs text-[#128C7E]/80 leading-relaxed">
                  Baixe o ZIP e descompacte em <code className="font-mono">deploy/postgres-stack/sql/</code> na VPS.
                  Depois rode <code className="font-mono">./deploy/atualizar.sh</code> — ele aplica de 010 a 090 na ordem certa.
                </p>
              </div>

              <Button onClick={downloadSqlPack} className="bg-[#075E54] hover:bg-[#128C7E] text-white gap-2 w-full sm:w-auto">
                <Download className="h-4 w-4" /> Baixar todos os dumps (.zip)
              </Button>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {dumpResult.files.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => downloadOne(f)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#E8F5F1] bg-[#F0FDF4] px-3 py-2 text-left transition-colors hover:bg-[#E8F5F1]"
                  >
                    <span className="truncate font-mono text-xs text-[#075E54]">{f.name}</span>
                    <span className="shrink-0 text-[10px] text-[#128C7E]/80">
                      {(f.content.length / 1024).toFixed(0)} KB
                    </span>
                  </button>
                ))}
              </div>

              <pre className="rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-green-400 overflow-x-auto">
{`unzip dumps-sql.zip -d /var/www/ia-mro/deploy/postgres-stack/sql/
cd /var/www/ia-mro && ./deploy/atualizar.sh`}
              </pre>
            </Card>
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-3">

            <Button
              onClick={downloadDump}
              className="bg-[#25D366] hover:bg-[#128C7E] text-white gap-2"
            >
              <Download className="h-4 w-4" /> Baixar .sql
            </Button>
            {dumpResult.readme && (
              <Button
                onClick={downloadReadme}
                className="bg-[#075E54] hover:bg-[#128C7E] text-white gap-2"
              >
                <FileText className="h-4 w-4" /> Baixar documentação
              </Button>
            )}
            <Button
              variant="outline"
              onClick={copyToClipboard}
              className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4] gap-2"
            >
              <Copy className="h-4 w-4" /> Copiar SQL
            </Button>
            <Button
              variant="outline"
              onClick={() => { setDumpResult(null); }}
              className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4] gap-2"
            >
              <RefreshCw className="h-4 w-4" /> Novo dump
            </Button>
          </div>

          {/* Alerta de segurança */}
          <Card className="p-4 bg-amber-50 border-amber-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-semibold mb-1">Arquivo contém dados sensíveis</p>
                <p className="text-xs text-amber-700">
                  O dump inclui e-mails, senhas hasheadas (não legíveis), mensagens e dados de contatos. Armazene o arquivo em local seguro e não compartilhe publicamente. Para restaurar em outro projeto Supabase, use o Dashboard &gt; SQL Editor &gt; Open file &gt; Run.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Botão principal */}
      {!dumpResult && !dumping && (
        <Button
          onClick={startDump}
          className="bg-[#25D366] hover:bg-[#128C7E] text-white text-base px-8 py-6 rounded-xl gap-3 shadow-lg"
        >
          <Database className="h-5 w-5" />
          <span>Exportar Dump SQL Completo</span>
        </Button>
      )}
    </div>
  );
}

export default function AdminCentral() {
  const [creds, setCreds] = useState<AdminCreds | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPwd, setLoginPwd] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [usersListOpen, setUsersListOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const [pwdDialogOpen, setPwdDialogOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  // Multi WhatsApp por cadastro
  const [numbersTarget, setNumbersTarget] = useState<AdminUser | null>(null);
  const [numbersList, setNumbersList] = useState<any[]>([]);
  const [numbersMax, setNumbersMax] = useState(1);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [numbersSaving, setNumbersSaving] = useState(false);

  // Travamento de acesso
  const [lockTarget, setLockTarget] = useState<AdminUser | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [lockSaving, setLockSaving] = useState(false);

  /**
   * Estado de ocupado por (usuário + ação). Antes um único booleano travava
   * botões demais — ou nenhum — e nada garantia o fim do carregamento.
   */
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const busyKey = (userId: string, action: string) => `${userId}:${action}`;
  const isBusy = (userId: string, action: string) => busy[busyKey(userId, action)] === true;
  const setBusyFlag = (userId: string, action: string, value: boolean) =>
    setBusy((prev) => {
      const next = { ...prev };
      if (value) next[busyKey(userId, action)] = true;
      else delete next[busyKey(userId, action)];
      return next;
    });

  /** Evita que "Recarregar" (manual ou automático) rode duas vezes ao mesmo tempo. */
  const loadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setCreds(JSON.parse(raw));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (creds) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds]);

  async function call(action: string, extra: Record<string, any> = {}, timeoutMs?: number) {
    if (!creds) throw new Error("Sessão do Admin Central encerrada. Entre novamente.");
    return adminCall(action, creds, extra, timeoutMs ? { timeoutMs } : undefined);
  }

  /** Erro de credencial derruba a sessão; o resto só informa. */
  function reportError(err: unknown, fallback: string) {
    if ((err as any)?.kind === "unauthorized") {
      toast.error(adminErrorMessage(err, fallback));
      logout();
      return;
    }
    toast.error(adminErrorMessage(err, fallback));
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loggingIn) return;
    const email = loginEmail.trim().toLowerCase();
    const password = loginPwd.trim();
    if (!email || !password) {
      toast.error("Informe e-mail e senha");
      return;
    }
    setLoggingIn(true);
    try {
      const data = await invokeAdminLogin(email, password);
      if (!data?.success) throw new Error(data?.error || "Credenciais inválidas");
      const c = { email, password };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
      setCreds(c);
      toast.success("Bem-vindo ao Admin Central");
    } catch (err) {
      toast.error(adminErrorMessage(err, "Falha no login"));
    } finally {
      setLoggingIn(false);
    }
  }

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setCreds(null);
    setUsers([]);
    setSelected(null);
    setBusy({});
  }

  /**
   * Leitura da lista. Uma única repetição curta para falha de rede — nunca uma
   * cadeia de tentativas que mantém o loader girando indefinidamente.
   */
  async function loadUsers(attempt = 0): Promise<void> {
    if (!creds) return;
    if (loadingRef.current && attempt === 0) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const data = await adminRead<{ users?: AdminUser[] }>("list_users", creds);
      if (!mountedRef.current) return;
      setUsers(data.users || []);
    } catch (err) {
      if (!mountedRef.current) return;
      if ((err as any)?.kind === "unauthorized") {
        toast.error(adminErrorMessage(err));
        logout();
        return;
      }
      if (attempt === 0 && isUnconfirmed(err)) {
        loadingRef.current = false;
        await new Promise((r) => setTimeout(r, 1500));
        return loadUsers(1);
      }
      toast.error(adminErrorMessage(err, "Erro ao carregar usuários"));
    } finally {
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }

  async function openInsights(u: AdminUser) {
    setSelected(u);
    setInsights(null);
    setLoadingInsights(true);
    try {
      const data = await adminRead<{ insights: Insights }>("user_insights", creds!, { userId: u.id });
      setInsights(data.insights);
    } catch (err) {
      reportError(err, "Erro ao carregar insights");
    } finally {
      setLoadingInsights(false);
    }
  }

  async function handleDelete(u: AdminUser) {
    if (isBusy(u.id, "delete")) return;
    if (!confirm(`Excluir definitivamente ${u.email}? Esta ação remove o cadastro, contatos e mensagens.`)) return;
    // requestId fixo: repetir a exclusão após timeout não duplica efeitos.
    const requestId = newRequestId();
    setBusyFlag(u.id, "delete", true);
    try {
      await adminCall("delete_user", creds!, { userId: u.id, requestId });
      toast.success("Usuário excluído");
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      if (selected?.id === u.id) setSelected(null);
    } catch (err) {
      if (isUnconfirmed(err)) {
        toast.error("Exclusão não confirmada. Use 'Recarregar' para verificar antes de tentar de novo.");
        void loadUsers();
      } else {
        reportError(err, "Erro ao excluir");
      }
    } finally {
      setBusyFlag(u.id, "delete", false);
    }
  }

  function openLockDialog(u: AdminUser) {
    setLockTarget(u);
    setLockReason(u.access_lock_reason || "");
  }

  async function confirmLock() {
    if (!lockTarget || lockSaving) return;
    const reason = lockReason.trim();
    if (!reason) {
      toast.error("Informe o motivo do travamento");
      return;
    }
    const target = lockTarget;
    setLockSaving(true);
    try {
      const data = await adminCall<{ locked?: boolean }>("lock_user", creds!, {
        userId: target.id,
        reason,
      });
      if (data.locked === false) throw new Error("O servidor não confirmou o travamento");
      setUsers((prev) =>
        prev.map((x) =>
          x.id === target.id
            ? { ...x, access_locked: true, access_lock_reason: reason, access_locked_at: new Date().toISOString() }
            : x
        )
      );
      toast.success(`Acesso de ${target.email} travado`);
      setLockTarget(null);
    } catch (err) {
      if (isUnconfirmed(err)) {
        toast.error("Travamento não confirmado. Recarregando a lista para verificar.");
        void loadUsers();
      } else {
        reportError(err, "Erro ao travar o acesso");
      }
    } finally {
      setLockSaving(false);
    }
  }

  async function handleUnlock(u: AdminUser) {
    if (isBusy(u.id, "unlock")) return;
    if (!confirm(`Destravar o acesso de ${u.email}?`)) return;
    setBusyFlag(u.id, "unlock", true);
    try {
      await adminCall("unlock_user", creds!, { userId: u.id });
      setUsers((prev) =>
        prev.map((x) => (x.id === u.id ? { ...x, access_locked: false, access_lock_reason: null, access_locked_at: null } : x))
      );
      toast.success("Acesso liberado");
    } catch (err) {
      if (isUnconfirmed(err)) {
        toast.error("Destravamento não confirmado. Recarregando a lista para verificar.");
        void loadUsers();
      } else {
        reportError(err, "Erro ao destravar");
      }
    } finally {
      setBusyFlag(u.id, "unlock", false);
    }
  }

  async function handleDisconnect(u: AdminUser) {
    if (isBusy(u.id, "disconnect")) return;
    if (!confirm(`Desconectar WhatsApp de ${u.email}?`)) return;
    setBusyFlag(u.id, "disconnect", true);
    try {
      await adminCall("disconnect_whatsapp", creds!, { userId: u.id });
      toast.success("WhatsApp desconectado");
      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id
            ? { ...x, connected: false, meta_display_phone_number: null, meta_phone_number_id: null, meta_verified_name: null }
            : x
        )
      );
    } catch (err) {
      if (isUnconfirmed(err)) {
        toast.error("Desconexão não confirmada. Recarregando a lista para verificar.");
        void loadUsers();
      } else {
        reportError(err, "Erro ao desconectar");
      }
    } finally {
      setBusyFlag(u.id, "disconnect", false);
    }
  }

  async function handleImpersonate(u: AdminUser) {
    if (isBusy(u.id, "impersonate")) return;
    setBusyFlag(u.id, "impersonate", true);
    const tab = window.open("", "_blank");
    try {
      const data = await adminCall<{ url?: string }>("impersonate", creds!, { userId: u.id });
      if (!data?.url) throw new Error("Não foi possível gerar o acesso");
      if (tab) tab.location.href = data.url;
      else window.open(data.url, "_blank", "noopener,noreferrer");
      toast.success(`Abrindo WhatsApp de ${u.email}`);
    } catch (err) {
      tab?.close();
      reportError(err, "Erro ao acessar WhatsApp do usuário");
    } finally {
      setBusyFlag(u.id, "impersonate", false);
    }
  }

  async function handleSendReset(u: AdminUser) {
    if (isBusy(u.id, "reminder")) return;
    if (!confirm(`Enviar lembrete de acesso para ${u.email}?\n\nSerá gerada uma nova senha temporária e enviada por e-mail junto com o link de acesso.`)) return;
    const requestId = newRequestId();
    setBusyFlag(u.id, "reminder", true);
    try {
      const data = await adminCall<{ emailQueued?: boolean }>("send_access_reminder", creds!, {
        userId: u.id,
        email: u.email,
        requestId,
      });
      toast.success(
        data.emailQueued
          ? "Nova senha aplicada — o e-mail está na fila de envio"
          : "Lembrete de acesso enviado por e-mail"
      );
    } catch (err) {
      if (isUnconfirmed(err)) {
        toast.error("Envio não confirmado. Verifique antes de repetir para não gerar outra senha.");
      } else {
        reportError(err, "Erro ao enviar o lembrete");
      }
    } finally {
      setBusyFlag(u.id, "reminder", false);
    }
  }

  async function openNumbersDialog(u: AdminUser) {
    setNumbersTarget(u);
    setNumbersList([]);
    setNumbersMax(1);
    setNumbersLoading(true);
    try {
      const data = await adminRead<{ maxNumbers?: number; numbers?: any[] }>(
        "list_user_numbers",
        creds!,
        { userId: u.id }
      );
      setNumbersMax(Number(data.maxNumbers) || 1);
      setNumbersList(data.numbers || []);
    } catch (err) {
      reportError(err, "Erro ao carregar números");
    } finally {
      setNumbersLoading(false);
    }
  }

  async function saveMaxNumbers(value: number) {
    if (!numbersTarget || numbersSaving) return;
    setNumbersSaving(true);
    try {
      const data = await adminCall<{ maxNumbers?: number }>("set_max_numbers", creds!, {
        userId: numbersTarget.id,
        maxNumbers: value,
      });
      const confirmed = Number(data.maxNumbers) || value;
      setNumbersMax(confirmed);
      toast.success(`Cadastro liberado para ${confirmed} número(s) de WhatsApp`);
    } catch (err) {
      reportError(err, "Erro ao salvar o limite de números");
    } finally {
      setNumbersSaving(false);
    }
  }

  async function saveNumber(numberId: string, patch: { label?: string; accessPin?: string }) {
    if (numbersSaving) return;
    setNumbersSaving(true);
    try {
      await adminCall("update_user_number", creds!, { numberId, ...patch });
      toast.success("Número atualizado");
      if (numbersTarget) await openNumbersDialog(numbersTarget);
    } catch (err) {
      reportError(err, "Erro ao salvar o número");
    } finally {
      setNumbersSaving(false);
    }
  }

  async function removeNumber(numberId: string) {
    if (numbersSaving) return;
    if (!confirm("Remover este número do cadastro?")) return;
    setNumbersSaving(true);
    try {
      await adminCall("delete_user_number", creds!, {
        numberId,
        userId: numbersTarget?.id,
      });
      toast.success("Número removido");
      if (numbersTarget) await openNumbersDialog(numbersTarget);
    } catch (err) {
      reportError(err, "Erro ao remover o número");
    } finally {
      setNumbersSaving(false);
    }
  }

  function openPwdDialog(u: AdminUser) {
    setPwdTarget(u);
    setNewPwd(generatePwd());
    setPwdDialogOpen(true);
  }

  function generatePwd() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out + "@1";
  }

  async function savePassword() {
    if (!pwdTarget || savingPwd) return;
    const pwd = newPwd.trim();
    if (pwd.length < 6) {
      toast.error("Senha deve ter no mínimo 6 caracteres");
      return;
    }
    setSavingPwd(true);
    try {
      await adminCall("set_password", creds!, { userId: pwdTarget.id, newPassword: pwd });
      try {
        await navigator.clipboard.writeText(pwd);
      } catch {
        /* clipboard pode estar bloqueado; não é crítico */
      }
      toast.success(`Senha de ${pwdTarget.email} alterada e copiada`);
      setPwdDialogOpen(false);
    } catch (err) {
      if (isUnconfirmed(err)) {
        toast.error("Troca de senha não confirmada. Peça ao usuário para testar antes de repetir.");
      } else {
        reportError(err, "Erro ao trocar a senha");
      }
    } finally {
      setSavingPwd(false);
    }
  }


  // ============ LOGIN ============
  if (!creds) {
    return (
      <div className="min-h-screen bg-[#F0FDF4] text-[#075E54] flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-6 space-y-4 bg-white border-[#E8F5F1] text-[#075E54] shadow-lg shadow-green-900/5">
          <div>
            <h1 className="text-2xl font-bold text-[#075E54]">Admin Central</h1>
            <p className="text-sm text-[#128C7E]/70">Acesso restrito ao administrador principal</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[#075E54]">E-mail</Label>
              <Input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="username"
                required
                className="bg-[#F0FDF4] border-[#E8F5F1] focus-visible:ring-[#25D366]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#075E54]">Senha</Label>
              <Input
                type="password"
                value={loginPwd}
                onChange={(e) => setLoginPwd(e.target.value)}
                autoComplete="current-password"
                required
                className="bg-[#F0FDF4] border-[#E8F5F1] focus-visible:ring-[#25D366]"
              />
            </div>
            <Button type="submit" disabled={loggingIn} className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white">
              {loggingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  // ============ DASHBOARD ============
  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.email?.toLowerCase().includes(q) ||
      (u.full_name || "").toLowerCase().includes(q) ||
      (u.meta_display_phone_number || "").toLowerCase().includes(q) ||
      (u.whatsapp_profile_number || "").toLowerCase().includes(q)
    );
  });

  const connectedCount = users.filter((u) => u.connected).length;
  const disconnectedCount = users.length - connectedCount;
  const connectionRate = users.length > 0 ? Math.round((connectedCount / users.length) * 100) : 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last7 = new Date(today); last7.setDate(last7.getDate() - 7);
  const newThisWeek = users.filter((u) => new Date(u.created_at) >= last7).length;

  return (
    <div className="min-h-screen bg-[#F0FDF4] text-[#075E54] p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-[#075E54]">Admin Central</h1>
            <p className="text-sm text-[#128C7E]/70">
              {users.length} cadastros · {connectedCount} conectados
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => loadUsers()} disabled={loading} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Recarregar
            </Button>
            <Button variant="outline" size="sm" onClick={logout} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
              Sair
            </Button>
          </div>
        </div>

        <Tabs defaultValue="users" className="w-full">
          <TabsList className="bg-white border border-[#E8F5F1] shadow-sm flex flex-wrap h-auto gap-1">
            <TabsTrigger value="users" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">Cadastros & Números</TabsTrigger>
            <TabsTrigger value="trials" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">Testes & Acessos</TabsTrigger>
            <TabsTrigger value="sales" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">Vendas</TabsTrigger>
            <TabsTrigger value="announcements" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">Avisos (Popup)</TabsTrigger>
            <TabsTrigger value="tutorials" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white">Tutoriais</TabsTrigger>
            <TabsTrigger value="migration" className="data-[state=active]:bg-[#25D366] data-[state=active]:text-white gap-1.5">
              <Database className="h-3.5 w-3.5" /> Migração
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4 mt-4">
        {!loading && users.length > 0 && (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#075E54] via-[#128C7E] to-[#25D366] p-1 shadow-xl">
            <div className="rounded-[14px] bg-white p-5 md:p-6">
              <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#25D366] to-[#128C7E] flex items-center justify-center shadow-md">
                    <TrendingUp className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#075E54]">Relatório Geral</h2>
                    <p className="text-xs text-[#128C7E]/70">Visão consolidada da plataforma</p>
                  </div>
                </div>
                <Badge className="bg-[#25D366] hover:bg-[#25D366] text-white border-0 gap-1">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  Ao vivo
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <ReportStat
                  icon={<Users className="h-5 w-5" />}
                  label="Total de cadastros"
                  value={users.length}
                  gradient="from-[#075E54] to-[#128C7E]"
                  onClick={() => {
                    setUsersListOpen((v) => !v);
                    setShowAll(false);
                  }}
                  active={usersListOpen}
                />
                <ReportStat
                  icon={<MessageCircle className="h-5 w-5" />}
                  label="Conectados ao WhatsApp"
                  value={connectedCount}
                  hint={`${connectionRate}% do total`}
                  gradient="from-[#25D366] to-[#128C7E]"
                />
                <ReportStat
                  icon={<XCircle className="h-5 w-5" />}
                  label="Não conectados"
                  value={disconnectedCount}
                  gradient="from-slate-500 to-slate-700"
                />
                <ReportStat
                  icon={<Zap className="h-5 w-5" />}
                  label="Novos (7 dias)"
                  value={newThisWeek}
                  gradient="from-[#34B7F1] to-[#128C7E]"
                />
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-xs text-[#075E54] mb-1.5 font-medium">
                  <span>Taxa de conexão</span>
                  <span>{connectionRate}%</span>
                </div>
                <div className="h-3 w-full rounded-full bg-[#E8F5F1] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#25D366] via-[#128C7E] to-[#075E54] transition-all duration-700 shadow-[0_0_12px_rgba(37,211,102,0.6)]"
                    style={{ width: `${connectionRate}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {usersListOpen && (
        <Card className="p-3 bg-white border-[#E8F5F1] shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#128C7E]/60" />
            <Input
              className="pl-9 bg-[#F0FDF4] border-[#E8F5F1] text-[#075E54] placeholder:text-[#128C7E]/50 focus-visible:ring-[#25D366]"
              placeholder="Buscar por e-mail, nome ou número..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </Card>
        )}

        {usersListOpen && (loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#128C7E]/60" />
          </div>
        ) : (
          <div className="grid gap-3">
            {(showAll ? filtered : filtered.slice(0, 10)).map((u) => (
              <Card key={u.id} className="p-4 bg-white border-[#E8F5F1] text-[#075E54] shadow-sm hover:shadow-md transition-shadow">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{u.full_name || u.email}</span>
                      {u.connected ? (
                        <Badge className="bg-[#25D366]/15 text-[#128C7E] hover:bg-[#25D366]/15 border border-[#25D366]/30 gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Conectado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-slate-500 border-slate-200 bg-slate-50">
                          <XCircle className="h-3 w-3" />
                          Não conectado
                        </Badge>
                      )}
                      {u.role === "super_admin" && <Badge className="bg-[#075E54] text-white hover:bg-[#075E54]">super_admin</Badge>}
                      {u.access_locked && (
                        <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border border-red-200 gap-1">
                          <Lock className="h-3 w-3" />
                          Travado{u.access_lock_reason ? `: ${u.access_lock_reason}` : ""}
                        </Badge>
                      )}

                    </div>
                    <div className="text-sm text-[#128C7E]/80 flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5" />
                      <span className="select-all">{u.email}</span>
                    </div>
                    <div className="text-xs text-slate-500 space-x-3">
                      {u.meta_display_phone_number && (
                        <span>📱 WA: {u.meta_display_phone_number}</span>
                      )}
                      {u.whatsapp_profile_number && !u.meta_display_phone_number && (
                        <span>📱 {u.whatsapp_profile_number}</span>
                      )}
                      <span>Cadastro: {new Date(u.created_at).toLocaleDateString("pt-BR")}</span>
                      {u.last_sign_in_at && (
                        <span>Último login: {new Date(u.last_sign_in_at).toLocaleDateString("pt-BR")}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openInsights(u)} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
                      <BarChart3 className="h-4 w-4 mr-1" /> Insights
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openPwdDialog(u)} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
                      <KeyRound className="h-4 w-4 mr-1" /> Nova senha
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleSendReset(u)} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
                      <Mail className="h-4 w-4 mr-1" /> Lembrar acesso
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openNumbersDialog(u)} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
                      <MessageCircle className="h-4 w-4 mr-1" /> Números WhatsApp
                    </Button>
                    {u.connected && (
                      <Button size="sm" onClick={() => handleImpersonate(u)} className="bg-[#25D366] text-white hover:bg-[#1eb356]">
                        <ExternalLink className="h-4 w-4 mr-1" /> Acessar WhatsApp
                      </Button>
                    )}
                    {u.connected && (
                      <Button size="sm" variant="outline" onClick={() => handleDisconnect(u)} className="bg-white border-amber-200 text-amber-700 hover:bg-amber-50">
                        <Power className="h-4 w-4 mr-1" /> Desconectar
                      </Button>
                    )}
                    {u.access_locked ? (
                      <Button size="sm" variant="outline" onClick={() => handleUnlock(u)} className="bg-white border-[#25D366]/40 text-[#128C7E] hover:bg-[#F0FDF4]">
                        <Unlock className="h-4 w-4 mr-1" /> Destravar acesso
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => openLockDialog(u)} className="bg-white border-red-200 text-red-700 hover:bg-red-50">
                        <Lock className="h-4 w-4 mr-1" /> Travar acesso
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(u)}>

                      <Trash2 className="h-4 w-4 mr-1" /> Excluir
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            {filtered.length === 0 && (
              <Card className="p-8 text-center text-[#128C7E]/70 bg-white border-[#E8F5F1]">Nenhum cadastro encontrado</Card>
            )}
            {!showAll && filtered.length > 10 && (
              <Button
                variant="outline"
                onClick={() => setShowAll(true)}
                className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4] mx-auto"
              >
                Ver todos ({filtered.length})
              </Button>
            )}
            {showAll && filtered.length > 10 && (
              <Button
                variant="outline"
                onClick={() => setShowAll(false)}
                className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4] mx-auto"
              >
                Mostrar menos
              </Button>
            )}
          </div>
        ))}
          </TabsContent>

          <TabsContent value="announcements" className="mt-4">
            <AnnouncementsAdminPanel creds={creds} />
          </TabsContent>

          <TabsContent value="sales" className="mt-4">
            <SalesOrdersPanel creds={creds} />
          </TabsContent>

          <TabsContent value="trials" className="mt-4">
            <TrialsPanel creds={creds} />
          </TabsContent>

          <TabsContent value="tutorials" className="mt-4">
            <TutorialsAdminPanel />
          </TabsContent>

          <TabsContent value="migration" className="mt-4">
            <MigrationPanel creds={creds} />
            <div className="mt-6">
              <MigrationExtras />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Insights dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md bg-white border-[#E8F5F1] text-[#075E54]">
          <DialogHeader>
            <DialogTitle className="text-[#075E54]">Insights do usuário</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium">{selected.full_name || selected.email}</div>
                <div className="text-[#128C7E]/70">{selected.email}</div>
              </div>
              {loadingInsights || !insights ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-[#128C7E]/60" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Card className="p-3 bg-[#F0FDF4] border-[#E8F5F1] text-[#075E54]">
                    <div className="text-xs text-[#128C7E]/70">Mensagens recebidas</div>
                    <div className="text-2xl font-bold text-[#075E54]">{insights.totalReceived}</div>
                  </Card>
                  <Card className="p-3 bg-[#F0FDF4] border-[#E8F5F1] text-[#075E54]">
                    <div className="text-xs text-[#128C7E]/70">Mensagens enviadas</div>
                    <div className="text-2xl font-bold text-[#075E54]">{insights.totalSent}</div>
                  </Card>
                  <Card className="p-3 bg-[#F0FDF4] border-[#E8F5F1] text-[#075E54]">
                    <div className="text-xs text-[#128C7E]/70">Contatos</div>
                    <div className="text-2xl font-bold text-[#075E54]">{insights.totalContacts}</div>
                  </Card>
                  <Card className="p-3 bg-[#F0FDF4] border-[#E8F5F1] text-[#075E54]">
                    <div className="text-xs text-[#128C7E]/70">Conversas cobradas</div>
                    <div className="text-2xl font-bold text-[#075E54]">{insights.paidConversations}</div>
                  </Card>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Password dialog */}
      {/* Travar acesso do cadastro */}
      <Dialog open={!!lockTarget} onOpenChange={(o) => !o && setLockTarget(null)}>
        <DialogContent className="max-w-md bg-white border-[#E8F5F1] text-[#075E54]">
          <DialogHeader>
            <DialogTitle className="text-[#075E54] flex items-center gap-2">
              <Lock className="h-4 w-4 text-red-600" /> Travar acesso
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              <div className="font-medium">{lockTarget?.full_name || lockTarget?.email}</div>
              <div className="text-[#128C7E]/70">{lockTarget?.email}</div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#075E54]">Motivo (aparece para o usuário)</Label>
              <Textarea
                value={lockReason}
                onChange={(e) => setLockReason(e.target.value)}
                placeholder="Ex.: pagamento"
                maxLength={500}
                className="bg-[#F0FDF4] border-[#E8F5F1] focus-visible:ring-[#25D366]"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {["Pagamento", "Uso indevido", "Pendência com a administração"].map((r) => (
                <Button
                  key={r}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLockReason(r)}
                  className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]"
                >
                  {r}
                </Button>
              ))}
            </div>
            <p className="text-xs text-[#128C7E]/70">
              O usuário verá um popup em tela cheia que não pode ser fechado até você destravar o acesso.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockTarget(null)} className="bg-white border-[#E8F5F1] text-[#075E54]">
              Cancelar
            </Button>
            <Button onClick={confirmLock} disabled={lockSaving} className="bg-red-600 hover:bg-red-700 text-white">
              {lockSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Travar agora"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Multi WhatsApp: libera quantidade e senha por número */}

      <Dialog open={!!numbersTarget} onOpenChange={(o) => !o && setNumbersTarget(null)}>
        <DialogContent className="max-w-lg bg-white border-[#E8F5F1] text-[#075E54]">
          <DialogHeader>
            <DialogTitle className="text-[#075E54]">Números de WhatsApp do cadastro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-[#075E54]/70">{numbersTarget?.email}</p>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs font-semibold text-[#075E54]">
                  Quantos WhatsApps este cadastro pode conectar
                </label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={numbersMax}
                  onChange={(e) => setNumbersMax(Math.max(1, Number(e.target.value) || 1))}
                  className="mt-1 bg-white border-[#E8F5F1] text-[#075E54]"
                />
              </div>
              <Button
                onClick={() => saveMaxNumbers(numbersMax)}
                disabled={numbersSaving}
                className="bg-[#25D366] text-white hover:bg-[#1eb356]"
              >
                {numbersSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
            <p className="text-[11px] text-[#075E54]/60">
              Com 2 ou mais, o usuário passa a escolher qual WhatsApp abrir antes das conversas e
              pode trocar a qualquer momento pelo botão “Trocar WhatsApp”.
            </p>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {numbersLoading && (
                <div className="py-6 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[#25D366]" />
                </div>
              )}
              {!numbersLoading && numbersList.length === 0 && (
                <p className="text-xs text-[#075E54]/60 py-4 text-center">
                  Nenhum número conectado ainda neste cadastro.
                </p>
              )}
              {numbersList.map((n) => (
                <div key={n.id} className="rounded-lg border border-[#E8F5F1] p-3 space-y-2">
                  <p className="text-sm font-semibold">
                    {n.meta_display_phone_number || n.meta_verified_name || n.label || n.meta_phone_number_id}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      defaultValue={n.label || ""}
                      placeholder="Apelido"
                      onBlur={(e) =>
                        e.target.value !== (n.label || "") &&
                        saveNumber(n.id, { label: e.target.value })
                      }
                      className="bg-white border-[#E8F5F1] text-[#075E54]"
                    />
                    <Input
                      defaultValue={n.access_pin || ""}
                      placeholder="Senha do número (opcional)"
                      onBlur={(e) =>
                        e.target.value !== (n.access_pin || "") &&
                        saveNumber(n.id, { accessPin: e.target.value })
                      }
                      className="bg-white border-[#E8F5F1] text-[#075E54]"
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeNumber(n.id)}
                      disabled={numbersSaving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNumbersTarget(null)}
              className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwdDialogOpen} onOpenChange={setPwdDialogOpen}>
        <DialogContent className="max-w-md bg-white border-[#E8F5F1] text-[#075E54]">
          <DialogHeader>
            <DialogTitle className="text-[#075E54]">Definir nova senha</DialogTitle>
          </DialogHeader>
          {pwdTarget && (
            <div className="space-y-3">
              <p className="text-sm text-[#128C7E]/80">
                Defina uma nova senha para <strong>{pwdTarget.email}</strong>. Copie e envie ao usuário — senhas atuais
                não podem ser recuperadas pois ficam criptografadas.
              </p>
              <div className="flex gap-2">
                <Input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} className="bg-[#F0FDF4] border-[#E8F5F1] text-[#075E54]" />
                <Button
                  type="button"
                  variant="outline"
                  className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]"
                  onClick={() => {
                    navigator.clipboard.writeText(newPwd);
                    toast.success("Copiado");
                  }}
                >
                  Copiar
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setNewPwd(generatePwd())} className="text-[#128C7E] hover:bg-[#F0FDF4]">
                Gerar outra
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdDialogOpen(false)} className="bg-white border-[#E8F5F1] text-[#075E54] hover:bg-[#F0FDF4]">
              Cancelar
            </Button>
            <Button onClick={savePassword} disabled={savingPwd} className="bg-[#25D366] hover:bg-[#128C7E] text-white">
              {savingPwd ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar senha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
