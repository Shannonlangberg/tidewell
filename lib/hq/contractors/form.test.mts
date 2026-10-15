import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACTOR_CATEGORIES } from "../constants.ts";
import { FormReader } from "../forms.ts";
import { abnProblem, stripAbn } from "./abn.ts";
import { parseDollars } from "./money.ts";
import { parsePlaceList, readContractorFields } from "./form.ts";

function read(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  const f = new FormReader(fd);
  return { f, v: readContractorFields(f, { categories: CONTRACTOR_CATEGORIES, abnProblem, stripAbn, parseDollars }) };
}

test("a minimal form: name and one trade. Everything else stays unknown", () => {
  const { f, v } = read({ business_name: "Moonta Plumbing", categories: "plumbing" });
  assert.equal(f.ok, true);
  assert.equal(v.businessName, "Moonta Plumbing");
  assert.deepEqual(v.categories, ["plumbing"]);
  assert.equal(v.emergencyAvailable, null);
  assert.deepEqual([v.hourlyRateCents, v.calloutFeeCents, v.afterHoursFeeCents, v.minimumChargeCents], [null, null, null, null]);
  assert.equal(v.abn, null);
  assert.deepEqual(v.serviceSuburbs, []);
});

test("name and trade are required", () => {
  const { f } = read({});
  assert.equal(f.ok, false);
  assert.ok(f.errors.business_name);
  assert.match(f.errors.categories, /at least one trade/);
});

test("an unknown trade is refused", () => {
  const { f } = read({ business_name: "X", categories: ["plumbing", "sorcery"] });
  assert.ok(f.errors.categories);
});

test("emergency is tri-state", () => {
  assert.equal(read({ business_name: "X", categories: "other", emergency_available: "yes" }).v.emergencyAvailable, true);
  assert.equal(read({ business_name: "X", categories: "other", emergency_available: "no" }).v.emergencyAvailable, false);
  assert.equal(read({ business_name: "X", categories: "other", emergency_available: "unknown" }).v.emergencyAvailable, null);
  assert.equal(read({ business_name: "X", categories: "other", emergency_available: "bogus" }).f.ok, false);
});

test("money: dollars in, cents out, blank is null, zero is zero", () => {
  const { f, v } = read({ business_name: "X", categories: "other", hourly_rate: "95.50", callout_fee: "0", after_hours_fee: "", minimum_charge: "$1,200" });
  assert.equal(f.ok, true);
  assert.deepEqual([v.hourlyRateCents, v.calloutFeeCents, v.afterHoursFeeCents, v.minimumChargeCents], [9550, 0, null, 120000]);
  const bad = read({ business_name: "X", categories: "other", hourly_rate: "-3", callout_fee: "lots" });
  assert.ok(bad.f.errors.hourly_rate && bad.f.errors.callout_fee);
});

test("ABN: checksum in plain language, stored without spaces", () => {
  const ok = read({ business_name: "X", categories: "other", abn: "51 824 753 556" });
  assert.equal(ok.v.abn, "51824753556");
  assert.equal(ok.f.ok, true);
  const bad = read({ business_name: "X", categories: "other", abn: "51 824 753 557" });
  assert.match(bad.f.errors.abn, /ABN check/);
  assert.equal(bad.v.abn, null);
});

test("service places: split, trimmed, de-duplicated by case, first spelling kept", () => {
  assert.deepEqual(parsePlaceList("Moonta, moonta\nMoonta Bay;  Wallaroo ,", "suburb"), { items: ["Moonta", "Moonta Bay", "Wallaroo"], error: null });
  assert.deepEqual(parsePlaceList(null, "suburb"), { items: [], error: null });
  assert.ok(parsePlaceList("Moonta {x}", "suburb").error);
  assert.ok(parsePlaceList("a".repeat(81), "suburb").error);
});

test("dates, owner and lengths are validated", () => {
  const bad = read({ business_name: "X", categories: "other", licence_expires_on: "2026-02-31", relationship_owner_id: "nope", business_name_extra: "" });
  assert.ok(bad.f.errors.licence_expires_on && bad.f.errors.relationship_owner_id);
  assert.ok(read({ business_name: "x".repeat(201), categories: "other" }).f.errors.business_name);
  assert.equal(read({ business_name: "X", categories: "other", insurance_expires_on: "2027-03-01" }).v.insuranceExpiresOn, "2027-03-01");
});
