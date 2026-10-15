// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { FormReader } from "../forms.ts";
import { centsToDollarsInput, conversionRate, formatConversion, parseDollars, parseGrowthSummary } from "./numbers.ts";

test("conversion is signed over received, to four places, and null when nothing was received", () => {
  assert.equal(conversionRate(1, 3), 0.3333);
  assert.equal(conversionRate(2, 3), 0.6667);
  assert.equal(conversionRate(0, 5), 0);
  assert.equal(conversionRate(5, 5), 1);
  assert.equal(conversionRate(3, 0), null);
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(1, -1), null);
  assert.equal(conversionRate(Number.NaN, 4), null);
});

test("conversion is shown as a percentage, and as an em dash when it does not exist", () => {
  assert.equal(formatConversion(null), "—");
  assert.equal(formatConversion(undefined), "—");
  assert.equal(formatConversion(Number.NaN), "—");
  assert.equal(formatConversion(0), "0%"); // received some, signed none: a real zero, not a dash
  assert.equal(formatConversion(0.5), "50%");
  assert.equal(formatConversion(1), "100%");
  assert.equal(formatConversion(0.3333), "33.3%");
  assert.equal(formatConversion(0.6667), "66.7%");
  assert.equal(formatConversion(0.125), "12.5%");
  assert.equal(formatConversion(0.0004), "0%");
  assert.equal(formatConversion(0.9999), "100%");
});

test("dollars a person types become whole cents", () => {
  assert.equal(parseDollars("12500"), 1_250_000);
  assert.equal(parseDollars("12,500"), 1_250_000);
  assert.equal(parseDollars("$12,500.50"), 1_250_050);
  assert.equal(parseDollars("  $ 99 "), 9_900);
  assert.equal(parseDollars("0"), 0);
  assert.equal(parseDollars("0.1"), 10);
  assert.equal(parseDollars("1234.99"), 123_499);
  // The classic floating-point trap: 1.15 * 100 is 114.99999999999999
  assert.equal(parseDollars("1.15"), 115);
  assert.equal(parseDollars("19.99"), 1_999);
  assert.equal(parseDollars(""), null);
  assert.equal(parseDollars("   "), null);
  assert.equal(parseDollars(null), null);
  assert.equal(parseDollars("$"), null); // just a dollar sign is a blank
});

test("anything that is not a plain amount is invalid", () => {
  for (const bad of ["abc", "12.345", "-5", "1e3", "12 500x", "12..5", "NaN", "Infinity", "9".repeat(30)]) {
    assert.equal(parseDollars(bad), "invalid", bad);
  }
});

test("the form reader and parseDollars agree, so the server and the tests read money the same way", () => {
  for (const text of ["12500", "$12,500.50", "1.15", "0", "19.99"]) {
    const form = new FormData();
    form.set("value", text);
    assert.equal(new FormReader(form).dollarsToCents("value"), parseDollars(text), text);
  }
});

test("cents go back into the input as the dollars the person would type", () => {
  assert.equal(centsToDollarsInput(1_200_000), "12000");
  assert.equal(centsToDollarsInput(1_250_050), "12500.50");
  assert.equal(centsToDollarsInput(1_250_005), "12500.05");
  assert.equal(centsToDollarsInput(0), "0");
  assert.equal(centsToDollarsInput(null), "");
  assert.equal(centsToDollarsInput(undefined), "");
  for (const cents of [0, 5, 99, 100, 101, 1_250_050, 1_999]) {
    assert.equal(parseDollars(centsToDollarsInput(cents)), cents, String(cents));
  }
});

const SUMMARY = {
  since: "2026-09-15",
  as_of: "2026-10-15",
  managements_signed: 1,
  referrals_received: 4,
  referrals_sent: 2,
  active_opportunities: 3,
  qualified: 2,
  conversion: 0.25,
  overdue_followups: 5,
  contacts_by_status: {},
  contacts_not_contacted_30d: 27,
  estimated_value_signed_cents: 1_200_000,
};

test("growth_summary is read into plain numbers", () => {
  const s = parseGrowthSummary(SUMMARY);
  assert.ok(s);
  assert.equal(s.referralsReceived, 4);
  assert.equal(s.referralsSent, 2);
  assert.equal(s.qualified, 2);
  assert.equal(s.managementsSigned, 1);
  assert.equal(s.conversion, 0.25);
  assert.equal(s.estimatedValueSignedCents, 1_200_000);
  assert.equal(s.contactsNotContacted30d, 27);
  assert.equal(s.since, "2026-09-15");
});

test("with nothing received the conversion is null, whatever the payload says", () => {
  const s = parseGrowthSummary({ ...SUMMARY, referrals_received: 0, managements_signed: 0, conversion: null });
  assert.ok(s);
  assert.equal(s.conversion, null);
  assert.equal(parseGrowthSummary({ ...SUMMARY, referrals_received: 0, conversion: 0 })?.conversion, null);
});

test("a missing conversion is recomputed from the counts, and numbers sent as text are accepted", () => {
  const rest: Record<string, unknown> = { ...SUMMARY };
  delete rest.conversion;
  assert.equal(parseGrowthSummary(rest)?.conversion, 0.25);
  assert.equal(parseGrowthSummary({ ...SUMMARY, managements_signed: "1", referrals_received: "4" })?.managementsSigned, 1);
});

test("a payload that breaks the contract is refused rather than shown as zeros", () => {
  assert.equal(parseGrowthSummary(null), null);
  assert.equal(parseGrowthSummary([]), null);
  assert.equal(parseGrowthSummary("x"), null);
  assert.equal(parseGrowthSummary({}), null);
  assert.equal(parseGrowthSummary({ ...SUMMARY, managements_signed: null }), null);
  assert.equal(parseGrowthSummary({ ...SUMMARY, referrals_received: -1 }), null);
  assert.equal(parseGrowthSummary({ ...SUMMARY, qualified: "many" }), null);
});
