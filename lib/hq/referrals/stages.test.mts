// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { OPPORTUNITY_STAGES, OPEN_STAGES } from "../constants.ts";
import {
  COLLAPSED_STAGES,
  STAGE_ORDER,
  allowedTargets,
  canLeaveSigned,
  classifyMove,
  columnTotals,
  daysInStage,
  daysInStageLabel,
  groupByStage,
  isOpenStage,
  isStage,
  moveFieldsFor,
  moveNeedsConfirmation,
  stageIndex,
} from "./stages.ts";

test("the stage order matches the shared constants exactly (the pipeline order is the database enum order)", () => {
  assert.deepEqual([...STAGE_ORDER], [...OPPORTUNITY_STAGES]);
  assert.deepEqual(
    STAGE_ORDER.filter(isOpenStage),
    [...OPEN_STAGES],
  );
});

test("isStage only accepts the eight stages", () => {
  for (const s of STAGE_ORDER) assert.equal(isStage(s), true);
  assert.equal(isStage("won"), false);
  assert.equal(isStage(""), false);
  assert.equal(isStage(undefined), false);
  assert.equal(isStage(3), false);
});

test("stage index follows the pipeline order, and signed and lost are the last two", () => {
  assert.equal(stageIndex("introduction_received"), 0);
  assert.equal(stageIndex("proposal_sent"), 5);
  assert.equal(stageIndex("management_signed"), 6);
  assert.equal(stageIndex("lost"), 7);
  assert.deepEqual([...COLLAPSED_STAGES], ["management_signed", "lost"]);
});

test("classifyMove names what a move means", () => {
  assert.equal(classifyMove("contacted", "contacted"), "same");
  assert.equal(classifyMove("contacted", "qualified"), "advance");
  assert.equal(classifyMove("introduction_received", "proposal_sent"), "advance"); // skipping ahead is allowed
  assert.equal(classifyMove("qualified", "contacted"), "back");
  assert.equal(classifyMove("proposal_sent", "management_signed"), "sign");
  assert.equal(classifyMove("introduction_received", "management_signed"), "sign");
  assert.equal(classifyMove("lost", "management_signed"), "sign");
  assert.equal(classifyMove("qualified", "lost"), "lose");
  assert.equal(classifyMove("management_signed", "lost"), "lose");
  assert.equal(classifyMove("management_signed", "qualified"), "unsign");
  assert.equal(classifyMove("lost", "contacted"), "reopen");
  assert.equal(classifyMove("management_signed", "management_signed"), "same");
});

test("only a director or administrator may leave signed", () => {
  assert.equal(canLeaveSigned("director"), true);
  assert.equal(canLeaveSigned("administrator"), true);
  for (const role of ["business_development_manager", "virtual_assistant", "senior_property_manager", "read_only", "", null, undefined]) {
    assert.equal(canLeaveSigned(role), false, String(role));
  }
});

test("allowedTargets offers every other stage in order, and nothing out of signed for most roles", () => {
  const fromContacted = allowedTargets("contacted", "virtual_assistant");
  assert.equal(fromContacted.length, 7);
  assert.equal(fromContacted.includes("contacted"), false);
  assert.deepEqual(fromContacted, STAGE_ORDER.filter((s) => s !== "contacted"));

  assert.deepEqual(allowedTargets("management_signed", "virtual_assistant"), []);
  assert.deepEqual(allowedTargets("management_signed", "business_development_manager"), []);
  assert.deepEqual(allowedTargets("management_signed", null), []);

  const out = allowedTargets("management_signed", "director");
  assert.equal(out.length, 7);
  assert.equal(out.includes("management_signed"), false); // re-signing is never offered
  assert.deepEqual(allowedTargets("management_signed", "administrator"), out);

  // A lost deal can be reopened by anyone who can write
  assert.equal(allowedTargets("lost", "virtual_assistant").includes("contacted"), true);
});

test("only leaving signed needs a confirmation", () => {
  assert.equal(moveNeedsConfirmation("management_signed", "qualified"), true);
  assert.equal(moveNeedsConfirmation("management_signed", "contacted"), true);
  assert.equal(moveNeedsConfirmation("contacted", "management_signed"), false);
  assert.equal(moveNeedsConfirmation("contacted", "lost"), false);
  assert.equal(moveNeedsConfirmation("lost", "contacted"), false);
  assert.equal(moveNeedsConfirmation("management_signed", "lost"), true); // a loss also reduces the signed count (and asks for a reason)
  assert.equal(moveNeedsConfirmation("management_signed", "management_signed"), false); // not a move at all
});

test("each target asks only for the details it needs", () => {
  assert.deepEqual(moveFieldsFor("management_signed"), { signedDate: true, reference: true, lostReason: false });
  assert.deepEqual(moveFieldsFor("lost"), { signedDate: false, reference: false, lostReason: true });
  for (const s of ["introduction_received", "contacted", "qualified", "appraisal_requested", "appraisal_completed", "proposal_sent"] as const) {
    assert.deepEqual(moveFieldsFor(s), { signedDate: false, reference: false, lostReason: false });
  }
});

test("days in stage counts calendar days in the person's timezone", () => {
  const now = new Date("2026-10-15T03:00:00Z"); // 15 Oct, 1:30 pm in Adelaide (UTC+10:30 in daylight time)
  assert.equal(daysInStage("2026-10-15T00:30:00Z", "Australia/Adelaide", now), 0);
  assert.equal(daysInStage("2026-10-14T03:00:00Z", "Australia/Adelaide", now), 1);
  assert.equal(daysInStage("2026-10-01T03:00:00Z", "Australia/Adelaide", now), 14);
  // Just before local midnight yesterday is still "yesterday", not "today"
  assert.equal(daysInStage("2026-10-14T13:29:00Z", "Australia/Adelaide", now), 1); // 14 Oct, 11:59 pm Adelaide
  assert.equal(daysInStage("2026-10-14T13:31:00Z", "Australia/Adelaide", now), 0); // 15 Oct, 12:01 am Adelaide
  // The same instants in UTC fall on different calendar days
  assert.equal(daysInStage("2026-10-14T13:31:00Z", "UTC", now), 1);
});

test("days in stage never goes negative, and bad input is null", () => {
  const now = new Date("2026-10-15T03:00:00Z");
  assert.equal(daysInStage("2026-10-20T00:00:00Z", "Australia/Adelaide", now), 0); // clock skew
  assert.equal(daysInStage(null, "Australia/Adelaide", now), null);
  assert.equal(daysInStage(undefined, "Australia/Adelaide", now), null);
  assert.equal(daysInStage("not a date", "Australia/Adelaide", now), null);
});

test("days in stage reads naturally", () => {
  assert.equal(daysInStageLabel(0), "Today");
  assert.equal(daysInStageLabel(1), "1 day");
  assert.equal(daysInStageLabel(12), "12 days");
  assert.equal(daysInStageLabel(null), "");
});

test("groupByStage gives every stage a column, even an empty one", () => {
  const cards = [
    { id: "a", stage: "contacted" as const },
    { id: "b", stage: "contacted" as const },
    { id: "c", stage: "lost" as const },
  ];
  const g = groupByStage(cards);
  assert.deepEqual(Object.keys(g), [...STAGE_ORDER]);
  assert.deepEqual(g.contacted.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(g.lost.map((c) => c.id), ["c"]);
  assert.deepEqual(g.qualified, []);
  assert.deepEqual(Object.values(groupByStage([])).map((l) => l.length), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test("column totals add only real estimates and say how many cards had one", () => {
  assert.deepEqual(columnTotals([]), { count: 0, estimateCents: 0, withEstimate: 0 });
  assert.deepEqual(columnTotals([{ estimateCents: 1_200_000 }, { estimateCents: null }, { estimateCents: 300_050 }]), {
    count: 3,
    estimateCents: 1_500_050,
    withEstimate: 2,
  });
  // A zero estimate is an estimate; a missing one is not
  assert.deepEqual(columnTotals([{ estimateCents: 0 }, { estimateCents: null }]), { count: 2, estimateCents: 0, withEstimate: 1 });
});
