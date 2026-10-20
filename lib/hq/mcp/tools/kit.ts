/*
 * The toolkit every MCP tool is built with: the capability gate and argument check that wrap each
 * handler, dates in the person's timezone, links to HQ pages, database-error handling, and name
 * resolution for every kind of record a person refers to by name.
 *
 * Every query here runs through ctx.db, the person's OWN session: row level security decides what
 * they can see, so a record they may not see is indistinguishable from one that does not exist.
 * No service key, ever.
 */
import { z } from "zod";
import type { ToolContext, ToolDef, ToolResult } from "../types";
import { formatDate, formatDateTime, todayIn } from "../../format";
import { normaliseName, searchTerm } from "../../growth/params";
import { matchTrade, sortTrades, type Trade } from "../../trades/rules";
import {
  GENERIC_ERROR,
  HQ_PATHS,
  LIMITS,
  candidatesText,
  capabilityRefusal,
  compose,
  decideResolution,
  hasCapability,
  hqUrl,
  isUuid,
  notFoundText,
  parseRecordId,
  result,
  type Candidate,
  type Outcome,
} from "./core";

export type { ToolContext, ToolResult };

// ── defining a tool ──────────────────────────────────────────

type AnyHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

/**
 * The handlers WITHOUT the tool's own capability gate, keyed by tool name. Only for
 * scripts/hq/mcp-tools-smoke.mts, to show that the database refuses a forced call too. The MCP
 * server never uses this.
 */
export const UNGATED_FOR_TESTS = new Map<string, AnyHandler>();

function issuesText(error: z.ZodError): string {
  const lines = error.issues.slice(0, 10).map((i) => `- ${i.path.length ? i.path.join(".") : "arguments"}: ${i.message}`);
  return `Not done. The arguments were not valid:\n${lines.join("\n")}`;
}

function errorTag(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message.slice(0, 120)}`;
  return "unknown";
}

/**
 * Wraps a handler so that, whoever calls it: the person must hold the tool's capability (else a
 * refusal, nothing read or written), the arguments are checked against the schema (else a plain
 * list of problems), and an unexpected failure becomes a generic message (the log gets a tag,
 * never record text).
 */
export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef {
  const parser = z.object(def.inputSchema);
  const inner = def.handler as unknown as AnyHandler;
  const run = async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
    const parsed = parser.safeParse(args ?? {});
    if (!parsed.success) return result("invalid", issuesText(parsed.error));
    try {
      return await inner(parsed.data as Record<string, unknown>, ctx);
    } catch (e) {
      console.error(`[hq] mcp tool ${def.name} failed:`, errorTag(e));
      return result("error", GENERIC_ERROR);
    }
  };
  UNGATED_FOR_TESTS.set(def.name, run);
  const handler = async (args: unknown, ctx: ToolContext): Promise<ToolResult> => {
    if (!hasCapability(ctx.staff.capabilities, def.capability)) {
      return result("refused", capabilityRefusal(def.title, def.capability ?? ""));
    }
    return run(args, ctx);
  };
  return { ...def, handler } as unknown as ToolDef;
}

// ── small helpers on the context ─────────────────────────────

export const can = (ctx: ToolContext, capability: string) => ctx.staff.capabilities.includes(capability);

/** Today in the person's timezone (the same rule as hq.today(), for their zone). */
export const today = (ctx: ToolContext) => todayIn(ctx.staff.timezone);

export const day = (ctx: ToolContext, value: string | null | undefined) => (value ? formatDate(value, ctx.staff.timezone) : "");
export const when = (ctx: ToolContext, value: string | null | undefined) => (value ? formatDateTime(value, ctx.staff.timezone) : "");

export const link = (ctx: ToolContext, path: string) => hqUrl(ctx.baseUrl, path);

export function respond(outcome: Outcome, head: string | readonly string[], data?: readonly string[] | null, extra: Record<string, unknown> = {}, tail?: string | readonly string[] | null): ToolResult {
  return result(outcome, compose({ head, data, tail }), extra);
}

// ── database errors ──────────────────────────────────────────

export type PgError = { code?: string | null; message?: string | null } | null | undefined;

/** Safe to log: the error code only. A message can hold record values. */
export function logDb(where: string, error: PgError): void {
  console.error(`[hq] mcp ${where} failed:`, error?.code ?? "unknown");
}

/** A failed read or write, in words a person can act on. The raw message is never shown. */
export function dbFailure(where: string, error: PgError, nouns: { notFound?: string } = {}): ToolResult {
  logDb(where, error);
  const code = error?.code ?? "";
  if (code === "42501") return result("refused", "Refused by HQ: your role is not allowed to do that. Nothing was changed.", { code });
  if (code === "P0002" || code === "PGRST116") return result("not_found", nouns.notFound ?? "That record could not be found. It may have been archived. Nothing was changed.", { code });
  return result("error", GENERIC_ERROR, { code });
}

// ── name resolution ──────────────────────────────────────────

type Rows<T> = PromiseLike<{ data: T[] | null; error: PgError }>;

async function rows<T>(where: string, q: Rows<T>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    logDb(where, error);
    throw new Error(`lookup ${where} ${error.code ?? ""}`);
  }
  return data ?? [];
}

type Finder = {
  noun: string;
  byId: (id: string) => Promise<Candidate | null>;
  exact: (key: string) => Promise<Candidate[]>;
  close: (term: string) => Promise<Candidate[]>;
};

export type Resolved = { ok: true; record: Candidate; how: "id" | "exact" | "close"; note: string | null } | { ok: false; result: ToolResult };

async function resolveWith(f: Finder, query: string, mode: "read" | "write"): Promise<Resolved> {
  const q = query.trim();
  const tagged = parseRecordId(q);
  const id = tagged ? tagged.id : isUuid(q) ? q.toLowerCase() : null;
  if (id) {
    const hit = await f.byId(id);
    if (hit) return { ok: true, record: hit, how: "id", note: null };
    return { ok: false, result: result("not_found", notFoundText(f.noun, q)) };
  }
  const key = normaliseName(q);
  const term = searchTerm(q);
  const exact = key ? await f.exact(key) : [];
  const close = exact.length === 0 && term.length >= 2 ? await f.close(term) : [];
  const r = decideResolution({ exact, close, mode });
  if (r.kind === "one") {
    const note = r.how === "close" ? `No ${f.noun} is named exactly "${q.slice(0, 80)}"; this is the only close match.` : null;
    return { ok: true, record: r.record, how: r.how, note };
  }
  if (r.kind === "none") return { ok: false, result: result("not_found", notFoundText(f.noun, q)) };
  const t = candidatesText(f.noun, q, r);
  return {
    ok: false,
    result: result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: r.candidates.map((c) => ({ id: c.id, label: c.label, detail: c.detail ?? null })) }),
  };
}

const CLOSE_LIMIT = LIMITS.candidates + 1;

/** Global search's trigram matching, for when a substring finds nothing (a typo). */
async function trigram(ctx: ToolContext, group: "contacts" | "organisations" | "contractors", term: string): Promise<Candidate[]> {
  const { data, error } = await ctx.db.rpc("global_search", { p_query: term, p_limit: CLOSE_LIMIT });
  if (error) {
    logDb("global_search (resolve)", error);
    throw new Error("lookup global_search");
  }
  const list = (data as Record<string, unknown> | null)?.[group];
  if (!Array.isArray(list)) return [];
  return list
    .map((h) => h as { id?: unknown; title?: unknown; subtitle?: unknown })
    .filter((h): h is { id: string; title: string; subtitle?: unknown } => typeof h.id === "string" && typeof h.title === "string")
    .map((h) => ({ id: h.id, label: h.title, detail: typeof h.subtitle === "string" && h.subtitle ? h.subtitle : null }));
}

function contactCandidate(r: { id: string | null; full_name: string | null; organisation_name: string | null; position: string | null }): Candidate | null {
  if (!r.id || !r.full_name) return null;
  const detail = [r.position, r.organisation_name ?? "independent"].filter(Boolean).join(", ");
  return { id: r.id, label: r.full_name, detail };
}

const CONTACT_COLS = "id, full_name, organisation_name, position";

export function resolveContact(ctx: ToolContext, query: string, mode: "read" | "write", opts: { organisationId?: string | null } = {}): Promise<Resolved> {
  const scope = <Q extends { eq: (c: string, v: string) => Q }>(q: Q): Q => (opts.organisationId ? q.eq("organisation_id", opts.organisationId) : q);
  const toCandidates = (list: Parameters<typeof contactCandidate>[0][]) => list.map(contactCandidate).filter((c): c is Candidate => c !== null);
  return resolveWith(
    {
      noun: "contact",
      byId: async (id) => toCandidates(await rows("contact by id", ctx.db.from("contact_directory").select(CONTACT_COLS).eq("id", id).limit(1)))[0] ?? null,
      exact: async (key) => {
        const ids = (await rows("contact exact", scope(ctx.db.from("contacts").select("id").eq("name_key", key).is("deleted_at", null)).limit(CLOSE_LIMIT))).map((r) => r.id);
        if (ids.length === 0) return [];
        return toCandidates(await rows("contact exact names", ctx.db.from("contact_directory").select(CONTACT_COLS).in("id", ids)));
      },
      close: async (term) => {
        const found = toCandidates(await rows("contact close", scope(ctx.db.from("contact_directory").select(CONTACT_COLS).ilike("full_name", `%${term}%`)).order("full_name").limit(CLOSE_LIMIT)));
        if (found.length > 0 || opts.organisationId) return found;
        return trigram(ctx, "contacts", term);
      },
    },
    query,
    mode,
  );
}

export function resolveOrganisation(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  type R = { id: string | null; name: string | null; location: string | null };
  const toCandidates = (list: R[]) => list.filter((r) => r.id && r.name).map((r) => ({ id: r.id as string, label: r.name as string, detail: r.location }));
  return resolveWith(
    {
      noun: "organisation",
      byId: async (id) => toCandidates(await rows("organisation by id", ctx.db.from("organisation_directory").select("id, name, location").eq("id", id).limit(1)))[0] ?? null,
      exact: async (key) => toCandidates(await rows("organisation exact", ctx.db.from("organisations").select("id, name, location").eq("name_key", key).is("deleted_at", null).limit(CLOSE_LIMIT))),
      close: async (term) => {
        const found = toCandidates(await rows("organisation close", ctx.db.from("organisation_directory").select("id, name, location").ilike("name", `%${term}%`).order("name").limit(CLOSE_LIMIT)));
        return found.length > 0 ? found : trigram(ctx, "organisations", term);
      },
    },
    query,
    mode,
  );
}

export function resolveContractor(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  type R = { id: string | null; business_name: string | null; status: string | null; categories: string[] | null };
  const toCandidates = (list: R[]) =>
    list
      .filter((r) => r.id && r.business_name)
      .map((r) => ({ id: r.id as string, label: r.business_name as string, detail: [(r.categories ?? []).map((c) => c.replace(/_/g, " ")).join(", "), r.status].filter(Boolean).join(" - ") }));
  const COLS = "id, business_name, status, categories";
  return resolveWith(
    {
      noun: "contractor",
      byId: async (id) => toCandidates(await rows("contractor by id", ctx.db.from("contractor_directory").select(COLS).eq("id", id).limit(1)))[0] ?? null,
      exact: async (key) => toCandidates(await rows("contractor exact", ctx.db.from("contractors").select(COLS).eq("name_key", key).is("deleted_at", null).limit(CLOSE_LIMIT))),
      close: async (term) => {
        const found = toCandidates(await rows("contractor close", ctx.db.from("contractor_directory").select(COLS).ilike("business_name", `%${term}%`).order("business_name").limit(CLOSE_LIMIT)));
        return found.length > 0 ? found : trigram(ctx, "contractors", term);
      },
    },
    query,
    mode,
  );
}

/**
 * A member of staff: "me", an id, or a name. Only ACTIVE staff can be given work, so only they are
 * matched. Exact is the full name (any case, spacing) or a unique first name.
 */
export function resolveStaff(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  const q = query.trim();
  if (/^(me|myself|i)$/i.test(q)) {
    return Promise.resolve({ ok: true, record: { id: ctx.staff.id, label: ctx.staff.fullName, detail: "you" }, how: "exact", note: null });
  }
  type R = { id: string; full_name: string; first_name: string | null; role: string };
  const COLS = "id, full_name, first_name, role";
  const active = () => ctx.db.from("staff_profiles").select(COLS).eq("is_active", true).eq("employment_status", "active");
  const toCandidates = (list: R[]) => list.map((r) => ({ id: r.id, label: r.full_name, detail: r.role.replace(/_/g, " ") }));
  return resolveWith(
    {
      noun: "active staff member",
      byId: async (id) => toCandidates(await rows("staff by id", active().eq("id", id).limit(1)))[0] ?? null,
      exact: async (key) => {
        const all = await rows("staff exact", active().order("full_name").limit(500));
        const full = all.filter((s) => normaliseName(s.full_name) === key);
        if (full.length > 0) return toCandidates(full);
        return toCandidates(all.filter((s) => s.first_name && normaliseName(s.first_name) === key));
      },
      close: async (term) => toCandidates(await rows("staff close", active().ilike("full_name", `%${term}%`).order("full_name").limit(CLOSE_LIMIT))),
    },
    q,
    mode,
  );
}

/** A task the person can see: by id, or by words of its title (open tasks first). */
export function resolveTask(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  type R = { id: string; title: string; status: string; due_date: string | null };
  const COLS = "id, title, status, due_date";
  const toCandidates = (list: R[]) =>
    list.map((r) => ({ id: r.id, label: r.title, detail: [r.status.replace(/_/g, " "), r.due_date ? `due ${day(ctx, r.due_date)}` : null].filter(Boolean).join(", ") }));
  const live = () => ctx.db.from("tasks").select(COLS).is("deleted_at", null);
  return resolveWith(
    {
      noun: "task",
      byId: async (id) => toCandidates(await rows("task by id", live().eq("id", id).limit(1)))[0] ?? null,
      exact: async () => {
        const term = searchTerm(query);
        if (!term) return [];
        const list = await rows("task exact", live().ilike("title", term).limit(CLOSE_LIMIT));
        const open = list.filter((t) => t.status !== "completed" && t.status !== "cancelled");
        return toCandidates(open.length > 0 ? open : list);
      },
      close: async (term) => {
        const list = await rows("task close", live().ilike("title", `%${term}%`).order("created_at", { ascending: false }).limit(50));
        const open = list.filter((t) => t.status !== "completed" && t.status !== "cancelled");
        return toCandidates((open.length > 0 ? open : list).slice(0, CLOSE_LIMIT));
      },
    },
    query,
    mode,
  );
}

/**
 * A prospect (lead) in the pipeline: an opportunity id, a lead number ("LEAD-0007"), a referral
 * number ("REF-0007"), or the prospect's name (live opportunities only).
 */
export async function resolveOpportunity(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  type R = { id: string; prospect_name: string | null; stage: string; display_number: number; property_suburb: string | null };
  const COLS = "id, prospect_name, stage, display_number, property_suburb";
  const toCandidates = (list: R[]) =>
    list.map((r) => ({ id: r.id, label: r.prospect_name ?? `Opportunity ${r.display_number}`, detail: [r.stage.replace(/_/g, " "), r.property_suburb].filter(Boolean).join(", ") }));
  const live = () => ctx.db.from("opportunities").select(COLS).is("deleted_at", null);
  const leadMatch = /^lead[-\s]?0*(\d{1,9})$/i.exec(query.trim());
  if (leadMatch) {
    const hit = toCandidates(await rows("opportunity by lead number", live().eq("display_number", Number(leadMatch[1])).limit(1)))[0];
    return hit ? { ok: true, record: hit, how: "id", note: null } : { ok: false, result: result("not_found", notFoundText("lead", query)) };
  }
  const refMatch = /^ref[-\s]?0*(\d{1,9})$/i.exec(query.trim());
  if (refMatch) {
    const ref = await rows("referral by number", ctx.db.from("referral_overview").select("opportunity_id").eq("ref_number", Number(refMatch[1])).limit(1));
    const oppId = ref[0]?.opportunity_id;
    if (!oppId) {
      return { ok: false, result: result("not_found", `No received referral numbered ${query.trim().toUpperCase()} with a prospect in the pipeline was found. Nothing was changed.`) };
    }
    const hit = toCandidates(await rows("opportunity by referral", live().eq("id", oppId).limit(1)))[0];
    return hit ? { ok: true, record: hit, how: "id", note: null } : { ok: false, result: result("not_found", notFoundText("prospect", query)) };
  }
  return resolveWith(
    {
      noun: "prospect",
      byId: async (id) => toCandidates(await rows("opportunity by id", live().eq("id", id).limit(1)))[0] ?? null,
      exact: async (key) => {
        const term = searchTerm(query);
        if (!term) return [];
        const list = await rows("opportunity exact", live().ilike("prospect_name", `%${term}%`).limit(50));
        return toCandidates(list.filter((r) => r.prospect_name && normaliseName(r.prospect_name) === key));
      },
      close: async (term) => toCandidates(await rows("opportunity close", live().ilike("prospect_name", `%${term}%`).order("stage_changed_at", { ascending: false }).limit(CLOSE_LIMIT))),
    },
    query,
    mode,
  );
}

export { HQ_PATHS };

// ── trades (hq.trades: the owner's own list) ─────────────────

/** Every trade the person can read (contractors.read), active and archived, in the owner's order. Throws on a database error. */
export async function loadToolTrades(ctx: ToolContext): Promise<Trade[]> {
  const list = await rows(
    "trades",
    ctx.db.from("trades").select("id, slug, label, description, sort_order, is_active, archived_at").order("sort_order").limit(500),
  );
  return sortTrades(
    list.map((t) => ({ id: t.id, slug: t.slug, label: t.label, description: t.description, sortOrder: t.sort_order, isActive: t.is_active ?? t.archived_at === null })),
  );
}

/** "Plumbing (plumbing), Electrical (electrical), ..." for a reply that has to list the trades. */
export function tradesListText(trades: readonly Trade[]): string {
  const active = trades.filter((t) => t.isActive);
  return active.length ? active.map((t) => `${t.label} (${t.slug})`).join(", ") : "none are recorded yet";
}

export type TradeResolved = { ok: true; trade: Trade; trades: Trade[]; note: string | null } | { ok: false; result: ToolResult };

/**
 * The trade a person named: exact (slug or label, any case) or a close match ("electricians" ->
 * Electrical, said in a note). Never guesses: none or several -> the available trades, nothing done.
 */
export async function resolveTrade(ctx: ToolContext, input: string): Promise<TradeResolved> {
  const trades = await loadToolTrades(ctx);
  const m = matchTrade(input, trades);
  if (m.kind === "match") {
    return { ok: true, trade: m.trade, trades, note: m.exact ? null : `Read "${input.slice(0, 60)}" as the trade ${m.trade.label} (${m.trade.slug}).` };
  }
  if (m.kind === "ambiguous") {
    return {
      ok: false,
      result: result("ambiguous", `"${input.slice(0, 60)}" could be more than one trade: ${m.options.map((t) => `${t.label} (${t.slug})`).join(", ")}. Say which one.`, {
        candidates: m.options.map((t) => ({ slug: t.slug, label: t.label })),
      }),
    };
  }
  return {
    ok: false,
    result: result("not_found", `No trade in HQ matches "${input.slice(0, 60)}". The trades are: ${tradesListText(trades)}.`, {
      trades: trades.filter((t) => t.isActive).map((t) => ({ slug: t.slug, label: t.label })),
    }),
  };
}
