import "server-only";

import type { HqClient } from "../db";
import { parseKnowledgeRef, searchWords, type KnowledgeCategory, type KnowledgeListQuery, type KnowledgeStatus, type VersionStatus } from "./rules";

/*
 * Reads for the knowledge screens (and the MCP tools). Every query runs as the signed-in person, so
 * row level security is the control: without knowledge.read nothing comes back; a reader gets the
 * approved text (or the draft of a never-approved document, flagged); only knowledge.write holders get
 * a pending draft and the full version history; archived documents only knowledge.approve holders.
 *
 * Nothing here logs more than an error code.
 */

export type Result<T> = { ok: true; data: T } | { ok: false };

export type KnowledgeRow = {
  id: string;
  ref: string;
  refNumber: number;
  title: string;
  category: KnowledgeCategory;
  summary: string | null;
  status: KnowledgeStatus;
  statusLabel: string;
  ownerId: string | null;
  ownerName: string | null;
  approvedVersion: number | null;
  currentVersion: number;
  hasPendingDraft: boolean;
  readingVersion: number;
  readingIsDraft: boolean;
  /** The reading text (approved, or the never-approved draft). Only filled when asked for. */
  body: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  reviewDue: string | null;
  reviewOverdue: boolean;
  reviewState: "overdue" | "due_soon" | null;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

const LIST_COLUMNS =
  "id, ref, ref_number, title, category, summary, status, status_label, owner_id, owner_name, approved_version, current_version, has_pending_draft, reading_version, reading_is_draft, approved_at, approved_by_name, review_due, review_overdue, review_state, is_template, created_at, updated_at, deleted_at";
export const OVERVIEW_COLUMNS = LIST_COLUMNS;
export const OVERVIEW_COLUMNS_WITH_BODY = `${LIST_COLUMNS}, body`;

type OverviewRow = {
  id: string | null;
  ref: string | null;
  ref_number: number | null;
  title: string | null;
  category: KnowledgeCategory | null;
  summary: string | null;
  status: KnowledgeStatus | null;
  status_label: string | null;
  owner_id: string | null;
  owner_name: string | null;
  approved_version: number | null;
  current_version: number | null;
  has_pending_draft: boolean | null;
  reading_version: number | null;
  reading_is_draft: boolean | null;
  body?: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  review_due: string | null;
  review_overdue: boolean | null;
  review_state: string | null;
  is_template: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export function toKnowledgeRow(r: OverviewRow): KnowledgeRow | null {
  if (!r.id || !r.ref || r.ref_number === null || !r.title || !r.category || !r.status || r.current_version === null || !r.created_at || !r.updated_at) return null;
  return {
    id: r.id,
    ref: r.ref,
    refNumber: r.ref_number,
    title: r.title,
    category: r.category,
    summary: r.summary,
    status: r.status,
    statusLabel: r.status_label ?? "",
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    approvedVersion: r.approved_version,
    currentVersion: r.current_version,
    hasPendingDraft: !!r.has_pending_draft,
    readingVersion: r.reading_version ?? r.current_version,
    readingIsDraft: !!r.reading_is_draft,
    body: r.body ?? null,
    approvedAt: r.approved_at,
    approvedByName: r.approved_by_name,
    reviewDue: r.review_due,
    reviewOverdue: !!r.review_overdue,
    reviewState: r.review_state === "overdue" || r.review_state === "due_soon" ? r.review_state : null,
    isTemplate: !!r.is_template,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.deleted_at !== null,
  };
}

export const rowsOf = (data: unknown): KnowledgeRow[] => ((data ?? []) as OverviewRow[]).map(toKnowledgeRow).filter((r): r is KnowledgeRow => r !== null);

export type KnowledgeFilters = Pick<KnowledgeListQuery, "q" | "category" | "status" | "reviewDue" | "owner">;

/**
 * The live documents, by category then title (most recently changed first when searching). Search
 * matches words in the title, the summary and the reading text; a KB-0001 ref finds that document.
 */
export async function listKnowledge(
  db: HqClient,
  f: Partial<KnowledgeFilters>,
  page: { offset: number; limit: number },
  opts: { withBody?: boolean } = {},
): Promise<Result<{ rows: KnowledgeRow[]; total: number }>> {
  let q = db.from("knowledge_overview").select(opts.withBody || f.q ? OVERVIEW_COLUMNS_WITH_BODY : OVERVIEW_COLUMNS, { count: "exact" }).is("deleted_at", null);
  const ref = f.q ? parseKnowledgeRef(f.q) : null;
  if (ref !== null) q = q.eq("ref_number", ref);
  else if (f.q) {
    const w = searchWords(f.q);
    if (w) q = q.or(`title.ilike.*${w}*,summary.ilike.*${w}*,body.ilike.*${w}*`);
  }
  if (f.category) q = q.eq("category", f.category);
  if (f.status === "approved") q = q.not("approved_version", "is", null);
  if (f.status === "draft") q = q.is("approved_version", null);
  if (f.status === "waiting") q = q.eq("has_pending_draft", true).eq("is_template", false);
  if (f.reviewDue) q = q.not("review_state", "is", null);
  if (f.owner) q = q.eq("owner_id", f.owner);
  q = f.q ? q.order("updated_at", { ascending: false }) : q.order("category").order("title");
  const { data, error, count } = await q.range(page.offset, page.offset + page.limit - 1);
  if (error) {
    if (error.code === "PGRST103") return { ok: true, data: { rows: [], total: count ?? 0 } };
    console.error("[hq] listKnowledge failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: rowsOf(data), total: count ?? 0 } };
}

export type VersionRow = {
  id: number;
  version: number;
  title: string;
  summary: string | null;
  body: string | null;
  basedOnVersion: number | null;
  status: VersionStatus;
  editedById: string | null;
  editedByName: string | null;
  editedAt: string;
  via: "hq" | "mcp";
  changeNote: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvedVia: "hq" | "mcp" | null;
  discardedAt: string | null;
};

const VERSION_META = "id, version, title, summary, based_on_version, status, edited_by, edited_by_name, edited_at, via, change_note, approved_by_name, approved_at, approved_via, discarded_at";

type VRow = {
  id: number;
  version: number;
  title: string;
  summary: string | null;
  body?: string | null;
  based_on_version: number | null;
  status: VersionStatus;
  edited_by: string | null;
  edited_by_name: string | null;
  edited_at: string;
  via: string;
  change_note: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approved_via: string | null;
  discarded_at: string | null;
};

const toVersion = (v: VRow): VersionRow => ({
  id: v.id,
  version: v.version,
  title: v.title,
  summary: v.summary,
  body: v.body ?? null,
  basedOnVersion: v.based_on_version,
  status: v.status,
  editedById: v.edited_by,
  editedByName: v.edited_by_name,
  editedAt: v.edited_at,
  via: v.via === "mcp" ? "mcp" : "hq",
  changeNote: v.change_note,
  approvedByName: v.approved_by_name,
  approvedAt: v.approved_at,
  approvedVia: v.approved_via === "mcp" ? "mcp" : v.approved_via === "hq" ? "hq" : null,
  discardedAt: v.discarded_at,
});

/** The versions of a document this person may see (RLS), newest first, without their text. */
export async function listVersions(db: HqClient, documentId: string, limit = 200): Promise<Result<VersionRow[]>> {
  const { data, error } = await db.from("knowledge_versions").select(VERSION_META).eq("document_id", documentId).order("version", { ascending: false }).limit(limit);
  if (error) {
    console.error("[hq] listVersions failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: ((data ?? []) as VRow[]).map(toVersion) };
}

/** One version with its text, if this person may see it. */
export async function getVersion(db: HqClient, documentId: string, version: number): Promise<Result<VersionRow | null>> {
  const { data, error } = await db.from("knowledge_versions").select(`${VERSION_META}, body`).eq("document_id", documentId).eq("version", version).maybeSingle();
  if (error) {
    console.error("[hq] getVersion failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: data ? toVersion(data as VRow) : null };
}

/** The version before `version` that this person may see (for a diff), with its text. */
export async function previousVersion(db: HqClient, documentId: string, version: number): Promise<Result<VersionRow | null>> {
  const { data, error } = await db
    .from("knowledge_versions")
    .select(`${VERSION_META}, body`)
    .eq("document_id", documentId)
    .lt("version", version)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[hq] previousVersion failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: data ? toVersion(data as VRow) : null };
}

export type KnowledgeDetail = {
  doc: KnowledgeRow;
  /** The pending draft (knowledge.write holders only, by RLS), with its text; null when none or not visible. */
  draft: VersionRow | null;
  versions: VersionRow[];
};

/** One document by id (archived ones only for knowledge.approve holders, by RLS), its pending draft and its history. */
export async function getKnowledge(db: HqClient, id: string): Promise<Result<KnowledgeDetail | null>> {
  const one = await db.from("knowledge_overview").select(OVERVIEW_COLUMNS_WITH_BODY).eq("id", id).maybeSingle();
  if (one.error) {
    console.error("[hq] getKnowledge failed:", one.error.code);
    return { ok: false };
  }
  const doc = one.data ? toKnowledgeRow(one.data as OverviewRow) : null;
  if (!doc) return { ok: true, data: null };
  const versions = await listVersions(db, id);
  if (!versions.ok) return { ok: false };
  let draft: VersionRow | null = null;
  if (doc.approvedVersion !== null && doc.hasPendingDraft) {
    const d = await getVersion(db, id, doc.currentVersion);
    if (!d.ok) return { ok: false };
    draft = d.data && d.data.status === "draft" ? d.data : null;
  }
  return { ok: true, data: { doc, draft, versions: versions.data } };
}

/** Documents with a draft waiting for approval (an approved document with a newer draft, or a written, never-approved one). */
export async function waitingForApproval(db: HqClient, limit = 5): Promise<Result<{ rows: KnowledgeRow[]; total: number }>> {
  const { data, error, count } = await db
    .from("knowledge_overview")
    .select(OVERVIEW_COLUMNS, { count: "exact" })
    .is("deleted_at", null)
    .eq("has_pending_draft", true)
    .eq("is_template", false)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[hq] waitingForApproval failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: rowsOf(data), total: count ?? 0 } };
}

/** The chat-approve switch (any staff may read settings). */
export async function loadKnowledgeSettings(db: HqClient): Promise<Result<{ chatApprove: boolean }>> {
  const { data, error } = await db.from("settings").select("value").eq("key", "knowledge_chat_approve_enabled").maybeSingle();
  if (error) {
    console.error("[hq] loadKnowledgeSettings failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { chatApprove: data?.value === true } };
}
