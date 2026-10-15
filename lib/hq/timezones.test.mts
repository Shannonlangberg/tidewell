// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { AU_TIMEZONES, OTHER_TIMEZONE, canonicalTimezone, isAustralianTimezone, isValidTimezone, resolveTimezoneChoice } from "./timezones.ts";

test("every listed Australian zone is a zone Intl knows", () => {
  for (const z of AU_TIMEZONES) {
    assert.equal(isValidTimezone(z.value), true, z.value);
    assert.equal(canonicalTimezone(z.value), z.value);
  }
});

test("canonicalTimezone tidies case and refuses junk", () => {
  assert.equal(canonicalTimezone("australia/adelaide"), "Australia/Adelaide");
  assert.equal(canonicalTimezone("  Pacific/Auckland "), "Pacific/Auckland");
  assert.equal(canonicalTimezone("Australia/Adelaide\n"), "Australia/Adelaide"); // surrounding whitespace is trimmed
  assert.equal(canonicalTimezone("UTC"), "UTC");
  for (const bad of ["", "Nowhere/Land", "Australia", "Australia/", "../etc/passwd", "Australia/Adelaide; drop table", "a".repeat(80), null, undefined, 12, "Australia/Adel\naide"]) {
    assert.equal(canonicalTimezone(bad), null, String(bad));
  }
});

test("isAustralianTimezone is exact", () => {
  assert.equal(isAustralianTimezone("Australia/Perth"), true);
  assert.equal(isAustralianTimezone("australia/perth"), false);
  assert.equal(isAustralianTimezone("Pacific/Auckland"), false);
  assert.equal(isAustralianTimezone(undefined), false);
});

test("resolveTimezoneChoice: a listed zone", () => {
  assert.deepEqual(resolveTimezoneChoice("Australia/Darwin", ""), { ok: true, timezone: "Australia/Darwin" });
  // The free-text box is ignored unless "other" is chosen.
  assert.deepEqual(resolveTimezoneChoice("Australia/Darwin", "Nowhere/Land"), { ok: true, timezone: "Australia/Darwin" });
});

test("resolveTimezoneChoice: nothing chosen, or a value that is not on offer", () => {
  assert.deepEqual(resolveTimezoneChoice("", ""), { ok: false, field: "timezone", message: "Choose a timezone." });
  const r = resolveTimezoneChoice("Europe/London", "");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "timezone");
});

test("resolveTimezoneChoice: other, validated with Intl and canonicalised", () => {
  assert.deepEqual(resolveTimezoneChoice(OTHER_TIMEZONE, "pacific/auckland"), { ok: true, timezone: "Pacific/Auckland" });
  const empty = resolveTimezoneChoice(OTHER_TIMEZONE, "  ");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.field, "timezoneOther");
  const bad = resolveTimezoneChoice(OTHER_TIMEZONE, "Mars/Olympus_Mons");
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.field, "timezoneOther");
});
