/*
 * The Business Decisions Register: vocabulary and rules shared by the screens, the Server Actions
 * and the MCP tools. They mirror what the database enforces (migration 0125): the database is the
 * control, these give people the same answer earlier and in plain words.
 *
 * Pure, with NO value imports on purpose: the unit tests run under Node's type stripping, which needs
 * ".ts" in relative imports, and the project's tsconfig rejects that in source files (see
 * lib/hq/tasks/rules.ts). The FormReader is passed in; only its type is imported.
 */
import type { FormReader } from "../forms";

// ── vocabulary (values MUST match hq.decision_category / hq.decision_status) ──

export const DECISION_CATEGORIES = [
  "strategy",
  "finance",
  "people",
  "operations",
  "partners",
  "marketing",
  "technology",
  "legal_compliance",
  "service_offering",
  "other",
] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export const DECISION_CATEGORY_LABEL: Record<DecisionCategory, string> = {
  strategy: "Strategy",
  finance: "Finance",
  people: "People",
  operations: "Operations",
  partners: "Partners",
  marketing: "Marketing",
  technology: "Technology",
  legal_compliance: "Legal and compliance",
  service_offering: "Service offering",
  other: "Other",
};

export const DECISION_STATUSES = ["proposed", "decided", "in_effect", "superseded", "reversed"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: "Proposed",
  decided: "Decided",
  in_effect: "In effect",
  superseded: "Superseded",
  reversed: "Reversed",
};

/** Statuses a decision can be recorded with, and moved between freely. */
export const OPEN_DECISION_STATUSES = ["proposed", "decided", "in_effect"] as const satisfies readonly DecisionStatus[];
export type OpenDecisionStatus = (typeof OPEN_DECISION_STATUSES)[number];

export const TITLE_MAX = 200;
export const TEXT_MAX = 5000;
export const NOTE_MAX = 1000;
/** A decision date can be at most this many days after today. */
export const FUTURE_DAYS = 7;
export const MIN_DATE = "1990-01-01";
export const LIST_PAGE_SIZE = 25;

export const isDecisionStatus = (v: unknown): v is DecisionStatus => typeof v === "string" && (DECISION_STATUSES as readonly string[]).includes(v);
export const isDecisionCategory = (v: unknown): v is DecisionCategory => typeof v === "string" && (DECISION_CATEGORIES as readonly string[]).includes(v);
export const isOpenStatus = (s: DecisionStatus): s is OpenDecisionStatus => (OPEN_DECISION_STATUSES as readonly string[]).includes(s);
/** Superseded and reversed decisions are closed: their status never changes again. */
export const isClosedStatus = (s: DecisionStatus): boolean => s === "superseded" || s === "reversed";

/** The dot-and-label tone for a status (StatusChip tones). */
export function decisionStatusTone(s: DecisionStatus): "neutral" | "info" | "success" | "warning" | "error" {
  switch (s) {
    case "proposed":
      return "info";
    case "decided":
    case "in_effect":
      return "success";
    case "superseded":
      return "neutral";
    case "reversed":
      return "warning";
  }
}

// ── refs: DEC-0001 ───────────────────────────────────────────

/** "DEC-0007"; never truncates a long number ("DEC-123456"). */
export function decisionRef(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  return `DEC-${String(n).padStart(4, "0")}`;
}

/** The number in "DEC-0007", "dec 7", "DEC7" or "#7"-free forms; null when it is not a ref. */
export function parseDecisionRef(input: string | null | undefined): number | null {
  const m = /^\s*dec(?:ision)?[-\s#]*0*(\d{1,9})\s*$/i.exec(input ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── dates ────────────────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD plus n days. */
export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** The latest decision date allowed today (today + 7). */
export function maxDecisionDate(today: string): string {
  return addDays(today, FUTURE_DAYS);
}

/** A plain reason a decision date is not allowed, or null. */
export function decisionDateProblem(date: string, today: string): string | null {
  if (!DATE.test(date)) return "Enter a valid date.";
  if (date > maxDecisionDate(today)) return `A decision date can be at most ${FUTURE_DAYS} days ahead.`;
  if (date < MIN_DATE) return "That date is too far in the past.";
  return null;
}

// ── status rules ─────────────────────────────────────────────

export type StatusChange = { from: DecisionStatus; to: DecisionStatus; note: string | null; supersededBy: string | null; selfId?: string };

/**
 * Why a status change would be refused, or null when it is allowed. The same rules as
 * hq.update_decision: open statuses move freely; reversed needs a note; superseded needs the
 * decision that replaces it (not itself) and a note; superseded and reversed are closed.
 */
export function statusChangeProblem(c: StatusChange): string | null {
  if (c.from === c.to && !(c.to === "superseded" && c.supersededBy)) return null;
  if (isClosedStatus(c.from)) return `This decision is ${DECISION_STATUS_LABEL[c.from].toLowerCase()}, so its status can no longer change. Record a new decision instead.`;
  if (c.to === "superseded") {
    if (!c.supersededBy) return "Say which decision replaces this one.";
    if (c.selfId && c.supersededBy.toLowerCase() === c.selfId.toLowerCase()) return "A decision cannot supersede itself.";
    if (!c.note || !c.note.trim()) return "A note is required to supersede a decision.";
  }
  if (c.to === "reversed" && (!c.note || !c.note.trim())) return "A note is required to reverse a decision.";
  return null;
}

/** The statuses the edit form offers for a decision now: the open statuses, or none once closed. */
export function editableStatuses(current: DecisionStatus): OpenDecisionStatus[] {
  return isClosedStatus(current) ? [] : [...OPEN_DECISION_STATUSES];
}

// ── the form ─────────────────────────────────────────────────

export const DECISION_FORM_LABELS: Record<string, string> = {
  title: "Decision",
  category: "Category",
  decision_date: "Decision date",
  status: "Status",
  decision_maker_id: "Decision maker",
  description: "What was decided",
  rationale: "Why",
  note: "Note",
};

export type DecisionFormValues = {
  title: string;
  category: DecisionCategory | null;
  decisionDate: string | null;
  status: OpenDecisionStatus | null;
  decisionMakerId: string | null;
  description: string | null;
  rationale: string | null;
  note: string | null;
};

/**
 * Reads the decision form (create and edit) with the HQ FormReader and adds the date rule. Status
 * is optional on edit when the decision is closed (the form then sends none).
 */
export function readDecisionFields(reader: FormReader, today: string, opts: { statusRequired: boolean }): DecisionFormValues {
  const title = reader.requiredText("title", { max: TITLE_MAX, label: "The decision" });
  const category = reader.oneOf("category", DECISION_CATEGORIES, { required: true });
  const decisionDate = reader.date("decision_date", { required: true });
  if (decisionDate) {
    const problem = decisionDateProblem(decisionDate, today);
    if (problem) reader.errors.decision_date = problem;
  }
  const status = reader.oneOf("status", OPEN_DECISION_STATUSES, { required: opts.statusRequired });
  const decisionMakerId = reader.uuid("decision_maker_id", { required: true, label: "The decision maker" });
  const description = reader.text("description", { max: TEXT_MAX, label: "What was decided" });
  const rationale = reader.text("rationale", { max: TEXT_MAX, label: "Why" });
  const note = reader.text("note", { max: NOTE_MAX, label: "The note" });
  return { title, category, decisionDate, status, decisionMakerId: decisionMakerId ? decisionMakerId.toLowerCase() : null, description, rationale, note };
}

// ── the list's URL ───────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DecisionListQuery = {
  q: string;
  category: DecisionCategory | null;
  status: DecisionStatus | null;
  maker: string | null;
  from: string | null;
  to: string | null;
  page: number;
  /** Any filter or search applied. */
  filtered: boolean;
  /** One of the filters behind the Filter button (not the search box) is applied. */
  moreActive: boolean;
};

function dateParam(v: string): string | null {
  if (!DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** The list's search params, each checked; anything malformed is dropped, never passed on. */
export function parseDecisionListQuery(sp: Params): DecisionListQuery {
  const q = first(sp.q).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, 100);
  const category = isDecisionCategory(first(sp.category)) ? (first(sp.category) as DecisionCategory) : null;
  const status = isDecisionStatus(first(sp.status)) ? (first(sp.status) as DecisionStatus) : null;
  const makerRaw = first(sp.maker);
  const maker = UUID.test(makerRaw) ? makerRaw.toLowerCase() : null;
  let from = dateParam(first(sp.from));
  let to = dateParam(first(sp.to));
  if (from && to && from > to) [from, to] = [to, from];
  const pageN = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageN) ? Math.min(10_000, Math.max(1, pageN)) : 1;
  const moreActive = !!(category || status || maker || from || to);
  return { q, category, status, maker, from, to, page, filtered: moreActive || q !== "", moreActive };
}

/** Search words made safe for a PostgREST `or=(...ilike...)` filter: wildcards and filter punctuation out. */
export function searchWords(q: string): string {
  return q.replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

// ── history ──────────────────────────────────────────────────

export const HISTORY_ACTIONS = ["create", "update", "status_change", "supersede", "supersedes", "reverse", "link_task", "unlink_task", "archive", "restore"] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

/** Field names in a history row's `changes`, in words. */
export const HISTORY_FIELD_LABEL: Record<string, string> = {
  title: "Wording",
  description: "Details",
  rationale: "Reasons",
  category: "Category",
  decision_date: "Decision date",
  decision_maker_id: "Decision maker",
  status: "Status",
  superseded_by: "Superseded by",
};

/** A value from a history row's `changes`, as a person reads it. */
export function historyValue(field: string, value: unknown, names: (id: string) => string | null): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (field === "status" && isDecisionStatus(value)) return DECISION_STATUS_LABEL[value];
  if (field === "category" && isDecisionCategory(value)) return DECISION_CATEGORY_LABEL[value];
  if (field === "decision_maker_id" && typeof value === "string") return names(value) ?? "a colleague";
  return String(value);
}
