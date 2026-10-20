"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { FormReader, fail, isUuid, succeed, type ActionState } from "@/lib/hq/forms";
import { readKnowledgeFields } from "@/lib/hq/knowledge/rules";
import { getVersion } from "@/lib/hq/knowledge/queries";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for the Knowledge base. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff(capability) FIRST (knowledge.write to save, knowledge.approve to approve,
 *      archive and restore; settings.admin for the chat-approve switch),
 *   2. takes identity from the session only (the database stamps who saved and who approved),
 *   3. validates every input on the server (FormReader + the knowledge rules),
 *   4. writes ONLY through the hq RPCs (create_knowledge_document, edit_knowledge_document,
 *      approve_knowledge_version, discard_knowledge_draft, set_knowledge_review,
 *      restore_knowledge_version, archive_record / restore_record), which check the capability again,
 *      keep approved content unchanged (every edit is a new draft) and write the audit trail.
 * People see plain messages; only error codes are logged.
 */

const KB = `${HQ_BASE}/knowledge`;
const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That document could not be found. It may have been archived.";
const CHECK = "Please check the highlighted fields and try again.";
const STALE = "Someone else saved a newer version while you were editing. Your changes were not saved: reload the page to see their version, then make your change again.";

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

function messageFor(error: DbError): string {
  const code = error?.code ?? "";
  if (error?.hint === "knowledge_stale") return STALE;
  if (code === "42501" && error?.hint && error.message) return sentence(error.message);
  if (code === "42501") return FORBIDDEN;
  if (code === "P0002" || code === "PGRST116") return NOT_FOUND;
  if (code === "23505") return "Another live document already has this title. Rename one of them first.";
  if ((code === "22023" || code === "23514") && error?.message) return sentence(error.message);
  return GENERIC;
}

function sentence(m: string): string {
  const t = m.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
}

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string) {
  revalidatePath(KB);
  if (id) revalidatePath(`${KB}/${id}`, "layout");
  revalidatePath(HQ_BASE);
}

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { values: retainedValues(formData) } });

function idFrom(formData: FormData, name = "id"): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

function intFrom(formData: FormData, name: string): number | null {
  const raw = formData.get(name);
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

// ── create ───────────────────────────────────────────────────

export async function createKnowledgeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("knowledge.write");
  const reader = new FormReader(formData);
  const v = readKnowledgeFields(reader, todayIn(staff.timezone), { noteRequired: false });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const { data, error } = await db.rpc("create_knowledge_document", {
    p_title: v.title,
    p_category: v.category!,
    p_body: v.body,
    p_summary: v.summary ?? undefined,
    p_owner: v.ownerId!,
    p_review_due: v.reviewDue ?? undefined,
    p_change_note: v.changeNote ?? undefined,
  });
  const out = data as { document_id?: string; ref?: string } | null;
  if (error || !out?.document_id) {
    logged("createKnowledge", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(out.document_id);
  redirect(withToast(`${KB}/${out.document_id}`, `${out.ref ?? "Document"} saved as a draft`));
}

// ── edit: the words become a new draft; filing details change directly ──

export async function updateKnowledgeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("knowledge.write");
  const id = idFrom(formData);
  const base = intFrom(formData, "base_version");
  if (!id || !base) return withValues(fail(NOT_FOUND), formData);

  const [doc, cur] = await Promise.all([
    db.from("knowledge_documents").select("category, owner_id, review_due, current_version").eq("id", id).is("deleted_at", null).maybeSingle(),
    getVersion(db, id, base),
  ]);
  if (doc.error || !cur.ok) {
    logged("updateKnowledge load", doc.error);
    return withValues(fail(GENERIC), formData);
  }
  if (!doc.data || !cur.data) return withValues(fail(NOT_FOUND), formData);
  if (doc.data.current_version !== base) return withValues(fail(STALE), formData);

  const reader = new FormReader(formData);
  const v = readKnowledgeFields(reader, todayIn(staff.timezone), { noteRequired: true, currentReview: doc.data.review_due });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const before = cur.data;
  const wordsChanged = v.title !== before.title || (v.summary ?? null) !== (before.summary ?? null) || v.body !== before.body;
  const filingChanged = v.category !== doc.data.category || v.ownerId !== doc.data.owner_id || (v.reviewDue ?? null) !== (doc.data.review_due ?? null);
  if (!wordsChanged && !filingChanged) return withValues(fail("Nothing has changed yet: edit the text or the details, then save."), formData);

  if (wordsChanged) {
    const { error } = await db.rpc("edit_knowledge_document", {
      p_document: id,
      p_base_version: base,
      p_change_note: v.changeNote!,
      p_title: v.title !== before.title ? v.title : undefined,
      p_summary: (v.summary ?? null) !== (before.summary ?? null) ? (v.summary ?? "") : undefined,
      p_body: v.body !== before.body ? v.body : undefined,
    });
    if (error) {
      logged("updateKnowledge edit", error);
      return withValues(fail(messageFor(error)), formData);
    }
  }
  if (filingChanged) {
    const { error } = await db.rpc("set_knowledge_review", {
      p_document: id,
      p_owner: v.ownerId!,
      p_review_due: v.reviewDue ?? undefined,
      p_clear_review: !v.reviewDue,
      p_category: v.category!,
      p_change_note: v.changeNote ?? undefined,
    });
    if (error) {
      logged("updateKnowledge details", error);
      refresh(id);
      return withValues(fail(wordsChanged ? `Your text was saved as a new draft, but the details were not: ${messageFor(error)}` : messageFor(error)), formData);
    }
  }
  refresh(id);
  redirect(withToast(`${KB}/${id}`, wordsChanged ? "Saved as a new draft. It needs approval before staff see it." : "Details saved"));
}

// ── approve, discard, restore a version ──────────────────────

export async function approveKnowledgeAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("knowledge.approve");
  const id = idFrom(formData);
  const version = intFrom(formData, "version");
  if (!id || !version) redirect(withToast(KB, NOT_FOUND, "error"));
  const { error } = await db.rpc("approve_knowledge_version", { p_document: id, p_version: version });
  if (error) {
    logged("approveKnowledge", error);
    redirect(withToast(`${KB}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${KB}/${id}`, `Version ${version} approved. Staff now read it.`));
}

export async function discardKnowledgeDraftAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("knowledge.write");
  const id = idFrom(formData);
  const version = intFrom(formData, "version");
  if (!id || !version) redirect(withToast(KB, NOT_FOUND, "error"));
  const { error } = await db.rpc("discard_knowledge_draft", { p_document: id, p_version: version, p_reason: "Discarded in HQ" });
  if (error) {
    logged("discardKnowledgeDraft", error);
    redirect(withToast(`${KB}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${KB}/${id}`, "Draft discarded"));
}

export async function restoreKnowledgeVersionAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("knowledge.write");
  const id = idFrom(formData);
  const version = intFrom(formData, "version");
  const base = intFrom(formData, "base_version");
  if (!id || !version || !base) redirect(withToast(KB, NOT_FOUND, "error"));
  const { data, error } = await db.rpc("restore_knowledge_version", { p_document: id, p_version: version, p_base_version: base });
  if (error) {
    logged("restoreKnowledgeVersion", error);
    redirect(withToast(`${KB}/${id}/versions/${version}`, messageFor(error), "error"));
  }
  refresh(id);
  const v = (data as { version?: number } | null)?.version;
  redirect(withToast(`${KB}/${id}`, `Version ${version} brought back as draft version ${v ?? ""}`.trim()));
}

// ── archive and restore ──────────────────────────────────────

export async function archiveKnowledgeAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("knowledge.approve");
  const id = idFrom(formData);
  if (!id) redirect(withToast(KB, NOT_FOUND, "error"));
  const { error } = await db.rpc("archive_record", { p_entity: "knowledge_document", p_id: id, p_reason: "Archived from the document page" });
  if (error) {
    logged("archiveKnowledge", error);
    redirect(withToast(`${KB}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(KB, "Document archived"));
}

export async function restoreKnowledgeDocumentAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("knowledge.approve");
  const id = idFrom(formData);
  if (!id) redirect(withToast(KB, NOT_FOUND, "error"));
  const { error } = await db.rpc("restore_record", { p_entity: "knowledge_document", p_id: id });
  if (error) {
    logged("restoreKnowledgeDocument", error);
    redirect(withToast(`${KB}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${KB}/${id}`, "Document restored"));
}

// ── the chat-approve switch (directors) ──────────────────────

export async function setKnowledgeChatApproveAction(enabled: boolean): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  if (typeof enabled !== "boolean") return fail(GENERIC);
  const { data, error } = await db.from("settings").update({ value: enabled }).eq("key", "knowledge_chat_approve_enabled").select("key");
  if (error || !data?.length) {
    console.error("[hq] changing knowledge_chat_approve_enabled failed:", error?.code);
    return fail(GENERIC);
  }
  revalidatePath(`${HQ_BASE}/settings`, "layout");
  return succeed(enabled ? "Approving knowledge from chat is on." : "Approving knowledge from chat is off.");
}
