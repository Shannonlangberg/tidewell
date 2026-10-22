// Run with: npm test   (node --test, no extra dependencies)
// Communications: who sees the hub and which tabs, where it opens, its two nav entries (Enquiries under
// Grow, Emails under Work), which pages light them, the badge, and the old addresses.
import "../../scripts/hq/ts-hooks.mts"; // nav.ts and communications.ts use "@/..." aliases
import test from "node:test";
import assert from "node:assert/strict";

const { COMMS_TAB_PATH, badgeText, canSeeComms, commsHref, commsTabs, defaultCommsTab } = await import("./communications.ts");
const { PRIMARY_NAV, mobileTabs, navKeyForPath, toEntries, visibleNav } = await import("../../components/hq/nav.ts");

const DIRECTOR = ["growth.read", "growth.write", "email.draft", "email.send", "settings.admin"];
const READ_ONLY = ["growth.read"];
const DRAFTER_ONLY = ["email.draft", "tasks.write"];
const JUNIOR = ["tasks.write", "people.read", "contractors.read"];

test("tabs by capability: growth.read gets Enquiries, email.draft gets Emails, in that order", () => {
  assert.deepEqual(commsTabs(DIRECTOR), ["enquiries", "emails"]);
  assert.deepEqual(commsTabs(READ_ONLY), ["enquiries"]);
  assert.deepEqual(commsTabs(DRAFTER_ONLY), ["emails"]);
  assert.deepEqual(commsTabs(JUNIOR), []);
});

test("the hub opens on the first tab the person may see, or nowhere", () => {
  assert.equal(defaultCommsTab(DIRECTOR), "enquiries");
  assert.equal(defaultCommsTab(READ_ONLY), "enquiries");
  assert.equal(defaultCommsTab(DRAFTER_ONLY), "emails");
  assert.equal(defaultCommsTab(JUNIOR), null);
  assert.equal(canSeeComms(JUNIOR), false);
  assert.equal(canSeeComms(DRAFTER_ONLY), true);
});

test("the nav (docs/hq-workspaces.md): Enquiries under Grow for growth.read, Emails under Work for email.draft", () => {
  const keys = PRIMARY_NAV.map((i) => i.key as string);
  assert.ok(!keys.includes("communications") && !keys.includes("email"), "no single Communications or Email item");
  const enq = PRIMARY_NAV.find((i) => i.key === "enquiries");
  const em = PRIMARY_NAV.find((i) => i.key === "emails");
  assert.equal(enq?.href, "/hq/communications/enquiries");
  assert.equal(enq?.group, "grow");
  assert.equal(em?.href, "/hq/communications/emails");
  assert.equal(em?.group, "work");
  const has = (caps: string[], key: string) => visibleNav(PRIMARY_NAV, caps as never).some((i) => i.key === key);
  assert.equal(has(DIRECTOR, "enquiries") && has(DIRECTOR, "emails"), true);
  assert.equal(has(READ_ONLY, "enquiries") && !has(READ_ONLY, "emails"), true);
  assert.equal(!has(DRAFTER_ONLY, "enquiries") && has(DRAFTER_ONLY, "emails"), true);
  assert.equal(has(JUNIOR, "enquiries") || has(JUNIOR, "emails"), false);
});

test("Enquiries lights on the hub and the old enquiry addresses; Emails on the email pages", () => {
  for (const p of ["/hq/communications", "/hq/communications/enquiries", "/hq/growth/enquiries", "/hq/growth/enquiries/0f9c1a2b-0000-4000-8000-000000000001"]) {
    assert.equal(navKeyForPath(p), "enquiries", p);
  }
  for (const p of ["/hq/communications/emails", "/hq/email", "/hq/email/new", "/hq/email/0f9c1a2b-0000-4000-8000-000000000001/edit"]) {
    assert.equal(navKeyForPath(p), "emails", p);
  }
  assert.equal(navKeyForPath("/hq/growth"), "reports", "the Growth overview's figures are reached from Reports");
  assert.equal(navKeyForPath("/hq/growth/opportunities/x"), "pipeline");
  assert.equal(navKeyForPath("/hq/growth/organisations/x"), "contacts");
  assert.equal(navKeyForPath("/hq/growth/partners"), "referralPartners");
  assert.equal(navKeyForPath("/hq/growth/enquiriesx"), "reports", "a prefix must end at a slash");
  assert.equal(navKeyForPath("/hq/emailx"), null);
  assert.equal(navKeyForPath("/hq"), "dashboard");
});

test("on a phone the workspace picks the tabs; Enquiries is a tab only in Support", () => {
  const visible = visibleNav(PRIMARY_NAV, [...DIRECTOR, "projects.read"] as never);
  assert.deepEqual(mobileTabs(visible, "grow").map((i) => i.key), ["dashboard", "contacts", "pipeline"]);
  assert.deepEqual(mobileTabs(visible, "overview").map((i) => i.key), ["dashboard", "operations", "projects"]);
  assert.deepEqual(mobileTabs(visible, "support").map((i) => i.key), ["dashboard", "enquiries", "operations"]);
});

test("the badge: a count of new enquiries; nothing for zero or junk; 99+ past 99", () => {
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-1), null);
  assert.equal(badgeText(1.5), null);
  assert.equal(badgeText(Number.NaN), null);
  assert.equal(badgeText(null), null);
  assert.equal(badgeText(100), "99+");
  const visible = visibleNav(PRIMARY_NAV, DIRECTOR as never);
  const entries = toEntries(visible, null, { enquiries: 2 });
  assert.equal(entries.find((e) => e.key === "enquiries")?.badge, "2");
  assert.equal(entries.filter((e) => e.badge).length, 1, "only Enquiries carries one");
  assert.equal(toEntries(visible, null, { enquiries: 0 }).find((e) => e.key === "enquiries")?.badge, undefined);
});

test("old list addresses redirect to the hub with their query kept", () => {
  assert.equal(COMMS_TAB_PATH.enquiries, "/hq/communications/enquiries");
  assert.equal(commsHref("enquiries", { status: "new", kind: undefined }), "/hq/communications/enquiries?status=new");
  assert.equal(commsHref("emails", { view: "sent", page: "2" }), "/hq/communications/emails?view=sent&page=2");
  assert.equal(commsHref("emails", {}), "/hq/communications/emails");
  assert.equal(commsHref("enquiries", { status: ["new", "spam"] }), "/hq/communications/enquiries?status=new&status=spam");
  assert.equal(commsHref("enquiries", { toast: "Saved & done" }), "/hq/communications/enquiries?toast=Saved+%26+done");
});
