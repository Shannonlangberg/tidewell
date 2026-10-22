// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  ackBegun,
  ackChip,
  clientIp,
  detailLines,
  enquiryRef,
  hashIp,
  intakeFailure,
  intakeSuccess,
  ipSalt,
  parseEnquiryRef,
  submitArgs,
} from "./enquiry-rules.ts";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test("clientIp prefers Netlify's connection header, then the first forwarded address", () => {
  assert.equal(clientIp(h({ "x-nf-client-connection-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1" })), "203.0.113.9");
  assert.equal(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1");
  assert.equal(clientIp(h({ "x-forwarded-for": "2001:DB8::1" })), "2001:db8::1");
  assert.equal(clientIp(h({ "x-nf-client-connection-ip": "not an ip", "x-forwarded-for": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(h({ "x-forwarded-for": "<script>" })), null);
  assert.equal(clientIp(h({})), null);
});

test("hashIp is a salted SHA-256 that never contains the address", () => {
  const a = hashIp("203.0.113.9", "a-long-server-side-salt");
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes("203"));
  assert.notEqual(a, hashIp("203.0.113.9", "another-long-server-salt"), "the salt changes the hash");
  assert.equal(a, hashIp("203.0.113.9", "a-long-server-side-salt"), "stable for the rate limit");
});

test("ipSalt: a configured salt needs 16 characters, else the derived fallback", () => {
  assert.equal(ipSalt("short", "fallback"), "fallback");
  assert.equal(ipSalt("  a-sixteen-char-salt  ", "fallback"), "a-sixteen-char-salt");
  assert.equal(ipSalt(undefined, null), null);
});

test("submitArgs: own columns, the rest as details, blanks out, and only the IP hash", () => {
  const ipHash = hashIp("203.0.113.9", "a-long-server-side-salt");
  const args = submitArgs(
    { kind: "appraisal", data: { name: "Ann", email: "ann@example.test", phone: "", suburb: "Wallaroo", message: "", address: "1 Test St", bedrooms: "3", consent: "yes", parking: "" } },
    ipHash,
  );
  assert.deepEqual(args, {
    p_kind: "appraisal",
    p_name: "Ann",
    p_email: "ann@example.test",
    p_suburb: "Wallaroo",
    p_details: { address: "1 Test St", bedrooms: "3", consent: "yes" },
    p_source_page: "/rental-appraisal",
    p_ip_hash: ipHash,
  });
  assert.ok(!JSON.stringify(args).includes("203.0.113.9"), "no raw IP in the call");
  const contact = submitArgs({ kind: "contact", data: { name: "C", email: "c@x.test", message: "Hi", enquiryType: "General Enquiry" } }, null);
  assert.equal(contact.p_source_page, "/contact");
  assert.equal("p_ip_hash" in contact, false);
  assert.deepEqual(contact.p_details, { enquiryType: "General Enquiry" });
});

test("intakeFailure maps database refusals to reasons", () => {
  assert.equal(intakeFailure({ code: "54000", hint: "enquiry_rate_limited" }), "rate_limited");
  assert.equal(intakeFailure({ code: "22023", hint: "enquiry_invalid" }), "invalid");
  assert.equal(intakeFailure({ name: "TimeoutError", message: "The operation was aborted due to timeout" }), "timeout");
  assert.equal(intakeFailure({ code: "42501" }), "failed");
  assert.equal(intakeFailure({ code: "PGRST202" }), "failed");
});

test("intakeSuccess needs an id and an ENQ ref", () => {
  assert.deepEqual(intakeSuccess({ enquiry_id: "e1", ref: "ENQ-0001", opportunity_id: "o1", duplicate: false }), {
    ok: true,
    ref: "ENQ-0001",
    enquiryId: "e1",
    opportunityId: "o1",
    duplicate: false,
  });
  assert.equal(intakeSuccess({ enquiry_id: "e1", ref: "LEAD-0001" }).ok, false);
  assert.equal(intakeSuccess(null).ok, false);
});

test("refs", () => {
  assert.equal(enquiryRef(7), "ENQ-0007");
  assert.equal(enquiryRef(12345), "ENQ-12345");
  assert.equal(parseEnquiryRef("ENQ-0007"), 7);
  assert.equal(parseEnquiryRef("enq 12"), 12);
  assert.equal(parseEnquiryRef("LEAD-0007"), null);
});

test("detailLines: known fields in form order with labels, the rest by name", () => {
  assert.deepEqual(detailLines({ timeframe: "Within 30 days", address: "1 Test St", consent: "yes", zebra: "z" }), [
    { label: "Property address", value: "1 Test St" },
    { label: "Looking to appoint", value: "Within 30 days" },
    { label: "Consent given", value: "Yes" },
    { label: "zebra", value: "z" },
  ]);
  assert.deepEqual(detailLines(null), []);
  assert.deepEqual(detailLines(["x"]), []);
});

test("receivedAgo and the list parameters", async () => {
  const { receivedAgo, parseEnquiryListParams } = await import("./enquiry-rules.ts");
  const now = new Date("2026-10-20T10:00:00Z");
  assert.equal(receivedAgo("2026-10-20T09:59:40Z", now), "Just now");
  assert.equal(receivedAgo("2026-10-20T09:48:00Z", now), "12 minutes ago");
  assert.equal(receivedAgo("2026-10-20T07:00:00Z", now), "3 hours ago");
  assert.equal(receivedAgo("2026-10-19T08:00:00Z", now), "Yesterday");
  assert.equal(receivedAgo("2026-10-16T08:00:00Z", now), "4 days ago");
  assert.equal(receivedAgo("2026-08-01T08:00:00Z", now), null);
  assert.deepEqual(parseEnquiryListParams({ status: "new", kind: "appraisal", page: "2" }), { view: "new", kind: "appraisal", page: 2, filtered: true });
  assert.deepEqual(parseEnquiryListParams({ status: "bogus", kind: ["contact"], page: "-1" }), { view: "open", kind: "contact", page: 1, filtered: true });
  assert.deepEqual(parseEnquiryListParams({}), { view: "open", kind: null, page: 1, filtered: false });
  assert.deepEqual(parseEnquiryListParams({ status: "archived" }), { view: "archived", kind: null, page: 1, filtered: true });
  assert.deepEqual(parseEnquiryListParams({ status: "all" }), { view: "all", kind: null, page: 1, filtered: true });
});

test("the enquiry list hides archived and spam unless asked; archive and restore only return to enquiry pages", async () => {
  const { enquiryViewStatuses, enquiryReturnPath } = await import("./enquiry-rules.ts");
  assert.deepEqual(enquiryViewStatuses("open"), ["new", "in_progress"]);
  assert.deepEqual(enquiryViewStatuses("archived"), ["archived"]);
  assert.deepEqual(enquiryViewStatuses("spam"), ["spam"]);
  assert.equal(enquiryViewStatuses("all"), null);
  const fb = "/hq/communications/enquiries";
  assert.equal(enquiryReturnPath("/hq/communications/enquiries?status=archived&kind=contact&page=2", fb), "/hq/communications/enquiries?status=archived&kind=contact&page=2");
  assert.equal(enquiryReturnPath("/hq/growth/enquiries/0b6c1a3e-6f1d-4c8e-9a43-2f1d7e1b9c10", fb), "/hq/growth/enquiries/0b6c1a3e-6f1d-4c8e-9a43-2f1d7e1b9c10");
  for (const bad of ["https://evil.test/hq/communications/enquiries", "//evil.test", "/hq/settings", "/hq/communications/enquiries/../../settings", "/hq/communications/enquiries?x=<script>", 42, null]) {
    assert.equal(enquiryReturnPath(bad, fb), fb, String(bad));
  }
});

// ── the automatic thank-you ──

test("begin_enquiry_auto_reply's answer: send only with an address; anything odd is do-not-send", () => {
  assert.deepEqual(ackBegun({ send: true, ref: "ENQ-0001", to: "a@b.test", first_name: "Jeff", reply_to: "o@hq.test" }), {
    send: true,
    ref: "ENQ-0001",
    to: "a@b.test",
    firstName: "Jeff",
    replyTo: "o@hq.test",
  });
  assert.deepEqual(ackBegun({ send: true, to: "a@b.test", first_name: null, reply_to: null }), { send: true, ref: null, to: "a@b.test", firstName: null, replyTo: null });
  assert.deepEqual(ackBegun({ send: true }), { send: false, reason: "unexpected_answer" }, "no address: never send");
  assert.deepEqual(ackBegun({ send: false, reason: "address_limit" }), { send: false, reason: "address_limit" });
  assert.deepEqual(ackBegun({ send: false, reason: "<b>odd</b>" }), { send: false, reason: "unexpected_answer" });
  assert.deepEqual(ackBegun(null), { send: false, reason: "unexpected_answer" });
  assert.deepEqual(ackBegun("true"), { send: false, reason: "unexpected_answer" });
});

test("the thank-you chip: sent, not sent (with the reason in words), not confirmed, or nothing", () => {
  assert.deepEqual(ackChip("sent", null), { label: "Thank-you sent", tone: "success", detail: null });
  assert.equal(ackChip("skipped", "address_limit")?.label, "Thank-you not sent");
  assert.equal(ackChip("skipped", "address_limit")?.detail, "this address already had one in the last 24 hours");
  assert.equal(ackChip("skipped", "disabled")?.detail, "automatic thank-yous were switched off");
  assert.deepEqual(ackChip("failed", "not_begun"), { label: "Thank-you not sent", tone: "warning", detail: "the website could not reach HQ to send it" });
  assert.equal(ackChip("failed", "begin_timeout")?.detail, "HQ did not answer the website in time");
  assert.equal(ackChip("failed", "timeout")?.detail, "the email service did not answer in time");
  assert.equal(ackChip("failed", "provider_auth")?.detail, "the email service refused it");
  assert.equal(ackChip("skipped", "something_new")?.detail, null);
  assert.equal(ackChip("sending", null)?.label, "Thank-you not confirmed");
  assert.equal(ackChip("none", null), null);
  assert.equal(ackChip(undefined, null), null);
});
