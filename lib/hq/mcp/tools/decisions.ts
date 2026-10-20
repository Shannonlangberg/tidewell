/*
 * The Business Decisions Register over MCP: list, search and open decisions; record one; change one.
 * Reads need decisions.read; writes need decisions.write (directors and administrators). Every
 * query runs as the person (RLS), every write goes through the hq RPCs (create_decision /
 * update_decision), which check the capability again, validate, write the decision's history and
 * the audit trail. The input is re-read with the HQ decision form's own validator first, so the
 * screen and the chat give the same answers. Nothing here archives, restores or deletes.
 */
import { FormReader } from "../../forms";
import {
  DECISION_CATEGORY_LABEL,
  DECISION_FORM_LABELS,
  DECISION_STATUS_LABEL,
  isClosedStatus,
  parseDecisionRef,
  readDecisionFields,
  searchWords,
  statusChangeProblem,
  type DecisionStatus,
} from "../../decisions/rules";
import { OVERVIEW_COLUMNS, toDecisionRow, type DecisionRow } from "../../decisions/queries";
import { LIMITS, candidatesText, changeLine, clean, compose, decideResolution, invalidText, isUuid, notFoundText, result, rowLimit, type Candidate } from "./core";
import { dbFailure, day, defineTool, link, logDb, resolveStaff, respond, today, when, type ToolContext, type ToolResult } from "./kit";
import {
  createDecisionShape,
  getDecisionShape,
  listDecisionsShape,
  searchDecisionsShape,
  updateDecisionShape,
} from "./schemas";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const path = (id: string) => `/hq/decisions/${id}`;
const statusLabel = (s: DecisionStatus) => DECISION_STATUS_LABEL[s] ?? s;

/** One list line (record content: goes inside the data block). */
function line(ctx: ToolContext, d: DecisionRow): string {
  const parts = [
    `${d.ref} ${clean(d.title)}`,
    DECISION_CATEGORY_LABEL[d.category],
    statusLabel(d.status) + (d.status === "superseded" && d.supersededByRef ? ` by ${d.supersededByRef}` : ""),
    `decided ${day(ctx, d.decisionDate)}`,
    d.decisionMakerName ? `by ${clean(d.decisionMakerName)}` : null,
  ].filter(Boolean);
  return `- ${parts.join(" · ")} [id: ${d.id}] ${link(ctx, path(d.id))}`;
}

// ── resolving "DEC-0001", an id or title words ───────────────

type Resolved = { ok: true; decision: DecisionRow; note: string | null } | { ok: false; result: ToolResult };

async function overview(ctx: ToolContext, build: (q: ReturnType<typeof base>) => ReturnType<typeof base>, max: number): Promise<DecisionRow[]> {
  const { data, error } = await build(base(ctx)).limit(max);
  if (error) {
    logDb("decision lookup", error);
    throw new Error(`decision lookup ${error.code ?? ""}`);
  }
  return ((data ?? []) as Parameters<typeof toDecisionRow>[0][]).map(toDecisionRow).filter((d): d is DecisionRow => d !== null);
}
const base = (ctx: ToolContext) => ctx.db.from("decision_overview").select(OVERVIEW_COLUMNS).is("deleted_at", null);

const candidate = (ctx: ToolContext, d: DecisionRow): Candidate => ({ id: d.id, label: `${d.ref} ${d.title}`, detail: `${statusLabel(d.status)}, decided ${day(ctx, d.decisionDate)}` });

/**
 * The decision a person named. A number or id is exact. Words of a title: an exact title (any case)
 * wins; otherwise close matches. Several -> candidates, never a guess; a single close match is
 * accepted for reading but must be confirmed for a write (core.decideResolution).
 */
export async function resolveDecision(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  const q = query.trim();
  const n = parseDecisionRef(q);
  const tagged = /^decision:([0-9a-f-]{36})$/i.exec(q);
  const id = tagged ? tagged[1] : isUuid(q) ? q : null;
  if (n !== null || id) {
    const hit = (await overview(ctx, (b) => (n !== null ? b.eq("ref_number", n) : b.eq("id", id!.toLowerCase())), 1))[0];
    if (hit) return { ok: true, decision: hit, note: null };
    return { ok: false, result: result("not_found", notFoundText("decision", q)) };
  }
  const words = searchWords(q);
  if (words.length < 2) return { ok: false, result: result("not_found", notFoundText("decision", q)) };
  const close = await overview(ctx, (b) => b.ilike("title", `%${words}%`).order("decision_date", { ascending: false }), LIMITS.candidates + 1);
  const exact = close.filter((d) => d.title.trim().toLowerCase() === q.toLowerCase());
  const byId = new Map(close.map((d) => [d.id, d]));
  const r = decideResolution({ exact: exact.map((d) => candidate(ctx, d)), close: close.map((d) => candidate(ctx, d)), mode });
  if (r.kind === "one") {
    const d = byId.get(r.record.id)!;
    return { ok: true, decision: d, note: r.how === "close" ? `No decision is titled exactly "${clean(q, 80)}"; this is the only close match (${d.ref}).` : null };
  }
  if (r.kind === "none") return { ok: false, result: result("not_found", notFoundText("decision", q)) };
  const t = candidatesText("decision", q, r);
  return { ok: false, result: result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: r.candidates.map((c) => ({ id: c.id, label: c.label, detail: c.detail ?? null })) }) };
}

// ── list_decisions ───────────────────────────────────────────

export const listDecisions = defineTool({
  name: "list_decisions",
  title: "List decisions",
  description:
    "Lists decisions from the HQ Business Decisions Register, newest decision first: number (DEC-0001), title, category, status, decision date and decision maker, with HQ links. Filters: status, category, decision maker (\"me\" or a name), since/until dates. Use this (or search_decisions) FIRST for any question about decisions; it answers most questions in one call. Open one decision with get_decision only when the person asks about that specific decision. Read-only.",
  inputSchema: listDecisionsShape,
  annotations: READ,
  capability: "decisions.read",
  kind: "read",
  handler: async (args, ctx) => {
    let maker: { id: string; label: string } | null = null;
    if (args.decision_maker) {
      const who = await resolveStaff(ctx, args.decision_maker, "read");
      if (!who.ok) return who.result;
      maker = { id: who.record.id, label: who.record.label };
    }
    if (args.since && args.until && args.since > args.until) return respond("invalid", "Not done: since is after until. Swap the dates and try again.");
    const max = rowLimit(args.limit);
    let q = ctx.db.from("decision_overview").select(OVERVIEW_COLUMNS, { count: "exact" }).is("deleted_at", null);
    if (args.status) q = q.eq("status", args.status);
    if (args.category) q = q.eq("category", args.category);
    if (maker) q = q.eq("decision_maker_id", maker.id);
    if (args.since) q = q.gte("decision_date", args.since);
    if (args.until) q = q.lte("decision_date", args.until);
    const { data, error, count } = await q.order("decision_date", { ascending: false }).order("ref_number", { ascending: false }).limit(max);
    if (error) return dbFailure("list_decisions", error);
    const rows = ((data ?? []) as Parameters<typeof toDecisionRow>[0][]).map(toDecisionRow).filter((d): d is DecisionRow => d !== null);
    const filters = [
      args.status ? `status ${statusLabel(args.status)}` : null,
      args.category ? `category ${DECISION_CATEGORY_LABEL[args.category]}` : null,
      maker ? `made by ${clean(maker.label)}` : null,
      args.since ? `from ${day(ctx, args.since)}` : null,
      args.until ? `to ${day(ctx, args.until)}` : null,
    ].filter(Boolean);
    const scope = filters.length ? ` (${filters.join(", ")})` : "";
    if (rows.length === 0) return respond("empty", `No decisions found${scope}. Nothing is recorded that matches; the register lists only what people have recorded in HQ.`, null, { count: 0 });
    const total = count ?? rows.length;
    const head = `${total} decision${total === 1 ? "" : "s"}${scope}, newest first${total > rows.length ? `; showing ${rows.length}` : ""}. Full register: ${link(ctx, "/hq/decisions")}`;
    return respond("ok", head, rows.map((d) => line(ctx, d)), { count: rows.length, total, ids: rows.map((d) => d.id) });
  },
});

// ── search_decisions ─────────────────────────────────────────

export const searchDecisions = defineTool({
  name: "search_decisions",
  title: "Search decisions",
  description:
    "Finds decisions whose title, what was decided or why contain the words given (or a number like DEC-0001), newest first, with a short excerpt of the reasons and HQ links. Use this or list_decisions FIRST; open one decision with get_decision only when the person asks about that specific decision. Read-only.",
  inputSchema: searchDecisionsShape,
  annotations: READ,
  capability: "decisions.read",
  kind: "read",
  handler: async (args, ctx) => {
    const max = rowLimit(args.limit);
    const n = parseDecisionRef(args.query);
    const words = searchWords(args.query);
    if (n === null && words.length < 2) return respond("invalid", "Not done: give at least two letters or a number like DEC-0001 to search for.");
    let q = ctx.db.from("decision_overview").select(OVERVIEW_COLUMNS).is("deleted_at", null);
    q = n !== null ? q.eq("ref_number", n) : q.or(`title.ilike.*${words}*,description.ilike.*${words}*,rationale.ilike.*${words}*`);
    const { data, error } = await q.order("decision_date", { ascending: false }).order("ref_number", { ascending: false }).limit(max);
    if (error) return dbFailure("search_decisions", error);
    const rows = ((data ?? []) as Parameters<typeof toDecisionRow>[0][]).map(toDecisionRow).filter((d): d is DecisionRow => d !== null);
    if (rows.length === 0) return respond("empty", `No decisions match "${clean(args.query, 80)}". Try other words, or list_decisions to see the latest.`, null, { count: 0 });
    const lines = rows.flatMap((d) => {
      const why = d.rationale ?? d.description;
      return [line(ctx, d), ...(why ? [`  Why: ${clean(why, 200)}`] : [])];
    });
    return respond("ok", `${rows.length} decision${rows.length === 1 ? "" : "s"} match "${clean(args.query, 80)}", newest first.`, lines, { count: rows.length, ids: rows.map((d) => d.id) });
  },
});

// ── get_decision ─────────────────────────────────────────────

export const getDecision = defineTool({
  name: "get_decision",
  title: "Open a decision",
  description:
    "Opens ONE decision in full, by its number (DEC-0001), id or title words: what was decided, why, category, status, date, decision maker, what it replaces and what replaced it, the tasks linked to it that you can see, and a summary of its recent history, with the HQ link. Use only when the person asks about that specific decision; for several, use list_decisions or search_decisions, never repeated get_decision calls. If the words match several decisions you get the candidates instead. Read-only.",
  inputSchema: getDecisionShape,
  annotations: READ,
  capability: "decisions.read",
  kind: "read",
  handler: async (args, ctx) => {
    const found = await resolveDecision(ctx, args.decision, "read");
    if (!found.ok) return found.result;
    const d = found.decision;
    const [sup, hist, links] = await Promise.all([
      ctx.db.from("decision_overview").select("id, ref, title").eq("superseded_by_id", d.id).is("deleted_at", null).limit(10),
      ctx.db.from("decision_history").select("changed_at, changed_by_name, summary, note").eq("decision_id", d.id).order("changed_at", { ascending: false }).order("id", { ascending: false }).limit(8),
      ctx.db.from("decision_tasks").select("task_id").eq("decision_id", d.id).limit(50),
    ]);
    if (sup.error || hist.error || links.error) return dbFailure("get_decision", sup.error ?? hist.error ?? links.error);
    const taskIds = (links.data ?? []).map((l) => l.task_id);
    const tasks = taskIds.length ? await ctx.db.from("tasks").select("id, title, status, due_date").in("id", taskIds).is("deleted_at", null).limit(50) : { data: [], error: null };
    if (tasks.error) return dbFailure("get_decision tasks", tasks.error);

    const url = link(ctx, path(d.id));
    const lines = [
      `${d.ref}: ${clean(d.title)}`,
      `Status: ${statusLabel(d.status)}${d.status === "superseded" && d.supersededByRef ? ` by ${d.supersededByRef} (${clean(d.supersededByTitle ?? "")})` : ""}`,
      d.status === "reversed" && d.reversedNote ? `Reversed because: ${clean(d.reversedNote, LIMITS.medium)}` : null,
      `Category: ${DECISION_CATEGORY_LABEL[d.category]}`,
      `Decided: ${day(ctx, d.decisionDate)}${d.decisionMakerName ? ` by ${clean(d.decisionMakerName)}` : ""}`,
      `What was decided: ${d.description ? clean(d.description, LIMITS.long, { multiline: true }) : "no more detail recorded"}`,
      `Why: ${d.rationale ? clean(d.rationale, LIMITS.long, { multiline: true }) : "no reasons recorded"}`,
      ...(sup.data ?? []).map((s) => `Replaces: ${s.ref} ${clean(s.title)} [id: ${s.id}]`),
      (tasks.data ?? []).length
        ? `Linked tasks: ${(tasks.data ?? []).map((t) => `${clean(t.title)} (${t.status.replace(/_/g, " ")}${t.due_date ? `, due ${day(ctx, t.due_date)}` : ""}) [id: ${t.id}]`).join("; ")}`
        : "Linked tasks: none you can see",
      taskIds.length > (tasks.data ?? []).length ? `(${taskIds.length - (tasks.data ?? []).length} more linked task(s) are not visible to you or are archived.)` : null,
      "History (newest first):",
      ...(hist.data ?? []).map((h) => `  ${when(ctx, h.changed_at)}${h.changed_by_name ? `, ${clean(h.changed_by_name)}` : ""}: ${clean(h.summary)}${h.note ? ` (note: ${clean(h.note, 200)})` : ""}`),
      `Last changed ${when(ctx, d.updatedAt)}.`,
    ].filter((l): l is string => !!l);
    return respond("ok", [`Decision ${d.ref} [id: ${d.id}]: ${url}`, found.note ?? ""], lines, { id: d.id, ref: d.ref, url, status: d.status });
  },
});

// ── create_decision ──────────────────────────────────────────

function form(values: Record<string, string | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) fd.set(k, v);
  return fd;
}

type RpcDecision = { decision_id?: string; ref?: string; changed?: boolean; changed_fields?: string[] };

/** A refusal from the decision RPCs, in words (their messages are plain English and name no record values). */
function rpcFailure(where: string, error: { code?: string | null; message?: string | null } | null): ToolResult {
  if (error && (error.code === "22023" || error.code === "23514") && error.message) {
    logDb(where, error);
    return result("invalid", `Not saved: ${error.message}. Nothing was changed.`, { code: error.code });
  }
  return dbFailure(where, error, { notFound: "That decision could not be found. It may have been archived. Nothing was changed." });
}

export const createDecision = defineTool({
  name: "create_decision",
  title: "Record a decision",
  description:
    "Records ONE decision in the HQ Business Decisions Register: the decision in one sentence, its category, optional detail (what was decided) and rationale (why), the decision date (default today; at most 7 days ahead), status (proposed, decided by default, or in_effect), and the decision maker (default you; an active staff member). Validated like the HQ decision form, saved as you, with a history row and an audit entry. Returns the new DEC number and HQ link. Before calling, say what will be recorded and make sure the person wants it. It does not record several decisions, archive or delete anything.",
  inputSchema: createDecisionShape,
  annotations: WRITE,
  capability: "decisions.write",
  kind: "write",
  handler: async (args, ctx) => {
    let maker = { id: ctx.staff.id, label: ctx.staff.fullName };
    if (args.decision_maker) {
      const who = await resolveStaff(ctx, args.decision_maker, "write");
      if (!who.ok) return who.result;
      maker = { id: who.record.id, label: who.record.label };
    }
    const reader = new FormReader(
      form({
        title: args.title,
        category: args.category,
        decision_date: args.decision_date ?? today(ctx),
        status: args.status ?? "decided",
        decision_maker_id: maker.id,
        description: args.description,
        rationale: args.rationale,
        note: args.note,
      }),
    );
    const v = readDecisionFields(reader, today(ctx), { statusRequired: true });
    if (!reader.ok) return respond("invalid", invalidText(reader.errors, DECISION_FORM_LABELS));

    const { data, error } = await ctx.db.rpc("create_decision", {
      p_title: v.title,
      p_category: v.category!,
      p_decision_date: v.decisionDate!,
      p_status: v.status!,
      p_description: v.description ?? undefined,
      p_rationale: v.rationale ?? undefined,
      p_decision_maker: v.decisionMakerId!,
      p_note: v.note ?? undefined,
    });
    const out = data as RpcDecision | null;
    if (error || !out?.decision_id) return rpcFailure("create_decision", error);
    const url = link(ctx, path(out.decision_id));
    const lines = [
      `${out.ref}: ${clean(v.title)}`,
      `Category: ${DECISION_CATEGORY_LABEL[v.category!]}`,
      `Status: ${statusLabel(v.status!)}`,
      `Decided: ${day(ctx, v.decisionDate!)} by ${clean(maker.label)}`,
      v.description ? `What was decided: ${clean(v.description, LIMITS.medium)}` : null,
      v.rationale ? `Why: ${clean(v.rationale, LIMITS.medium)}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Recorded decision ${out.ref} [id: ${out.decision_id}]: ${url}`, lines, { id: out.decision_id, ref: out.ref, url, created: "decision" });
  },
});

// ── update_decision ──────────────────────────────────────────

const NONE = /^(none|clear|remove)$/i;

export const updateDecision = defineTool({
  name: "update_decision",
  title: "Update a decision",
  description:
    "Changes ONE decision, found by its number (DEC-0001), id or exact title: its wording, what was decided, why, category, date, decision maker, or status. Statuses: proposed, decided and in_effect move freely; reversed needs a note; superseded needs superseded_by (the decision that replaces it, by number) and a note. A superseded or reversed decision is closed and its status cannot change again. Only the fields given change; the result lists exactly what changed (before and after), and the decision's history and the audit trail record it. Before calling, say what will change and make sure the person wants it. It never archives or deletes a decision.",
  inputSchema: updateDecisionShape,
  annotations: WRITE,
  capability: "decisions.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveDecision(ctx, args.decision, "write");
    if (!found.ok) return found.result;
    const cur = found.decision;

    let target: DecisionRow | null = null;
    if (args.superseded_by) {
      const t = await resolveDecision(ctx, args.superseded_by, "write");
      if (!t.ok) return t.result;
      target = t.decision;
    }
    const nextStatus: DecisionStatus = args.status ?? (target ? "superseded" : cur.status);
    if (target && nextStatus !== "superseded") return respond("invalid", "Not changed: superseded_by can only be given when the status is superseded (or left out).");
    const problem = statusChangeProblem({ from: cur.status, to: nextStatus, note: args.note ?? null, supersededBy: target?.id ?? null, selfId: cur.id });
    if (problem) return respond("invalid", `Not changed: ${problem}`, [`Decision: ${cur.ref} ${clean(cur.title)} (${statusLabel(cur.status)})`]);
    if (target && isClosedStatus(target.status)) {
      return respond("invalid", `Not changed: ${target.ref} is itself ${statusLabel(target.status).toLowerCase()}. Choose the decision that is in force now.`);
    }

    let maker = { id: cur.decisionMakerId, label: cur.decisionMakerName ?? "a colleague" };
    if (args.decision_maker) {
      const who = await resolveStaff(ctx, args.decision_maker, "write");
      if (!who.ok) return who.result;
      maker = { id: who.record.id, label: who.record.label };
    }
    const description = args.description === undefined ? cur.description : NONE.test(args.description) ? null : args.description;
    const rationale = args.rationale === undefined ? cur.rationale : NONE.test(args.rationale) ? null : args.rationale;

    // The same validator as the HQ edit form, on the decision as it would be after the change.
    const reader = new FormReader(
      form({
        title: args.title ?? cur.title,
        category: args.category ?? cur.category,
        decision_date: args.decision_date ?? cur.decisionDate,
        decision_maker_id: maker.id,
        description,
        rationale,
        note: args.note,
      }),
    );
    // The date rule applies only to a date being changed (the database checks it the same way).
    const v = readDecisionFields(reader, args.decision_date ? today(ctx) : cur.decisionDate, { statusRequired: false });
    if (!reader.ok) return respond("invalid", invalidText(reader.errors, DECISION_FORM_LABELS));

    const { data, error } = await ctx.db.rpc("update_decision", {
      p_decision: cur.id,
      p_title: args.title !== undefined ? v.title : undefined,
      p_description: args.description !== undefined ? (v.description ?? "") : undefined,
      p_rationale: args.rationale !== undefined ? (v.rationale ?? "") : undefined,
      p_category: args.category ?? undefined,
      p_decision_date: args.decision_date ?? undefined,
      p_status: nextStatus !== cur.status ? nextStatus : undefined,
      p_decision_maker: args.decision_maker ? maker.id : undefined,
      p_superseded_by: target?.id ?? undefined,
      p_note: v.note ?? undefined,
      p_expected_updated_at: cur.updatedAt,
    });
    if (error) return rpcFailure("update_decision", error);
    const out = data as RpcDecision | null;
    const url = link(ctx, path(cur.id));
    if (out?.changed === false) return respond("unchanged", `Nothing to change: ${cur.ref} already has those values. ${url}`, [`Decision: ${cur.ref} ${clean(cur.title)}`], { id: cur.id, url });

    const fields = new Set(out?.changed_fields ?? []);
    const lines = [`Decision: ${cur.ref} ${clean(args.title !== undefined ? v.title : cur.title)}`];
    if (fields.has("title")) lines.push(changeLine("Wording", cur.title, v.title));
    if (fields.has("status")) lines.push(changeLine("Status", statusLabel(cur.status), statusLabel(nextStatus) + (target ? ` by ${target.ref}` : "")));
    if (fields.has("category")) lines.push(changeLine("Category", DECISION_CATEGORY_LABEL[cur.category], DECISION_CATEGORY_LABEL[v.category!]));
    if (fields.has("decision_date")) lines.push(changeLine("Decided", day(ctx, cur.decisionDate), day(ctx, v.decisionDate!)));
    if (fields.has("decision_maker_id")) lines.push(changeLine("Decision maker", cur.decisionMakerName, maker.label));
    if (fields.has("description")) lines.push(changeLine("What was decided", cur.description, v.description));
    if (fields.has("rationale")) lines.push(changeLine("Why", cur.rationale, v.rationale));
    if (v.note) lines.push(`Note: ${clean(v.note, LIMITS.medium)}`);
    return respond("ok", `Updated decision ${cur.ref} [id: ${cur.id}]: ${url}`, lines, { id: cur.id, ref: cur.ref, url, changed: [...fields] });
  },
});

