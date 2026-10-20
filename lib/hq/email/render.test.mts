// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_LINE, escapeHtml, footerText, paragraphs, renderEmail, renderHtml, renderText, signatureLines } from "./render.ts";

const base = { subject: "Thank you for today", body: "Hi Tim,\n\nThank you for meeting me today.\nIt was good to talk.\n\nSpeak soon.", senderName: "Shannon Langberg", senderRole: "Director" };

test("paragraphs come from blank lines; single breaks stay inside a paragraph", () => {
  assert.deepEqual(paragraphs("One\n\nTwo\nlines\n\n\n\nThree  \n"), [["One"], ["Two", "lines"], ["Three"]]);
  assert.deepEqual(paragraphs("A\r\n\r\nB"), [["A"], ["B"]]);
  assert.deepEqual(paragraphs("  \n\n  "), []);
  const html = renderHtml(base);
  assert.equal((html.match(/padding-bottom:16px/g) ?? []).length, 3, "three paragraphs, three rows");
  assert.match(html, /Thank you for meeting me today\.<br \/>It was good to talk\./);
});

test("everything a person wrote is HTML-escaped (no markup, no script, no attribute break-out)", () => {
  const evil = {
    subject: `<script>alert(1)</script> & "quotes"`,
    body: `<img src="https://evil.test/p.gif" onerror="x()">\n\n<a href="javascript:alert(1)">click</a> & 'single'`,
    senderName: `Eve <b>"Bold"</b>`,
    senderRole: `<i>Director</i>`,
  };
  const html = renderHtml(evil);
  assert.doesNotMatch(html, /<script|<img|<a\s|<b>|<i>|<[^>]*\son[a-z]+=/i, "no live tag or event attribute");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.match(html, /&lt;img src=&quot;https:\/\/evil\.test\/p\.gif&quot;/);
  assert.match(html, /&#39;single&#39;/);
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("no remote images, no tracking pixel, no stylesheet, no script, no added link", () => {
  const html = renderHtml(base);
  assert.doesNotMatch(html, /<img|<link|<script|<a\s|url\(|https?:\/\//i);
});

test("the branded layout matches the sign-in email: charcoal header, wordmark in Georgia, soft-white card, hairline, 4px radius", () => {
  const html = renderHtml(base);
  assert.match(html, /background:#252525;padding:26px 32px;border-radius:4px 4px 0 0/);
  assert.match(html, /font-family:Georgia,'Times New Roman',serif;[^"]*">PLANTED\.<\/span>/);
  assert.match(html, /background:#FAF8F4;border:1px solid #DED8D0;border-top:0;border-radius:0 0 4px 4px/);
  assert.match(html, /font-family:Arial,'Helvetica Neue',Helvetica,sans-serif/);
  assert.match(html, /<html lang="en-AU">/);
  assert.match(html, /<title>Thank you for today<\/title>/);
});

test("the signature is name, role and the business, and nothing invented", () => {
  assert.deepEqual(signatureLines("Shannon Langberg", "Director"), ["Shannon Langberg", "Director", BRAND_LINE]);
  assert.deepEqual(signatureLines("Shannon Langberg", null), ["Shannon Langberg", BRAND_LINE]);
  for (const out of [renderText(base), renderHtml(base)]) {
    // no phone number, street address, ABN, licence or web address appears unless the person wrote it
    assert.doesNotMatch(out, /\b(?:\+?61|0)[2-478](?:[ -]?\d){8}\b/, "no phone number");
    assert.doesNotMatch(out, /\bABN\b|\blicen[cs]e\b|\bRLA\b/i);
    assert.doesNotMatch(out, /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave)\b/);
    assert.doesNotMatch(out, /www\.|\.com\.au|https?:/i);
  }
});

test("the footer identifies the sender and says how to opt out", () => {
  assert.equal(
    footerText("Shannon Langberg"),
    "Sent by PLANTED. Property Management on behalf of Shannon Langberg. Reply to this email to reach Shannon Langberg. If you would rather not receive emails from us, reply with the word unsubscribe.",
  );
  assert.ok(renderText(base).includes(footerText("Shannon Langberg")));
  assert.ok(renderHtml(base).includes(escapeHtml(footerText("Shannon Langberg"))));
});

test("the plain-text part: the message, a signature separator, the signature, the footer", () => {
  assert.equal(
    renderText(base),
    [
      "Hi Tim,",
      "",
      "Thank you for meeting me today.",
      "It was good to talk.",
      "",
      "Speak soon.",
      "",
      "--",
      "Shannon Langberg",
      "Director",
      "PLANTED. Property Management",
      "",
      footerText("Shannon Langberg"),
      "",
    ].join("\n"),
  );
});

test("the subject is one line", () => {
  assert.equal(renderEmail({ ...base, subject: "Two\r\nlines\there" }).subject, "Two lines here");
});
