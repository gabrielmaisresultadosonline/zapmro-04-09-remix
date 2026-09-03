/**
 * conversationArchive — exportação, backup e limpeza do histórico de conversas.
 *
 * Motivação: o banco e o Storage cresciam indefinidamente porque não havia
 * nenhuma rotina de saída. Aqui o usuário pode exportar (com ou sem os
 * arquivos), salvar um backup no Storage e limpar o histórico mantendo os
 * contatos — e a limpeza também apaga a mídia órfã do bucket.
 */
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { collectStorageUrls, deleteMediaUrlsIfUnused, parseStorageUrl } from "@/lib/mediaStorage";

export interface ConversationExportOptions {
  /** Inclui os binários (imagens/vídeos/áudios) dentro de um .zip. */
  includeFiles: boolean;
  /** Escopo: um contato específico ou todos. */
  contactId?: string | null;
  userId?: string | null;
}

export interface ConversationSnapshot {
  exportedAt: string;
  totalContacts: number;
  totalMessages: number;
  contacts: Array<Record<string, unknown> & { messages: Array<Record<string, unknown>> }>;
}

const PAGE = 1000;

async function fetchAll<T>(
  build: (from: number, to: number) => any,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 200; page += 1) {
    const from = page * PAGE;
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const chunk = (data || []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

/** Monta o snapshot completo (contatos + mensagens) para exportar/backup. */
export async function buildConversationSnapshot(
  options: Pick<ConversationExportOptions, "contactId" | "userId">,
): Promise<ConversationSnapshot> {
  const contacts = await fetchAll<Record<string, any>>((from, to) => {
    let q = supabase.from("crm_contacts").select("*").order("created_at", { ascending: true }).range(from, to);
    if (options.userId) q = q.eq("user_id", options.userId);
    if (options.contactId) q = q.eq("id", options.contactId);
    return q;
  });

  const messages = await fetchAll<Record<string, any>>((from, to) => {
    let q = supabase.from("crm_messages").select("*").order("created_at", { ascending: true }).range(from, to);
    if (options.userId) q = q.eq("user_id", options.userId);
    if (options.contactId) q = q.eq("contact_id", options.contactId);
    return q;
  });

  const byContact = new Map<string, Array<Record<string, unknown>>>();
  messages.forEach((msg) => {
    const key = String(msg.contact_id ?? "sem-contato");
    const list = byContact.get(key) || [];
    list.push(msg);
    byContact.set(key, list);
  });

  return {
    exportedAt: new Date().toISOString(),
    totalContacts: contacts.length,
    totalMessages: messages.length,
    contacts: contacts.map((contact) => ({
      ...contact,
      messages: byContact.get(String(contact.id)) || [],
    })),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Gera um HTML legível para abrir a conversa fora do sistema. */
export function renderSnapshotHtml(snapshot: ConversationSnapshot, fileMap?: Map<string, string>): string {
  const blocks = snapshot.contacts
    .map((contact) => {
      const rows = (contact.messages as Array<Record<string, any>>)
        .map((msg) => {
          const url = String(msg.media_url || "");
          const local = fileMap?.get(url);
          const media = url
            ? `<div class="media"><a href="${escapeHtml(local || url)}" target="_blank" rel="noreferrer">${escapeHtml(
                msg.message_type || "arquivo",
              )}</a></div>`
            : "";
          return `<div class="msg ${msg.direction === "outbound" ? "out" : "in"}">
  <div class="meta">${escapeHtml(msg.created_at)} · ${escapeHtml(msg.direction || "")}</div>
  <div class="text">${escapeHtml(msg.content || "")}</div>
  ${media}
</div>`;
        })
        .join("\n");
      return `<section><h2>${escapeHtml(contact.name || contact.wa_id || contact.id)}</h2>${rows || "<p>Sem mensagens.</p>"}</section>`;
    })
    .join("\n");

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Conversas exportadas</title>
<style>
body{font-family:system-ui,sans-serif;background:#0b141a;color:#e9edef;margin:0;padding:24px}
section{max-width:860px;margin:0 auto 40px;background:#111b21;border-radius:16px;padding:20px}
h1,h2{margin:0 0 16px}
.msg{padding:10px 14px;border-radius:12px;margin-bottom:8px;background:#202c33;max-width:80%}
.msg.out{background:#005c4b;margin-left:auto}
.meta{font-size:11px;opacity:.6;margin-bottom:4px}
.media a{color:#53bdeb}
</style></head><body>
<h1 style="max-width:860px;margin:0 auto 24px">Conversas — ${escapeHtml(snapshot.exportedAt)} (${snapshot.totalMessages} mensagens)</h1>
${blocks}
</body></html>`;
}

export interface ConversationExportResult {
  blob: Blob;
  filename: string;
  totalMessages: number;
  filesIncluded: number;
}

/** Exporta as conversas em JSON+HTML (zip) — opcionalmente com os arquivos. */
export async function exportConversations(
  options: ConversationExportOptions,
  onProgress?: (label: string) => void,
): Promise<ConversationExportResult> {
  onProgress?.("Carregando conversas...");
  const snapshot = await buildConversationSnapshot(options);

  const zip = new JSZip();
  const fileMap = new Map<string, string>();
  let filesIncluded = 0;

  if (options.includeFiles) {
    const urls = Array.from(collectStorageUrls(snapshot.contacts));
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      onProgress?.(`Baixando arquivos ${i + 1}/${urls.length}...`);
      const parsed = parseStorageUrl(url);
      if (!parsed) continue;
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const name = `arquivos/${parsed.path.split("/").pop() || `arquivo-${i}`}`;
        zip.file(name, blob);
        fileMap.set(url, name);
        filesIncluded += 1;
      } catch (error) {
        console.warn("[conversationArchive] arquivo ignorado no export", url, error);
      }
    }
  }

  zip.file("conversas.json", JSON.stringify(snapshot, null, 2));
  zip.file("conversas.html", renderSnapshotHtml(snapshot, options.includeFiles ? fileMap : undefined));

  onProgress?.("Compactando...");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return {
    blob,
    filename: `conversas-${stamp}${options.includeFiles ? "-com-arquivos" : ""}.zip`,
    totalMessages: snapshot.totalMessages,
    filesIncluded,
  };
}

/** Salva um backup do histórico no bucket (para restaurar/consultar depois). */
export async function saveConversationBackup(options: {
  userId?: string | null;
  includeFiles?: boolean;
}): Promise<{ url: string; path: string; totalMessages: number }> {
  const exported = await exportConversations({
    includeFiles: !!options.includeFiles,
    userId: options.userId,
  });
  const path = `conversation-backups/${options.userId || "global"}/${exported.filename}`;
  const { error } = await supabase.storage
    .from("crm-media")
    .upload(path, exported.blob, { contentType: "application/zip", upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("crm-media").getPublicUrl(path);
  return { url: data.publicUrl, path, totalMessages: exported.totalMessages };
}

/**
 * Limpa o histórico mantendo os contatos e apaga a mídia órfã do Storage.
 * Ordem importa: coletamos as URLs ANTES de apagar as mensagens, e removemos
 * os arquivos DEPOIS, quando nada mais referencia aquela URL.
 */
export async function clearConversationHistory(options: {
  userId?: string | null;
  contactId?: string | null;
  purgeStorage?: boolean;
}): Promise<{ deletedMessages: number; removedFiles: number; keptFiles: number }> {
  const messages = await fetchAll<Record<string, any>>((from, to) => {
    let q = supabase
      .from("crm_messages")
      .select("id, media_url, content, metadata")
      .order("created_at", { ascending: true })
      .range(from, to);
    if (options.userId) q = q.eq("user_id", options.userId);
    if (options.contactId) q = q.eq("contact_id", options.contactId);
    return q;
  });

  const urls = collectStorageUrls(messages);

  let deleteQuery = supabase.from("crm_messages").delete();
  if (options.contactId) deleteQuery = deleteQuery.eq("contact_id", options.contactId);
  else if (options.userId) deleteQuery = deleteQuery.eq("user_id", options.userId);
  else throw new Error("Escopo inválido: informe o usuário ou o contato.");

  const { error } = await deleteQuery;
  if (error) throw error;

  let removedFiles = 0;
  let keptFiles = 0;
  if (options.purgeStorage !== false) {
    const result = await deleteMediaUrlsIfUnused(urls, { userId: options.userId });
    removedFiles = result.removed;
    keptFiles = result.kept;
  }

  console.log("[conversationArchive] histórico limpo", {
    deletedMessages: messages.length,
    removedFiles,
    keptFiles,
  });
  return { deletedMessages: messages.length, removedFiles, keptFiles };
}

/** Dispara o download de um blob no navegador. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
