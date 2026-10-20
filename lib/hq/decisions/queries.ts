import "server-only";

import type { HqClient } from "../db";
import { parseDecisionRef, searchWords, type DecisionCategory, type DecisionListQuery, type DecisionStatus, type HistoryAction } from "./rules";

/*
 * Reads for the decision screens (and the MCP tools). Every query runs as the signed-in person, so
 * row level security is the control: without decisions.read nothing comes back; archived decisions
 * reach only decisions.write holders, and the lists filter them out. Linked tasks are read through
 * hq.tasks under the reader's own rules, so a task they may not see is never named or counted.
 *
 * Nothing here logs more than an error code.
 */

export type Result<T> = { ok: true; data: T } | { ok: false };

export type DecisionRow = {
  id: string;
  ref: string;
  refNumber: number;
  title: string;
  description: string | null;
  rationale: string | null;
  category: DecisionCategory;
  status: DecisionStatus;
  decisionDate: string;
  decisionMakerId: string;
  decisionMakerName: string | null;
  supersededById: string | null;
  supersededByRef: string | null;
  supersededByTitle: string | null;
  reversedNote: string | null;
  linkedTaskCount: number;
  openLinkedTaskCount: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export const OVERVIEW_COLUMNS =
  "id, ref, ref_number, title, description, rationale, category, status, decision_date, decision_maker_id, decision_maker_name, superseded_by_id, superseded_by_ref, superseded_by_title, reversed_note, linked_task_count, open_linked_task_count, created_at, updated_at, deleted_at";

type OverviewRow = {
  id: string | null;
  ref: string | null;
  ref_number: number | null;
  title: string | null;
  description: string | null;
  rationale: string | null;
  category: DecisionCategory | null;
  status: DecisionStatus | null;
  decision_date: string | null;
  decision_maker_id: string | null;
  decision_maker_name: string | null;
  superseded_by_id: string | null;
  superseded_by_ref: string | null;
  superseded_by_title: string | null;
  reversed_note: string | null;
  linked_task_count: number | null;
  open_linked_task_count: number | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export function toDecisionRow(r: OverviewRow): DecisionRow | null {
  if (!r.id || !r.ref || r.ref_number === null || !r.title || !r.category || !r.status || !r.decision_date || !r.decision_maker_id || !r.created_at || !r.updated_at) return null;
  return {
    id: r.id,
    ref: r.ref,
    refNumber: r.ref_number,
    title: r.title,
    description: r.description,
    rationale: r.rationale,
    category: r.category,
    status: r.status,
    decisionDate: r.decision_date,
    decisionMakerId: r.decision_maker_id,
    decisionMakerName: r.decision_maker_name,
    supersededById: r.superseded_by_id,
    supersededByRef: r.superseded_by_ref,
    supersededByTitle: r.superseded_by_title,
    reversedNote: r.reversed_note,
    linkedTaskCount: Number(r.linked_task_count ?? 0),
    openLinkedTaskCount: Number(r.open_linked_task_count ?? 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.deleted_at !== null,
  };
}

const rowsOf = (data: unknown): DecisionRow[] => ((data ?? []) as OverviewRow[]).map(toDecisionRow).filter((r): r is DecisionRow => r !== null);

export type DecisionFilters = Pick<DecisionListQuery, "q" | "category" | "status" | "maker" | "from" | "to">;

/**
 * The register, newest decision first (decision date, then number). Search matches the words in the
 * title, what was decided and why; a DEC-0001 ref finds that decision.
 */
export async function listDecisions(
  db: HqClient,
  f: Partial<DecisionFilters>,
  page: { offset: number; limit: number },
): Promise<Result<{ rows: DecisionRow[]; total: number }>> {
  let q = db.from("decision_overview").select(OVERVIEW_COLUMNS, { count: "exact" }).is("deleted_at", null);
  const ref = f.q ? parseDecisionRef(f.q) : null;
  if (ref !== null) q = q.eq("ref_number", ref);
  else if (f.q) {
    const w = searchWords(f.q);
    if (w) q = q.or(`title.ilike.*${w}*,description.ilike.*${w}*,rationale.ilike.*${w}*`);
  }
  if (f.category) q = q.eq("category", f.category);
  if (f.status) q = q.eq("status", f.status);
  if (f.maker) q = q.eq("decision_maker_id", f.maker);
  if (f.from) q = q.gte("decision_date", f.from);
  if (f.to) q = q.lte("decision_date", f.to);
  const { data, error, count } = await q
    .order("decision_date", { ascending: false })
    .order("ref_number", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) {
    // PGRST103: a page past the end. Treat as empty rather than an error.
    if (error.code === "PGRST103") return { ok: true, data: { rows: [], total: count ?? 0 } };
    console.error("[hq] listDecisions failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: rowsOf(data), total: count ?? 0 } };
}

export type HistoryEntry = {
  id: number;
  at: string;
  byId: string | null;
  byName: string | null;
  action: HistoryAction;
  summary: string;
  changes: Record<string, { from?: unknown; to?: unknown }>;
  note: string | null;
};

export type LinkedTask = { id: string; title: string; status: string; dueDate: string | null; assignedToName: string | null };

export type DecisionDetail = {
  decision: DecisionRow;
  /** Decisions this one supersedes (they point at it). */
  supersedes: { id: string; ref: string; title: string; decisionDate: string }[];
  history: HistoryEntry[];
  /** Only the linked tasks this person can see. */
  tasks: LinkedTask[];
  /** Links whose task this person cannot see (counted, never named). */
  hiddenTaskCount: number;
};

/** One decision by id (archived ones only for decisions.write holders, by RLS), with its history, supersession and tasks. */
export async function getDecision(db: HqClient, id: string, opts: { historyLimit?: number } = {}): Promise<Result<DecisionDetail | null>> {
  const one = await db.from("decision_overview").select(OVERVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (one.error) {
    console.error("[hq] getDecision failed:", one.error.code);
    return { ok: false };
  }
  const decision = one.data ? toDecisionRow(one.data as OverviewRow) : null;
  if (!decision) return { ok: true, data: null };

  const [sup, hist, links] = await Promise.all([
    db.from("decision_overview").select("id, ref, title, decision_date").eq("superseded_by_id", id).is("deleted_at", null).order("decision_date", { ascending: false }).limit(50),
    db
      .from("decision_history")
      .select("id, changed_at, changed_by, changed_by_name, action, summary, changes, note")
      .eq("decision_id", id)
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(opts.historyLimit ?? 200),
    db.from("decision_tasks").select("task_id, linked_at").eq("decision_id", id).order("linked_at", { ascending: true }).limit(200),
  ]);
  if (sup.error || hist.error || links.error) {
    console.error("[hq] getDecision parts failed:", sup.error?.code ?? hist.error?.code ?? links.error?.code);
    return { ok: false };
  }

  const taskIds = (links.data ?? []).map((l) => l.task_id);
  let tasks: LinkedTask[] = [];
  if (taskIds.length > 0) {
    const t = await db.from("tasks").select("id, title, status, due_date, assigned_to").in("id", taskIds).is("deleted_at", null);
    if (t.error) {
      console.error("[hq] getDecision tasks failed:", t.error.code);
      return { ok: false };
    }
    const assignees = [...new Set((t.data ?? []).map((x) => x.assigned_to).filter((x): x is string => !!x))];
    const names = new Map<string, string>();
    if (assignees.length) {
      const s = await db.from("staff_profiles").select("id, full_name").in("id", assignees);
      for (const r of s.data ?? []) names.set(r.id, r.full_name);
    }
    const order = new Map(taskIds.map((tid, i) => [tid, i]));
    tasks = (t.data ?? [])
      .map((x) => ({ id: x.id, title: x.title, status: x.status, dueDate: x.due_date, assignedToName: x.assigned_to ? (names.get(x.assigned_to) ?? null) : null }))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  return {
    ok: true,
    data: {
      decision,
      supersedes: (sup.data ?? [])
        .filter((s): s is { id: string; ref: string; title: string; decision_date: string } => !!(s.id && s.ref && s.title && s.decision_date))
        .map((s) => ({ id: s.id, ref: s.ref, title: s.title, decisionDate: s.decision_date })),
      history: (hist.data ?? []).map((h) => ({
        id: h.id,
        at: h.changed_at,
        byId: h.changed_by,
        byName: h.changed_by_name,
        action: h.action as HistoryAction,
        summary: h.summary,
        changes: (h.changes && typeof h.changes === "object" && !Array.isArray(h.changes) ? h.changes : {}) as HistoryEntry["changes"],
        note: h.note,
      })),
      tasks,
      hiddenTaskCount: Math.max(0, taskIds.length - tasks.length),
    },
  };
}

/** Live decisions in force (for "superseded by"): not this one, not superseded or reversed, newest first. */
export async function supersedeCandidates(db: HqClient, exceptId: string): Promise<{ value: string; label: string }[]> {
  const { data, error } = await db
    .from("decision_overview")
    .select("id, ref, title")
    .is("deleted_at", null)
    .in("status", ["proposed", "decided", "in_effect"])
    .neq("id", exceptId)
    .order("decision_date", { ascending: false })
    .order("ref_number", { ascending: false })
    .limit(300);
  if (error) {
    console.error("[hq] supersedeCandidates failed:", error.code);
    return [];
  }
  return (data ?? []).filter((d) => d.id && d.ref && d.title).map((d) => ({ value: d.id as string, label: `${d.ref} ${d.title}` }));
}

/** The most recent live decisions (for Reports). */
export async function recentDecisions(db: HqClient, limit = 5): Promise<Result<DecisionRow[]>> {
  const r = await listDecisions(db, {}, { offset: 0, limit });
  return r.ok ? { ok: true, data: r.data.rows } : { ok: false };
}

/** Names of staff (for history entries that changed the decision maker). */
export async function staffNameMap(db: HqClient, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await db.from("staff_profiles").select("id, full_name").in("id", unique);
  if (error) {
    console.error("[hq] staffNameMap failed:", error.code);
    return out;
  }
  for (const r of data ?? []) out.set(r.id, r.full_name);
  return out;
}
