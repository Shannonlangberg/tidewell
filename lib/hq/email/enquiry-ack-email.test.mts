// Run with: npm test   (node --test, no extra dependencies)
// The automatic thank-you to a website enquirer: what it says, what it never says, and the greeting rule.
import "../../../scripts/hq/ts-hooks.mts"; // enquiry-ack-email.ts imports ./render without an extension
import test from "node:test";
import assert from "node:assert/strict";

const { ACK_SUBJECT, ackGreetingName, enquiryAckBody, enquiryAckEmail } = await import("./enquiry-ack-email.ts");
const { footerText } = await import("./render.ts");

const CONTACT = { email: "info@plantedproperty.com.au", phone: "0424 156 023" };

test("the greeting: a plain first name is used; anything else is Hello,", () => {
  assert.equal(ackGreetingName("Jeff"), "Jeff");
  assert.equal(ackGreetingName("  Mary-Jane  "), "Mary-Jane");
  assert.equal(ackGreetingName("O'Neil"), "O'Neil");
  assert.equal(ackGreetingName("Zoë"), "Zoë");
  assert.equal(ackGreetingName("Anne Marie"), "Anne Marie");
  assert.equal(ackGreetingName("a".repeat(40)), "a".repeat(40), "40 characters is the limit");
  for (const bad of ["a".repeat(41), "[test]", "Jeff2", "J.", "<b>Jeff</b>", "jeff@example.test", "https://x.test", "-Jeff", "'", "", "   ", null, undefined, "Je\u0000ff", "Jeff\nBcc: x"]) {
    assert.equal(ackGreetingName(bad), null, `refused: ${JSON.stringify(bad)}`);
  }
  assert.match(enquiryAckBody("Jeff", CONTACT), /^Hello Jeff,\n/);
  assert.match(enquiryAckBody("[test]", CONTACT), /^Hello,\n/);
  assert.match(enquiryAckBody(null, CONTACT), /^Hello,\n/);
});

test("what it says: thanks, received, will be in touch, the confirmed contacts, ignore if not you, the signature and footer", () => {
  const m = enquiryAckEmail({ firstName: "Jeff", contact: CONTACT });
  assert.equal(m.subject, ACK_SUBJECT);
  assert.equal(m.subject, "Thank you for contacting PLANTED.");
  for (const part of [m.text, m.html]) {
    assert.ok(part.includes("Thank you for getting in touch with PLANTED. We have received your message and will be in touch."));
    assert.ok(part.includes("If you did not send this enquiry, you can ignore this email."));
    assert.ok(part.includes("PLANTED. Property Management"));
    assert.ok(part.includes("info@plantedproperty.com.au"));
    assert.ok(part.includes("0424 156 023"));
  }
  assert.ok(m.text.includes(footerText("")), "the same identification and opt-out footer as every HQ email");
  assert.match(m.text, /reply with the word unsubscribe/);
  assert.match(m.html, /Hello Jeff,/);
});

test("the branded look: the forest header with the lockup and the ivory page; only the brand images, no link or other URL", () => {
  const { html } = enquiryAckEmail({ firstName: "Jeff", contact: CONTACT });
  assert.match(html, /background:#14291F;[^"]*">\s*<img src="https:\/\/plantedproperty\.com\.au\/brand\/logos\/png\/planted-lockup-horizontal-ivory-lime-1200\.png"/);
  assert.match(html, /background:#F7F5EF/);
  const rest = html.replace(/<img src="https:\/\/plantedproperty\.com\.au\/brand\/logos\/png\/planted-(?:lockup-horizontal-ivory-lime-1200|app-icon-512)\.png"[^>]*\/>/g, "");
  assert.ok(!/<img|<a\s|https?:\/\//i.test(rest), "no other image, no link, no URL");
  assert.match(html, /<span style="font-weight:600;">PLANTED\. Property Management<\/span>/, "signed by the business");
  assert.match(html, /<html lang="en-AU">/);
});

test("it never echoes the enquiry and invents nothing", () => {
  const { text, html } = enquiryAckEmail({ firstName: "Jeff", contact: CONTACT });
  const both = `${text}\n${html}`;
  // nothing the person typed but the checked first name; no ENQ ref, no message
  assert.ok(!/ENQ-|message:|suburb|appraisal/i.test(both));
  // no promise of a response time, hours, prices or services
  assert.ok(!/\b(hours?|minutes?|days?|today|tomorrow|within|soon|shortly|business day|monday|friday|\$|price|fee|free|guarantee|management fee|appraisal)\b/i.test(text), text);
});

test("what the person typed is escaped, and anything odd falls back to Hello,", () => {
  const m = enquiryAckEmail({ firstName: "<script>alert(1)</script>", contact: CONTACT });
  assert.ok(!m.html.includes("<script>"));
  assert.match(m.text, /^Hello,/);
  const apos = enquiryAckEmail({ firstName: "O'Neil", contact: CONTACT });
  assert.ok(apos.html.includes("Hello O&#39;Neil,"), "an apostrophe is escaped in the HTML");
  assert.ok(apos.text.startsWith("Hello O'Neil,"));
});

test("contact details that are not confirmed (null) are left out, and so is the line introducing them", () => {
  const none = enquiryAckEmail({ firstName: "Jeff", contact: { email: null, phone: null } });
  assert.ok(!/You can also reach us|Email:|Phone:/.test(none.text));
  assert.ok(!/You can also reach us|Email:|Phone:/.test(none.html));
  const emailOnly = enquiryAckEmail({ firstName: "Jeff", contact: { email: "info@plantedproperty.com.au", phone: null } });
  assert.match(emailOnly.text, /Email: info@plantedproperty\.com\.au/);
  assert.ok(!/Phone:/.test(emailOnly.text));
  const phoneOnly = enquiryAckEmail({ firstName: null, contact: { email: "", phone: "0424 156 023" } });
  assert.match(phoneOnly.text, /Phone: 0424 156 023/);
  assert.ok(!/Email:/.test(phoneOnly.text));
});
