/*
 * Reads and the one write for the referral partner pathway (lib/hq/growth/pathway.ts), shared by the HQ
 * pages and the chat tools, so both move a partner the same way. Every query runs as the signed-in person:
 * row level security decides what comes back (growth.read) and who may change a contact (growth.write).
 * A move is an ordinary contact update of relationship_status, so it lands in the audit trail as before.
 * No "server-only" import: the MCP smoke script loads this under plain Node.
 */

import type { HqClient } from "../db";
import type { RelationshipStatus } from "../constants";
import { PATHWAY_STEPS, STEP_STATUSES, partnerPlace, planPartnerMove, type MovePlan, type PathwayPerson, type PathwayPlace, type PathwayStep } from "./pathway";

type Db = HqClient;
export type PartnerRef = { kind: "organisation" | "independent"; id: string };
export type Loaded<T> = { ok: true; data: T } | { ok: false };

const logErr = (where: string, e: { code?: string } | null | undefined) => console.error(`[hq] pathway ${where} failed:`, e?.code ?? "unknown");

/** Not yet connected on referral_partner_overview: identified, or a business with nobody recorded (no status). */
export const NOT_CONNECTED_CONDITION = "relationship_status.is.null,relationship_status.eq.identified";

/** Narrows a referral_partner_overview query to one place on the pathway. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wherePlace<Q extends { or: (c: string) => Q; in: (col: string, v: any[]) => Q }>(q: Q, place: PathwayPlace): Q {
  return place === "not_connected" ? q.or(NOT_CONNECTED_CONDITION) : q.in("relationship_status", [...STEP_STATUSES[place]]);
}

/** How many partners of one kind are at each place on the pathway. Null when the counts failed. */
export async function partnerPlaceCounts(db: Db, kind: PartnerRef["kind"]): Promise<Record<PathwayPlace, number> | null> {
  const places = [...PATHWAY_STEPS, "inactive"] as const;
  const results = await Promise.all(places.map((p) => wherePlace(db.from("referral_partner_overview").select("id", { count: "exact", head: true }).eq("partner_kind", kind), p)));
  const bad = results.find((r) => r.error);
  if (bad?.error) {
    logErr("place counts", bad.error);
    return null;
  }
  return Object.fromEntries(places.map((p, i) => [p, results[i].count ?? 0])) as Record<PathwayPlace, number>;
}

/** The people whose status sets the partner's place: the business's live partner contacts, or the independent contact. */
export async function loadPartnerPeople(db: Db, partner: PartnerRef): Promise<Loaded<PathwayPerson[]>> {
  let q = db.from("contacts").select("id, full_name, relationship_status, org_contact_role").is("deleted_at", null).eq("contact_kind", "partner");
  q = partner.kind === "organisation" ? q.eq("organisation_id", partner.id) : q.eq("id", partner.id);
  const { data, error } = await q.order("full_name").limit(500);
  if (error) {
    logErr("people", error);
    return { ok: false };
  }
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id,
      name: r.full_name,
      status: (r.relationship_status ?? null) as RelationshipStatus | null,
      primary: partner.kind === "independent" || r.org_contact_role === "primary",
    })),
  };
}

export type PartnerPathway = { place: PathwayPlace; people: PathwayPerson[] };

export async function loadPartnerPathway(db: Db, partner: PartnerRef): Promise<Loaded<PartnerPathway>> {
  const people = await loadPartnerPeople(db, partner);
  if (!people.ok) return people;
  return { ok: true, data: { place: partnerPlace(people.data), people: people.data } };
}

export type MoveResult =
  | { ok: true; plan: Extract<MovePlan, { ok: true }> }
  | { ok: false; kind: "refused" | "forbidden" | "changed" | "error"; message: string };

/**
 * Moves a partner to `to`, working out who changes from the people as they are NOW (never from what a page
 * showed earlier). Everyone who changes gets the same status, so it is one update: all of it or none.
 */
export async function movePartner(db: Db, partner: PartnerRef, to: PathwayStep): Promise<MoveResult> {
  const people = await loadPartnerPeople(db, partner);
  if (!people.ok) return { ok: false, kind: "error", message: "We couldn't read this partner's people just now. Nothing was changed." };
  const plan = planPartnerMove(people.data, to);
  if (!plan.ok) return { ok: false, kind: "refused", message: plan.reason };
  const ids = plan.changes.map((c) => c.id);
  const { data, error } = await db.from("contacts").update({ relationship_status: plan.changes[0].to }).in("id", ids).is("deleted_at", null).select("id");
  if (error) {
    logErr("move", error);
    return error.code === "42501"
      ? { ok: false, kind: "forbidden", message: "You don't have permission to change this partner." }
      : { ok: false, kind: "error", message: "We couldn't move this partner. Nothing was changed. Try again in a moment." };
  }
  if ((data ?? []).length !== ids.length) return { ok: false, kind: "changed", message: "Not everyone could be moved: someone at this partner was archived or is no longer yours to change. Reload to see where they are now." };
  return { ok: true, plan };
}
