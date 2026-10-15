/*
 * Growth writes, one record each: log an interaction, create or update a contact, create an
 * organisation, record a referral, move a prospect between working stages.
 *
 * Each one re-reads its input with the HQ form validator for the same screen (built into a
 * FormData, so the rules are literally the same code), resolves names to ids without guessing,
 * and writes through the same RPC or RLS-governed table write as the HQ Server Action, AS the
 * person. The database's checks, policies and audit triggers therefore apply unchanged.
 *
 * Not here, deliberately: signing a management, marking a prospect lost, changing the credited
 * source, archiving anything, imports.
 */
import { PARTNER_CATEGORIES, RELATIONSHIP_STATUSES, PRIORITIES, PRIORITY_LABEL, type OrgContactRole } from "../../constants";
import { readContactForm } from "../../contacts/form";
import { readInteractionForm } from "../../contacts/interaction-form";
import { currentPrimary, findDuplicateContact, findDuplicateOrganisation } from "../../contacts/write";
import type { Tables } from "../../db";
import { FormReader } from "../../forms";
import { formatAud, refNumber } from "../../format";
import { classifyDbError } from "../../growth/db-errors";
import { checkFollowUpDate, nowLocalInput } from "../../growth/dates";
import { classifyReferralError } from "../../referrals/errors";
import { checkPartner, checkPastOrToday } from "../../referrals/rules";
import { HQ_PATHS, appendNote, changeLine, clean, invalidText, moveOpportunityRefusal, result, sameValue } from "./core";
import {
  can,
  day,
  dbFailure,
  defineTool,
  link,
  logDb,
  resolveContact,
  resolveOpportunity,
  resolveOrganisation,
  resolveStaff,
  respond,
  today,
  when,
  type PgError,
  type ToolContext,
} from "./kit";
import { interactionLabel, partnerCats, relLabel, stageLabel } from "./records";
import { logContractorContactFor } from "./write-contractors";
import { createContactShape, createOrganisationShape, logInteractionShape, moveOpportunityShape, recordReferralShape, updateContactShape } from "./schemas";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const SOURCE = "Added in HQ via chat";
const NOTES_MAX = 4000;

function form(values: Record<string, string | readonly string[] | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) fd.append(k, x);
    else fd.set(k, v as string);
  }
  return fd;
}

const LABELS: Record<string, string> = {
  contact_id: "Contact",
  organisation_id: "Organisation",
  interaction_type: "Type",
  occurred_at: "When",
  summary: "Summary",
  next_action: "Next action",
  follow_up_date: "Follow-up date",
  create_task: "Create a task",
  task_assignee: "Task assignee",
  new_status: "Relationship status",
  full_name: "Full name",
  categories: "Categories",
  relationship_owner_id: "Owner",
  prospect_name: "Prospect name",
  prospect_phone: "Prospect phone",
  prospect_email: "Prospect email",
  referral_date: "Referral date",
  estimated_value: "Estimated annual value",
};

async function staffRef(ctx: ToolContext, raw: string | undefined) {
  if (!raw) return { ok: true as const, id: null as string | null, label: null as string | null };
  const r = await resolveStaff(ctx, raw, "write");
  if (!r.ok) return r;
  return { ok: true as const, id: r.record.id, label: r.record.label };
}

// ── log an interaction ───────────────────────────────────────

function interactionFailure(error: PgError) {
  logDb("record_interaction", error);
  const text = (error?.message ?? "").toLowerCase();
  const code = error?.code ?? "";
  if (code === "42501") return result("refused", "Refused by HQ: your role may not log that. Nothing was saved.");
  if (code === "P0002") return result("not_found", "That contact or organisation could not be found. It may have been archived. Nothing was saved.");
  if (code === "22023") {
    if (text.includes("assignee")) return result("invalid", "Not saved: the follow-up task's assignee must be an active member of staff.");
    if (text.includes("future")) return result("invalid", "Not saved: the time can't be in the future.");
    if (text.includes("organisation")) return result("invalid", "Not saved: that person doesn't work at that organisation.");
    return result("invalid", "Not saved: HQ refused one of the values. Check them and try again.");
  }
  return result("error", "We couldn't log that. Nothing was saved. Try again in a moment.");
}

export const logInteraction = defineTool({
  name: "log_interaction",
  title: "Log an interaction",
  description:
    "Logs ONE call, meeting, email, message or note with a partner contact, a partner organisation, or a contractor (contractors also need contractors.write), as you. Optionally sets a follow-up date, creates one follow-up task for it, and (contacts) moves the relationship status or (contractors) moves a prospect to contacted. Updates the contact's last-contacted date. Returns what was recorded and the HQ link. It does not edit or delete earlier interactions.",
  inputSchema: logInteractionShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    if (args.contractor) {
      if (args.contact || args.organisation) return respond("invalid", "Not saved: a contractor interaction names the contractor only. Leave out the contact and organisation.");
      if (!can(ctx, "contractors.write")) return respond("refused", "Refused: logging contact with a contractor needs contractors.write, which your role does not include. Nothing was saved.");
      if (args.new_relationship_status) return respond("invalid", "Not saved: relationship status belongs to partner contacts. For a contractor use mark_contacted.");
      return logContractorContactFor(ctx, { ...args, contractor: args.contractor });
    }
    if (!args.contact && !args.organisation) return respond("invalid", "Not saved: say who it was with: a contact, an organisation, or a contractor.");
    if (args.mark_contacted) return respond("invalid", "Not saved: mark_contacted is for contractors. For a contact, use new_relationship_status.");

    let organisationId: string | null = null;
    let orgLabel: string | null = null;
    if (args.organisation) {
      const org = await resolveOrganisation(ctx, args.organisation, "write");
      if (!org.ok) return org.result;
      organisationId = org.record.id;
      orgLabel = org.record.label;
    }
    let contactId: string | null = null;
    let contactLabel: string | null = null;
    if (args.contact) {
      const c = await resolveContact(ctx, args.contact, "write", { organisationId });
      if (!c.ok) return c.result;
      contactId = c.record.id;
      contactLabel = c.record.label;
    }
    const assignee = await staffRef(ctx, args.task_assignee);
    if (!assignee.ok) return assignee.result;

    const { reader, values: v } = readInteractionForm(
      form({
        contact_id: contactId,
        organisation_id: organisationId,
        interaction_type: args.type,
        occurred_at: args.occurred_at ?? nowLocalInput(ctx.staff.timezone),
        summary: args.summary,
        next_action: args.next_action,
        follow_up_date: args.follow_up_date,
        create_task: args.create_task ? "on" : null,
        task_assignee: assignee.id,
        new_status: args.new_relationship_status,
      }),
      { timezone: ctx.staff.timezone, staffId: ctx.staff.id, canCreateTasks: can(ctx, "tasks.write") },
    );
    if (!reader.ok) return respond("invalid", invalidText(reader.errors, LABELS));

    const { data, error } = await ctx.db.rpc("record_interaction", {
      p_contact: v.contactId ?? undefined,
      p_organisation: v.organisationId ?? undefined,
      p_type: v.type,
      p_occurred_at: v.occurredAt.toISOString(),
      p_summary: v.summary,
      p_next_action: v.nextAction ?? undefined,
      p_follow_up_date: v.followUpDate ?? undefined,
      p_create_task: v.createTask,
      p_task_assignee: v.createTask ? (v.taskAssignee ?? undefined) : undefined,
      p_new_status: v.newStatus ?? undefined,
    });
    if (error) return interactionFailure(error);
    const out = (data ?? {}) as { interaction_id?: string; task_id?: string | null };
    const url = link(ctx, contactId ? HQ_PATHS.contact(contactId) : HQ_PATHS.organisation(organisationId as string));
    const lines = [
      `${interactionLabel(v.type)} with ${clean(contactLabel ?? orgLabel)}${contactLabel && orgLabel ? ` (${clean(orgLabel)})` : ""}, ${when(ctx, v.occurredAt.toISOString())}`,
      `Summary: ${clean(v.summary, 600)}`,
      v.nextAction ? `Next action: ${clean(v.nextAction)}` : null,
      v.followUpDate ? `Follow-up date: ${day(ctx, v.followUpDate)}${contactId ? " (also set as the contact's next follow-up)" : ""}` : null,
      v.newStatus ? `Relationship status set to: ${relLabel(v.newStatus)}` : null,
      out.task_id ? `Follow-up task created [id: ${out.task_id}]: ${link(ctx, HQ_PATHS.task(out.task_id))}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Logged 1 ${interactionLabel(v.type).toLowerCase()}${out.task_id ? " and created its follow-up task" : ""}: ${url}`, lines, { interaction_id: out.interaction_id ?? null, task_id: out.task_id ?? null, url });
  },
});

// ── create a contact ─────────────────────────────────────────

export const createContact = defineTool({
  name: "create_contact",
  title: "Create a contact",
  description:
    "Adds ONE partner contact (a person at an agency, broker, conveyancer and so on) with at least one partner category, at an organisation that already exists in HQ or as an independent. Refuses a likely duplicate (same name at the same organisation, or the same email) and shows the existing record instead. The first contact at an organisation becomes its primary contact. Returns the new contact and its HQ link. It does not create organisations (use create_organisation).",
  inputSchema: createContactShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    let organisationId: string | null = null;
    let orgLabel: string | null = null;
    if (args.organisation) {
      const org = await resolveOrganisation(ctx, args.organisation, "write");
      if (!org.ok) return org.result;
      organisationId = org.record.id;
      orgLabel = org.record.label;
    }
    const owner = await staffRef(ctx, args.owner);
    if (!owner.ok) return owner.result;

    const { reader: f, values: v } = readContactForm(
      form({
        full_name: args.full_name,
        organisation_id: organisationId,
        categories: args.categories,
        position: args.position,
        phone: args.phone,
        email: args.email,
        website: args.website,
        location: args.location,
        service_region: args.service_region,
        relationship_owner_id: owner.id,
        relationship_status: args.status,
        priority: args.priority,
        notes: args.notes,
      }),
    );
    if (!f.ok) return respond("invalid", invalidText(f.errors, LABELS));

    const dup = await findDuplicateContact(ctx.db, { organisationId: v.organisationId, fullName: v.fullName, email: v.email });
    if (dup) {
      const why = dup.reason === "name" ? "A contact with this name already exists at this organisation" : "Another contact already uses this email address";
      return respond("unchanged", `Not created: ${why}. Use the existing contact instead [id: ${dup.id}]: ${link(ctx, HQ_PATHS.contact(dup.id))}`, [`Existing: ${clean(dup.fullName)}${dup.organisationName ? ` (${clean(dup.organisationName)})` : ""}`], {
        duplicate_id: dup.id,
      });
    }

    let role: OrgContactRole = "secondary";
    if (v.organisationId) {
      const other = await currentPrimary(ctx.db, v.organisationId);
      if (!other) role = "primary";
    }
    const { data, error } = await ctx.db
      .from("contacts")
      .insert({
        organisation_id: v.organisationId,
        full_name: v.fullName,
        position: v.position,
        categories: v.categories,
        phone: v.phone,
        email: v.email,
        website: v.website,
        location: v.location,
        service_region: v.serviceRegion,
        org_contact_role: role,
        relationship_owner_id: v.ownerId,
        relationship_status: v.status,
        priority: v.priority,
        notes: v.notes,
        source: SOURCE,
        needs_verification: false,
      })
      .select("id")
      .single();
    if (error || !data) {
      const kind = classifyDbError(error);
      if (kind === "duplicate_contact_name" || kind === "duplicate_contact_email") {
        logDb("create_contact", error);
        return respond("unchanged", "Not created: HQ already has this person (same name at this organisation, or the same email). Search for them instead.");
      }
      return dbFailure("create_contact", error);
    }
    const url = link(ctx, HQ_PATHS.contact(data.id));
    const lines = [
      `Name: ${clean(v.fullName)}`,
      `Organisation: ${orgLabel ? `${clean(orgLabel)}${role === "primary" ? " (primary contact)" : ""}` : "independent"}`,
      `Categories: ${partnerCats(v.categories)}`,
      v.position ? `Position: ${clean(v.position)}` : null,
      v.phone ? `Phone: ${clean(v.phone)}` : null,
      v.email ? `Email: ${clean(v.email)}` : null,
      `Relationship status: ${relLabel(v.status)}; priority ${PRIORITY_LABEL[v.priority].toLowerCase()}`,
      owner.label ? `Owner: ${clean(owner.label)}` : null,
      v.notes ? `Notes: ${clean(v.notes, 400)}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Created 1 contact [id: ${data.id}]: ${url}`, lines, { id: data.id, url, created: "contact" });
  },
});

// ── update a contact ─────────────────────────────────────────

const NONE = /^(none|clear|remove|-)$/i;

export const updateContact = defineTool({
  name: "update_contact",
  title: "Update a contact",
  description:
    "Changes ONE partner contact found by name or id: phone, email, position, relationship status, priority, next follow-up date, and/or adds a note (notes are appended with the date and your name; existing notes are never replaced). Only the fields you give change; the result lists exactly what changed and the HQ link. It does not move the contact to another organisation, archive or delete anything.",
  inputSchema: updateContactShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    let organisationId: string | null = null;
    if (args.organisation) {
      const org = await resolveOrganisation(ctx, args.organisation, "write");
      if (!org.ok) return org.result;
      organisationId = org.record.id;
    }
    const found = await resolveContact(ctx, args.contact, "write", { organisationId });
    if (!found.ok) return found.result;
    const { data: cur, error } = await ctx.db
      .from("contacts")
      .select("id, full_name, organisation_id, phone, email, position, relationship_status, priority, next_follow_up_date, notes, updated_at")
      .eq("id", found.record.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return dbFailure("update_contact load", error);
    if (!cur) return respond("not_found", "That contact could not be found. It may have been archived. Nothing was changed.");

    const f = new FormReader(
      form({
        phone: args.phone && !NONE.test(args.phone) ? args.phone : null,
        email: args.email && !NONE.test(args.email) ? args.email : null,
        position: args.position && !NONE.test(args.position) ? args.position : null,
        relationship_status: args.status,
        priority: args.priority,
        next_follow_up_date: args.next_follow_up_date && args.next_follow_up_date !== "none" ? args.next_follow_up_date : null,
      }),
    );
    const update: Record<string, unknown> = {};
    if (args.phone !== undefined) update.phone = NONE.test(args.phone) ? null : f.phone("phone");
    if (args.email !== undefined) update.email = NONE.test(args.email) ? null : f.email("email");
    if (args.position !== undefined) update.position = NONE.test(args.position) ? null : f.text("position", { label: "Position", max: 200 });
    if (args.status !== undefined) update.relationship_status = f.oneOf("relationship_status", RELATIONSHIP_STATUSES, { required: true });
    if (args.priority !== undefined) update.priority = f.oneOf("priority", PRIORITIES, { required: true });
    if (args.next_follow_up_date !== undefined) {
      if (args.next_follow_up_date === "none") update.next_follow_up_date = null;
      else {
        const check = checkFollowUpDate(f.date("next_follow_up_date"), today(ctx));
        if (!check.ok) f.errors.next_follow_up_date = check.message;
        else update.next_follow_up_date = check.value;
      }
    }
    if (args.add_note !== undefined) {
      const appended = appendNote(cur.notes, args.add_note, `${today(ctx)} ${ctx.staff.fullName}, via chat`, NOTES_MAX);
      if (!appended.ok) f.errors.add_note = appended.message;
      else update.notes = appended.value;
    }
    if (!f.ok) return respond("invalid", invalidText(f.errors, { ...LABELS, next_follow_up_date: "Next follow-up", add_note: "Note" }));

    const before = cur as unknown as Record<string, unknown>;
    for (const k of Object.keys(update)) if (sameValue(update[k], before[k])) delete update[k];
    const url = link(ctx, HQ_PATHS.contact(cur.id));
    if (Object.keys(update).length === 0) return respond("unchanged", `Nothing to change: the contact already has those values. ${url}`, [`Contact: ${clean(cur.full_name)}`], { id: cur.id, url });

    if (typeof update.email === "string") {
      const dup = await findDuplicateContact(ctx.db, { organisationId: null, fullName: cur.full_name, email: update.email, excludeId: cur.id });
      if (dup) return respond("invalid", `Not changed: another contact already uses that email address [id: ${dup.id}].`, null, { duplicate_id: dup.id });
    }

    const res = await ctx.db.from("contacts").update(update as Tables["contacts"]["Update"]).eq("id", cur.id).eq("updated_at", cur.updated_at).is("deleted_at", null).select("id");
    if (res.error) {
      if (classifyDbError(res.error) === "duplicate_contact_email") {
        logDb("update_contact", res.error);
        return respond("invalid", "Not changed: another contact already uses that email address.");
      }
      return dbFailure("update_contact", res.error);
    }
    if (!res.data || res.data.length === 0) return respond("unchanged", "Not changed: the contact was changed by someone else a moment ago, or your role may not edit it. Look at it in HQ.", null, { id: cur.id, url });

    const labels: Record<string, string> = { phone: "Phone", email: "Email", position: "Position", relationship_status: "Relationship status", priority: "Priority", next_follow_up_date: "Next follow-up" };
    const lines = [`Contact: ${clean(cur.full_name)}`];
    for (const k of Object.keys(update)) {
      if (k === "notes") lines.push(`- Note added: ${clean(args.add_note, 600)}`);
      else if (k === "relationship_status") lines.push(changeLine(labels[k], relLabel(cur.relationship_status), relLabel(update[k] as string)));
      else if (k === "next_follow_up_date") lines.push(changeLine(labels[k], cur.next_follow_up_date ? day(ctx, cur.next_follow_up_date) : null, update[k] ? day(ctx, update[k] as string) : null));
      else lines.push(changeLine(labels[k] ?? k, before[k], update[k]));
    }
    return respond("ok", `Updated 1 contact [id: ${cur.id}]: ${url}`, lines, { id: cur.id, url, changed: Object.keys(update) });
  },
});

// ── create an organisation ───────────────────────────────────

export const createOrganisation = defineTool({
  name: "create_organisation",
  title: "Create an organisation",
  description:
    "Adds ONE partner organisation (an agency, brokerage, conveyancer and so on) with at least one partner category. Refuses a name HQ already has (the same name ignoring case, punctuation, a leading \"The\" and \"Pty Ltd\") and shows the existing one. Returns the new organisation and its HQ link. It does not add its people (use create_contact).",
  inputSchema: createOrganisationShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    const owner = await staffRef(ctx, args.owner);
    if (!owner.ok) return owner.result;
    const f = new FormReader(
      form({
        name: args.name,
        categories: args.categories,
        website: args.website,
        phone: args.phone,
        email: args.email,
        location: args.location,
        service_region: args.service_region,
        relationship_owner_id: owner.id,
        notes: args.notes,
      }),
    );
    const name = f.requiredText("name", { label: "Name", max: 200 });
    const categories = f.manyOf("categories", PARTNER_CATEGORIES);
    if (categories.length === 0 && !f.errors.categories) f.errors.categories = "Choose at least one category.";
    const website = f.url("website");
    const phone = f.phone("phone");
    const email = f.email("email");
    const location = f.text("location", { label: "Location", max: 300 });
    const serviceRegion = f.text("service_region", { label: "Service region", max: 120 });
    const ownerId = f.uuid("relationship_owner_id");
    const notes = f.text("notes", { label: "Notes", max: 4000 });
    if (!f.ok) return respond("invalid", invalidText(f.errors, { name: "Name", categories: "Categories" }));

    const dup = await findDuplicateOrganisation(ctx.db, name);
    if (dup) return respond("unchanged", `Not created: HQ already has this organisation [id: ${dup.id}]: ${link(ctx, HQ_PATHS.organisation(dup.id))}`, [`Existing: ${clean(dup.name)}`], { duplicate_id: dup.id });

    const { data, error } = await ctx.db
      .from("organisations")
      .insert({ name, categories, website, phone, email, location, service_region: serviceRegion, relationship_owner_id: ownerId, notes, source: SOURCE, needs_verification: false })
      .select("id")
      .single();
    if (error || !data) {
      if (classifyDbError(error) === "duplicate_organisation_name") {
        logDb("create_organisation", error);
        return respond("unchanged", "Not created: HQ already has an organisation with this name. Search for it instead.");
      }
      return dbFailure("create_organisation", error);
    }
    const url = link(ctx, HQ_PATHS.organisation(data.id));
    const lines = [
      `Name: ${clean(name)}`,
      `Categories: ${partnerCats(categories)}`,
      website ? `Website: ${clean(website)}` : null,
      phone ? `Phone: ${clean(phone)}` : null,
      email ? `Email: ${clean(email)}` : null,
      location ? `Location: ${clean(location)}` : null,
      owner.label ? `Owner: ${clean(owner.label)}` : null,
      notes ? `Notes: ${clean(notes, 400)}` : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Created 1 organisation [id: ${data.id}]: ${url}`, lines, { id: data.id, url, created: "organisation" });
  },
});

// ── record a referral ────────────────────────────────────────

function referralFailure(error: PgError) {
  logDb("record_referral", error);
  switch (classifyReferralError(error)) {
    case "permission":
      return result("refused", "Refused by HQ: your role may not record referrals. Nothing was saved.");
    case "partner_not_found":
      return result("not_found", "Not saved: that partner could not be found. It may have been archived.");
    case "partner_required":
      return result("invalid", "Not saved: name the partner: a contact, an organisation, or both.");
    case "partner_mismatch":
      return result("invalid", "Not saved: that contact works at a different organisation.");
    case "duplicate_claim":
      return result("unchanged", "Not saved: this partner already has a referral for that prospect. Find it in the referral register.");
    case "not_found":
      return result("not_found", "Not saved: that prospect could not be found in the pipeline.");
    case "prospect_required":
      return result("invalid", "Not saved: the prospect's name is required for a new received referral.");
    case "assignee_inactive":
      return result("invalid", "Not saved: the assignee must be an active member of staff.");
    case "value_on_claim":
      return result("invalid", "Not saved: the estimate belongs to the prospect, so it can't be set on a further referral.");
    default:
      return result("error", "We couldn't record that referral. Nothing was saved. Try again in a moment.");
  }
}

export const recordReferral = defineTool({
  name: "record_referral",
  title: "Record a referral",
  description:
    "Records ONE referral through hq.record_referral, as you. Received: a partner introduced a prospect; this creates the prospect in the pipeline at introduction_received and credits that partner, or (with existing_prospect) records a further claim on a prospect already in the pipeline, leaving the credit where it is. Sent: Planted referred someone to a partner. Returns the referral number and HQ link. It does not move stages, sign managements or change the credited source.",
  inputSchema: recordReferralShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    const sent = args.direction === "sent";
    if (sent && args.existing_prospect) return respond("invalid", "Not saved: existing_prospect is only for received referrals.");
    if (sent && args.estimated_annual_value !== undefined) return respond("invalid", "Not saved: an estimated value belongs to a received referral's prospect.");
    if (args.existing_prospect && (args.prospect_name || args.estimated_annual_value !== undefined)) {
      return respond("invalid", "Not saved: a further claim on an existing prospect takes no new prospect name or estimate (they belong to the prospect already in the pipeline).");
    }

    let contactId: string | null = null;
    let contactLabel: string | null = null;
    let orgId: string | null = null;
    let orgLabel: string | null = null;
    if (args.partner_organisation) {
      const org = await resolveOrganisation(ctx, args.partner_organisation, "write");
      if (!org.ok) return org.result;
      orgId = org.record.id;
      orgLabel = org.record.label;
    }
    let contactOrgId: string | null = null;
    if (args.partner_contact) {
      const c = await resolveContact(ctx, args.partner_contact, "write", { organisationId: orgId });
      if (!c.ok) return c.result;
      contactId = c.record.id;
      contactLabel = c.record.label;
      const row = await ctx.db.from("contacts").select("organisation_id").eq("id", contactId).maybeSingle();
      if (row.error) return dbFailure("record_referral contact", row.error);
      contactOrgId = row.data?.organisation_id ?? null;
    }
    const partner = checkPartner({ contactId, organisationId: orgId, contactOrganisationId: contactOrgId });
    if (!partner.ok) return respond("invalid", `Not saved: ${partner.message}`);

    let existing: string | null = null;
    let existingLabel: string | null = null;
    if (args.existing_prospect) {
      const opp = await resolveOpportunity(ctx, args.existing_prospect, "write");
      if (!opp.ok) return opp.result;
      existing = opp.record.id;
      existingLabel = opp.record.label;
    }
    const assignee = await staffRef(ctx, args.assignee);
    if (!assignee.ok) return assignee.result;

    const t = today(ctx);
    const f = new FormReader(
      form({
        referral_date: args.referral_date ?? t,
        prospect_name: args.prospect_name,
        prospect_phone: args.prospect_phone,
        prospect_email: args.prospect_email,
        property_suburb: args.property_suburb,
        property_address: args.property_address,
        estimated_value: args.estimated_annual_value !== undefined ? String(args.estimated_annual_value) : null,
        notes: args.notes,
      }),
    );
    const date = f.date("referral_date", { required: true });
    if (date && !f.errors.referral_date) {
      const check = checkPastOrToday(date, t, "The referral date");
      if (!check.ok) f.errors.referral_date = check.message;
    }
    const notes = f.text("notes", { max: 2000, label: "Notes" });
    let prospectName: string | null = null;
    let phone: string | null = null;
    let email: string | null = null;
    let suburb: string | null = null;
    let address: string | null = null;
    let estimate: number | null = null;
    if (!existing) {
      prospectName = sent ? f.text("prospect_name", { max: 200, label: "The prospect's name" }) : f.requiredText("prospect_name", { max: 200, label: "The prospect's name" });
      phone = f.phone("prospect_phone");
      email = f.email("prospect_email");
      suburb = f.text("property_suburb", { max: 120, label: "The suburb" });
      address = f.text("property_address", { max: 300, label: "The address" });
      if (!sent) estimate = f.dollarsToCents("estimated_value");
    }
    if (!f.ok) return respond("invalid", invalidText(f.errors, LABELS));

    const common = { p_referral_date: date ?? undefined, p_assigned_to: assignee.id ?? undefined, p_notes: notes ?? undefined };
    const { data, error } = sent
      ? await ctx.db.rpc("record_referral", {
          p_direction: "sent",
          p_receiving_contact: contactId ?? undefined,
          p_receiving_organisation: orgId ?? undefined,
          p_prospect_name: prospectName ?? undefined,
          p_prospect_phone: phone ?? undefined,
          p_prospect_email: email ?? undefined,
          p_property_suburb: suburb ?? undefined,
          p_property_address: address ?? undefined,
          ...common,
        })
      : await ctx.db.rpc("record_referral", {
          p_direction: "received",
          p_referring_contact: contactId ?? undefined,
          p_referring_organisation: orgId ?? undefined,
          p_existing_opportunity: existing ?? undefined,
          p_prospect_name: prospectName ?? undefined,
          p_prospect_phone: phone ?? undefined,
          p_prospect_email: email ?? undefined,
          p_property_suburb: suburb ?? undefined,
          p_property_address: address ?? undefined,
          p_estimated_value_cents: estimate ?? undefined,
          ...common,
        });
    if (error) return referralFailure(error);
    const out = (data ?? {}) as { referral_id?: string; opportunity_id?: string | null; ref_number?: number | string; is_attributed?: boolean };
    if (!out.referral_id) return respond("error", "HQ did not confirm the referral was saved. Check the referral register before trying again.");
    const label = refNumber(out.ref_number ?? null) || "The referral";
    const url = link(ctx, HQ_PATHS.referral(out.referral_id));
    const partnerText = [contactLabel, orgLabel].filter(Boolean).map((p) => clean(p)).join(", ");
    const lines = [
      `${label}: ${sent ? "sent to" : "received from"} ${partnerText}, dated ${day(ctx, date)}`,
      existingLabel ? `Prospect (already in the pipeline): ${clean(existingLabel)}` : prospectName ? `Prospect: ${clean(prospectName)}` : null,
      suburb || address ? `Property: ${clean([address, suburb].filter(Boolean).join(", "))}` : null,
      estimate !== null ? `Estimated annual value: ${formatAud(estimate)}` : null,
      assignee.label ? `Assigned to: ${clean(assignee.label)}` : null,
      !sent ? (out.is_attributed === false ? "Credit: this is a further claim; the credit stays with the first source." : "Credit: this referral is the credited source; the prospect is at Introduction received.") : null,
    ].filter((l): l is string => !!l);
    return respond("ok", `Recorded 1 referral (${label}) [id: ${out.referral_id}]: ${url}`, lines, { id: out.referral_id, opportunity_id: out.opportunity_id ?? null, ref_number: out.ref_number ?? null, url });
  },
});

// ── move a prospect ──────────────────────────────────────────

export const moveOpportunity = defineTool({
  name: "move_opportunity",
  title: "Move a prospect to another stage",
  description:
    "Moves ONE prospect in the pipeline (found by name, referral number such as REF-0007, or id) to another working stage: introduction_received, contacted, qualified, appraisal_requested, appraisal_completed or proposal_sent, through hq.move_opportunity (stage history and audit recorded). It REFUSES management_signed and lost, and moving anything out of signed: those change the reported counts and are done on the HQ pipeline screen.",
  inputSchema: moveOpportunityShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async ({ opportunity, stage, note }, ctx) => {
    const early = moveOpportunityRefusal(stage, null);
    if (early) return respond("refused", `${early} Pipeline: ${link(ctx, HQ_PATHS.pipeline())}`);
    const found = await resolveOpportunity(ctx, opportunity, "write");
    if (!found.ok) return found.result;
    const { data: cur, error } = await ctx.db.from("opportunities").select("id, stage, prospect_name, display_number").eq("id", found.record.id).is("deleted_at", null).maybeSingle();
    if (error) return dbFailure("move_opportunity load", error);
    if (!cur) return respond("not_found", "That prospect could not be found. It may have been archived. Nothing was changed.");
    const refusal = moveOpportunityRefusal(stage, cur.stage);
    if (refusal) return respond("refused", `${refusal} Pipeline: ${link(ctx, HQ_PATHS.pipeline())}`);

    const ref = await ctx.db.from("referral_overview").select("id").eq("opportunity_id", cur.id).eq("is_attributed", true).limit(1);
    const url = ref.data?.[0]?.id ? link(ctx, HQ_PATHS.referral(ref.data[0].id)) : link(ctx, HQ_PATHS.pipeline());
    const name = clean(cur.prospect_name ?? `Opportunity ${cur.display_number}`);
    if (cur.stage === stage) return respond("unchanged", `Nothing changed: the prospect is already at ${stageLabel(stage)}. ${url}`, [`Prospect: ${name}`], { id: cur.id });

    const f = new FormReader(form({ note }));
    const cleanNote = f.text("note", { max: 500, label: "The note" });
    if (!f.ok) return respond("invalid", invalidText(f.errors));
    const { data, error: moveError } = await ctx.db.rpc("move_opportunity", { p_opportunity: cur.id, p_stage: stage, p_note: cleanNote ?? undefined });
    if (moveError) {
      logDb("move_opportunity", moveError);
      const kind = classifyReferralError(moveError);
      if (kind === "permission" || kind === "leave_signed_forbidden") return respond("refused", "Refused by HQ: your role may not make that move. Nothing was changed.");
      if (kind === "not_found") return respond("not_found", "That prospect could not be found. It may have been archived. Nothing was changed.");
      return respond("error", "We couldn't move that. Nothing was changed. Try again in a moment.");
    }
    if ((data as { changed?: unknown } | null)?.changed === false) return respond("unchanged", `Nothing changed: it was already at that stage. ${url}`, [`Prospect: ${name}`], { id: cur.id });
    return respond("ok", `Moved 1 prospect [id: ${cur.id}]: ${url}`, [`Prospect: ${name}`, changeLine("Stage", stageLabel(cur.stage), stageLabel(stage)), cleanNote ? `Note: ${clean(cleanNote)}` : ""].filter(Boolean), {
      id: cur.id,
      from: cur.stage,
      to: stage,
      url,
    });
  },
});
