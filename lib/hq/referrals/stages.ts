/*
 * The opportunity pipeline: stage order, which moves are allowed, which extra details each
 * move needs, how long a card has sat in its stage, and how the board groups and totals cards.
 *
 * The database is the arbiter of every rule here (hq.move_opportunity). This module decides
 * what the interface OFFERS, so a person is never shown a move the database would refuse.
 *
 * Pure and dependency-free (no value imports), so `node --test` can run it. The stage list is
 * written out rather than imported from lib/hq/constants.ts (a test asserts the two agree).
 */

export const STAGE_ORDER = [
  "introduction_received",
  "contacted",
  "qualified",
  "appraisal_requested",
  "appraisal_completed",
  "proposal_sent",
  "management_signed",
  "lost",
] as const;
export type Stage = (typeof STAGE_ORDER)[number];

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGE_ORDER as readonly string[]).includes(value);
}

/** The two columns a board shows collapsed until asked. */
export const COLLAPSED_STAGES: readonly Stage[] = ["management_signed", "lost"];

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

/** Still needs work: neither signed nor lost. */
export function isOpenStage(stage: Stage): boolean {
  return stage !== "management_signed" && stage !== "lost";
}

/** The roles the database lets move an opportunity OUT of management_signed. */
export function canLeaveSigned(role: string | null | undefined): boolean {
  return role === "director" || role === "administrator";
}

export type MoveKind = "same" | "advance" | "back" | "sign" | "lose" | "unsign" | "reopen";

/** What a move means, in the terms a person would use. Order of the checks matters. */
export function classifyMove(from: Stage, to: Stage): MoveKind {
  if (from === to) return "same";
  if (to === "management_signed") return "sign";
  if (to === "lost") return "lose";
  if (from === "management_signed") return "unsign";
  if (from === "lost") return "reopen";
  return stageIndex(to) > stageIndex(from) ? "advance" : "back";
}

/**
 * The stages a person may choose when moving an opportunity, in pipeline order. Every other
 * stage is allowed (a deal can skip ahead or step back), except that nobody but a director or
 * administrator may leave "signed": for them the list is empty.
 */
export function allowedTargets(current: Stage, role: string | null | undefined): Stage[] {
  if (current === "management_signed" && !canLeaveSigned(role)) return [];
  return STAGE_ORDER.filter((s) => s !== current);
}

/** Moving out of "signed", to any other stage including lost, changes the signed count, so it asks for confirmation. */
export function moveNeedsConfirmation(from: Stage, to: Stage): boolean {
  return from === "management_signed" && to !== "management_signed";
}

export type MoveFields = {
  /** The date the management was signed. */
  signedDate: boolean;
  /** The reference in the property management system. */
  reference: boolean;
  /** Why the opportunity was lost. Required. */
  lostReason: boolean;
};

export function moveFieldsFor(target: Stage): MoveFields {
  return {
    signedDate: target === "management_signed",
    reference: target === "management_signed",
    lostReason: target === "lost",
  };
}

// ── time in stage ────────────────────────────────────────────

function calendarDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Whole calendar days since the stage last changed, in `timezone`. 0 means "today". Null for no timestamp. */
export function daysInStage(stageChangedAt: string | null | undefined, timezone: string, now: Date = new Date()): number | null {
  if (!stageChangedAt) return null;
  const then = new Date(stageChangedAt);
  if (Number.isNaN(then.getTime())) return null;
  const a = Date.parse(`${calendarDate(then, timezone)}T00:00:00Z`);
  const b = Date.parse(`${calendarDate(now, timezone)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** "Today", "1 day", "12 days". */
export function daysInStageLabel(days: number | null): string {
  if (days === null) return "";
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

// ── board grouping ───────────────────────────────────────────

export type ColumnTotals = { count: number; estimateCents: number; withEstimate: number };

/** Groups cards by stage. Every stage is present, so an empty column still renders. */
export function groupByStage<T extends { stage: Stage }>(cards: readonly T[]): Record<Stage, T[]> {
  const out = Object.fromEntries(STAGE_ORDER.map((s) => [s, [] as T[]])) as Record<Stage, T[]>;
  for (const card of cards) out[card.stage].push(card);
  return out;
}

/** The number of cards and the sum of their estimates. Cards with no estimate add nothing and are counted apart. */
export function columnTotals(cards: readonly { estimateCents: number | null }[]): ColumnTotals {
  let estimateCents = 0;
  let withEstimate = 0;
  for (const c of cards) {
    if (c.estimateCents !== null && Number.isFinite(c.estimateCents)) {
      estimateCents += c.estimateCents;
      withEstimate += 1;
    }
  }
  return { count: cards.length, estimateCents, withEstimate };
}
