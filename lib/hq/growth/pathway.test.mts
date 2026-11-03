import test from "node:test";
import assert from "node:assert/strict";
import { RELATIONSHIP_STATUSES } from "../constants.ts";
import { PARTNER_STAGE_VALUES } from "./params.ts";
import { PATHWAY_STEPS, STEP_STATUSES, nextStep, partnerPlace, placeOf, planPartnerMove, previousStep, type PathwayPerson } from "./pathway.ts";

const person = (id: string, status: PathwayPerson["status"], primary = false): PathwayPerson => ({ id, name: `Person ${id}`, status, primary });

test("every relationship status sits in exactly one place", () => {
  const all = Object.values(STEP_STATUSES).flat();
  assert.deepEqual([...all].sort(), [...RELATIONSHIP_STATUSES].sort());
  assert.equal(new Set(all).size, all.length);
});

test("the list filter accepts exactly the pathway places", () => {
  assert.deepEqual([...PARTNER_STAGE_VALUES].sort(), [...PATHWAY_STEPS, "inactive"].sort());
});

test("statuses read as steps; no status is not yet connected", () => {
  assert.equal(placeOf(null), "not_connected");
  assert.equal(placeOf("identified"), "not_connected");
  assert.equal(placeOf("meeting_booked"), "connect");
  assert.equal(placeOf("active_relationship"), "cultivate");
  assert.equal(placeOf("referring_partner"), "champion");
  assert.equal(placeOf("inactive"), "inactive");
});

test("a business is at its furthest live person's step; all inactive is not active", () => {
  assert.equal(partnerPlace([]), "not_connected");
  assert.equal(partnerPlace([person("a", "identified"), person("b", "met"), person("c", "inactive")]), "cultivate");
  assert.equal(partnerPlace([person("a", "inactive")]), "inactive");
});

test("next and previous stop at the ends", () => {
  assert.equal(nextStep("not_connected"), "connect");
  assert.equal(nextStep("champion"), null);
  assert.equal(previousStep("not_connected"), null);
  assert.equal(previousStep("cultivate"), "connect");
  assert.equal(nextStep("inactive"), null);
});

test("moving forward changes only the primary contact, to the step's first status", () => {
  const plan = planPartnerMove([person("a", "contacted", true), person("b", "meeting_booked"), person("c", "inactive")], "cultivate");
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.equal(plan.from, "connect");
    assert.deepEqual(plan.changes, [{ id: "a", name: "Person a", from: "contacted", to: "met" }]);
  }
});

test("with no primary contact, forward moves the person furthest along", () => {
  const plan = planPartnerMove([person("a", "identified"), person("b", "contacted")], "cultivate");
  assert.ok(plan.ok && plan.changes.length === 1 && plan.changes[0]!.id === "b");
});

test("moving back changes everyone further along, and nobody else", () => {
  const plan = planPartnerMove([person("a", "referring_partner"), person("b", "met"), person("c", "contacted"), person("d", "inactive")], "connect");
  assert.ok(plan.ok);
  if (plan.ok) {
    assert.deepEqual(
      plan.changes.map((c) => `${c.id}:${c.to}`),
      ["a:contacted", "b:contacted"],
    );
    assert.equal(partnerPlace([person("a", "contacted"), person("b", "contacted"), person("c", "contacted")]), plan.to);
  }
});

test("a partner with nobody live cannot be moved, and says why", () => {
  const none = planPartnerMove([], "connect");
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.reason, /Nobody is recorded/);
  const inactive = planPartnerMove([person("a", "inactive")], "connect");
  assert.equal(inactive.ok, false);
  if (!inactive.ok) assert.match(inactive.reason, /inactive/);
  const same = planPartnerMove([person("a", "met")], "cultivate");
  assert.equal(same.ok, false);
});
