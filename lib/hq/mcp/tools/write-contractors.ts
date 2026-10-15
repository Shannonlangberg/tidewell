/*
 * Contractor writes, one record each: update the details the contractor form allows (contact
 * details, service areas, rates, notes appended), record job feedback, set one vetting step, and log
 * contact. Each input goes through the HQ contractor form validators; each write runs as the
 * person through the same RPC or column-limited table update as the HQ screen, so the guard
 * trigger, RLS and audit apply.
 *
 * Deliberately NOT here: approving, preferring, suspending, reinstating or deactivating a
 * contractor, verifying or opening documents, changing the ABN, trades or licence / insurance
 * expiry dates (changing an expiry clears its verification), archiving, imports.
 */
import { CONTRACTOR_CATEGORIES, VETTING_STEP_LABEL } from "../../constants";
import { abnProblem, stripAbn } from "../../contractors/abn";
import { readContactForm as readContractorContactForm } from "../../contractors/contact-form";
import { classifyContractorError } from "../../contractors/db-errors";
import { LIMITS as FORM_LIMITS, readContractorFields } from "../../contractors/form";
import { formatRate, parseDollars } from "../../contractors/money";
import { RATING_FIELDS, RATING_LABEL, TENANT_FEEDBACK_LABEL, readReviewForm } from "../../contractors/reviews-form";
import { VETTING_STEP_STATUS_LABEL, readVettingStepForm } from "../../contractors/vetting-steps";
import type { Tables } from "../../db";
import { FormReader } from "../../forms";
import { nowLocalInput } from "../../growth/dates";
import { HQ_PATHS, appendNote, changeLine, clean, editPlaceList, invalidText, result, sameValue } from "./core";
import { can, day, dbFailure, defineTool, link, logDb, resolveContractor, resolveStaff, respond, today, when, type PgError, type ToolContext } from "./kit";
import { interactionLabel } from "./records";
import { logContractorContactShape, recordContractorReviewShape, setVettingStepShape, updateContractorShape } from "./schemas";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const NONE = /^(none|clear|remove|-)$/i;

function form(values: Record<string, string | readonly string[] | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) fd.append(k, x);
    else fd.set(k, v as string);
  }
  return fd;
}

function contractorFailure(where: string, error: PgError) {
  logDb(where, error);
  const kind = classifyContractorError(error);
  if (kind === "permission") return result("refused", "Refused by HQ: your role may not do that to a contractor. Nothing was changed.");
  if (kind === "not_found") return result("not_found", "That contractor could not be found. It may have been archived. Nothing was changed.");
  if (kind === "email_shape") return result("invalid", "Not changed: that doesn't look like an email address.");
  if (kind === "rates_negative") return result("invalid", "Not changed: an amount can't be negative.");
  if (kind === "invalid" || kind === "refused") return result("invalid", "Not changed: HQ refused one of the values. Check them and try again.");
  return result("error", "Something went wrong and nothing was changed. Try again in a moment.");
}

// ── update the details ───────────────────────────────────────

const RATE_COLUMNS = {
  hourly_rate: "hourly_rate_cents",
  callout_fee: "callout_fee_cents",
  after_hours_fee: "after_hours_fee_cents",
  minimum_charge: "minimum_charge_cents",
} as const;
type RateField = keyof typeof RATE_COLUMNS;

const COLUMN_LABEL: Record<string, string> = {
  primary_contact_name: "Contact person",
  phone: "Phone",
  email: "Email",
  website: "Website",
  service_suburbs: "Suburbs serviced",
  service_regions: "Regions serviced",
  hourly_rate_cents: "Hourly rate",
  callout_fee_cents: "Call-out fee",
  after_hours_fee_cents: "After-hours fee",
  minimum_charge_cents: "Minimum charge",
  internal_notes: "Internal notes",
};

export const updateContractor = defineTool({
  name: "update_contractor",
  title: "Update a contractor",
  description:
    "Changes ONE contractor's details that the HQ contractor form allows: contact person, phone, email, website, suburbs and regions serviced (add or remove), the four rates (in dollars; stored in cents; can be set back to unknown), and adds a note to the internal notes (dated, attributed; existing notes are kept). Only the fields you give change; the result lists exactly what changed. It NEVER changes status (no approving, preferring, suspending, reinstating or deactivating), the ABN, trades, licence or insurance details, or documents: those stay on the HQ screen.",
  inputSchema: updateContractorShape,
  annotations: WRITE,
  capability: "contractors.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveContractor(ctx, args.contractor, "write");
    if (!found.ok) return found.result;
    const { data: cur, error } = await ctx.db
      .from("contractors")
      .select("id, business_name, categories, primary_contact_name, phone, email, website, service_suburbs, service_regions, hourly_rate_cents, callout_fee_cents, after_hours_fee_cents, minimum_charge_cents, internal_notes, updated_at")
      .eq("id", found.record.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return dbFailure("update_contractor load", error);
    if (!cur) return respond("not_found", "That contractor could not be found. It may have been archived. Nothing was changed.");

    const clear = new Set(args.clear_rates ?? []);
    for (const k of Object.keys(RATE_COLUMNS) as RateField[]) {
      if (clear.has(k) && args[k] !== undefined) return respond("invalid", `Not changed: ${k.replace(/_/g, " ")} was both given and cleared. Choose one.`);
    }
    const touched = new Set<string>();
    const values: Record<string, string | string[] | null> = { business_name: cur.business_name, categories: cur.categories };
    const text = (field: "primary_contact_name" | "phone" | "email" | "website") => {
      const v = args[field];
      if (v === undefined) return;
      touched.add(field);
      values[field] = NONE.test(v) ? null : v;
    };
    text("primary_contact_name");
    text("phone");
    text("email");
    text("website");
    if (args.add_suburbs || args.remove_suburbs) {
      touched.add("service_suburbs");
      values.service_suburbs = editPlaceList(cur.service_suburbs, args.add_suburbs, args.remove_suburbs).join("\n");
    }
    if (args.add_regions || args.remove_regions) {
      touched.add("service_regions");
      values.service_regions = editPlaceList(cur.service_regions, args.add_regions, args.remove_regions).join("\n");
    }
    for (const k of Object.keys(RATE_COLUMNS) as RateField[]) {
      if (args[k] !== undefined) {
        touched.add(RATE_COLUMNS[k]);
        values[k] = String(args[k]);
      } else if (clear.has(k)) {
        touched.add(RATE_COLUMNS[k]);
        values[k] = null;
      }
    }
    if (args.add_note !== undefined) {
      const appended = appendNote(cur.internal_notes, args.add_note, `${today(ctx)} ${ctx.staff.fullName}, via chat`, FORM_LIMITS.notes);
      if (!appended.ok) return respond("invalid", `Not changed: ${appended.message}`);
      touched.add("internal_notes");
      values.internal_notes = appended.value;
    }
    if (touched.size === 0) return respond("invalid", "Nothing to change: give at least one detail to update.");

    // The whole contractor form's reader, so the rules are the screen's own. Untouched fields are left out of the
    // form (so a legacy value that the form would now reject never blocks an unrelated change), and out of the update.
    const f = new FormReader(form(values));
    const v = readContractorFields(f, { categories: CONTRACTOR_CATEGORIES, abnProblem, stripAbn, parseDollars });
    if (!f.ok) {
      const errors = Object.fromEntries(Object.entries(f.errors).filter(([k]) => touched.has(k) || touched.has(RATE_COLUMNS[k as RateField] ?? "")));
      return respond("invalid", invalidText(Object.keys(errors).length ? errors : f.errors));
    }
    const next: Record<string, unknown> = {
      primary_contact_name: v.primaryContactName,
      phone: v.phone,
      email: v.email,
      website: v.website,
      service_suburbs: v.serviceSuburbs,
      service_regions: v.serviceRegions,
      hourly_rate_cents: v.hourlyRateCents,
      callout_fee_cents: v.calloutFeeCents,
      after_hours_fee_cents: v.afterHoursFeeCents,
      minimum_charge_cents: v.minimumChargeCents,
      internal_notes: v.internalNotes,
    };
    const before = cur as unknown as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    for (const k of touched) if (!sameValue(next[k], before[k])) update[k] = next[k];
    const url = link(ctx, HQ_PATHS.contractor(cur.id));
    if (Object.keys(update).length === 0) return respond("unchanged", `Nothing to change: the contractor already has those details. ${url}`, [`Contractor: ${clean(cur.business_name)}`], { id: cur.id, url });

    const res = await ctx.db.from("contractors").update(update as Tables["contractors"]["Update"]).eq("id", cur.id).eq("updated_at", cur.updated_at).is("deleted_at", null).select("id");
    if (res.error) return contractorFailure("update_contractor", res.error);
    if (!res.data || res.data.length === 0) return respond("unchanged", "Not changed: the contractor was changed by someone else a moment ago, or your role may not edit it. Look at it in HQ.", null, { id: cur.id, url });

    const lines = [`Contractor: ${clean(cur.business_name)}`];
    for (const k of Object.keys(update)) {
      if (k === "internal_notes") lines.push(`- Note added to internal notes: ${clean(args.add_note, 600)}`);
      else if (k.endsWith("_cents")) lines.push(changeLine(COLUMN_LABEL[k], formatRate(before[k] as number | null), formatRate(update[k] as number | null)));
      else lines.push(changeLine(COLUMN_LABEL[k] ?? k, before[k], update[k]));
    }
    return respond("ok", `Updated 1 contractor [id: ${cur.id}]: ${url}`, lines, { id: cur.id, url, changed: Object.keys(update) });
  },
});

// ── job feedback ─────────────────────────────────────────────

export const recordContractorReview = defineTool({
  name: "record_contractor_review",
  title: "Record contractor feedback",
  description:
    "Records ONE piece of job feedback on a contractor through hq.record_contractor_review, as you: job date and reference, ratings 1 to 5 for response time, communication, quality of work and invoice accuracy (rate only what you know), tenant feedback, rework, notes. At least one rating or a note is needed. The overall rating is computed by HQ and shown only once there is enough rated feedback. It does not edit or remove earlier feedback.",
  inputSchema: recordContractorReviewShape,
  annotations: WRITE,
  capability: "contractors.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveContractor(ctx, args.contractor, "write");
    if (!found.ok) return found.result;
    const f = new FormReader(
      form({
        contractor_id: found.record.id,
        job_date: args.job_date,
        job_reference: args.job_reference,
        response_time: args.response_time !== undefined ? String(args.response_time) : null,
        communication: args.communication !== undefined ? String(args.communication) : null,
        work_quality: args.work_quality !== undefined ? String(args.work_quality) : null,
        invoice_accuracy: args.invoice_accuracy !== undefined ? String(args.invoice_accuracy) : null,
        tenant_feedback: args.tenant_feedback,
        rework_required: args.rework_required === undefined ? null : args.rework_required ? "yes" : "no",
        notes: args.notes,
      }),
    );
    const input = readReviewForm(f);
    if (input?.jobDate && input.jobDate > today(ctx)) f.errors.job_date = "The job date can't be in the future.";
    if (!input || !f.ok) return respond("invalid", invalidText(f.errors, { ...RATING_LABEL, job_date: "Job date", notes: "Notes" }));

    const { data, error } = await ctx.db.rpc("record_contractor_review", {
      p_contractor: input.contractorId,
      p_job_date: input.jobDate ?? undefined,
      p_job_reference: input.jobReference ?? undefined,
      p_response_time: input.ratings.response_time ?? undefined,
      p_communication: input.ratings.communication ?? undefined,
      p_work_quality: input.ratings.work_quality ?? undefined,
      p_invoice_accuracy: input.ratings.invoice_accuracy ?? undefined,
      p_tenant_feedback: input.tenantFeedback ?? undefined,
      p_rework_required: input.reworkRequired ?? undefined,
      p_notes: input.notes ?? undefined,
    });
    if (error) return contractorFailure("record_contractor_review", error);
    const out = (data ?? {}) as { review_id?: string };
    const url = link(ctx, HQ_PATHS.contractor(input.contractorId));
    const ratings = RATING_FIELDS.filter((k) => input.ratings[k] !== null).map((k) => `${RATING_LABEL[k]} ${input.ratings[k]}`);
    const lines = [
      `Contractor: ${clean(found.record.label)}`,
      input.jobDate ? `Job date: ${day(ctx, input.jobDate)}` : null,
      input.jobReference ? `Job reference: ${clean(input.jobReference)}` : null,
      `Ratings: ${ratings.length ? ratings.join(", ") : "none given"}`,
      input.tenantFeedback ? `Tenant feedback: ${TENANT_FEEDBACK_LABEL[input.tenantFeedback]}` : null,
      input.reworkRequired !== null ? `Rework required: ${input.reworkRequired ? "yes" : "no"}` : null,
      input.notes ? `Notes: ${clean(input.notes, 600)}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Recorded 1 piece of feedback [id: ${out.review_id ?? "unknown"}]: ${url}`, lines, { id: out.review_id ?? null, contractor_id: input.contractorId, url });
  },
});

// ── a vetting step ───────────────────────────────────────────

export const setVettingStep = defineTool({
  name: "set_vetting_step",
  title: "Set a vetting step",
  description:
    "Sets ONE step (1 to 8) of a contractor's nine-step vetting checklist to not_started, in_progress, done or not_applicable (which needs a note saying why), through hq.set_vetting_step. Leaving out the note keeps the existing note. It never changes the contractor's status: completing every step does NOT approve anyone. Approval (step 9) is a deliberate action by a director or administrator on the HQ screen.",
  inputSchema: setVettingStepShape,
  annotations: { ...WRITE, idempotentHint: true },
  capability: "contractors.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveContractor(ctx, args.contractor, "write");
    if (!found.ok) return found.result;
    const { data: cur, error } = await ctx.db.from("contractor_vetting_steps").select("status, note").eq("contractor_id", found.record.id).eq("step", args.step).maybeSingle();
    if (error) return dbFailure("set_vetting_step load", error);
    if (!cur) return respond("not_found", "That contractor's checklist could not be found. Nothing was changed.");
    // set_vetting_step sets the note to exactly what it is given (null clears it), so "left out" means "keep".
    const note = args.note === undefined ? cur.note : NONE.test(args.note) ? null : args.note;
    const f = new FormReader(form({ contractor_id: found.record.id, step: args.step, status: args.status, note }));
    const input = readVettingStepForm(f);
    if (!input) return respond("invalid", invalidText(f.errors, { note: "Note", status: "Status", step: "Step" }));

    const { data, error: rpcError } = await ctx.db.rpc("set_vetting_step", { p_contractor: input.contractorId, p_step: input.step, p_status: input.status, p_note: input.note ?? undefined });
    if (rpcError) return contractorFailure("set_vetting_step", rpcError);
    const out = (data ?? {}) as { changed?: boolean; vetting_done_count?: number };
    const url = link(ctx, HQ_PATHS.contractor(input.contractorId));
    const lines = [
      `Contractor: ${clean(found.record.label)}`,
      changeLine(`Step "${VETTING_STEP_LABEL[input.step]}"`, VETTING_STEP_STATUS_LABEL[cur.status], VETTING_STEP_STATUS_LABEL[input.status]),
      sameValue(cur.note, input.note) ? null : changeLine("Note", cur.note, input.note),
      typeof out.vetting_done_count === "number" ? `Checklist: ${out.vetting_done_count} of 9 done. Status unchanged (approval happens only on the HQ screen).` : null,
    ].filter((l): l is string => !!l);
    if (out.changed === false) return respond("unchanged", `Nothing changed: the step already had that status and note. ${url}`, lines, { contractor_id: input.contractorId, url });
    return respond("ok", `Updated 1 vetting step: ${url}`, lines, { contractor_id: input.contractorId, step: input.step, status: input.status, url });
  },
});

// ── log contact with a contractor ────────────────────────────

type ContactArgs = {
  contractor: string;
  type: "phone_call" | "coffee_meeting" | "office_meeting" | "email" | "message" | "note";
  summary: string;
  occurred_at?: string;
  next_action?: string;
  follow_up_date?: string;
  create_task?: boolean;
  task_assignee?: string;
  mark_contacted?: boolean;
};

/** Shared by log_contractor_contact and log_interaction (when it names a contractor). */
export async function logContractorContactFor(ctx: ToolContext, args: ContactArgs) {
  const found = await resolveContractor(ctx, args.contractor, "write");
  if (!found.ok) return found.result;
  let assignee: string | null = null;
  if (args.task_assignee) {
    const who = await resolveStaff(ctx, args.task_assignee, "write");
    if (!who.ok) return who.result;
    assignee = who.record.id;
  }
  const { reader: f, values: v } = readContractorContactForm(
    form({
      contractor_id: found.record.id,
      interaction_type: args.type,
      occurred_at: args.occurred_at ?? nowLocalInput(ctx.staff.timezone),
      summary: args.summary,
      next_action: args.next_action,
      follow_up_date: args.follow_up_date,
      create_task: args.create_task ? "on" : null,
      task_assignee: assignee,
      mark_contacted: args.mark_contacted ? "on" : null,
    }),
    { timezone: ctx.staff.timezone, staffId: ctx.staff.id, canCreateTasks: can(ctx, "tasks.write") },
  );
  if (!f.ok) return respond("invalid", invalidText(f.errors));

  const { data, error } = await ctx.db.rpc("record_contractor_contact", {
    p_contractor: v.contractorId,
    p_type: v.type,
    p_occurred_at: v.occurredAt.toISOString(),
    p_summary: v.summary,
    p_next_action: v.nextAction ?? undefined,
    p_follow_up_date: v.followUpDate ?? undefined,
    p_create_task: v.createTask,
    p_task_assignee: v.createTask ? (v.taskAssignee ?? undefined) : undefined,
    p_new_status: v.markContacted ? "contacted" : undefined,
  });
  if (error) {
    if ((error.message ?? "").toLowerCase().includes("assignee")) {
      logDb("record_contractor_contact", error);
      return respond("invalid", "Not saved: the follow-up task's assignee must be an active member of staff.");
    }
    return contractorFailure("record_contractor_contact", error);
  }
  const out = (data ?? {}) as { interaction_id?: string; task_id?: string | null; status?: string; status_changed?: boolean };
  const url = link(ctx, HQ_PATHS.contractor(v.contractorId));
  const lines = [
    `${interactionLabel(v.type)} with ${clean(found.record.label)}, ${when(ctx, v.occurredAt.toISOString())}`,
    `Summary: ${clean(v.summary, 600)}`,
    v.nextAction ? `Next action: ${clean(v.nextAction)}` : null,
    v.followUpDate ? `Follow-up date: ${day(ctx, v.followUpDate)}` : null,
    out.status_changed ? "Status moved from prospect to contacted." : v.markContacted ? "Status unchanged (only a prospect moves to contacted)." : null,
    out.task_id ? `Follow-up task created [id: ${out.task_id}]: ${link(ctx, HQ_PATHS.task(out.task_id))}` : null,
  ].filter((l): l is string => !!l);
  return respond("ok", `Logged 1 ${interactionLabel(v.type).toLowerCase()} with a contractor${out.task_id ? " and created its follow-up task" : ""}: ${url}`, lines, {
    interaction_id: out.interaction_id ?? null,
    task_id: out.task_id ?? null,
    contractor_id: v.contractorId,
    url,
  });
}

export const logContractorContact = defineTool({
  name: "log_contractor_contact",
  title: "Log contact with a contractor",
  description:
    "Logs ONE call, meeting, email, message or note with a contractor through hq.record_contractor_contact, as you, for people who work with contractors (contractors.write) but not partner contacts. Optionally sets a follow-up date, creates one follow-up task, and moves a prospect to contacted (never further). Returns what was recorded and the HQ link. It never approves or changes a contractor's status beyond prospect to contacted.",
  inputSchema: logContractorContactShape,
  annotations: WRITE,
  capability: "contractors.write",
  kind: "write",
  handler: async (args, ctx) => logContractorContactFor(ctx, args),
});
