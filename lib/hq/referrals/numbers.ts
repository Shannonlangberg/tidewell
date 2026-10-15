/*
 * Figures for the referral screens: conversion rates, the dollars a person types turned into the
 * cents the database stores, and the growth_summary payload read safely.
 *
 * Nothing here invents a number. A rate with nothing received is null (shown as an em dash),
 * never 0%.
 *
 * Pure and dependency-free (no value imports), so `node --test` can run it.
 */

/** signed / received, to four decimal places (the precision the database uses). Null when nothing was received. */
export function conversionRate(signed: number, received: number): number | null {
  if (!Number.isFinite(signed) || !Number.isFinite(received) || received <= 0) return null;
  return Math.round((signed / received) * 10_000) / 10_000;
}

/**
 * "33.3%", "50%", "0%", "100%". An em dash for null or a non-number. Whole percentages are
 * shown whole; anything else gets one decimal place, so 1 of 3 reads "33.3%" and 1 of 8 "12.5%".
 */
export function formatConversion(rate: number | null | undefined): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  const percent = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/** Dollars typed by a person ("12,500", "$12500.50") to whole cents. Null for blank. "invalid" for anything else. */
export function parseDollars(input: string | null | undefined): number | null | "invalid" {
  const v = (input ?? "").replace(/[$,\s]/g, "");
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return "invalid";
  const cents = Math.round(Number(v) * 100);
  return Number.isSafeInteger(cents) ? cents : "invalid";
}

/** Cents back to what the input should show: 1200000 -> "12000", 1250050 -> "12500.50". Empty for null. */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

// ── hq.growth_summary ────────────────────────────────────────

export type GrowthSummary = {
  since: string;
  asOf: string;
  referralsReceived: number;
  referralsSent: number;
  qualified: number;
  managementsSigned: number;
  /** signed / received, or null when nothing was received. */
  conversion: number | null;
  estimatedValueSignedCents: number;
  activeOpportunities: number;
  overdueFollowups: number;
  contactsNotContacted30d: number;
};

function count(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Reads the jsonb from hq.growth_summary. Returns null if the shape is not what the contract
 * promises, so the page shows an error rather than a wrong number. Conversion is recomputed when
 * it is missing but the counts are there.
 */
export function parseGrowthSummary(json: unknown): GrowthSummary | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const j = json as Record<string, unknown>;
  const received = count(j.referrals_received);
  const sent = count(j.referrals_sent);
  const qualified = count(j.qualified);
  const signed = count(j.managements_signed);
  const value = count(j.estimated_value_signed_cents);
  if (received === null || sent === null || qualified === null || signed === null || value === null) return null;
  const rate = j.conversion === null || j.conversion === undefined ? null : count(j.conversion);
  return {
    since: typeof j.since === "string" ? j.since : "",
    asOf: typeof j.as_of === "string" ? j.as_of : "",
    referralsReceived: received,
    referralsSent: sent,
    qualified,
    managementsSigned: signed,
    conversion: received === 0 ? null : (rate ?? conversionRate(signed, received)),
    estimatedValueSignedCents: value,
    activeOpportunities: count(j.active_opportunities) ?? 0,
    overdueFollowups: count(j.overdue_followups) ?? 0,
    contactsNotContacted30d: count(j.contacts_not_contacted_30d) ?? 0,
  };
}
