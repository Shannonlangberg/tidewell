// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FormReader } from "../forms.ts";
import {
  AILO_STATUSES,
  FEE_BASES,
  HANDOVER_STEPS,
  HANDOVER_STEP_STATUSES,
  MANAGED_STATUSES,
  SERVICE_TYPES,
  feeText,
  financialYearLabel,
  managedOfGoalText,
  managedRef,
  paceText,
  parseBusinessSummary,
  parseManagedRef,
  parsePercent,
  parsePortfolioListQuery,
  propertyProblems,
  readPropertyFields,
  serviceSplitText,
} from "./rules.ts";

const sql = readFileSync(new URL("../../../supabase/migrations/0129_hq_managed_properties.sql", import.meta.url), "utf8");
const enumValues = (name: string): string[] => {
  const m = new RegExp(`create type hq\\.${name} as enum \\(([^;]*?)\\);`, "s").exec(sql);
  assert.ok(m, `enum ${name} not found`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

test("the vocabularies match the enums in migration 0129", () => {
  assert.deepEqual([...SERVICE_TYPES], enumValues("service_type"));
  assert.deepEqual([...FEE_BASES], enumValues("fee_basis"));
  assert.deepEqual([...MANAGED_STATUSES], enumValues("managed_status"));
  assert.deepEqual([...AILO_STATUSES], enumValues("ailo_status"));
  assert.deepEqual([...HANDOVER_STEPS], enumValues("handover_step"));
  assert.deepEqual([...HANDOVER_STEP_STATUSES], enumValues("handover_step_status"));
  assert.equal(HANDOVER_STEPS.length, 9);
});

test("MP refs pad, never truncate, and parse back", () => {
  assert.equal(managedRef(7), "MP-0007");
  assert.equal(managedRef(123456), "MP-123456");
  assert.equal(parseManagedRef("MP-0007"), 7);
  assert.equal(parseManagedRef(" mp 12 "), 12);
  assert.equal(parseManagedRef("DEC-0007"), null);
  assert.equal(parseManagedRef("MP-0"), null);
});

test("percentages: 0 to 100, two decimals at most", () => {
  assert.deepEqual(parsePercent("8.8"), { value: 8.8, error: null });
  assert.deepEqual(parsePercent("8.8 %"), { value: 8.8, error: null });
  assert.deepEqual(parsePercent(""), { value: null, error: null });
  assert.ok(parsePercent("101").error);
  assert.ok(parsePercent("8.888").error);
  assert.ok(parsePercent("abc").error);
});

test("the fee reads as words", () => {
  assert.equal(feeText("percent_of_rent", "8.80", null), "8.8% of rent");
  assert.equal(feeText("flat_fee", null, "$99 a month"), "Flat fee: $99 a month");
  assert.equal(feeText(null, null, null), "Not recorded");
});

const today = "2026-10-20";
const base = { status: "onboarding", managedFrom: null, endedOn: null, ailoStatus: "not_started", ailoReference: null, feeBasis: null, feePercent: null, agreementSignedOn: null } as const;

test("the status and Ailo rules match the database", () => {
  assert.deepEqual(propertyProblems({ ...base }, today), {});
  assert.ok(propertyProblems({ ...base, status: "active" }, today).managed_from);
  assert.ok(propertyProblems({ ...base, status: "active", managedFrom: "2026-10-21" }, today).managed_from);
  assert.deepEqual(propertyProblems({ ...base, status: "active", managedFrom: today }, today), {});
  assert.ok(propertyProblems({ ...base, status: "ended" }, today).ended_on);
  assert.ok(propertyProblems({ ...base, endedOn: today }, today).ended_on);
  assert.ok(propertyProblems({ ...base, status: "ended", endedOn: "2026-10-21" }, today).ended_on);
  assert.ok(propertyProblems({ ...base, ailoStatus: "live" }, today).ailo_reference);
  assert.deepEqual(propertyProblems({ ...base, ailoStatus: "live", ailoReference: "A-1" }, today), {});
  assert.ok(propertyProblems({ ...base, feeBasis: "percent_of_rent" }, today).fee_percent);
  assert.ok(propertyProblems({ ...base, agreementSignedOn: "2026-11-01" }, today).agreement_signed_on);
});

const form = (v: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return new FormReader(fd);
};

test("the convert form lets the opportunity supply the address and owner", () => {
  const r = form({ service_type: "long_term_residential", fee_percent: "8.8" });
  const v = readPropertyFields(r, today, "convert");
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(v.propertyAddress, null);
  assert.equal(v.status, "onboarding");
  assert.equal(v.feeBasis, "percent_of_rent");
  assert.equal(v.feePercent, 8.8);
  assert.equal(v.ailoStatus, "not_started");
});

test("the manual form needs the address, an owner and the origin note", () => {
  const r = form({ service_type: "long_term_residential" });
  readPropertyFields(r, today, "manual");
  assert.ok(r.errors.property_address && r.errors.owner_name && r.errors.manual_origin_note, JSON.stringify(r.errors));
  const ok = form({ service_type: "short_term_accommodation", property_address: "1 Test St", owner_name: "A", manual_origin_note: "Signed on paper", status: "active", managed_from: "2026-01-01" });
  const v = readPropertyFields(ok, today, "manual");
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(v.status, "active");
});

test("the edit form applies the rules and drops a percentage for another fee basis", () => {
  const r = form({ service_type: "long_term_residential", property_address: "1 Test St", owner_name: "A", status: "ended" });
  readPropertyFields(r, today, "edit");
  assert.ok(r.errors.ended_on);
  const f = form({ service_type: "long_term_residential", property_address: "1 Test St", owner_name: "A", status: "onboarding", fee_basis: "flat_fee", fee_percent: "8" });
  const v = readPropertyFields(f, today, "edit");
  assert.ok(f.ok, JSON.stringify(f.errors));
  assert.equal(v.feePercent, null);
  const bad = form({ service_type: "nope", property_address: "x", owner_name: "A", status: "onboarding" });
  readPropertyFields(bad, today, "edit");
  assert.ok(bad.errors.service_type);
});

test("the list query drops anything malformed", () => {
  const q = parsePortfolioListQuery({ q: "  Moonta ", status: "active", service: "bogus", ailo: "live", handover: "open", page: "-3" });
  assert.equal(q.q, "Moonta");
  assert.equal(q.status, "active");
  assert.equal(q.service, null);
  assert.equal(q.ailo, "live");
  assert.equal(q.handoverOpen, true);
  assert.equal(q.page, 1);
  assert.equal(q.filtered, true);
});

test("business_summary is parsed, and a missing section stays missing (never zero-filled)", () => {
  const s = parseBusinessSummary({
    as_of: "2026-10-20",
    goal: { target_managed: 20, goal_date: null },
    managed: { managed: 3, active: 2, onboarding: 1, offboarding: 0, ended: 1, long_term_residential: { managed: 2 }, short_term_accommodation: { managed: 1 }, handover_open: 2, recorded: 4 },
    signed: null,
    pipeline: null,
    leads_needing_attention: null,
    pace: null,
    notes: ["Signings are not shown"],
  });
  assert.ok(s);
  assert.equal(s.managed?.managed, 3);
  assert.equal(s.managed?.shortTerm.managed, 1);
  assert.equal(s.signed, null);
  assert.equal(s.pace, null);
  assert.equal(s.goal.date, null);
  assert.equal(parseBusinessSummary(null), null);
  assert.equal(parseBusinessSummary({}), null);
});

test("glance phrases", () => {
  assert.equal(managedOfGoalText(3, 20), "Managed 3 of 20");
  assert.equal(serviceSplitText(2, 1), "2 long-term, 1 short-term accommodation");
  assert.equal(serviceSplitText(0, 0), "none yet");
  assert.equal(paceText(null), null);
  assert.equal(paceText({ remaining: 17, monthsLeft: 12, neededPerMonth: 1.42, actualPerMonth: 0.33, goalDatePassed: false, targetReached: false }), "Needs 1.4 a month for 12 months; signing 0.3 a month lately.");
  assert.equal(paceText({ remaining: 0, monthsLeft: 3, neededPerMonth: 0, actualPerMonth: 1, goalDatePassed: false, targetReached: true }), "Goal reached.");
  assert.equal(financialYearLabel("2026-07-01"), "2026-27");
});
