/*
 * The Knowledge base: vocabulary and rules shared by the screens, the Server Actions and the MCP
 * tools. They mirror what the database enforces (migration 0138): the database is the control, these
 * give people the same answer earlier and in plain words.
 *
 * THE RULE: approved content never changes silently. Every edit saves a new DRAFT version; readers keep
 * the approved one until a person with knowledge.approve approves the draft.
 *
 * Pure, with NO value imports on purpose (Node's type-stripping test runner; see lib/hq/tasks/rules.ts).
 * The FormReader is passed in; only its type is imported.
 */
import type { FormReader } from "../forms";

// ── vocabulary (values MUST match hq.knowledge_category / hq.knowledge_status) ──

export const KNOWLEDGE_CATEGORIES = [
  "company_procedure",
  "contractor_vetting",
  "referral_partner",
  "landlord_onboarding",
  "staff_policy",
  "operational_checklist",
  "brand_voice",
  "general",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  company_procedure: "Company procedures",
  contractor_vetting: "Contractor vetting",
  referral_partner: "Referral partners",
  landlord_onboarding: "Landlord onboarding",
  staff_policy: "Staff policies",
  operational_checklist: "Operational checklists",
  brand_voice: "Brand, voice and vision",
  general: "General",
};

export const KNOWLEDGE_STATUSES = ["draft", "approved", "archived"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const VERSION_STATUSES = ["draft", "approved", "superseded", "discarded"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

/** The status filter on the list: what a person means, not the stored value. */
export const STATUS_FILTERS = ["approved", "draft", "waiting"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  approved: "Approved",
  draft: "Draft, never approved",
  waiting: "Waiting for approval",
};

export const TITLE_MAX = 200;
export const SUMMARY_MAX = 500;
export const BODY_MAX = 50_000;
export const NOTE_MAX = 300;
/** A review date may be set up to this many days ahead (five years; the database's rule). */
export const REVIEW_MAX_DAYS = 1826;
/** "Review due" means overdue or due within this many days. */
export const REVIEW_SOON_DAYS = 30;
export const LIST_PAGE_SIZE = 25;

export const isKnowledgeCategory = (v: unknown): v is KnowledgeCategory => typeof v === "string" && (KNOWLEDGE_CATEGORIES as readonly string[]).includes(v);
export const isVersionStatus = (v: unknown): v is VersionStatus => typeof v === "string" && (VERSION_STATUSES as readonly string[]).includes(v);

// ── how a document reads ─────────────────────────────────────

export type DocState = { approvedVersion: number | null; currentVersion: number; archived?: boolean };

/** "Approved", "Draft" or "Approved, newer draft waiting" (the database's status_label, the same rule). */
export function statusLabel(d: DocState): string {
  if (d.archived) return "Archived";
  if (d.approvedVersion === null) return "Draft";
  return d.currentVersion > d.approvedVersion ? "Approved, newer draft waiting" : "Approved";
}

export function statusTone(d: DocState): "neutral" | "info" | "success" | "warning" {
  if (d.archived) return "neutral";
  if (d.approvedVersion === null) return "warning";
  return d.currentVersion > d.approvedVersion ? "info" : "success";
}

export const hasPendingDraft = (d: DocState): boolean => d.approvedVersion === null || d.currentVersion > d.approvedVersion;

/** What a version's status means, in words. A superseded version that was once approved reads "Previously approved". */
export function versionLabel(status: VersionStatus, wasApproved: boolean): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "approved":
      return "Approved";
    case "discarded":
      return "Discarded";
    case "superseded":
      return wasApproved ? "Previously approved" : "Replaced by a later draft";
  }
}

export function versionTone(status: VersionStatus): "neutral" | "info" | "success" | "warning" {
  return status === "approved" ? "success" : status === "draft" ? "info" : "neutral";
}

// ── refs: KB-0001 ────────────────────────────────────────────

export function knowledgeRef(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  return `KB-${String(n).padStart(4, "0")}`;
}

/** The number in "KB-0007", "kb 7", "KB7"; null when it is not a ref. */
export function parseKnowledgeRef(input: string | null | undefined): number | null {
  const m = /^\s*kb[-\s#]*0*(\d{1,9})\s*$/i.exec(input ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── dates ────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** The same rule as the database: a review date someone sets is today or later, at most five years ahead. */
export function reviewDateProblem(date: string, today: string): string | null {
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return "Enter a valid date.";
  if (date < today) return "A review date is today or later.";
  if (date > addDays(today, REVIEW_MAX_DAYS)) return "A review date can be at most five years ahead.";
  return null;
}

/** "overdue" (before today), "due_soon" (today to 30 days ahead) or null. */
export function reviewState(reviewDue: string | null, today: string): "overdue" | "due_soon" | null {
  if (!reviewDue) return null;
  if (reviewDue < today) return "overdue";
  if (reviewDue <= addDays(today, REVIEW_SOON_DAYS)) return "due_soon";
  return null;
}

// ── text ─────────────────────────────────────────────────────

/** The body as the database stores it: CR LF to LF, control characters (but tabs and newlines) out, trimmed. */
export function normaliseBody(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/^[ \t\n]+|[ \t\n]+$/g, "");
}

/** One line as the database stores it (title, summary, note). */
export function normaliseLine(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/ {2,}/g, " ").trim();
}

/** Search words made safe for a PostgREST `or=(...ilike...)` filter. */
export function searchWords(q: string): string {
  return q.replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** A short excerpt around the first place `words` appear in `text` (markdown marks removed), or its start. */
export function excerpt(text: string | null | undefined, words: string, max = 180): string {
  const plain = (text ?? "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*]\s+\[[ xX]\]|[-*]|\d+[.)])\s+/gm, "")
    .replace(/\*\*|__|\*/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const at = words ? plain.toLowerCase().indexOf(words.toLowerCase()) : -1;
  const start = at > 60 ? at - 60 : 0;
  const cut = plain.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${cut}${start + max < plain.length ? "…" : ""}`;
}

// ── the form ─────────────────────────────────────────────────

export const KNOWLEDGE_FORM_LABELS: Record<string, string> = {
  title: "Title",
  category: "Category",
  summary: "Summary",
  owner_id: "Owner",
  review_due: "Review date",
  body: "Text",
  change_note: "What changed",
};

export type KnowledgeFormValues = {
  title: string;
  category: KnowledgeCategory | null;
  summary: string | null;
  ownerId: string | null;
  reviewDue: string | null;
  body: string;
  changeNote: string | null;
};

/**
 * Reads the document form (create and edit). On edit a change note is required (it goes into the
 * version history). A review date is checked only when it is new or changed (`currentReview`), as
 * the database does: an existing date that has since passed can be kept.
 */
export function readKnowledgeFields(reader: FormReader, today: string, opts: { noteRequired: boolean; currentReview?: string | null }): KnowledgeFormValues {
  const title = reader.requiredText("title", { max: TITLE_MAX, label: "The title" });
  const category = reader.oneOf("category", KNOWLEDGE_CATEGORIES, { required: true });
  const summary = reader.text("summary", { max: SUMMARY_MAX, label: "The summary" });
  const ownerId = reader.uuid("owner_id", { required: true, label: "The owner" });
  const reviewDue = reader.date("review_due");
  if (reviewDue && reviewDue !== (opts.currentReview ?? null)) {
    const problem = reviewDateProblem(reviewDue, today);
    if (problem) reader.errors.review_due = problem;
  }
  const rawBody = reader.requiredText("body", { max: BODY_MAX, label: "The text" });
  const body = rawBody ? normaliseBody(rawBody) : "";
  const changeNote = opts.noteRequired ? reader.requiredText("change_note", { max: NOTE_MAX, label: "What changed" }) : reader.text("change_note", { max: NOTE_MAX, label: "What changed" });
  return {
    title: title ? normaliseLine(title) : "",
    category,
    summary: summary ? normaliseLine(summary) : null,
    ownerId: ownerId ? ownerId.toLowerCase() : null,
    reviewDue,
    body,
    changeNote: changeNote ? normaliseLine(changeNote) : null,
  };
}

// ── the list's URL ───────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type KnowledgeListQuery = {
  q: string;
  category: KnowledgeCategory | null;
  status: StatusFilter | null;
  /** Review overdue or due within 30 days. */
  reviewDue: boolean;
  owner: string | null;
  page: number;
  filtered: boolean;
  moreActive: boolean;
};

export function parseKnowledgeListQuery(sp: Params): KnowledgeListQuery {
  const q = first(sp.q).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const category = isKnowledgeCategory(first(sp.category)) ? (first(sp.category) as KnowledgeCategory) : null;
  const statusRaw = first(sp.status);
  const status = (STATUS_FILTERS as readonly string[]).includes(statusRaw) ? (statusRaw as StatusFilter) : null;
  const reviewDue = first(sp.review) === "due";
  const ownerRaw = first(sp.owner);
  const owner = UUID.test(ownerRaw) ? ownerRaw.toLowerCase() : null;
  const pageN = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageN) ? Math.min(10_000, Math.max(1, pageN)) : 1;
  const moreActive = !!(category || status || reviewDue || owner);
  return { q, category, status, reviewDue, owner, page, filtered: moreActive || q !== "", moreActive };
}
