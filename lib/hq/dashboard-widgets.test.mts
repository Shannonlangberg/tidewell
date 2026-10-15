// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  WIDGETS,
  WIDGET_IDS,
  availableWidgets,
  defaultWidgetsFor,
  hasCustomLayout,
  isWidgetId,
  resolveWidgets,
  sanitiseSelection,
  widgetDef,
} from "./dashboard-widgets.ts";

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

const GROWTH_WIDGETS = WIDGETS.filter((w) => w.requires === "growth.read").map((w) => w.id);

test("the registry is consistent: unique ids, every id defined once, stats before panels", () => {
  assert.equal(new Set(WIDGET_IDS).size, WIDGET_IDS.length);
  assert.deepEqual(WIDGETS.map((w) => w.id), [...WIDGET_IDS]);
  const firstPanel = WIDGETS.findIndex((w) => w.kind === "panel");
  assert.ok(WIDGETS.slice(firstPanel).every((w) => w.kind === "panel"));
  for (const id of WIDGET_IDS) assert.equal(widgetDef(id).id, id);
});

test("a role without growth.read never gets a growth widget, by default or by choice", () => {
  const junior = CAPS.junior_property_manager;
  const offered = availableWidgets(junior).map((w) => w.id);
  for (const g of GROWTH_WIDGETS) assert.equal(offered.includes(g), false, g);
  const defaults = defaultWidgetsFor("junior_property_manager", junior);
  assert.deepEqual(defaults, ["managed-properties", "my-tasks"]);
  // Even if a saved layout asks for them (an old choice, or a forged request), they are dropped.
  const chosen = resolveWidgets({ role: "junior_property_manager", capabilities: junior, saved: ["who-to-call", "my-tasks", "referrals-summary"] });
  assert.deepEqual(chosen, ["my-tasks"]);
});

test("team tasks need tasks.read_all", () => {
  assert.equal(availableWidgets(CAPS.property_manager).some((w) => w.id === "team-tasks"), false);
  assert.equal(availableWidgets(CAPS.senior_property_manager).some((w) => w.id === "team-tasks"), true);
});

test("every role gets a non-empty default made only of widgets it may see", () => {
  for (const role of ROLES) {
    const defaults = defaultWidgetsFor(role, CAPS[role]);
    assert.ok(defaults.length > 0, role);
    const allowed = new Set(availableWidgets(CAPS[role]).map((w) => w.id));
    for (const id of defaults) assert.ok(allowed.has(id), `${role}: ${id}`);
  }
});

test("a director and the business development manager default to the growth-heavy set", () => {
  const director = defaultWidgetsFor("director", CAPS.director);
  const bdm = defaultWidgetsFor("business_development_manager", CAPS.business_development_manager);
  for (const id of ["referrals-summary", "contacts-identified", "who-to-call", "opportunities-by-stage"] as const) {
    assert.ok(director.includes(id), `director ${id}`);
    assert.ok(bdm.includes(id), `bdm ${id}`);
  }
  assert.ok(bdm.includes("partner-referrals"));
  // Growth-heavy: more growth widgets than task widgets.
  const growth = (ids: readonly string[]) => ids.filter((i) => (GROWTH_WIDGETS as readonly string[]).includes(i)).length;
  assert.ok(growth(director) > director.filter((i) => i === "my-tasks" || i === "team-tasks").length);
});

test("operations roles default to tasks first", () => {
  const admin = defaultWidgetsFor("administrator", CAPS.administrator);
  assert.ok(admin.includes("my-tasks") && admin.includes("team-tasks"));
  const senior = defaultWidgetsFor("senior_property_manager", CAPS.senior_property_manager);
  assert.ok(senior.includes("my-tasks") && senior.includes("team-tasks"));
  const pm = defaultWidgetsFor("property_manager", CAPS.property_manager);
  assert.ok(pm.includes("my-tasks"));
});

test("a read-only person sees figures but has no widget that writes", () => {
  const defaults = defaultWidgetsFor("read_only", CAPS.read_only);
  assert.ok(defaults.includes("referrals-summary"));
  assert.equal(defaults.includes("my-tasks"), false);
});

test("null or undefined saved means the role default", () => {
  const expected = defaultWidgetsFor("director", CAPS.director);
  assert.deepEqual(resolveWidgets({ role: "director", capabilities: CAPS.director, saved: null }), expected);
  assert.deepEqual(resolveWidgets({ role: "director", capabilities: CAPS.director, saved: undefined }), expected);
  assert.equal(hasCustomLayout(null), false);
  assert.equal(hasCustomLayout(undefined), false);
  assert.equal(hasCustomLayout([]), true);
});

test("a saved choice is kept, de-duplicated and put in registry order; unknown ids are dropped", () => {
  const out = resolveWidgets({
    role: "director",
    capabilities: CAPS.director,
    saved: ["stale-partners", "my-tasks", "my-tasks", "no-such-widget", "contacts-identified", "<script>"],
  });
  assert.deepEqual(out, ["contacts-identified", "my-tasks", "stale-partners"]);
});

test("a saved choice that no longer survives (capability withdrawn) falls back to the role default", () => {
  const out = resolveWidgets({ role: "property_manager", capabilities: CAPS.junior_property_manager, saved: ["who-to-call", "stale-partners"] });
  assert.deepEqual(out, defaultWidgetsFor("property_manager", CAPS.junior_property_manager));
  assert.ok(out.length > 0);
});

test("an empty saved layout falls back to the default rather than an empty dashboard", () => {
  const out = resolveWidgets({ role: "director", capabilities: CAPS.director, saved: [] });
  assert.deepEqual(out, defaultWidgetsFor("director", CAPS.director));
});

test("sanitiseSelection ignores non-strings and respects capabilities", () => {
  assert.deepEqual(sanitiseSelection([1, null, {}, "my-tasks", "who-to-call"], CAPS.junior_property_manager), ["my-tasks"]);
  assert.deepEqual(sanitiseSelection([], CAPS.director), []);
});

test("isWidgetId", () => {
  assert.equal(isWidgetId("my-tasks"), true);
  assert.equal(isWidgetId("MY-TASKS"), false);
  assert.equal(isWidgetId(undefined), false);
});
