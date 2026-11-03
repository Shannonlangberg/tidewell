/*
 * The referral partner pathway (docs/hq-partner-pathway.md): Not yet connected, then Connect, Cultivate,
 * Champion. It is a READING of the relationship status HQ already stores on each contact
 * (hq.contacts.relationship_status), never a second field:
 *
 *   Not yet connected   identified, or a business with nobody recorded yet
 *   Connect             contacted, meeting booked
 *   Cultivate           met, active relationship
 *   Champion            referring partner
 *   Not active          inactive (every person at the business is inactive)
 *
 * A business's step is its most advanced live person's, exactly as hq.referral_partner_overview reads
 * relationship_status. An independent partner is one person, so their step is their own.
 *
 * Moving a partner (planPartnerMove) changes as few people as it can, and only their relationship status:
 *   forward   the partner's main person (the primary contact, else the furthest along) moves to the new
 *             step's first status. Everyone else keeps theirs.
 *   back      everyone further along than the new step moves back to its first status, so the business
 *             really is at that step. Everyone else keeps theirs.
 * Inactive people are never touched. The page shows exactly who will change before anything is saved,
 * and each change is an ordinary contact update, so it is in the audit trail.
 *
 * Pure: type-only imports, so `node --test` can run it.
 */

import type { RelationshipStatus } from "../constants";

export const PATHWAY_STEPS = ["not_connected", "connect", "cultivate", "champion"] as const;
export type PathwayStep = (typeof PATHWAY_STEPS)[number];
/** A step, or "inactive" for a partner whose people are all inactive. */
export type PathwayPlace = PathwayStep | "inactive";

export const STEP_LABEL: Record<PathwayPlace, string> = {
  not_connected: "Not yet connected",
  connect: "Connect",
  cultivate: "Cultivate",
  champion: "Champion",
  inactive: "Not active",
};

export const STEP_HINT: Record<PathwayPlace, string> = {
  not_connected: "Identified, not contacted yet",
  connect: "Contacted, or a meeting booked",
  cultivate: "Met, or an active relationship",
  champion: "Referring to us",
  inactive: "Marked inactive",
};

/** The statuses each step holds, in pipeline order. */
export const STEP_STATUSES: Record<PathwayPlace, readonly RelationshipStatus[]> = {
  not_connected: ["identified"],
  connect: ["contacted", "meeting_booked"],
  cultivate: ["met", "active_relationship"],
  champion: ["referring_partner"],
  inactive: ["inactive"],
};

/** The status a person is given when they are moved to a step. */
export const STEP_ENTRY: Record<PathwayStep, RelationshipStatus> = {
  not_connected: "identified",
  connect: "contacted",
  cultivate: "met",
  champion: "referring_partner",
};

export function isPathwayPlace(v: unknown): v is PathwayPlace {
  return typeof v === "string" && (v === "inactive" || (PATHWAY_STEPS as readonly string[]).includes(v));
}

/** The step a status sits in. No status (a business with nobody recorded) is Not yet connected. */
export function placeOf(status: RelationshipStatus | null | undefined): PathwayPlace {
  if (!status) return "not_connected";
  for (const p of [...PATHWAY_STEPS, "inactive"] as const) if (STEP_STATUSES[p].includes(status)) return p;
  return "not_connected";
}

const rank = (s: PathwayStep) => PATHWAY_STEPS.indexOf(s);

export function nextStep(p: PathwayPlace): PathwayStep | null {
  if (p === "inactive") return null;
  return PATHWAY_STEPS[rank(p) + 1] ?? null;
}

export function previousStep(p: PathwayPlace): PathwayStep | null {
  if (p === "inactive") return null;
  return rank(p) > 0 ? PATHWAY_STEPS[rank(p) - 1] : null;
}

export type PathwayPerson = { id: string; name: string; status: RelationshipStatus | null; primary: boolean };
export type PathwayChange = { id: string; name: string; from: RelationshipStatus | null; to: RelationshipStatus };

/** Where a partner is, from its people: the furthest along live person; all inactive is Not active. */
export function partnerPlace(people: readonly PathwayPerson[]): PathwayPlace {
  const live = people.filter((p) => p.status !== "inactive");
  if (people.length > 0 && live.length === 0) return "inactive";
  let best: PathwayStep = "not_connected";
  for (const p of live) {
    const step = placeOf(p.status) as PathwayStep;
    if (rank(step) > rank(best)) best = step;
  }
  return best;
}

export type MovePlan = { ok: true; from: PathwayPlace; to: PathwayStep; changes: PathwayChange[] } | { ok: false; reason: string };

/** Exactly who changes when a partner is moved to `to`. Nothing is saved here. */
export function planPartnerMove(people: readonly PathwayPerson[], to: PathwayStep): MovePlan {
  const live = people.filter((p) => p.status !== "inactive");
  if (live.length === 0) {
    return { ok: false, reason: people.length === 0 ? "Nobody is recorded at this partner yet. Add the person you deal with, then move them along the pathway." : "Everyone at this partner is marked inactive. Change a person's status on their page first." };
  }
  const from = partnerPlace(people);
  if (from === to) return { ok: false, reason: `Already at ${STEP_LABEL[to]}.` };
  const entry = STEP_ENTRY[to];
  const fromRank = from === "inactive" ? -1 : rank(from);
  if (rank(to) > fromRank) {
    // forward: the main person only
    const lead =
      live.find((p) => p.primary) ??
      [...live].sort((a, b) => rank(placeOf(b.status) as PathwayStep) - rank(placeOf(a.status) as PathwayStep) || a.name.localeCompare(b.name))[0];
    return { ok: true, from, to, changes: [{ id: lead.id, name: lead.name, from: lead.status, to: entry }] };
  }
  // back: everyone further along than the new step
  const ahead = live.filter((p) => rank(placeOf(p.status) as PathwayStep) > rank(to));
  return { ok: true, from, to, changes: ahead.map((p) => ({ id: p.id, name: p.name, from: p.status, to: entry })) };
}
