// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { WIDGETS, WIDGET_IDS, availableWidgets, isWidgetId, reportPanels, widgetDef, type WidgetId } from "./dashboard-widgets.ts";

// The capability matrix from docs/hq-design.md section 4, for the roles the tests use.
const CAPS = {
  director: ["growth.read", "growth.write", "growth.delete", "tasks.read_all", "tasks.write", "people.read", "people.admin", "audit.read", "import.run", "settings.admin"],
  administrator: ["growth.read", "growth.write", "growth.delete", "tasks.read_all", "tasks.write", "people.read", "people.admin", "audit.read", "import.run"],
  business_development_manager: ["growth.read", "growth.write", "tasks.read_all", "tasks.write", "people.read", "import.run"],
  senior_property_manager: ["growth.read", "tasks.read_all", "tasks.write", "people.read"],
  property_manager: ["growth.read", "tasks.write", "people.read"],
  junior_property_manager: ["tasks.write", "people.read"],
  virtual_assistant: ["growth.read", "growth.write", "tasks.write", "people.read"],
  read_only: ["growth.read", "tasks.read_all", "people.read"],
} as const;
type Role = keyof typeof CAPS;
const ROLES = Object.keys(CAPS) as Role[];

const GROWTH_PANELS: readonly WidgetId[] = ["opportunities-by-stage", "partner-referrals", "partner-activity"];
const CONTRACTOR_PANELS: readonly WidgetId[] = ["contractors-preferred-coverage", "contractors-awaiting-vetting", "contractors-recent-activity"];

test("the registry is consistent: unique ids, every id defined once, each with a title", () => {
  assert.equal(new Set(WIDGET_IDS).size, WIDGET_IDS.length);
  assert.deepEqual(WIDGETS.map((w) => w.id), [...WIDGET_IDS]);
  for (const id of WIDGET_IDS) {
    assert.equal(widgetDef(id).id, id);
    assert.ok(widgetDef(id).title.length > 0, id);
  }
  assert.throws(() => widgetDef("no-such-widget" as WidgetId));
});

test("every panel belongs to exactly one Reports section, in the Reports order", () => {
  const all = [...CAPS.director, "contractors.read"];
  assert.deepEqual(reportPanels("growth", all), GROWTH_PANELS);
  assert.deepEqual(reportPanels("contractors", all), CONTRACTOR_PANELS);
  assert.equal(GROWTH_PANELS.length + CONTRACTOR_PANELS.length, WIDGET_IDS.length);
});

test("growth panels need growth.read: a role without it is shown none", () => {
  for (const id of GROWTH_PANELS) assert.equal(widgetDef(id).requires, "growth.read", id);
  assert.deepEqual(reportPanels("growth", CAPS.junior_property_manager), []);
  const offered = availableWidgets(CAPS.junior_property_manager).map((w) => w.id);
  for (const id of GROWTH_PANELS) assert.equal(offered.includes(id), false, id);
});

test("contractor panels need contractors.read, whatever else the person holds", () => {
  for (const id of CONTRACTOR_PANELS) assert.equal(widgetDef(id).requires, "contractors.read", id);
  // Every Phase 1 capability, no contractors.*: no contractor panel.
  assert.deepEqual(reportPanels("contractors", CAPS.director), []);
  assert.deepEqual(reportPanels("contractors", [...CAPS.junior_property_manager, "contractors.read"]), CONTRACTOR_PANELS);
});

test("every role is shown only panels it may see", () => {
  for (const role of ROLES) {
    const caps = CAPS[role] as readonly string[];
    for (const w of availableWidgets(caps)) assert.ok(!w.requires || caps.includes(w.requires), `${role}: ${w.id}`);
    const expectGrowth = caps.includes("growth.read") ? GROWTH_PANELS : [];
    assert.deepEqual(reportPanels("growth", caps), expectGrowth, role);
  }
});

test("isWidgetId", () => {
  assert.equal(isWidgetId("partner-activity"), true);
  assert.equal(isWidgetId("PARTNER-ACTIVITY"), false);
  assert.equal(isWidgetId("my-tasks"), false); // the old dashboard's panels are gone
  assert.equal(isWidgetId(undefined), false);
});
