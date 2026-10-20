/*
 * The pure parts of the project and bulk-task tools (docs/hq-projects.md sections 2 and 3): refs and
 * duplicate refs in a plan, resolving many names in ONE pass against lists loaded once, the payload
 * handed to hq.bulk_create_tasks / hq.bulk_update_tasks, reading their result, the plain-language
 * answer (honest counts, a compact table, every failure with its reasons), the bulk-budget refusal,
 * and the "first open blockers" walk over a dependency graph.
 *
 * NO value imports on purpose (the unit tests run under Node's type stripping; see core.ts). Anything
 * needed from a neighbour (name normalising, cleaning record text) is passed in.
 */

// ── refs ─────────────────────────────────────────────────────

export type WithRef = { ref?: string | undefined };

/** Each entry's ref (its own, else its 1-based position) and the refs used more than once. */
export function assignRefs<T extends WithRef>(entries: readonly T[]): { refs: string[]; duplicates: string[] } {
  const refs = entries.map((e, i) => (e.ref && e.ref.trim() ? e.ref.trim() : String(i + 1)));
  const seen = new Map<string, number>();
  for (const r of refs) seen.set(r.toLowerCase(), (seen.get(r.toLowerCase()) ?? 0) + 1);
  const duplicates = [...new Set(refs.filter((r) => (seen.get(r.toLowerCase()) ?? 0) > 1))];
  return { refs, duplicates };
}

// ── resolving names in one pass ──────────────────────────────

export type Pick1 = { id: string; label: string; detail?: string | null };
export type Match = { kind: "one"; record: Pick1; how: "id" | "exact" } | { kind: "many"; candidates: Pick1[]; how: "exact" | "close" } | { kind: "none" } | { kind: "nobody" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeId = (v: string): boolean => UUID.test(v.trim());
const NOBODY = /^(nobody|no one|none|unassigned)$/i;
const ME = /^(me|myself|i)$/i;

export type StaffRow = { id: string; full_name: string; first_name: string | null; role: string };

/**
 * One staff name against the active staff list (loaded once for the whole plan): "me", "nobody", an
 * id, the full name (any case/spacing) or a unique first name; otherwise close matches (a part of the
 * full name) are CANDIDATES, never accepted: a bulk write never acts on a name the person did not
 * give exactly. The same rules as resolveStaff in kit.ts, without a query per name.
 */
export function matchStaff(list: readonly StaffRow[], query: string, me: Pick1, normalise: (s: string) => string): Match {
  const q = query.trim();
  if (ME.test(q)) return { kind: "one", record: me, how: "exact" };
  if (NOBODY.test(q)) return { kind: "nobody" };
  const pick = (s: StaffRow): Pick1 => ({ id: s.id, label: s.full_name, detail: s.role.replace(/_/g, " ") });
  if (looksLikeId(q)) {
    const hit = list.find((s) => s.id.toLowerCase() === q.toLowerCase());
    return hit ? { kind: "one", record: pick(hit), how: "id" } : { kind: "none" };
  }
  const key = normalise(q);
  if (!key) return { kind: "none" };
  const full = list.filter((s) => normalise(s.full_name) === key);
  if (full.length === 1) return { kind: "one", record: pick(full[0]), how: "exact" };
  if (full.length > 1) return { kind: "many", candidates: full.map(pick), how: "exact" };
  const firsts = list.filter((s) => s.first_name && normalise(s.first_name) === key);
  if (firsts.length === 1) return { kind: "one", record: pick(firsts[0]), how: "exact" };
  if (firsts.length > 1) return { kind: "many", candidates: firsts.map(pick), how: "exact" };
  const close = list.filter((s) => normalise(s.full_name).includes(key)).slice(0, 8);
  return close.length ? { kind: "many", candidates: close.map(pick), how: "close" } : { kind: "none" };
}

export type NamedRow = { id: string; label: string; key: string; detail?: string | null };

/**
 * One name against rows loaded for the whole plan (exact name keys, plus close matches): an id must
 * be among them; an exact key match wins when it is the only one; otherwise candidates or none. A
 * single close match is a candidate to confirm, never accepted, as for any write.
 */
export function matchNamed(rows: readonly NamedRow[], query: string, normalise: (s: string) => string): Match {
  const q = query.trim();
  const pick = (r: NamedRow): Pick1 => ({ id: r.id, label: r.label, detail: r.detail ?? null });
  const uniq = (list: readonly NamedRow[]) => [...new Map(list.map((r) => [r.id.toLowerCase(), r])).values()];
  if (looksLikeId(q)) {
    const hit = rows.find((r) => r.id.toLowerCase() === q.toLowerCase());
    return hit ? { kind: "one", record: pick(hit), how: "id" } : { kind: "none" };
  }
  const key = normalise(q);
  if (!key) return { kind: "none" };
  const exact = uniq(rows.filter((r) => r.key === key));
  if (exact.length === 1) return { kind: "one", record: pick(exact[0]), how: "exact" };
  if (exact.length > 1) return { kind: "many", candidates: exact.slice(0, 8).map(pick), how: "exact" };
  const close = uniq(rows.filter((r) => r.key.includes(key) || normalise(r.label).includes(key))).slice(0, 8);
  return close.length ? { kind: "many", candidates: close.map(pick), how: "close" } : { kind: "none" };
}

/** One problem found while resolving a plan's names: which entry, which field, what was typed, and what to do. */
export type NameProblem = { index: number | null; ref: string | null; field: string; value: string; message: string; candidates: Pick1[] };

export function problemFor(field: string, noun: string, value: string, m: Match, at: { index: number | null; ref: string | null }): NameProblem | null {
  if (m.kind === "one" || m.kind === "nobody") return null;
  const v = value.slice(0, 80);
  if (m.kind === "none") return { ...at, field, value: v, message: `no ${noun} matching "${v}" was found that you can see`, candidates: [] };
  const message =
    m.candidates.length === 1
      ? `no ${noun} is named exactly "${v}"; the closest is ${m.candidates[0].label} [id: ${m.candidates[0].id}]: if that is right, send its id`
      : `${m.candidates.length} ${noun}s ${m.how === "exact" ? "match" : "are close to"} "${v}": ask which one and send its id`;
  return { ...at, field, value: v, message, candidates: m.candidates };
}

/** The refusal when names in a plan could not be resolved: every problem in one answer, nothing written, the key not used. */
export function nameProblemsText(problems: readonly NameProblem[], clean: (s: unknown, max?: number) => string): { head: string; data: string[] } {
  const head = `Nothing was created or changed: ${problems.length === 1 ? "one name" : `${problems.length} names`} in the plan could not be matched exactly, and a bulk call never guesses. Ask the person, fix the entries (an id from the candidates is exact), and call again. The idempotency key was NOT used, so the same key can be sent again with the corrected plan.`;
  const data = problems.slice(0, 30).flatMap((p) => {
    const where = p.index === null ? "the call" : `entry ${p.index + 1}${p.ref ? ` (${clean(p.ref, 40)})` : ""}`;
    return [`- ${where}, ${p.field}: ${clean(p.message, 300)}`, ...p.candidates.slice(0, 8).map((c) => `    - ${clean(c.label)}${c.detail ? ` (${clean(c.detail)})` : ""} [id: ${c.id}]`)];
  });
  if (problems.length > 30) data.push(`… and ${problems.length - 30} more.`);
  return { head, data };
}

// ── the RPC's answer ─────────────────────────────────────────

export type BulkCreated = { index: number; ref: string | null; id: string };
export type BulkFailed = { index: number; ref: string | null; errors: string[] };
export type BulkOutcome = { created: BulkCreated[]; failed: BulkFailed[]; duplicate: boolean; createdCount: number; failedCount: number; updated?: BulkCreated[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Reads hq.bulk_create_tasks / hq.bulk_update_tasks' jsonb result: {created|updated: [{index, ref, id}],
 * failed: [{index, ref, errors[]}], duplicate, created_count|updated_count, failed_count}. The index is
 * 0-based as sent. Anything malformed is dropped rather than trusted; null when it is not that shape.
 */
export function parseBulkOutcome(data: unknown): BulkOutcome | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const okList = Array.isArray(d.created) ? d.created : Array.isArray(d.updated) ? d.updated : null;
  if (!okList || !Array.isArray(d.failed)) return null;
  const created: BulkCreated[] = [];
  for (const raw of okList) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const index = num(r.index);
    const id = str(r.id) ?? str(r.task_id);
    if (index === null || !id) continue;
    created.push({ index, ref: str(r.ref), id });
  }
  const failed: BulkFailed[] = [];
  for (const raw of d.failed) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const index = num(r.index);
    if (index === null) continue;
    const errors = Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === "string" && e.length > 0) : typeof r.error === "string" ? [r.error] : [];
    failed.push({ index, ref: str(r.ref), errors: errors.length ? errors : ["it could not be saved (no reason was given)"] });
  }
  const createdCount = num(d.created_count) ?? num(d.updated_count) ?? created.length;
  const failedCount = num(d.failed_count) ?? failed.length;
  return { created, failed, duplicate: d.duplicate === true, createdCount, failedCount };
}

// ── the answer to the person ─────────────────────────────────

export type BulkLine = { index: number; ref: string; title: string };

/**
 * The answer to a bulk create: counts first (never claiming more than the database reported), a
 * compact table of what was created (ref, title, id, link), then every failure with its reasons. A
 * replay says it was a replay and that nothing new was created.
 */
export function bulkCreateText(
  o: BulkOutcome,
  plan: { lines: readonly BulkLine[]; total: number; atomic: boolean; where: string | null },
  fmt: { clean: (s: unknown, max?: number) => string; url: (taskId: string) => string },
): { head: string[]; data: string[]; tail: string[] } {
  const byIndex = new Map(plan.lines.map((l) => [l.index, l]));
  const created = [...o.created].sort((a, b) => a.index - b.index);
  const failed = [...o.failed].sort((a, b) => a.index - b.index);
  const head: string[] = [];
  if (o.duplicate) {
    head.push(`This plan was already sent with the same idempotency key, so NOTHING new was created: this is the original result (${o.createdCount} created, ${o.failedCount} failed). Do not send it again.`);
  } else if (o.createdCount === 0) {
    head.push(`Created 0 of ${plan.total} tasks${plan.atomic && o.failedCount > 0 ? " (all or nothing: one or more entries were invalid, so nothing was written)" : ""}. ${o.failedCount} failed; the reasons are below.`);
  } else {
    head.push(`Created ${o.createdCount} of ${plan.total} task${plan.total === 1 ? "" : "s"}${plan.where ? ` in ${plan.where}` : ""}${o.failedCount ? `; ${o.failedCount} failed (reasons below, nothing was created for them)` : ""}.`);
  }
  const data = created.map((c) => {
    const l = byIndex.get(c.index);
    return `- ${fmt.clean(c.ref ?? l?.ref ?? String(c.index + 1), 40)} | ${fmt.clean(l?.title ?? "", 120)} | id ${c.id} | ${fmt.url(c.id)}`;
  });
  const tail: string[] = [];
  if (failed.length) {
    tail.push("Failed (not created):");
    for (const f of failed) {
      const l = byIndex.get(f.index);
      tail.push(`- entry ${f.index + 1} (${fmt.clean(f.ref ?? l?.ref ?? String(f.index + 1), 40)}): ${f.errors.map((e) => fmt.clean(e, 240)).join("; ")}`);
    }
    tail.push("Tell the person exactly which ones failed and why. To add them after fixing, send ONLY the fixed entries with a NEW idempotency key (the created ones exist already).");
  }
  return { head, data, tail };
}

/** The same for bulk updates. */
export function bulkUpdateText(
  o: BulkOutcome,
  plan: { lines: readonly BulkLine[]; total: number; atomic: boolean },
  fmt: { clean: (s: unknown, max?: number) => string; url: (taskId: string) => string },
): { head: string[]; data: string[]; tail: string[] } {
  const byIndex = new Map(plan.lines.map((l) => [l.index, l]));
  const head: string[] = [];
  if (o.duplicate) head.push(`These changes were already sent with the same idempotency key, so NOTHING was changed again: this is the original result (${o.createdCount} updated, ${o.failedCount} failed).`);
  else if (o.createdCount === 0) head.push(`Updated 0 of ${plan.total} tasks${plan.atomic && o.failedCount > 0 ? " (all or nothing: one or more changes were invalid, so nothing was written)" : ""}. ${o.failedCount} failed; the reasons are below.`);
  else head.push(`Updated ${o.createdCount} of ${plan.total} task${plan.total === 1 ? "" : "s"}${o.failedCount ? `; ${o.failedCount} failed (reasons below, those tasks are unchanged)` : ""}.`);
  const data = [...o.created]
    .sort((a, b) => a.index - b.index)
    .map((c) => `- ${fmt.clean(byIndex.get(c.index)?.title ?? "", 120)} | id ${c.id} | ${fmt.url(c.id)}`);
  const tail: string[] = [];
  if (o.failed.length) {
    tail.push("Failed (unchanged):");
    for (const f of [...o.failed].sort((a, b) => a.index - b.index)) tail.push(`- entry ${f.index + 1} (${fmt.clean(byIndex.get(f.index)?.title ?? "", 80)}): ${f.errors.map((e) => fmt.clean(e, 240)).join("; ")}`);
  }
  return { head, data, tail };
}

// ── the bulk budget ──────────────────────────────────────────

export type BudgetInfo = { callsUsed: number | null; callsLimit: number | null; itemsUsed: number | null; itemsLimit: number | null; retryAt: string | null };

/**
 * Reads what the database said when it refused a bulk call (SQLSTATE 54000, hint bulk_rate_limited).
 * The numbers come from the error's detail when it carries JSON ({calls_used, calls_limit, items_used,
 * items_limit, retry_at}) or "key=value" pairs; anything missing stays null and is not invented.
 */
export function readBudgetDetail(detail: string | null | undefined): BudgetInfo {
  const info: BudgetInfo = { callsUsed: null, callsLimit: null, itemsUsed: null, itemsLimit: null, retryAt: null };
  if (!detail) return info;
  // The 0144 RPC's own wording: "6 of 6 calls used in the last hour" / "290 of 300 items used in the last hour".
  const said = /(\d+) of (\d+) (calls|items) used/i.exec(detail);
  if (said) {
    if (said[3].toLowerCase() === "calls") [info.callsUsed, info.callsLimit] = [Number(said[1]), Number(said[2])];
    else [info.itemsUsed, info.itemsLimit] = [Number(said[1]), Number(said[2])];
    return info;
  }
  let obj: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  } catch {
    obj = {};
    for (const m of detail.matchAll(/([a-z_]+)\s*[=:]\s*([^\s,;]+)/gi)) obj[m[1].toLowerCase()] = m[2];
  }
  if (!obj) return info;
  info.callsUsed = num(obj.calls_used);
  info.callsLimit = num(obj.calls_limit) ?? num(obj.bulk_calls_per_hour);
  info.itemsUsed = num(obj.items_used);
  info.itemsLimit = num(obj.items_limit) ?? num(obj.bulk_items_per_hour);
  const at = str(obj.retry_at) ?? str(obj.next_slot_at) ?? str(obj.resets_at);
  info.retryAt = at && !Number.isNaN(Date.parse(at)) ? at : null;
  return info;
}

/**
 * The honest refusal: which budget ran out, how many calls and items are left this hour, and when to
 * try again (from the database's own figures; when one is unknown the sentence says so plainly).
 */
export function bulkLimitText(info: BudgetInfo, requestedItems: number, when: (iso: string) => string): string {
  const parts: string[] = ["Not done: the hourly budget for bulk changes through a chat app has been reached, so nothing was written (and the idempotency key was not used)."];
  const callsLeft = info.callsLimit !== null && info.callsUsed !== null ? Math.max(0, info.callsLimit - info.callsUsed) : null;
  const itemsLeft = info.itemsLimit !== null && info.itemsUsed !== null ? Math.max(0, info.itemsLimit - info.itemsUsed) : null;
  if (info.callsLimit !== null) parts.push(`Bulk calls: ${info.callsUsed ?? "?"} of ${info.callsLimit} used in the last hour (${callsLeft ?? "?"} left).`);
  if (info.itemsLimit !== null) parts.push(`Items: ${info.itemsUsed ?? "?"} of ${info.itemsLimit} used (${itemsLeft ?? "?"} left); this call had ${requestedItems}.`);
  if (callsLeft !== null && callsLeft > 0 && itemsLeft !== null && itemsLeft > 0 && itemsLeft < requestedItems) parts.push(`A smaller batch of at most ${itemsLeft} would fit now.`);
  parts.push(info.retryAt ? `Try again after ${when(info.retryAt)}.` : "The budget is a rolling hour: try again later in the hour.");
  parts.push("Do not retry in a loop. Tell the person; they can also add the tasks in HQ.");
  return parts.join(" ");
}

// ── what is blocking ─────────────────────────────────────────

export type DepTask = { id: string; title: string; status: string; due: string | null; assignee: string | null; projectId: string | null };

const OPEN = new Set(["to_do", "in_progress", "waiting"]);
export const isOpenStatus = (s: string): boolean => OPEN.has(s);

/**
 * For each blocked task (an open task with at least one unfinished dependency), the FIRST OPEN
 * BLOCKERS: follow the unfinished dependencies down the chain until a task that is itself not waiting
 * on anything unfinished (that is the work that unblocks the rest). Cycles cannot exist in the data,
 * but the walk is bounded and remembers where it has been anyway. Unknown tasks (not visible to this
 * person) stop the walk and are reported as hidden.
 */
export function firstOpenBlockers(
  blocked: readonly string[],
  deps: ReadonlyMap<string, readonly string[]>,
  tasks: ReadonlyMap<string, DepTask>,
  maxDepth = 25,
): Map<string, { roots: string[]; hidden: number }> {
  const out = new Map<string, { roots: string[]; hidden: number }>();
  for (const start of blocked) {
    const roots = new Set<string>();
    let hidden = 0;
    const seen = new Set<string>([start]);
    let frontier = [start];
    for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        const open = (deps.get(id) ?? []).filter((d) => {
          const t = tasks.get(d);
          return !t || isOpenStatus(t.status);
        });
        for (const d of open) {
          if (seen.has(d)) continue;
          seen.add(d);
          const t = tasks.get(d);
          if (!t) {
            hidden += 1;
            continue;
          }
          const further = (deps.get(d) ?? []).filter((x) => {
            const tx = tasks.get(x);
            return !tx || isOpenStatus(tx.status);
          });
          if (further.length === 0) roots.add(d);
          else next.push(d);
        }
      }
      frontier = next;
    }
    out.set(start, { roots: [...roots], hidden });
  }
  return out;
}
