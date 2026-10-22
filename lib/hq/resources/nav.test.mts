// Run with: npm test   (node --test, no extra dependencies)
// The Resources entry in HQ's navigation: where it sits, who sees it, where it lights.
import "../../../scripts/hq/ts-hooks.mts"; // nav.ts uses "@/..." aliases
import test from "node:test";
import assert from "node:assert/strict";

const { ACCOUNT_NAV, HQ_ROUTES, PRIMARY_NAV, mobileTabs, navKeyForPath, visibleNav } = await import("../../../components/hq/nav.ts");
const { STAFF_ROLES } = await import("../constants.ts");

test("Resources comes straight after Knowledge in Company, opens /hq/resources and needs resources.read", () => {
  const keys = PRIMARY_NAV.map((i) => i.key as string);
  assert.equal(keys.indexOf("resources"), keys.indexOf("knowledge") + 1);
  assert.equal(PRIMARY_NAV.find((i) => i.key === "resources")?.group, "company");
  const item = PRIMARY_NAV.find((i) => i.key === "resources");
  assert.equal(item?.label, "Resources");
  assert.equal(item?.href, "/hq/resources");
  assert.equal(HQ_ROUTES.resources, "/hq/resources");
  assert.equal(item?.requires, "resources.read");
  assert.equal(item?.icon, "resources");
});

test("everyone who holds resources.read sees it, and nobody else", () => {
  const has = (caps: string[]) => visibleNav(PRIMARY_NAV, caps as never).some((i) => i.key === "resources");
  assert.equal(has(["resources.read"]), true);
  assert.equal(has(["resources.read", "resources.manage"]), true);
  assert.equal(has(["resources.manage"]), false);
  assert.equal(has(["knowledge.read", "growth.read", "tasks.write"]), false);
  assert.equal(has([]), false);
  assert.equal(STAFF_ROLES.length, 8);
});

test("it is lit on the library, a resource and its download, and not on look-alike paths", () => {
  for (const p of ["/hq/resources", "/hq/resources/6b0c1f2e-0000-4000-8000-000000000001", "/hq/resources/6b0c1f2e-0000-4000-8000-000000000001/download", "/hq/resources/zip"]) assert.equal(navKeyForPath(p), "resources", p);
  assert.equal(navKeyForPath("/hq/resourcesx"), null);
  assert.equal(navKeyForPath("/hq/knowledge"), "knowledge");
});

test("on a phone it sits in More; the account entries are unchanged", () => {
  const all = ["growth.read", "resources.read", "knowledge.read", "projects.read", "contractors.read", "people.read", "meetings.read", "decisions.read", "portfolio.read", "email.draft"];
  const visible = visibleNav(PRIMARY_NAV, all as never);
  assert.deepEqual(mobileTabs(visible, "grow").map((i) => i.key), ["dashboard", "contacts", "pipeline"]);
  assert.deepEqual(mobileTabs(visible, "deliver").map((i) => i.key), ["dashboard", "operations", "partners"]);
  assert.deepEqual(ACCOUNT_NAV.map((i) => i.key), ["settings", "profile"]);
  // a person whose only HQ pages are Today, Tasks, Resources and Reports still gets three tabs, then More
  const few = visibleNav(PRIMARY_NAV, ["resources.read"] as never);
  assert.deepEqual(few.map((i) => i.key).sort(), ["dashboard", "operations", "reports", "resources"]);
  assert.deepEqual(mobileTabs(few, "grow").map((i) => i.key), ["dashboard", "operations", "resources"]);
});
