// Run with: npm test   (node --test, no extra dependencies)
import "../../../scripts/hq/ts-hooks.mts"; // enquiry-notice.ts imports ./render without an extension
import test from "node:test";
import assert from "node:assert/strict";
const { enquiryNotice } = await import("./enquiry-notice.ts");

const base = {
  ref: "ENQ-0007",
  kind: "appraisal" as const,
  name: "[test] Ann Appraisal",
  suburb: "Wallaroo",
  receivedAt: new Date("2026-10-20T01:00:00Z"),
  timezone: "Australia/Adelaide",
  enquiryUrl: "https://hq.plantedproperty.com.au/hq/growth/enquiries/e7",
  leadUrl: "https://hq.plantedproperty.com.au/hq/growth/opportunities/o7",
};

test("the notice: plain facts and the HQ links", () => {
  const n = enquiryNotice(base);
  assert.equal(n.subject, "New website enquiry ENQ-0007: Rental appraisal request (Wallaroo)");
  assert.match(n.text, /Name: \[test\] Ann Appraisal/);
  assert.match(n.text, /Read it in HQ: https:\/\/hq\.plantedproperty\.com\.au\/hq\/growth\/enquiries\/e7/);
  assert.match(n.text, /Open the lead: https:\/\/hq\.plantedproperty\.com\.au\/hq\/growth\/opportunities\/o7/);
  assert.match(n.html, /href="https:\/\/hq\.plantedproperty\.com\.au\/hq\/growth\/enquiries\/e7"/);
});

test("what the public typed is escaped and kept to one line; it never becomes a link", () => {
  const n = enquiryNotice({ ...base, kind: "contact", name: '<a href="https://evil.test">Click</a>\r\nBcc: x@y.test', suburb: null });
  assert.ok(!n.html.includes("<a href=\"https://evil.test\""));
  assert.ok(n.html.includes("&lt;a href=&quot;https://evil.test&quot;&gt;"));
  assert.ok(!n.subject.includes("\n"));
  assert.ok(!/\r|\nBcc/.test(n.text.split("\n").find((l) => l.startsWith("Name:")) ?? ""));
  assert.equal(n.subject, "New website enquiry ENQ-0007: Contact form enquiry");
});

test("no message, email address or phone number goes in the notice", () => {
  const n = enquiryNotice(base);
  assert.ok(!/@example|message:|phone/i.test(n.text));
});

test("a link that is not http(s) is dropped", () => {
  const n = enquiryNotice({ ...base, enquiryUrl: "javascript:alert(1)", leadUrl: null });
  assert.ok(!n.html.includes("javascript:"));
  assert.ok(!n.text.includes("Read it in HQ"));
});
