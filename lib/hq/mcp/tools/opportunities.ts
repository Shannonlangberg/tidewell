/*
 * Leads (the pipeline beyond referrals) over MCP: add a lead, open one, list them, change one, log a
 * call or meeting notes on one, and list recent activity for any contact, organisation, contractor
 * or lead. Reads need growth.read, writes growth.write; every query runs as the person (RLS) and
 * every write goes through the hq RPCs (create_opportunity, update_opportunity,
 * log_opportunity_activity), which check the capability again, validate, and are audited. Input is
 * re-read with the HQ form's own validators first, so the screen and the chat give the same answers.
 *
 * Not here, deliberately: moving a lead's stage (move_opportunity), signing, marking lost (HQ
 * screen only, where the reason is recorded), archiving or deleting anything.
 */
import { INTERACTION_LABEL, STAGE_LABEL, TASK_STATUS_LABEL, type InteractionType, type OpportunityStage, type TaskStatus } from "../../constants";
import { FormReader } from "../../forms";
import { formatAud } from "../../format";
import { orIlike } from "../../growth/params";
import { nowLocalInput } from "../../growth/dates";
import { readLeadActivityForm } from "../../leads/forms";
import {
  LEAD_FORM_LABELS,
  LEAD_SOURCE_LABEL,
  checkExpectedClose,
  checkFollowUp,
  classifyLeadError,
  duplicateReasonText,
  isLeadSource,
  leadFieldError,
  parseDuplicate,
  readLeadFields,
  type LeadDbError,
} from "../../leads/rules";
import { HQ_PATHS, LIMITS, appendNote, changeLine, clean, invalidText, plural, result, rowLimit } from "./core";
import { can, day, dbFailure, defineTool, link, logDb, resolveContact, resolveContractor, resolveOpportunity, resolveOrganisation, resolveStaff, respond, today, when, type ToolContext } from "./kit";
import {
  createOpportunityShape,
  getOpportunityShape,
  listInteractionsShape,
  listOpportunitiesShape,
  logOpportunityActivityShape,
  updateOpportunityShape,
} from "./schemas";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const NONE = /^(none|clear|remove|-)$/i;
const NOTES_MAX = 2000;

const leadPath = (id: string) => `/hq/growth/opportunities/${id}`;
const stageText = (s: string | null | undefined) => (s && s in STAGE_LABEL ? STAGE_LABEL[s as OpportunityStage] : (s ?? ""));
const sourceText = (s: string | null | undefined) => (isLeadSource(s) ? LEAD_SOURCE_LABEL[s] : (s ?? ""));

function form(values: Record<string, string | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) fd.set(k, v);
  return fd;
}

async function staffRef(ctx: ToolContext, raw: string | undefined) {
  if (!raw) return { ok: true as const, id: null as string | null, label: null as string | null };
  const r = await resolveStaff(ctx, raw, "write");
  if (!r.ok) return r;
  return { ok: true as const, id: r.record.id, label: r.record.label };
}

/** A database refusal for a lead write, in words. */
function leadFailure(where: string, error: LeadDbError) {
  logDb(where, error);
  const kind = classifyLeadError(error);
  if (kind === "permission") return result("refused", "Refused by HQ: your role may not change leads. Nothing was changed.");
  if (kind === "not_found") return result("not_found", "That lead could not be found. It may have been archived. Nothing was changed.");
  if (kind === "contact_not_found") return result("not_found", "That contact could not be found. Nothing was changed.");
  if (kind === "stale") return result("unchanged", "Not changed: someone changed this lead a moment ago. Open it again and retry.");
  if (kind === "future") return result("invalid", "Not saved: the time can't be in the future.");
  if (kind === "task_assignee_inactive") return result("invalid", "Not saved: the task must be for an active member of staff.");
  const field = leadFieldError(kind);
  if (field) return result("invalid", `Not saved: ${field.message}`);
  return result("error", "We couldn't save that. Nothing was changed. Try again in a moment.");
}

type OverviewRow = {
  id: string | null;
  ref: string | null;
  prospect_name: string | null;
  property_suburb: string | null;
  stage: OpportunityStage | null;
  source: string | null;
  assigned_to_name: string | null;
  next_action: string | null;
  next_action_due: string | null;
  next_action_overdue: boolean | null;
  needs_attention: boolean | null;
  is_open: boolean | null;
  estimated_annual_value_cents: number | null;
  partner_organisation_name: string | null;
};
const LIST_COLS =
  "id, ref, prospect_name, property_suburb, stage, source, assigned_to_name, next_action, next_action_due, next_action_overdue, needs_attention, is_open, estimated_annual_value_cents, partner_organisation_name";

function listLine(ctx: ToolContext, r: OverviewRow): string {
  const parts = [
    `${r.ref} ${clean(r.prospect_name)}`,
    r.property_suburb ? clean(r.property_suburb) : null,
    stageText(r.stage),
    r.partner_organisation_name ? `via ${clean(r.partner_organisation_name)}` : sourceText(r.source),
    r.assigned_to_name ? `owner ${clean(r.assigned_to_name)}` : r.is_open ? "NO OWNER" : null,
    r.is_open ? (r.next_action ? `next: ${clean(r.next_action)}${r.next_action_due ? ` by ${day(ctx, r.next_action_due)}${r.next_action_overdue ? " (OVERDUE)" : ""}` : ""}` : "NO NEXT STEP") : null,
    r.estimated_annual_value_cents !== null ? `est. ${formatAud(r.estimated_annual_value_cents)}/yr` : null,
  ].filter(Boolean);
  return `- ${parts.join(" · ")} [id: ${r.id}] ${link(ctx, leadPath(r.id as string))}`;
}

// ── create_opportunity ───────────────────────────────────────

export const createOpportunity = defineTool({
  name: "create_opportunity",
  title: "Add a lead",
  description:
    "Adds ONE lead (a landlord or property owner) to the pipeline that did NOT come through a referral partner: our own marketing, a website enquiry, a direct approach, or other. Needs the person's name, where it came from, the next action and its follow-up date (work out dates like \"tomorrow\" from today); the owner defaults to you. Also adds the person as a landlord contact (flagged to verify) unless create_contact is false. If HQ already has a lead or landlord with the same phone, email, or name in the same suburb, it adds nothing and shows that record: ask the person, and only if they confirm it is someone else call again with confirm_distinct true. A partner's introduction is NOT a lead here: use record_referral. Returns the LEAD number and the HQ link.",
  inputSchema: createOpportunityShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    const owner = await staffRef(ctx, args.owner);
    if (!owner.ok) return owner.result;
    const f = new FormReader(
      form({
        prospect_name: args.prospect_name,
        prospect_phone: args.prospect_phone,
        prospect_email: args.prospect_email,
        property_suburb: args.property_suburb,
        property_address: args.property_address,
        source: args.source,
        assigned_to: owner.id,
        next_action: args.next_action,
        next_action_due: args.follow_up_date,
        expected_close_date: args.expected_close_date,
        estimated_value: args.estimated_annual_value !== undefined ? String(args.estimated_annual_value) : null,
        notes: args.notes,
        confirm_distinct: args.confirm_distinct ? "on" : null,
      }),
    );
    const v = readLeadFields(f, { today: today(ctx), staffId: ctx.staff.id });
    if (!f.ok || !v.source || !v.nextActionDue) return respond("invalid", invalidText(f.errors, { ...LEAD_FORM_LABELS, next_action_due: "Follow-up date" }));

    const { data, error } = await ctx.db.rpc("create_opportunity", {
      p_prospect_name: v.prospectName,
      p_prospect_phone: v.prospectPhone ?? undefined,
      p_prospect_email: v.prospectEmail ?? undefined,
      p_property_suburb: v.propertySuburb ?? undefined,
      p_property_address: v.propertyAddress ?? undefined,
      p_source: v.source,
      p_assigned_to: v.assignedTo ?? undefined,
      p_next_action: v.nextAction,
      p_next_action_due: v.nextActionDue,
      p_expected_close_date: v.expectedCloseDate ?? undefined,
      p_estimated_annual_value_cents: v.estimateCents ?? undefined,
      p_notes: v.notes ?? undefined,
      p_create_contact: args.create_contact ?? true,
      p_confirm_distinct: v.confirmDistinct,
    });
    if (error) {
      if (classifyLeadError(error) === "duplicate") {
        logDb("create_opportunity", error);
        const dup = parseDuplicate(error.details);
        let existing: string | null = null;
        let url: string | null = null;
        if (dup?.kind === "opportunity") {
          const r = await ctx.db.from("opportunity_overview").select(LIST_COLS).eq("id", dup.id).maybeSingle();
          if (r.data) existing = listLine(ctx, r.data as OverviewRow);
          url = link(ctx, leadPath(dup.id));
        } else if (dup?.kind === "contact") {
          const r = await ctx.db.from("contact_directory").select("full_name, phone, email, location").eq("id", dup.id).maybeSingle();
          if (r.data) existing = `- Landlord contact ${clean(r.data.full_name)}${r.data.location ? ` (${clean(r.data.location)})` : ""} [id: ${dup.id}]`;
          url = link(ctx, HQ_PATHS.contact(dup.id));
        }
        return respond(
          "unchanged",
          `Not added: HQ already has a ${dup?.kind === "contact" ? "landlord contact" : "lead"} with ${dup ? duplicateReasonText(dup.reason) : "the same details"}${url ? `: ${url}` : ""}. Ask the person whether this is the same landlord. Only if they say it is someone else, call create_opportunity again with confirm_distinct: true.`,
          existing ? [existing] : null,
          { duplicate: dup ?? null },
        );
      }
      return leadFailure("create_opportunity", error);
    }
    const out = (data ?? {}) as { opportunity_id?: string; ref?: string; owner_contact_id?: string | null; contact_created?: boolean };
    if (!out.opportunity_id) return respond("error", "HQ did not confirm the lead was saved. Check the pipeline before trying again.");
    const url = link(ctx, leadPath(out.opportunity_id));
    const lines = [
      `${out.ref}: ${clean(v.prospectName)}`,
      v.prospectPhone ? `Phone: ${clean(v.prospectPhone)}` : null,
      v.prospectEmail ? `Email: ${clean(v.prospectEmail)}` : null,
      v.propertySuburb || v.propertyAddress ? `Property: ${clean([v.propertyAddress, v.propertySuburb].filter(Boolean).join(", "))}` : null,
      `Came from: ${LEAD_SOURCE_LABEL[v.source]}`,
      `Owner: ${clean(owner.label ?? ctx.staff.fullName)}`,
      `Next action: ${clean(v.nextAction)}, due ${day(ctx, v.nextActionDue)}`,
      v.expectedCloseDate ? `Expected to sign by: ${day(ctx, v.expectedCloseDate)}` : null,
      v.estimateCents !== null ? `Estimated yearly value: ${formatAud(v.estimateCents)} (an estimate)` : null,
      out.owner_contact_id ? (out.contact_created ? "Added as a landlord contact (to verify)" : "Linked to the existing contact with that email") : "No contact added",
      "Stage: Introduction received",
    ].filter((l): l is string => !!l);
    return respond("ok", `Added 1 lead (${out.ref}) [id: ${out.opportunity_id}]: ${url}`, lines, { id: out.opportunity_id, ref: out.ref ?? null, owner_contact_id: out.owner_contact_id ?? null, url, created: "opportunity" });
  },
});

// ── get_opportunity ──────────────────────────────────────────

export const getOpportunity = defineTool({
  name: "get_opportunity",
  title: "Open a lead",
  description:
    "Opens ONE lead in full, by name, LEAD-0007, REF-0007 or id: stage and days in it, where it came from, owner, next action and follow-up date, expected close, estimate, the landlord contact, the credited partner (if any), the latest activity and open tasks, with the HQ link. Use only when asked about that specific lead; for several, use list_opportunities, never repeated get_opportunity calls. Read-only.",
  inputSchema: getOpportunityShape,
  annotations: READ,
  capability: "growth.read",
  kind: "read",
  handler: async ({ opportunity }, ctx) => {
    const found = await resolveOpportunity(ctx, opportunity, "read");
    if (!found.ok) return found.result;
    const { data: o, error } = await ctx.db.from("opportunity_overview").select("*").eq("id", found.record.id).maybeSingle();
    if (error) return dbFailure("get_opportunity", error);
    if (!o?.id) return respond("not_found", "That lead could not be found. It may have been archived.");
    const [acts, tasks] = await Promise.all([
      ctx.db.from("interactions").select("occurred_at, interaction_type, summary, next_action, staff:staff_profiles(full_name)").eq("opportunity_id", o.id).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(5),
      ctx.db.from("tasks").select("id, title, status, due_date").eq("related_opportunity_id", o.id).is("deleted_at", null).in("status", ["to_do", "in_progress", "waiting"]).limit(10),
    ]);
    if (acts.error || tasks.error) return dbFailure("get_opportunity activity", acts.error ?? tasks.error);
    type Act = { occurred_at: string; interaction_type: InteractionType; summary: string; next_action: string | null; staff: { full_name: string } | null };
    const url = link(ctx, leadPath(o.id));
    const lines = [
      `${o.ref}: ${clean(o.prospect_name)}`,
      `Stage: ${stageText(o.stage)}${o.is_open ? `, ${o.days_in_stage ?? 0} day(s) in this stage` : ""}`,
      o.signed_at ? `Signed: ${day(ctx, o.signed_at)}${o.management_reference ? `, reference ${clean(o.management_reference)}` : ""}` : null,
      o.stage === "lost" ? `Did not proceed: ${clean(o.lost_reason_code ?? "")}${o.lost_reason ? ` - ${clean(o.lost_reason, LIMITS.medium)}` : ""}` : null,
      `Came from: ${sourceText(o.source)}${o.partner_organisation_name || o.partner_contact_name ? ` (credited to ${clean([o.partner_organisation_name, o.partner_contact_name].filter(Boolean).join(", "))}${o.credited_ref_label ? `, ${o.credited_ref_label}` : ""})` : ""}`,
      `Owner: ${o.assigned_to_name ? clean(o.assigned_to_name) : "nobody"}`,
      o.is_open ? `Next action: ${o.next_action ? clean(o.next_action) : "none"}${o.next_action_due ? `, due ${day(ctx, o.next_action_due)}${o.next_action_overdue ? " (overdue)" : ""}` : ""}` : null,
      o.expected_close_date ? `Expected to sign by: ${day(ctx, o.expected_close_date)}` : null,
      o.estimated_annual_value_cents !== null ? `Estimated yearly value: ${formatAud(o.estimated_annual_value_cents)} (an estimate)` : null,
      o.property_suburb || o.property_address ? `Property: ${clean([o.property_address, o.property_suburb].filter(Boolean).join(", "))}` : null,
      o.prospect_phone ? `Phone: ${clean(o.prospect_phone)}` : null,
      o.prospect_email ? `Email: ${clean(o.prospect_email)}` : null,
      o.owner_contact_id ? `Landlord contact: ${clean(o.owner_contact_name ?? "")} [id: ${o.owner_contact_id}]` : null,
      o.notes ? `Notes: ${clean(o.notes, LIMITS.long, { multiline: true })}` : null,
      (acts.data ?? []).length ? "Latest activity (newest first):" : "Activity: none logged",
      ...((acts.data ?? []) as unknown as Act[]).map(
        (a) => `- ${when(ctx, a.occurred_at)}, ${INTERACTION_LABEL[a.interaction_type] ?? a.interaction_type}${a.staff ? ` by ${clean(a.staff.full_name)}` : ""}: ${clean(a.summary, LIMITS.medium)}${a.next_action ? ` | next: ${clean(a.next_action)}` : ""}`,
      ),
      (tasks.data ?? []).length ? "Open tasks:" : null,
      ...(tasks.data ?? []).map((t) => `- ${clean(t.title)} (${TASK_STATUS_LABEL[t.status as TaskStatus]}${t.due_date ? `, due ${day(ctx, t.due_date)}` : ""}) [id: ${t.id}]`),
    ].filter((l): l is string => !!l);
    return respond("ok", [found.note ?? "", `Lead ${o.ref} [id: ${o.id}]: ${url}`], lines, { id: o.id, ref: o.ref, url, stage: o.stage });
  },
});

// ── list_opportunities ───────────────────────────────────────

export const listOpportunities = defineTool({
  name: "list_opportunities",
  title: "List leads",
  description:
    "Lists leads in the pipeline in ONE call, preferred over opening leads one by one: open leads by default (oldest follow-up first), each with its LEAD number, suburb, stage, source or credited partner, owner, next action and follow-up date (overdue marked) and estimate, with HQ links. Filters: stage, owner (\"me\" or a name), source, needs_attention (no owner, no next step or overdue), overdue, include_closed, words in the name or suburb. Use pipeline_summary for counts per stage. Read-only.",
  inputSchema: listOpportunitiesShape,
  annotations: READ,
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    let q = ctx.db.from("opportunity_overview").select(LIST_COLS, { count: "exact" });
    const notes: string[] = [];
    if (args.stage) {
      q = q.eq("stage", args.stage);
      notes.push(`at ${stageText(args.stage)}`);
    } else if (!args.include_closed) {
      q = q.eq("is_open", true);
      notes.push("open");
    }
    if (args.owner) {
      const who = await resolveStaff(ctx, args.owner, "read");
      if (!who.ok) return who.result;
      q = q.eq("assigned_to", who.record.id);
      notes.push(`owned by ${clean(who.record.label)}`);
    }
    if (args.source) {
      q = q.eq("source", args.source);
      notes.push(`from ${sourceText(args.source)}`);
    }
    if (args.needs_attention) {
      q = q.eq("needs_attention", true);
      notes.push("needing attention");
    }
    if (args.overdue) {
      q = q.eq("next_action_overdue", true);
      notes.push("follow-up overdue");
    }
    const filter = orIlike(["prospect_name", "property_suburb"], args.query ?? "");
    if (filter) {
      q = q.or(filter);
      notes.push(`matching "${clean(args.query, 60)}"`);
    }
    const { data, error, count } = await q.order("next_action_due", { ascending: true, nullsFirst: true }).order("stage_changed_at", { ascending: true }).limit(n);
    if (error) return dbFailure("list_opportunities", error);
    const rows = (data ?? []) as OverviewRow[];
    const scope = notes.length ? ` (${notes.join(", ")})` : "";
    if (rows.length === 0) return respond("empty", `No leads found${scope}. Pipeline: ${link(ctx, HQ_PATHS.pipeline())}`, null, { count: 0 });
    const total = count ?? rows.length;
    return respond("ok", `${plural(total, "lead")}${scope}${total > rows.length ? `, showing ${rows.length}` : ""}. Pipeline: ${link(ctx, HQ_PATHS.pipeline())}`, rows.map((r) => listLine(ctx, r)), {
      count: total,
      ids: rows.map((r) => r.id),
    });
  },
});

// ── update_opportunity ───────────────────────────────────────

export const updateOpportunity = defineTool({
  name: "update_opportunity",
  title: "Update a lead",
  description:
    "Changes ONE lead found by name, LEAD-0007, REF-0007 or id: the person's details, source, owner, next action, follow-up date, expected close, estimate, the landlord contact, and/or adds a note (appended with the date and your name). Only the fields you give change; the result lists what changed. It does NOT move the stage (use move_opportunity), sign, mark lost, or archive.",
  inputSchema: updateOpportunityShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveOpportunity(ctx, args.opportunity, "write");
    if (!found.ok) return found.result;
    const { data: cur, error } = await ctx.db.from("opportunity_overview").select("*").eq("id", found.record.id).maybeSingle();
    if (error) return dbFailure("update_opportunity load", error);
    if (!cur?.id) return respond("not_found", "That lead could not be found. It may have been archived. Nothing was changed.");

    const t = today(ctx);
    const f = new FormReader(
      form({
        prospect_name: args.prospect_name,
        prospect_phone: args.prospect_phone && !NONE.test(args.prospect_phone) ? args.prospect_phone : null,
        prospect_email: args.prospect_email && !NONE.test(args.prospect_email) ? args.prospect_email : null,
        property_suburb: args.property_suburb && !NONE.test(args.property_suburb) ? args.property_suburb : null,
        property_address: args.property_address && !NONE.test(args.property_address) ? args.property_address : null,
        next_action: args.next_action,
        next_action_due: args.follow_up_date,
        expected_close_date: args.expected_close_date && args.expected_close_date !== "none" ? args.expected_close_date : null,
      }),
    );
    const patch: Record<string, unknown> = {};
    const clear: string[] = [];
    const labels: Array<[string, unknown, unknown]> = [];
    const set = (key: string, label: string, before: unknown, after: unknown) => {
      if ((before ?? null) === (after ?? null)) return;
      patch[key] = after;
      labels.push([label, before, after]);
    };
    const clearIt = (field: string, label: string, before: unknown) => {
      if (before === null || before === undefined) return;
      clear.push(field);
      labels.push([label, before, null]);
    };
    if (args.prospect_name !== undefined) set("p_prospect_name", "Name", cur.prospect_name, f.requiredText("prospect_name", { max: 200, label: "The name" }));
    if (args.prospect_phone !== undefined) {
      if (NONE.test(args.prospect_phone)) clearIt("prospect_phone", "Phone", cur.prospect_phone);
      else set("p_prospect_phone", "Phone", cur.prospect_phone, f.phone("prospect_phone"));
    }
    if (args.prospect_email !== undefined) {
      if (NONE.test(args.prospect_email)) clearIt("prospect_email", "Email", cur.prospect_email);
      else set("p_prospect_email", "Email", cur.prospect_email, f.email("prospect_email"));
    }
    if (args.property_suburb !== undefined) {
      if (NONE.test(args.property_suburb)) clearIt("property_suburb", "Suburb", cur.property_suburb);
      else set("p_property_suburb", "Suburb", cur.property_suburb, f.text("property_suburb", { max: 120, label: "The suburb" }));
    }
    if (args.property_address !== undefined) {
      if (NONE.test(args.property_address)) clearIt("property_address", "Address", cur.property_address);
      else set("p_property_address", "Address", cur.property_address, f.text("property_address", { max: 300, label: "The address" }));
    }
    if (args.source !== undefined) set("p_source", "Came from", cur.source, args.source);
    if (args.next_action !== undefined) set("p_next_action", "Next action", cur.next_action, f.requiredText("next_action", { max: 300, label: "The next action" }));
    if (args.follow_up_date !== undefined) set("p_next_action_due", "Follow-up date", cur.next_action_due, checkFollowUp(f, "next_action_due", t, true));
    if (args.expected_close_date !== undefined) {
      if (args.expected_close_date === "none") clearIt("expected_close_date", "Expected to sign by", cur.expected_close_date);
      else set("p_expected_close_date", "Expected to sign by", cur.expected_close_date, checkExpectedClose(f, "expected_close_date", t));
    }
    if (args.estimated_annual_value !== undefined) {
      if (args.estimated_annual_value === "none") clearIt("estimated_annual_value", "Estimate", cur.estimated_annual_value_cents);
      else {
        const cents = Math.round(args.estimated_annual_value * 100);
        if (Math.abs(cents - args.estimated_annual_value * 100) > 1e-6) f.errors.estimated_annual_value = "Use dollars and cents, at most two decimal places.";
        else set("p_estimated_annual_value_cents", "Estimate (cents)", cur.estimated_annual_value_cents, cents);
      }
    }
    if (args.owner !== undefined) {
      const who = await resolveStaff(ctx, args.owner, "write");
      if (!who.ok) return who.result;
      if (who.record.id !== cur.assigned_to) {
        patch.p_assigned_to = who.record.id;
        labels.push(["Owner", cur.assigned_to_name, who.record.label]);
      }
    }
    if (args.landlord_contact !== undefined) {
      const c = await resolveContact(ctx, args.landlord_contact, "write");
      if (!c.ok) return c.result;
      if (c.record.id !== cur.owner_contact_id) {
        patch.p_owner_contact = c.record.id;
        labels.push(["Landlord contact", cur.owner_contact_name, c.record.label]);
      }
    }
    if (args.add_note !== undefined) {
      const appended = appendNote(cur.notes, args.add_note, `${t} ${ctx.staff.fullName}, via chat`, NOTES_MAX);
      if (!appended.ok) f.errors.add_note = appended.message;
      else {
        patch.p_notes = appended.value;
        labels.push(["Note added", null, args.add_note]);
      }
    }
    if (!f.ok) return respond("invalid", invalidText(f.errors, { ...LEAD_FORM_LABELS, next_action_due: "Follow-up date", add_note: "Note" }));
    const url = link(ctx, leadPath(cur.id));
    if (Object.keys(patch).length === 0 && clear.length === 0) return respond("unchanged", `Nothing to change: the lead already has those values. ${url}`, [`Lead: ${cur.ref} ${clean(cur.prospect_name)}`], { id: cur.id, url });

    const { data, error: upError } = await ctx.db.rpc("update_opportunity", {
      p_opportunity: cur.id,
      ...(patch as Record<string, never>),
      p_clear: clear.length ? clear : undefined,
      p_expected_updated_at: cur.updated_at ?? undefined,
    });
    if (upError) return leadFailure("update_opportunity", upError);
    if ((data as { changed?: unknown } | null)?.changed === false) return respond("unchanged", `Nothing to change: the lead already has those values. ${url}`, [`Lead: ${cur.ref} ${clean(cur.prospect_name)}`], { id: cur.id, url });
    const lines = [`Lead: ${cur.ref} ${clean(cur.prospect_name)}`, ...labels.map(([l, b, a]) => (l === "Note added" ? `- Note added: ${clean(a, 600)}` : changeLine(l, b, a)))];
    return respond("ok", `Updated 1 lead [id: ${cur.id}]: ${url}`, lines, { id: cur.id, url, changed: labels.map(([l]) => l) });
  },
});

// ── log_opportunity_activity ─────────────────────────────────

export const logOpportunityActivity = defineTool({
  name: "log_opportunity_activity",
  title: "Log a call or meeting on a lead",
  description:
    "Logs ONE call, meeting (meeting notes), email, message or note on a lead found by name, LEAD-0007, REF-0007 or id, as you. Optionally sets the lead's new next action and follow-up date, and creates one follow-up task linked to the lead. Updates the lead's last activity and the landlord contact's last contact. Returns what was recorded and the HQ link. It does not move the stage or edit earlier activity.",
  inputSchema: logOpportunityActivityShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveOpportunity(ctx, args.opportunity, "write");
    if (!found.ok) return found.result;
    const assignee = await staffRef(ctx, args.task_assignee);
    if (!assignee.ok) return assignee.result;
    const { reader, values: v } = readLeadActivityForm(
      form({
        interaction_type: args.type,
        occurred_at: args.occurred_at ?? nowLocalInput(ctx.staff.timezone),
        summary: args.summary,
        next_action: args.next_action,
        next_action_due: args.follow_up_date,
        create_task: args.create_task ? "on" : null,
        task_assignee: assignee.id,
      }),
      { timezone: ctx.staff.timezone, today: today(ctx), staffId: ctx.staff.id, canCreateTasks: can(ctx, "tasks.write") },
    );
    if (!reader.ok) return respond("invalid", invalidText(reader.errors, { interaction_type: "Type", occurred_at: "When", summary: "Summary", next_action: "Next action", next_action_due: "Follow-up date", create_task: "Create a task" }));
    const { data, error } = await ctx.db.rpc("log_opportunity_activity", {
      p_opportunity: found.record.id,
      p_type: v.type,
      p_occurred_at: v.occurredAt.toISOString(),
      p_summary: v.summary,
      p_next_action: v.nextAction ?? undefined,
      p_next_action_due: v.nextActionDue ?? undefined,
      p_create_task: v.createTask,
      p_task_assignee: v.createTask ? (v.taskAssignee ?? undefined) : undefined,
    });
    if (error) return leadFailure("log_opportunity_activity", error);
    const out = (data ?? {}) as { interaction_id?: string; task_id?: string | null; next_action?: string | null; next_action_due?: string | null };
    const url = link(ctx, leadPath(found.record.id));
    const lines = [
      `${INTERACTION_LABEL[v.type]} on the lead ${clean(found.record.label)}, ${when(ctx, v.occurredAt.toISOString())}`,
      `Summary: ${clean(v.summary, 600)}`,
      out.next_action ? `Next action now: ${clean(out.next_action)}${out.next_action_due ? `, due ${day(ctx, out.next_action_due)}` : ""}` : null,
      out.task_id ? `Follow-up task created [id: ${out.task_id}]: ${link(ctx, HQ_PATHS.task(out.task_id))}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Logged 1 ${INTERACTION_LABEL[v.type].toLowerCase()} on the lead${out.task_id ? " and created its follow-up task" : ""}: ${url}`, lines, {
      interaction_id: out.interaction_id ?? null,
      task_id: out.task_id ?? null,
      id: found.record.id,
      url,
    });
  },
});

// ── list_interactions ────────────────────────────────────────

export const listInteractions = defineTool({
  name: "list_interactions",
  title: "List recent activity",
  description:
    "Lists the calls, meetings, emails, messages and notes logged with ONE contact, organisation (and its people), contractor (needs contractors.read) or lead, newest first, a page at a time (page 1, 2, ...). Give exactly one of contact, organisation, contractor or opportunity. Filter by type or since a date. Use it to recall what was said before a call. Read-only.",
  inputSchema: listInteractionsShape,
  annotations: READ,
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const given = [args.contact, args.organisation, args.contractor, args.opportunity].filter((x) => x !== undefined).length;
    if (given !== 1) return respond("invalid", "Not done: give exactly one of contact, organisation, contractor or opportunity.");
    let column: "contact_id" | "organisation_id" | "contractor_id" | "opportunity_id";
    let subject: { id: string; label: string };
    let url: string;
    if (args.contractor) {
      if (!can(ctx, "contractors.read")) return respond("refused", "Refused: activity with contractors needs contractors.read, which your role does not include. Nothing was read.");
      const r = await resolveContractor(ctx, args.contractor, "read");
      if (!r.ok) return r.result;
      column = "contractor_id";
      subject = r.record;
      url = link(ctx, HQ_PATHS.contractor(r.record.id));
    } else if (args.organisation) {
      const r = await resolveOrganisation(ctx, args.organisation, "read");
      if (!r.ok) return r.result;
      column = "organisation_id";
      subject = r.record;
      url = link(ctx, HQ_PATHS.organisation(r.record.id));
    } else if (args.opportunity) {
      const r = await resolveOpportunity(ctx, args.opportunity, "read");
      if (!r.ok) return r.result;
      column = "opportunity_id";
      subject = r.record;
      url = link(ctx, leadPath(r.record.id));
    } else {
      const r = await resolveContact(ctx, args.contact as string, "read");
      if (!r.ok) return r.result;
      column = "contact_id";
      subject = r.record;
      url = link(ctx, HQ_PATHS.contact(r.record.id));
    }
    const n = rowLimit(args.limit);
    const page = args.page ?? 1;
    let q = ctx.db
      .from("interactions")
      .select("id, interaction_type, occurred_at, summary, next_action, follow_up_date, contact_id, opportunity_id, staff:staff_profiles(full_name), contact:contacts(full_name)", { count: "exact" })
      .eq(column, subject.id)
      .is("deleted_at", null);
    if (args.type) q = q.eq("interaction_type", args.type);
    if (args.since) q = q.gte("occurred_at", `${args.since}T00:00:00`);
    const { data, error, count } = await q.order("occurred_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * n, page * n - 1);
    if (error) {
      if (error.code === "PGRST103") return respond("empty", `No more activity: page ${page} is past the end.`, null, { count: 0 });
      return dbFailure("list_interactions", error);
    }
    type Row = { id: string; interaction_type: InteractionType; occurred_at: string; summary: string; next_action: string | null; follow_up_date: string | null; staff: { full_name: string } | null; contact: { full_name: string } | null };
    const rows = (data ?? []) as unknown as Row[];
    const total = count ?? rows.length;
    if (rows.length === 0) return respond("empty", `No activity logged with ${clean(subject.label)}${args.type || args.since ? " with those filters" : ""}. ${url}`, null, { count: 0, total });
    const lines = rows.map(
      (r) =>
        `- ${when(ctx, r.occurred_at)}, ${INTERACTION_LABEL[r.interaction_type] ?? r.interaction_type}${r.staff ? ` by ${clean(r.staff.full_name)}` : ""}${column === "organisation_id" && r.contact ? ` with ${clean(r.contact.full_name)}` : ""}: ${clean(r.summary, LIMITS.medium)}${r.next_action ? ` | next: ${clean(r.next_action)}` : ""}${r.follow_up_date ? ` | follow up ${day(ctx, r.follow_up_date)}` : ""} [id: ${r.id}]`,
    );
    const pages = Math.max(1, Math.ceil(total / n));
    return respond("ok", `${plural(total, "interaction")} with ${clean(subject.label)}, newest first; page ${page} of ${pages}. ${url}`, lines, { count: rows.length, total, page, pages });
  },
});
