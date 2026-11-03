/*
 * The referral partner pathway over chat: where partners are on Not yet connected, Connect, Cultivate,
 * Champion, and moving one along it. The same reading and the same move as the HQ pages
 * (lib/hq/growth/pathway.ts, pathway-queries.ts), so the two cannot disagree. Reads need growth.read,
 * the move growth.write. Every query runs as the person (RLS); a move is an ordinary contact update of
 * relationship_status, so it is in the audit trail. It never changes anything else.
 */
import { RELATIONSHIP_LABEL } from "../../constants";
import { PATHWAY_STEPS, STEP_HINT, STEP_LABEL, nextStep, previousStep, type PathwayPlace, type PathwayStep } from "../../growth/pathway";
import { loadPartnerPathway, movePartner, partnerPlaceCounts, wherePlace, type PartnerRef } from "../../growth/pathway-queries";
import { HQ_PATHS, clean, rowLimit } from "./core";
import { day, defineTool, link, resolveContact, resolveOrganisation, respond, type ToolContext } from "./kit";
import { movePartnerStageShape, partnerPathwayShape } from "./schemas";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const partnerUrl = (ctx: ToolContext, p: PartnerRef) => link(ctx, p.kind === "organisation" ? HQ_PATHS.organisation(p.id) : HQ_PATHS.contact(p.id));

/** A partner by name or id: an organisation first, else an independent partner contact (no organisation). */
async function resolvePartner(ctx: ToolContext, query: string, mode: "read" | "write") {
  const org = await resolveOrganisation(ctx, query, mode);
  if (org.ok) return { ok: true as const, partner: { kind: "organisation" as const, id: org.record.id }, label: org.record.label };
  if (org.result.structured?.outcome === "ambiguous") return { ok: false as const, result: org.result };
  const person = await resolveContact(ctx, query, mode);
  if (!person.ok) return { ok: false as const, result: org.result.structured?.outcome === "not_found" && person.result.structured?.outcome === "not_found" ? org.result : person.result };
  const { data } = await ctx.db.from("contacts").select("organisation_id, contact_kind").eq("id", person.record.id).maybeSingle();
  if (data?.organisation_id) return { ok: true as const, partner: { kind: "organisation" as const, id: data.organisation_id }, label: `${person.record.label}'s organisation` };
  if (data?.contact_kind !== "partner") return { ok: false as const, result: respond("invalid", `${clean(person.record.label)} is not a referral partner (only partner contacts are on the pathway). Nothing was changed.`) };
  return { ok: true as const, partner: { kind: "independent" as const, id: person.record.id }, label: person.record.label };
}

export const partnerPathway = defineTool({
  name: "partner_pathway",
  title: "Referral partner pathway",
  description:
    "Where referral partners are on the pathway: Not yet connected (identified, not contacted), Connect (contacted, meeting booked), Cultivate (met, active relationship), Champion (referring to us), or Not active. With no arguments: how many partners are at each step. With stage: the partners at that step. With partner (a business or independent partner, by name or id): where they are, who sets it and the moves open to them. A partner's step is its furthest-along person's relationship status. Read-only.",
  inputSchema: partnerPathwayShape,
  annotations: READ,
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    if (args.partner) {
      const found = await resolvePartner(ctx, args.partner, "read");
      if (!found.ok) return found.result;
      const pw = await loadPartnerPathway(ctx.db, found.partner);
      if (!pw.ok) return respond("error", "The pathway could not be loaded just now. Try again in a moment.");
      const { place, people } = pw.data;
      const next = nextStep(place);
      const prev = previousStep(place);
      return respond(
        "ok",
        `${clean(found.label)} is at ${STEP_LABEL[place]} (${STEP_HINT[place]}). ${partnerUrl(ctx, found.partner)}`,
        people.length ? people.map((p) => `- ${clean(p.name)} [contact id: ${p.id}]${p.primary && found.partner.kind === "organisation" ? " (primary)" : ""}: ${p.status ? RELATIONSHIP_LABEL[p.status] : "no status"}`) : ["Nobody is recorded at this partner yet."],
        { place, next: next ?? null, previous: prev ?? null },
        [next ? `Next step: ${STEP_LABEL[next]}.` : null, prev ? `Previous step: ${STEP_LABEL[prev]}.` : null, "move_partner_stage moves them (it shows who changes)."].filter(Boolean).join(" "),
      );
    }
    const kind = args.independent ? "independent" : "organisation";
    if (args.stage) {
      const n = rowLimit(args.limit);
      const { data, error, count } = await wherePlace(ctx.db.from("referral_partner_overview").select("id, name, primary_contact_name, last_contacted_at, relationship_status", { count: "exact" }).eq("partner_kind", kind), args.stage as PathwayPlace)
        .order("name")
        .limit(n);
      if (error) return respond("error", "The partners could not be listed just now. Try again in a moment.");
      const rows = data ?? [];
      if (rows.length === 0) return respond("empty", `No ${kind === "independent" ? "independent " : ""}partners are at ${STEP_LABEL[args.stage as PathwayPlace]}.`, null, { total: 0 });
      return respond(
        "ok",
        `${count ?? rows.length} ${kind === "independent" ? "independent " : ""}partners at ${STEP_LABEL[args.stage as PathwayPlace]}. List: ${link(ctx, `/hq/growth/partners?stage=${args.stage}${kind === "independent" ? "&show=independent" : ""}`)}`,
        rows.map((r) => `- ${clean(r.name)} [${kind === "organisation" ? "organisation" : "contact"} id: ${r.id}]${r.primary_contact_name ? ` (${clean(r.primary_contact_name)})` : ""} - ${r.relationship_status ? RELATIONSHIP_LABEL[r.relationship_status] : "nobody recorded"} - last contact ${r.last_contacted_at ? day(ctx, r.last_contacted_at.slice(0, 10)) : "never"}`),
        { total: count ?? rows.length },
        (count ?? 0) > rows.length ? `Showing ${rows.length}, by name.` : undefined,
      );
    }
    const counts = await partnerPlaceCounts(ctx.db, kind);
    if (!counts) return respond("error", "The pathway could not be counted just now. Try again in a moment.");
    const places = [...PATHWAY_STEPS, "inactive"] as const;
    return respond(
      "ok",
      `The referral pathway (${kind === "independent" ? "independent partners" : "partner businesses"}). List: ${link(ctx, "/hq/growth/partners")}`,
      places.filter((p) => p !== "inactive" || counts.inactive > 0).map((p) => `- ${STEP_LABEL[p]}: ${counts[p]} (${STEP_HINT[p]})`),
      { counts },
    );
  },
});

export const movePartnerStage = defineTool({
  name: "move_partner_stage",
  title: "Move a referral partner along the pathway",
  description:
    "Moves ONE referral partner (a business or an independent partner, by name or id) to a step of the pathway: not_connected, connect, cultivate or champion, or next / back. Forward changes only the partner's main person (the primary contact, else the furthest along) to the step's first status; back changes everyone further along than the step. Inactive people are never touched. Returns exactly who changed. It changes relationship status only, audited.",
  inputSchema: movePartnerStageShape,
  annotations: WRITE,
  capability: "growth.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolvePartner(ctx, args.partner, "write");
    if (!found.ok) return found.result;
    const pw = await loadPartnerPathway(ctx.db, found.partner);
    if (!pw.ok) return respond("error", "The pathway could not be loaded just now. Nothing was changed.");
    const place = pw.data.place;
    const to: PathwayStep | null = args.to === "next" ? nextStep(place) : args.to === "back" ? previousStep(place) : (args.to as PathwayStep);
    if (!to) return respond("invalid", `${clean(found.label)} is at ${STEP_LABEL[place]}: there is no ${args.to === "next" ? "next" : "previous"} step. Nothing was changed.`);
    const moved = await movePartner(ctx.db, found.partner, to);
    if (!moved.ok) return respond(moved.kind === "forbidden" ? "refused" : moved.kind === "refused" ? "invalid" : "error", `${moved.message}${moved.kind === "refused" ? " Nothing was changed." : ""}`);
    return respond(
      "ok",
      `Moved ${clean(found.label)} from ${STEP_LABEL[moved.plan.from]} to ${STEP_LABEL[to]}: ${partnerUrl(ctx, found.partner)}`,
      moved.plan.changes.map((c) => `- ${clean(c.name)}: ${c.from ? RELATIONSHIP_LABEL[c.from] : "no status"} -> ${RELATIONSHIP_LABEL[c.to]}`),
      { from: moved.plan.from, to, changed: moved.plan.changes.map((c) => c.id) },
      "Nobody else changed.",
    );
  },
});
