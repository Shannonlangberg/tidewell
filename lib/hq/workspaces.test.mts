import test from "node:test";
import assert from "node:assert/strict";
import { mobileTabKeys, navGroupOrder, navWorkspace, roleWorkspace, todayWorkspace, todayWorkspaces, WORKSPACES } from "./workspaces.ts";

const GROWTH = ["growth.read", "tasks.write"];
const NO_GROWTH = ["tasks.write", "contractors.read"];

test("role defaults", () => {
  assert.equal(roleWorkspace("business_development_manager"), "grow");
  assert.equal(roleWorkspace("property_manager"), "deliver");
  assert.equal(roleWorkspace("junior_property_manager"), "deliver");
  assert.equal(roleWorkspace("virtual_assistant"), "support");
  assert.equal(roleWorkspace("director"), "overview");
  assert.equal(roleWorkspace("read_only"), "overview");
});

test("Grow is offered only with growth.read; the overview always", () => {
  assert.deepEqual(todayWorkspaces(GROWTH), ["grow", "overview"]);
  assert.deepEqual(todayWorkspaces(NO_GROWTH), ["overview"]);
});

test("Today: the chosen view, then the saved default, then the role's", () => {
  assert.equal(todayWorkspace({ view: "overview", saved: "grow", role: "director", capabilities: GROWTH }), "overview");
  assert.equal(todayWorkspace({ view: null, saved: "grow", role: "director", capabilities: GROWTH }), "grow");
  assert.equal(todayWorkspace({ view: null, saved: null, role: "director", capabilities: GROWTH }), "overview");
  assert.equal(todayWorkspace({ view: null, saved: null, role: "business_development_manager", capabilities: GROWTH }), "grow");
});

test("a view the person cannot use is ignored: a workspace never grants access", () => {
  assert.equal(todayWorkspace({ view: "grow", saved: null, role: "junior_property_manager", capabilities: NO_GROWTH }), "overview");
  assert.equal(todayWorkspace({ view: "grow", saved: "grow", role: "junior_property_manager", capabilities: NO_GROWTH }), "overview");
  assert.equal(todayWorkspace({ view: "nonsense", saved: null, role: "business_development_manager", capabilities: GROWTH }), "grow");
});

test("Deliver and Support are not built yet: Today shows the overview, the navigation follows the role", () => {
  assert.equal(todayWorkspace({ view: "deliver", saved: null, role: "property_manager", capabilities: GROWTH }), "overview");
  assert.equal(navWorkspace(null, "property_manager"), "deliver");
  assert.deepEqual(navGroupOrder(navWorkspace(null, "property_manager"))[0], "deliver");
  assert.deepEqual(mobileTabKeys("deliver"), ["dashboard", "operations", "partners"]);
});

test("every workspace orders all four groups and starts its tabs with Today", () => {
  for (const w of WORKSPACES) {
    assert.deepEqual([...navGroupOrder(w)].sort(), ["company", "deliver", "grow", "work"]);
    assert.equal(mobileTabKeys(w)[0], "dashboard");
    assert.equal(mobileTabKeys(w).length, 3);
  }
  assert.equal(navGroupOrder("grow")[0], "grow");
});
