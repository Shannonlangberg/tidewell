// Run with: npm test   (node --test, no extra dependencies)
// Communications: who sees the hub and which tabs, where it opens, the nav item that replaced Email,
// which pages light it, the badge, and the old addresses.
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

test("the nav: Communications replaces Email, right after Growth, for growth.read OR email.draft", () => {
  const keys = PRIMARY_NAV.map((i) => i.key as string);
  assert.ok(!keys.includes("email"), "no separate Email item");
  assert.equal(keys.indexOf("communications"), keys.indexOf("growth") + 1);
  const item = PRIMARY_NAV.find((i) => i.key === "communications");
  assert.equal(item?.label, "Communications");
  assert.equal(item?.href, "/hq/communications");
  const has = (caps: string[]) => visibleNav(PRIMARY_NAV, caps as never).some((i) => i.key === "communications");
  assert.equal(has(DIRECTOR), true);
  assert.equal(has(READ_ONLY), true);
  assert.equal(has(DRAFTER_ONLY), true);
  assert.equal(has(JUNIOR), false);
  // the other single-capability items are unchanged
  assert.equal(visibleNav(PRIMARY_NAV, READ_ONLY as never).some((i) => i.key === "growth"), true);
  assert.equal(visibleNav(PRIMARY_NAV, JUNIOR as never).some((i) => i.key === "growth"), false);
});

test("Communications is lit on the hub and on the enquiry and email pages kept at their old addresses", () => {
  for (const p of [
    "/hq/communications",
    "/hq/communications/enquiries",
    "/hq/communications/emails",
    "/hq/growth/enquiries",
    "/hq/growth/enquiries/0f9c1a2b-0000-4000-8000-000000000001",
    "/hq/email",
    "/hq/email/new",
    "/hq/email/0f9c1a2b-0000-4000-8000-000000000001/edit",
  ]) {
    assert.equal(navKeyForPath(p), "communications", p);
  }
  assert.equal(navKeyForPath("/hq/growth"), "growth");
  assert.equal(navKeyForPath("/hq/growth/opportunities/x"), "growth");
  assert.equal(navKeyForPath("/hq/growth/enquiriesx"), "growth", "a prefix must end at a slash");
  assert.equal(navKeyForPath("/hq/emailx"), null);
  assert.equal(navKeyForPath("/hq"), "dashboard");
});

test("on a phone it sits in More; the bottom tabs are unchanged", () => {
  const visible = visibleNav(PRIMARY_NAV, DIRECTOR as never);
  assert.deepEqual(mobileTabs(visible, "director").map((i) => i.key), ["dashboard", "growth", "operations"]);
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
  const entries = toEntries(visible, null, { communications: 2 });
  assert.equal(entries.find((e) => e.key === "communications")?.badge, "2");
  assert.equal(entries.filter((e) => e.badge).length, 1, "only Communications carries one");
  assert.equal(toEntries(visible, null, { communications: 0 }).find((e) => e.key === "communications")?.badge, undefined);
});

test("old list addresses redirect to the hub with their query kept", () => {
  assert.equal(COMMS_TAB_PATH.enquiries, "/hq/communications/enquiries");
  assert.equal(commsHref("enquiries", { status: "new", kind: undefined }), "/hq/communications/enquiries?status=new");
  assert.equal(commsHref("emails", { view: "sent", page: "2" }), "/hq/communications/emails?view=sent&page=2");
  assert.equal(commsHref("emails", {}), "/hq/communications/emails");
  assert.equal(commsHref("enquiries", { status: ["new", "spam"] }), "/hq/communications/enquiries?status=new&status=spam");
  assert.equal(commsHref("enquiries", { toast: "Saved & done" }), "/hq/communications/enquiries?toast=Saved+%26+done");
});
