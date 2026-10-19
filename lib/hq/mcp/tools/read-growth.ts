/*
 * Growth reads: contacts, organisations, referrals, the pipeline and who to contact next. All need
 * growth.read (RLS enforces it again on every view).
 */
import { PRIORITY_LABEL, type Priority } from "../../constants";
import { orIlike } from "../../growth/params";
import { columnTotals, daysInStage, groupByStage, isStage, STAGE_ORDER, type Stage } from "../../referrals/stages";
import { formatAud } from "../../format";
import { HQ_PATHS, clean, plural, rowLimit } from "./core";
import { day, dbFailure, defineTool, link, resolveContact, resolveOrganisation, resolveStaff, respond, today, when } from "./kit";
import { contactRecord, partnerCats, relLabel, stageLabel } from "./records";
import { getContactShape, listReferralsShape, pipelineSummaryShape, searchContactsShape, searchOrganisationsShape, whoToContactShape } from "./schemas";

export const searchContacts = defineTool({
  name: "search_contacts",
  title: "Search contacts",
  description:
    "Lists many partner contacts in ONE call (people at agencies, brokers, conveyancers and so on), preferred over opening contacts one by one. Filter by words, organisation, relationship status, owner, or follow-up due. Shows organisation, status, last contact and next follow-up, with ids for follow-up calls. Read-only.",
  inputSchema: searchContactsShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    let q = ctx.db
      .from("contact_directory")
      .select("id, full_name, position, organisation_name, relationship_status, priority, next_follow_up_date, last_contact_at, relationship_owner_name", { count: "exact" });
    const filter = orIlike(["full_name", "position", "email", "organisation_name"], args.query ?? "");
    if (filter) q = q.or(filter);
    const notes: string[] = [];
    if (args.organisation) {
      const org = await resolveOrganisation(ctx, args.organisation, "read");
      if (!org.ok) return org.result;
      q = q.eq("organisation_id", org.record.id);
      notes.push(`at ${clean(org.record.label)}`);
    }
    if (args.owner) {
      const who = await resolveStaff(ctx, args.owner, "read");
      if (!who.ok) return who.result;
      q = q.eq("relationship_owner_id", who.record.id);
      notes.push(`owned by ${clean(who.record.label)}`);
    }
    if (args.status) q = q.eq("relationship_status", args.status);
    if (args.follow_up_due) q = q.lte("next_follow_up_date", today(ctx)).neq("relationship_status", "inactive");
    const { data, error, count } = await q.order("full_name").limit(n);
    if (error) return dbFailure("search_contacts", error);
    const rows = data ?? [];
    const what = [args.query && `matching "${clean(args.query, 60)}"`, ...notes, args.status && `status ${relLabel(args.status)}`, args.follow_up_due && "follow-up due"].filter(Boolean).join(", ");
    if (rows.length === 0) return respond("empty", `No contacts found${what ? ` (${what})` : ""}.`, null, { count: 0 });
    const total = count ?? rows.length;
    const t = today(ctx);
    const lines = rows.map(
      (r) =>
        `- ${clean(r.full_name)} [id: ${r.id}]${r.position ? `, ${clean(r.position)}` : ""} - ${clean(r.organisation_name ?? "independent")} - ${relLabel(r.relationship_status)}${r.priority ? `, ${PRIORITY_LABEL[r.priority as Priority].toLowerCase()} priority` : ""} - last contact ${r.last_contact_at ? when(ctx, r.last_contact_at) : "never"}${r.next_follow_up_date ? ` - follow up ${day(ctx, r.next_follow_up_date)}${r.next_follow_up_date < t ? " (overdue)" : ""}` : ""}`,
    );
    return respond("ok", `${plural(total, "contact")}${what ? ` (${what})` : ""}${total > rows.length ? `, showing ${rows.length}` : ""}.`, lines, { count: total, ids: rows.map((r) => r.id) });
  },
});

export const getContact = defineTool({
  name: "get_contact",
  title: "Get a contact",
  description:
    "Opens ONE partner contact in full. Use only when asked about that specific person; to look at several people, use search_contacts, who_to_contact or a report, never repeated get_contact calls. Shows, by name or id, organisation, contact details, relationship status, owner, last contact, next follow-up, notes, the five most recent interactions and open tasks, with the HQ link. If the name matches several people you get the candidates instead (add the organisation to tell them apart). Read-only.",
  inputSchema: getContactShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async ({ contact, organisation }, ctx) => {
    let organisationId: string | null = null;
    if (organisation) {
      const org = await resolveOrganisation(ctx, organisation, "read");
      if (!org.ok) return org.result;
      organisationId = org.record.id;
    }
    const found = await resolveContact(ctx, contact, "read", { organisationId });
    if (!found.ok) return found.result;
    const rec = await contactRecord(ctx, found.record.id);
    if (!rec) return respond("not_found", "That contact could not be found. It may have been archived.");
    return respond("ok", [found.note ?? "", `${clean(rec.title)}: ${rec.url}`], rec.lines, { id: rec.id, url: rec.url, ...rec.metadata });
  },
});

export const searchOrganisations = defineTool({
  name: "search_organisations",
  title: "Search organisations",
  description: "Lists partner organisations filtered by words (name or location) or partner category, with contact counts and primary contact. Read-only.",
  inputSchema: searchOrganisationsShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    let q = ctx.db.from("organisation_directory").select("id, name, categories, location, contact_count, primary_contact_name, relationship_owner_name, last_contact_at", { count: "exact" });
    const filter = orIlike(["name", "location"], args.query ?? "");
    if (filter) q = q.or(filter);
    if (args.category) q = q.contains("categories", [args.category]);
    const { data, error, count } = await q.order("name").limit(n);
    if (error) return dbFailure("search_organisations", error);
    const rows = data ?? [];
    if (rows.length === 0) return respond("empty", "No organisations found that match.", null, { count: 0 });
    const total = count ?? rows.length;
    const lines = rows.map(
      (r) =>
        `- ${clean(r.name)} [id: ${r.id}] - ${partnerCats(r.categories)}${r.location ? ` - ${clean(r.location)}` : ""} - ${plural(r.contact_count ?? 0, "contact")}${r.primary_contact_name ? `, primary ${clean(r.primary_contact_name)}` : ""}${r.relationship_owner_name ? ` - owner ${clean(r.relationship_owner_name)}` : ""}`,
    );
    return respond("ok", `${plural(total, "organisation")}${total > rows.length ? `, showing ${rows.length}` : ""}.`, lines, { count: total, ids: rows.map((r) => r.id) });
  },
});

export const listReferrals = defineTool({
  name: "list_referrals",
  title: "List referrals",
  description:
    "Lists referrals from the referral register, newest first: received introductions (with the prospect's pipeline stage and whether it is the credited source) and referrals Planted sent out. Filter by direction, stage, partner organisation or date. Read-only.",
  inputSchema: listReferralsShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    let q = ctx.db
      .from("referral_overview")
      .select("id, ref_label, direction, referral_date, partner_contact_name, partner_organisation_name, prospect_name, property_suburb, stage, is_attributed, sent_outcome, assigned_to_name, estimated_annual_value_cents", { count: "exact" });
    if (args.direction) q = q.eq("direction", args.direction);
    if (args.stage) q = q.eq("stage", args.stage).eq("direction", "received");
    if (args.partner) {
      const org = await resolveOrganisation(ctx, args.partner, "read");
      if (!org.ok) return org.result;
      q = q.eq("partner_organisation_id", org.record.id);
    }
    if (args.since) q = q.gte("referral_date", args.since);
    const { data, error, count } = await q.order("referral_date", { ascending: false }).order("ref_number", { ascending: false }).limit(n);
    if (error) return dbFailure("list_referrals", error);
    const rows = data ?? [];
    if (rows.length === 0) return respond("empty", "No referrals match. Nothing has been recorded with those filters.", null, { count: 0 });
    const total = count ?? rows.length;
    const lines = rows.map((r) => {
      const partner = [r.partner_contact_name, r.partner_organisation_name].filter(Boolean).map((p) => clean(p)).join(", ") || "partner not recorded";
      const tail =
        r.direction === "received"
          ? `${stageLabel(r.stage)}${r.is_attributed === false ? ", further claim (not credited)" : ""}${r.estimated_annual_value_cents !== null ? `, est. ${formatAud(r.estimated_annual_value_cents)}/yr` : ""}`
          : `outcome ${(r.sent_outcome ?? "sent").replace(/_/g, " ")}`;
      return `- ${r.ref_label} [id: ${r.id}] ${day(ctx, r.referral_date)}, ${r.direction} ${r.direction === "received" ? "from" : "to"} ${partner}: ${clean(r.prospect_name ?? "no prospect name")}${r.property_suburb ? ` (${clean(r.property_suburb)})` : ""} - ${tail}${r.assigned_to_name ? ` - ${clean(r.assigned_to_name)}` : ""}`;
    });
    return respond("ok", `${plural(total, "referral")}${total > rows.length ? `, showing the latest ${rows.length}` : ""}. Register: ${link(ctx, "/hq/growth/referrals")}`, lines, { count: total });
  },
});

export const pipelineSummary = defineTool({
  name: "pipeline_summary",
  title: "Pipeline summary",
  description:
    "Counts the prospects (opportunities) at each pipeline stage right now, with the total estimated annual value where an estimate was recorded and how many have sat in their stage for over 30 days. Signed and lost are all-time totals; use growth_report for figures over a period. Read-only.",
  inputSchema: pipelineSummaryShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async (_args, ctx) => {
    const LIMIT = 2000;
    const { data, error } = await ctx.db.from("opportunities").select("stage, estimated_annual_value_cents, stage_changed_at").is("deleted_at", null).limit(LIMIT + 1);
    if (error) return dbFailure("pipeline_summary", error);
    const rows = (data ?? []).slice(0, LIMIT);
    if (rows.length === 0) return respond("empty", `The pipeline is empty: no prospects have been recorded yet. Pipeline: ${link(ctx, HQ_PATHS.pipeline())}`, null, { total: 0 });
    const cards = rows.filter((r) => isStage(r.stage)).map((r) => ({ stage: r.stage as Stage, estimateCents: r.estimated_annual_value_cents, changedAt: r.stage_changed_at }));
    const grouped = groupByStage(cards);
    const byStage: Record<string, number> = {};
    const lines = STAGE_ORDER.map((s) => {
      const list = grouped[s];
      const totals = columnTotals(list);
      byStage[s] = totals.count;
      const stale = s === "management_signed" || s === "lost" ? 0 : list.filter((c) => (daysInStage(c.changedAt, ctx.staff.timezone) ?? 0) > 30).length;
      const value = totals.withEstimate > 0 ? `, est. ${formatAud(totals.estimateCents)}/yr from ${totals.withEstimate} with an estimate` : "";
      return `- ${stageLabel(s)}: ${totals.count}${value}${stale ? `, ${stale} in this stage over 30 days` : ""}`;
    });
    const open = cards.filter((c) => c.stage !== "management_signed" && c.stage !== "lost").length;
    return respond(
      "ok",
      `${plural(open, "open prospect")} in the pipeline (${plural(rows.length, "prospect")} in total, including signed and lost)${(data ?? []).length > LIMIT ? `; counted the first ${LIMIT}` : ""}. Pipeline: ${link(ctx, HQ_PATHS.pipeline())}`,
      lines,
      { by_stage: byStage, open },
    );
  },
});

export const whoToContact = defineTool({
  name: "who_to_contact",
  title: "Who to contact",
  description:
    "Lists partner contacts to get in touch with: follow-ups that are overdue or due today, then active contacts not contacted in the last N days (default 30; never contacted first). Inactive contacts are left out. Read-only.",
  inputSchema: whoToContactShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    const days = args.days ?? 30;
    const t = today(ctx);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    let due = ctx.db
      .from("contact_directory")
      .select("id, full_name, organisation_name, next_follow_up_date, last_contact_at, relationship_status", { count: "exact" })
      .lte("next_follow_up_date", t)
      .neq("relationship_status", "inactive");
    let stale = ctx.db
      .from("contact_directory")
      .select("id, full_name, organisation_name, last_contact_at, relationship_status", { count: "exact" })
      .neq("relationship_status", "inactive")
      .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`);
    if (args.mine_only) {
      due = due.eq("relationship_owner_id", ctx.staff.id);
      stale = stale.eq("relationship_owner_id", ctx.staff.id);
    }
    const [a, b] = await Promise.all([
      due.order("next_follow_up_date", { ascending: true }).order("full_name").limit(n),
      stale.order("last_contact_at", { ascending: true, nullsFirst: true }).order("full_name").limit(n),
    ]);
    if (a.error) return dbFailure("who_to_contact (due)", a.error);
    if (b.error) return dbFailure("who_to_contact (stale)", b.error);
    const dueRows = a.data ?? [];
    const dueIds = new Set(dueRows.map((r) => r.id));
    const staleRows = (b.data ?? []).filter((r) => !dueIds.has(r.id));
    if (dueRows.length === 0 && staleRows.length === 0) {
      return respond("empty", `Nobody is due: no follow-ups are overdue or due today, and every active contact${args.mine_only ? " you own" : ""} has been contacted in the last ${days} days.`, null, { due: 0, stale: 0 });
    }
    const lines = [
      dueRows.length ? `Follow-ups due (${a.count ?? dueRows.length}):` : "Follow-ups due: none",
      ...dueRows.map((r) => `- ${clean(r.full_name)} [id: ${r.id}] (${clean(r.organisation_name ?? "independent")}) - follow-up ${day(ctx, r.next_follow_up_date)}${r.next_follow_up_date && r.next_follow_up_date < t ? " (overdue)" : " (today)"} - last contact ${r.last_contact_at ? when(ctx, r.last_contact_at) : "never"}`),
      staleRows.length ? `Not contacted in ${days} days (${b.count ?? staleRows.length}${dueRows.length ? ", some may also be listed above" : ""}):` : `Not contacted in ${days} days: none`,
      ...staleRows.map((r) => `- ${clean(r.full_name)} [id: ${r.id}] (${clean(r.organisation_name ?? "independent")}) - ${relLabel(r.relationship_status)} - last contact ${r.last_contact_at ? when(ctx, r.last_contact_at) : "never"}`),
    ];
    return respond("ok", `Who to contact${args.mine_only ? " (your contacts)" : ""}. Contacts: ${link(ctx, "/hq/growth/contacts")}`, lines, { due: a.count ?? dueRows.length, stale: b.count ?? staleRows.length }, `Showing at most ${n} per list.`);
  },
});
