/*
 * The portfolio over MCP: list and open managed properties; make a SIGNED lead a managed property;
 * change one (status, dates, fee, Ailo reference and status); set a handover step; and the CEO's
 * business_summary. Reads need portfolio.read; writes portfolio.write (directors, administrators,
 * senior property managers); business_summary needs growth.read OR portfolio.read and shows only the
 * sections the person's role includes. Every query runs as the person (RLS); every write goes through
 * the hq RPCs (convert_to_managed_property, update_managed_property, set_handover_step), which check
 * the capability again, validate and write the audit trail.
 *
 * Ailo is the system of record for rent, trust, tenancy, maintenance, inspections and owner comms:
 * nothing here reads from or writes to Ailo. HQ only records the reference a person typed.
 * Not available here (HQ screens only): archiving, restoring or deleting a property, adding a
 * property signed before HQ, and setting the business goal.
 */
import { formatAud } from "../../format";
import {
  AILO_STATUS_LABEL,
  HANDOVER_STEPS,
  HANDOVER_STEP_LABEL,
  HANDOVER_STEP_STATUS_LABEL,
  MANAGED_STATUS_LABEL,
  SERVICE_TYPE_LABEL,
  feeText,
  financialYearLabel,
  managedOfGoalText,
  paceText,
  parseBusinessSummary,
  parseManagedRef,
  propertyProblems,
  searchWords,
  serviceSplitText,
  type AiloStatus,
  type FeeBasis,
  type ManagedStatus,
} from "../../portfolio/rules";
import { PORTFOLIO_COLUMNS, propertyRowsOf, type PropertyRow } from "../../portfolio/queries";
import { LIMITS, candidatesText, changeLine, clean, compose, decideResolution, invalidText, isUuid, notFoundText, result, rowLimit, type Candidate } from "./core";
import { dbFailure, day, defineTool, link, logDb, resolveOpportunity, respond, today, type ToolContext, type ToolResult } from "./kit";
import {
  businessSummaryShape,
  createManagedPropertyShape,
  getManagedPropertyShape,
  listManagedPropertiesShape,
  setHandoverStepShape,
  updateManagedPropertyShape,
} from "./portfolio-schemas";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const path = (id: string) => `/hq/portfolio/${id}`;
const NONE = /^(none|clear|remove)$/i;

/** One list line (record content: goes inside the data block). */
function line(ctx: ToolContext, p: PropertyRow): string {
  const parts = [
    `${p.ref} ${clean(p.propertyAddress)}${p.suburb ? `, ${clean(p.suburb)}` : ""}`,
    p.ownerDisplayName ? `owner ${clean(p.ownerDisplayName)}` : null,
    SERVICE_TYPE_LABEL[p.serviceType],
    MANAGED_STATUS_LABEL[p.status],
    `handover ${p.handoverDone} of ${p.handoverTotal}`,
    `Ailo ${AILO_STATUS_LABEL[p.ailoStatus].toLowerCase()}${p.ailoReference ? ` (${clean(p.ailoReference, 60)})` : ""}`,
  ].filter(Boolean);
  return `- ${parts.join(" · ")} [id: ${p.id}] ${link(ctx, path(p.id))}`;
}

// ── resolving "MP-0001", an id or address words ──────────────

type Resolved = { ok: true; property: PropertyRow; note: string | null } | { ok: false; result: ToolResult };

const base = (ctx: ToolContext) => ctx.db.from("portfolio_overview").select(PORTFOLIO_COLUMNS).is("deleted_at", null);

async function rowsWhere(ctx: ToolContext, build: (q: ReturnType<typeof base>) => ReturnType<typeof base>, max: number): Promise<PropertyRow[]> {
  const { data, error } = await build(base(ctx)).limit(max);
  if (error) {
    logDb("managed property lookup", error);
    throw new Error(`managed property lookup ${error.code ?? ""}`);
  }
  return propertyRowsOf(data);
}

const candidate = (p: PropertyRow): Candidate => ({ id: p.id, label: `${p.ref} ${p.propertyAddress}`, detail: `${MANAGED_STATUS_LABEL[p.status]}${p.ownerDisplayName ? `, owner ${p.ownerDisplayName}` : ""}` });

export async function resolveProperty(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Resolved> {
  const q = query.trim();
  const n = parseManagedRef(q);
  const tagged = /^managed_property:([0-9a-f-]{36})$/i.exec(q);
  const id = tagged ? tagged[1] : isUuid(q) ? q : null;
  if (n !== null || id) {
    const hit = (await rowsWhere(ctx, (b) => (n !== null ? b.eq("ref_number", n) : b.eq("id", id!.toLowerCase())), 1))[0];
    if (hit) return { ok: true, property: hit, note: null };
    return { ok: false, result: result("not_found", notFoundText("managed property", q)) };
  }
  const words = searchWords(q);
  if (words.length < 2) return { ok: false, result: result("not_found", notFoundText("managed property", q)) };
  const close = await rowsWhere(ctx, (b) => b.or(`property_address.ilike.*${words}*,owner_display_name.ilike.*${words}*`).order("ref_number", { ascending: false }), LIMITS.candidates + 1);
  const exact = close.filter((p) => p.propertyAddress.trim().toLowerCase() === q.toLowerCase());
  const byId = new Map(close.map((p) => [p.id, p]));
  const r = decideResolution({ exact: exact.map(candidate), close: close.map(candidate), mode });
  if (r.kind === "one") {
    const p = byId.get(r.record.id)!;
    return { ok: true, property: p, note: r.how === "close" ? `No property's address is exactly "${clean(q, 80)}"; this is the only close match (${p.ref}).` : null };
  }
  if (r.kind === "none") return { ok: false, result: result("not_found", notFoundText("managed property", q)) };
  const t = candidatesText("managed property", q, r);
  return { ok: false, result: result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: r.candidates.map((c) => ({ id: c.id, label: c.label, detail: c.detail ?? null })) }) };
}

/** A refusal from the portfolio RPCs, in words (their messages are plain English). */
function rpcFailure(where: string, error: { code?: string | null; message?: string | null; hint?: string | null } | null): ToolResult {
  if (error && (error.code === "22023" || error.code === "23514" || error.code === "23505") && error.message && !/violates|constraint|relation/i.test(error.message)) {
    logDb(where, error);
    return result("invalid", `Not saved: ${error.message}. Nothing was changed.`, { code: error.code });
  }
  return dbFailure(where, error, { notFound: "That managed property or lead could not be found. It may have been archived. Nothing was changed." });
}

// ── list_managed_properties ──────────────────────────────────

export const listManagedProperties = defineTool({
  name: "list_managed_properties",
  title: "List managed properties",
  description:
    "Lists the properties Planted manages, from HQ's light record (newest first): MP number, address, owner, service (long-term residential or short-term accommodation), status (onboarding, active, offboarding, ended), handover progress (n of 9) and Ailo set-up status, with HQ links. Filters: words or MP-0001, status, service_type, ailo_status, handover_open. Use this FIRST for any portfolio question; it answers most in one call. For the overall numbers against the goal use business_summary instead. Rent, tenancies and maintenance are in Ailo, not HQ. Read-only.",
  inputSchema: listManagedPropertiesShape,
  annotations: READ,
  capability: "portfolio.read",
  kind: "read",
  handler: async (args, ctx) => {
    const max = rowLimit(args.limit);
    let q = ctx.db.from("portfolio_overview").select(PORTFOLIO_COLUMNS, { count: "exact" }).is("deleted_at", null);
    const n = args.query ? parseManagedRef(args.query) : null;
    if (n !== null) q = q.eq("ref_number", n);
    else if (args.query) {
      const w = searchWords(args.query);
      if (w) q = q.or(`property_address.ilike.*${w}*,suburb.ilike.*${w}*,owner_display_name.ilike.*${w}*,ailo_reference.ilike.*${w}*`);
    }
    if (args.status) q = q.eq("status", args.status);
    if (args.service_type) q = q.eq("service_type", args.service_type);
    if (args.ailo_status) q = q.eq("ailo_status", args.ailo_status);
    if (args.handover_open) q = q.lt("handover_done", HANDOVER_STEPS.length);
    const { data, error, count } = await q.order("ref_number", { ascending: false }).limit(max);
    if (error) return dbFailure("list_managed_properties", error);
    const rows = propertyRowsOf(data);
    const filters = [
      args.query ? `matching "${clean(args.query, 60)}"` : null,
      args.status ? `status ${MANAGED_STATUS_LABEL[args.status]}` : null,
      args.service_type ? SERVICE_TYPE_LABEL[args.service_type] : null,
      args.ailo_status ? `Ailo ${AILO_STATUS_LABEL[args.ailo_status].toLowerCase()}` : null,
      args.handover_open ? "handover not finished" : null,
    ].filter(Boolean);
    const scope = filters.length ? ` (${filters.join(", ")})` : "";
    if (rows.length === 0) return respond("empty", `No managed properties found${scope}. HQ lists only the properties people have recorded.`, null, { count: 0 });
    const total = count ?? rows.length;
    const head = `${total} managed propert${total === 1 ? "y" : "ies"}${scope}, newest first${total > rows.length ? `; showing ${rows.length}` : ""}. All: ${link(ctx, "/hq/portfolio")}`;
    return respond("ok", head, rows.map((p) => line(ctx, p)), { count: rows.length, total, ids: rows.map((p) => p.id) });
  },
});

// ── get_managed_property ─────────────────────────────────────

export const getManagedProperty = defineTool({
  name: "get_managed_property",
  title: "Open a managed property",
  description:
    "Opens ONE managed property by its number (MP-0001), id or address words: owner, service, fee, dates, status, the Ailo reference and status, where it came from (the signed lead, or signed before HQ), the nine handover steps with their status and notes, and the HQ link. Use only when the person asks about that specific property; for several use list_managed_properties, never repeated calls. If the words match several properties you get the candidates instead. Read-only.",
  inputSchema: getManagedPropertyShape,
  annotations: READ,
  capability: "portfolio.read",
  kind: "read",
  handler: async (args, ctx) => {
    const found = await resolveProperty(ctx, args.property, "read");
    if (!found.ok) return found.result;
    const p = found.property;
    const steps = await ctx.db.from("property_handover_steps").select("step, status, note, completed_at").eq("property_id", p.id).order("step");
    if (steps.error) return dbFailure("get_managed_property steps", steps.error);
    const url = link(ctx, path(p.id));
    const lines = [
      `${p.ref}: ${clean(p.propertyAddress)}${p.suburb ? `, ${clean(p.suburb)}` : ""}`,
      `Status: ${MANAGED_STATUS_LABEL[p.status]}${p.managedFrom ? `, managed from ${day(ctx, p.managedFrom)}` : ""}${p.endedOn ? `, ended ${day(ctx, p.endedOn)}` : ""}`,
      `Service: ${SERVICE_TYPE_LABEL[p.serviceType]}`,
      `Owner: ${p.ownerDisplayName ? clean(p.ownerDisplayName) : "not recorded"}${p.ownerPhone ? `, ${clean(p.ownerPhone, 40)}` : ""}`,
      `Fee: ${clean(feeText(p.feeBasis, p.feePercent, p.feeNotes), LIMITS.medium)}`,
      p.agreementSignedOn ? `Agreement signed: ${day(ctx, p.agreementSignedOn)}` : null,
      `Came from: ${p.opportunityId ? `the signed lead ${clean(p.opportunityProspectName ?? "")} [opportunity id: ${p.opportunityId}]` : `signed before HQ (${clean(p.manualOriginNote ?? "", LIMITS.medium)})`}`,
      `Ailo: ${AILO_STATUS_LABEL[p.ailoStatus]}${p.ailoReference ? `, reference ${clean(p.ailoReference, 100)}` : ", no reference recorded"} (Ailo holds rent, trust, tenancy and maintenance; HQ only records the reference)`,
      `Handover: ${p.handoverDone} of ${p.handoverTotal} steps done`,
      ...(steps.data ?? []).map((s) => `  ${HANDOVER_STEP_LABEL[s.step as keyof typeof HANDOVER_STEP_LABEL] ?? s.step}: ${HANDOVER_STEP_STATUS_LABEL[s.status as keyof typeof HANDOVER_STEP_STATUS_LABEL] ?? s.status}${s.note ? ` (${clean(s.note, 200)})` : ""}`),
      p.notes ? `Notes: ${clean(p.notes, LIMITS.long, { multiline: true })}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", [`Managed property ${p.ref} [id: ${p.id}]: ${url}`, found.note ?? ""], lines, { id: p.id, ref: p.ref, url, status: p.status });
  },
});

// ── create_managed_property ──────────────────────────────────

type RpcProperty = { managed_property_id?: string; ref?: string; changed?: boolean; changed_fields?: string[] };

export const createManagedProperty = defineTool({
  name: "create_managed_property",
  title: "Make a signed lead a managed property",
  description:
    "Makes ONE signed lead (an opportunity at management_signed) a managed property in HQ, once: the service (long-term residential or short-term accommodation), and optionally the fee, start date, status (onboarding by default; active needs managed_from) and the Ailo reference if it already exists. The address, suburb and owner come from the lead unless given. Creates the nine-step Ailo handover checklist. Saved as you and audited. Returns the new MP number and HQ link. Before calling, say what will be recorded and make sure the person wants it. It refuses a lead that is not signed or is already a managed property; it does not sign a lead, add a property signed before HQ, archive or delete anything.",
  inputSchema: createManagedPropertyShape,
  annotations: WRITE,
  capability: "portfolio.write",
  kind: "write",
  handler: async (args, ctx) => {
    const opp = await resolveOpportunity(ctx, args.opportunity, "write");
    if (!opp.ok) return opp.result;
    const feeBasis = (args.fee_basis ?? (args.fee_percent !== undefined ? "percent_of_rent" : null)) as FeeBasis | null;
    const problems = propertyProblems(
      {
        status: (args.status ?? "onboarding") as ManagedStatus,
        managedFrom: args.managed_from ?? null,
        endedOn: null,
        ailoStatus: "not_started",
        ailoReference: args.ailo_reference ?? null,
        feeBasis,
        feePercent: args.fee_percent ?? null,
        agreementSignedOn: null,
      },
      today(ctx),
    );
    if (Object.keys(problems).length) return respond("invalid", invalidText(problems));
    const { data, error } = await ctx.db.rpc("convert_to_managed_property", {
      p_opportunity_id: opp.record.id,
      p_service_type: args.service_type,
      p_property_address: args.property_address || undefined,
      p_suburb: args.suburb || undefined,
      p_owner_name: args.owner_name || undefined,
      p_fee_basis: feeBasis ?? undefined,
      p_fee_percent: args.fee_percent,
      p_fee_notes: args.fee_notes || undefined,
      p_managed_from: args.managed_from,
      p_status: args.status,
      p_ailo_reference: args.ailo_reference || undefined,
      p_notes: args.notes || undefined,
    });
    const out = data as RpcProperty | null;
    if (error || !out?.managed_property_id) return rpcFailure("create_managed_property", error);
    const made = await rowsWhere(ctx, (b) => b.eq("id", out.managed_property_id!), 1);
    const p = made[0];
    const url = link(ctx, path(out.managed_property_id));
    const lines = p
      ? [line(ctx, p), `Fee: ${clean(feeText(p.feeBasis, p.feePercent, p.feeNotes))}`, `Came from the signed lead ${clean(opp.record.label)}`, "Handover: 0 of 9 steps done"]
      : [`${out.ref} from the signed lead ${clean(opp.record.label)}`];
    return respond("ok", [`Made the signed lead a managed property: ${out.ref} [id: ${out.managed_property_id}]: ${url}`, opp.note ?? ""], lines, { id: out.managed_property_id, ref: out.ref, url, created: "managed_property" });
  },
});

// ── update_managed_property ──────────────────────────────────

export const updateManagedProperty = defineTool({
  name: "update_managed_property",
  title: "Update a managed property",
  description:
    "Changes ONE managed property, found by its number (MP-0001), id or exact address: its status (onboarding, active, offboarding, ended), dates (managed_from, ended_on), the Ailo reference and Ailo status, the service, the fee, address, suburb, owner name or notes. Rules: active needs managed_from (today or earlier); ended needs ended_on; Ailo live needs a reference; reopening an ended property needs a director or administrator. Only the fields given change; the result lists exactly what changed (before and after) and the audit trail records it. Before calling, say what will change and make sure the person wants it. It never archives or deletes a property, and it does not touch Ailo.",
  inputSchema: updateManagedPropertyShape,
  annotations: WRITE,
  capability: "portfolio.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveProperty(ctx, args.property, "write");
    if (!found.ok) return found.result;
    const cur = found.property;
    const clear = (v: string | undefined) => (v === undefined ? undefined : NONE.test(v) ? "" : v);
    const ailoReference = clear(args.ailo_reference);
    const feeBasis = (args.fee_basis ?? (args.fee_percent !== undefined ? "percent_of_rent" : cur.feeBasis)) as FeeBasis | null;
    const after = {
      status: (args.status ?? cur.status) as ManagedStatus,
      managedFrom: args.managed_from ?? cur.managedFrom,
      endedOn: args.ended_on ?? (args.status && args.status !== "ended" && cur.status === "ended" ? null : cur.endedOn),
      ailoStatus: (args.ailo_status ?? cur.ailoStatus) as AiloStatus,
      ailoReference: ailoReference === undefined ? cur.ailoReference : ailoReference || null,
      feeBasis,
      feePercent: args.fee_percent ?? (feeBasis === "percent_of_rent" ? cur.feePercent : null),
      agreementSignedOn: cur.agreementSignedOn,
    };
    const problems = propertyProblems(after, today(ctx));
    // The date rules apply to dates being changed (as in the database); an old start date stays valid.
    if (Object.keys(problems).length) return respond("invalid", invalidText(problems), [`Property: ${cur.ref} ${clean(cur.propertyAddress)} (${MANAGED_STATUS_LABEL[cur.status]})`]);

    const { data, error } = await ctx.db.rpc("update_managed_property", {
      p_id: cur.id,
      p_property_address: args.property_address,
      p_suburb: clear(args.suburb),
      p_owner_name: args.owner_name,
      p_service_type: args.service_type,
      p_fee_basis: args.fee_basis,
      p_fee_percent: args.fee_percent,
      p_fee_notes: clear(args.fee_notes),
      p_managed_from: args.managed_from,
      p_status: args.status,
      p_ended_on: args.ended_on,
      p_ailo_reference: ailoReference,
      p_ailo_status: args.ailo_status,
      p_notes: clear(args.notes),
      p_note: args.note,
      p_expected_updated_at: cur.updatedAt,
    });
    if (error) return rpcFailure("update_managed_property", error);
    const out = data as (RpcProperty & Record<string, unknown>) | null;
    const url = link(ctx, path(cur.id));
    if (out?.changed === false) return respond("unchanged", `Nothing to change: ${cur.ref} already has those values. ${url}`, [`Property: ${cur.ref} ${clean(cur.propertyAddress)}`], { id: cur.id, url });
    const fields = new Set(out?.changed_fields ?? []);
    const lines = [`Property: ${cur.ref} ${clean(cur.propertyAddress)}`];
    const s = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));
    if (fields.has("status")) lines.push(changeLine("Status", MANAGED_STATUS_LABEL[cur.status], MANAGED_STATUS_LABEL[(out?.status as ManagedStatus) ?? cur.status]));
    if (fields.has("managed_from")) lines.push(changeLine("Managed from", cur.managedFrom ? day(ctx, cur.managedFrom) : null, s(out?.managed_from) ? day(ctx, s(out?.managed_from)) : null));
    if (fields.has("ended_on")) lines.push(changeLine("Ended on", cur.endedOn ? day(ctx, cur.endedOn) : null, s(out?.ended_on) ? day(ctx, s(out?.ended_on)) : null));
    if (fields.has("ailo_reference")) lines.push(changeLine("Ailo reference", cur.ailoReference, s(out?.ailo_reference)));
    if (fields.has("ailo_status")) lines.push(changeLine("Ailo status", AILO_STATUS_LABEL[cur.ailoStatus], AILO_STATUS_LABEL[(out?.ailo_status as AiloStatus) ?? cur.ailoStatus]));
    if (fields.has("service_type")) lines.push(changeLine("Service", SERVICE_TYPE_LABEL[cur.serviceType], args.service_type ? SERVICE_TYPE_LABEL[args.service_type] : null));
    if (fields.has("fee_basis") || fields.has("fee_percent") || fields.has("fee_notes")) {
      lines.push(changeLine("Fee", feeText(cur.feeBasis, cur.feePercent, cur.feeNotes), feeText((out?.fee_basis as FeeBasis | null) ?? null, (out?.fee_percent as number | null) ?? null, clear(args.fee_notes) ?? cur.feeNotes)));
    }
    if (fields.has("property_address")) lines.push(changeLine("Address", cur.propertyAddress, s(out?.property_address)));
    if (fields.has("suburb")) lines.push(changeLine("Suburb", cur.suburb, s(out?.suburb)));
    if (fields.has("owner_name")) lines.push(changeLine("Owner name", cur.ownerName, s(out?.owner_name)));
    if (fields.has("notes")) lines.push(changeLine("Notes", cur.notes, clear(args.notes) || null));
    if (args.note) lines.push(`Note: ${clean(args.note, LIMITS.medium)}`);
    return respond("ok", `Updated managed property ${cur.ref} [id: ${cur.id}]: ${url}`, lines, { id: cur.id, ref: cur.ref, url, changed: [...fields] });
  },
});

// ── set_handover_step ────────────────────────────────────────

export const setHandoverStep = defineTool({
  name: "set_handover_step",
  title: "Set a handover step",
  description:
    "Sets ONE of the nine Ailo handover steps on a managed property (MP-0001, id or address) to not_started, in_progress, done or not_applicable (not_applicable needs a note). The step's status and note become exactly what is given. Saved as you and audited. Completing steps never changes the property's status or Ailo status: those are separate changes (update_managed_property). Before calling, say which step will change and make sure the person wants it.",
  inputSchema: setHandoverStepShape,
  annotations: WRITE,
  capability: "portfolio.write",
  kind: "write",
  handler: async (args, ctx) => {
    if (args.status === "not_applicable" && !args.note) return respond("invalid", "Not saved: a step marked not applicable needs a note saying why. Nothing was changed.");
    const found = await resolveProperty(ctx, args.property, "write");
    if (!found.ok) return found.result;
    const p = found.property;
    const { data, error } = await ctx.db.rpc("set_handover_step", { p_property_id: p.id, p_step: args.step, p_status: args.status, ...(args.note ? { p_note: args.note } : {}) });
    if (error) return rpcFailure("set_handover_step", error);
    const out = data as { changed?: boolean; handover_done_count?: number; handover_total?: number } | null;
    const url = link(ctx, path(p.id));
    const stepLine = `${HANDOVER_STEP_LABEL[args.step]}: ${HANDOVER_STEP_STATUS_LABEL[args.status]}${args.note ? ` (${clean(args.note, 200)})` : ""}`;
    if (out?.changed === false) return respond("unchanged", `Nothing to change: that step on ${p.ref} is already set that way. ${url}`, [stepLine], { id: p.id, url });
    return respond("ok", `Set a handover step on ${p.ref} [id: ${p.id}]: ${url}`, [`Property: ${p.ref} ${clean(p.propertyAddress)}`, stepLine, `Handover: ${out?.handover_done_count ?? "?"} of ${out?.handover_total ?? 9} steps done`], {
      id: p.id,
      url,
      step: args.step,
      status: args.status,
    });
  },
});

// ── business_summary ─────────────────────────────────────────

export const businessSummary = defineTool({
  name: "business_summary",
  title: "Business at a glance",
  description:
    "The CEO's view of the business in one call: managed properties against the goal (ACTUAL: counted from HQ records; managed means active or onboarding; long-term residential and short-term accommodation shown separately), managements signed this month and this financial year (SIGNED: from HQ records), the open pipeline by stage with its yearly value (an ESTIMATE: people's own guesses, never income), leads needing attention, and the pace needed to reach the goal (only when the owner has set a goal date; none is ever invented). Use this for any 'how is the business going' or 'how far to 20' question instead of several other calls. Needs growth.read or portfolio.read; sections your role does not include are left out and said so. Read-only.",
  inputSchema: businessSummaryShape,
  annotations: READ,
  capability: null,
  kind: "read",
  handler: async (_args, ctx) => {
    const caps = ctx.staff.capabilities;
    if (!caps.includes("growth.read") && !caps.includes("portfolio.read")) {
      return result("refused", 'Refused: your HQ role includes neither growth.read nor portfolio.read, which "Business at a glance" needs. Nothing was read. Ask a director if you think your role should include it.');
    }
    const { data, error } = await ctx.db.rpc("business_summary");
    if (error) return dbFailure("business_summary", error);
    const s = parseBusinessSummary(data);
    if (!s) return result("error", "Something went wrong reading HQ. Try again in a moment.");
    const lines: string[] = [];
    if (s.managed) {
      lines.push(
        s.managed.recorded === 0
          ? `Managed (actual): no managed properties recorded yet. Goal: ${s.goal.target}.`
          : `Managed (actual, from HQ records): ${managedOfGoalText(s.managed.managed, s.goal.target)}; ${serviceSplitText(s.managed.longTerm.managed, s.managed.shortTerm.managed)}. Active ${s.managed.active}, onboarding ${s.managed.onboarding}, offboarding ${s.managed.offboarding}, ended ${s.managed.ended}. ${s.managed.handoverOpen} managed propert${s.managed.handoverOpen === 1 ? "y has" : "ies have"} handover steps still open.`,
      );
    }
    if (s.signed) {
      lines.push(`Signed (from HQ records): ${s.signed.thisMonth} this month, ${s.signed.last30Days} in the last 30 days, ${s.signed.financialYear} in the ${financialYearLabel(s.signed.financialYearStart)} financial year (from ${day(ctx, s.signed.financialYearStart)}).`);
    }
    if (s.pipeline) {
      const stages = Object.entries(s.pipeline.byStage)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k.replace(/_/g, " ")} ${n}`)
        .join(", ");
      lines.push(`Open pipeline (actual count): ${s.pipeline.open} lead${s.pipeline.open === 1 ? "" : "s"}${stages ? ` (${stages})` : ""}.`);
      lines.push(
        s.pipeline.estimatedYearlyValueCents > 0
          ? `Estimated yearly value of the open pipeline (ESTIMATE, people's own guesses, not income): ${formatAud(s.pipeline.estimatedYearlyValueCents)}; ${s.pipeline.withEstimate} lead(s) carry an estimate, ${s.pipeline.withoutEstimate} do not.`
          : "Estimated yearly value of the open pipeline: none estimated yet.",
      );
    }
    if (s.leadsNeedingAttention !== null) lines.push(`Leads needing attention (actual): ${s.leadsNeedingAttention} (no owner, no next step, or overdue).`);
    const pace = paceText(s.pace);
    lines.push(pace ? `Pace to the goal of ${s.goal.target} by ${s.goal.date ? day(ctx, s.goal.date) : "the goal date"} (calculation): ${pace}` : "Pace: no goal date has been set, so no pace is shown. A director sets it in HQ Settings.");
    for (const n of s.notes) lines.push(`Note: ${n}`);
    return respond("ok", `Business at a glance, as of ${day(ctx, s.asOf)}. Labels: actual = counted from HQ records; signed = managements marked signed in HQ; estimate = people's own yearly-value guesses, never income. Reports: ${link(ctx, "/hq/reports")}`, lines, {
      as_of: s.asOf,
      goal: s.goal,
      managed: s.managed,
      signed: s.signed,
      pipeline: s.pipeline,
      leads_needing_attention: s.leadsNeedingAttention,
      pace: s.pace,
    });
  },
});
