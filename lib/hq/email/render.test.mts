// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_LINE, EMAIL_ICON_URL, EMAIL_LOCKUP_URL, escapeHtml, footerText, paragraphs, renderEmail, renderHtml, renderText, signatureLines } from "./render.ts";

/** The HTML with the two brand images removed: what is left is what the person wrote, the signature and the footer. */
const BRAND_IMG = new RegExp(`<img src="(?:${EMAIL_LOCKUP_URL}|${EMAIL_ICON_URL})"[^>]*/>`, "g");
const withoutBrandImages = (html: string) => html.replace(BRAND_IMG, "");

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
  const html = withoutBrandImages(renderHtml(evil));
  assert.doesNotMatch(html, /<script|<img|<a\s|<b>|<i>|<[^>]*\son[a-z]+=/i, "no live tag or event attribute");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quotes&quot;/);
  assert.match(html, /&lt;img src=&quot;https:\/\/evil\.test\/p\.gif&quot;/);
  assert.match(html, /&#39;single&#39;/);
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("only the two brand images, at fixed URLs: no tracking pixel, no stylesheet, no script, no added link", () => {
  const html = renderHtml(base);
  assert.equal(EMAIL_LOCKUP_URL, "https://plantedproperty.com.au/brand/logos/png/planted-lockup-horizontal-ivory-lime-1200.png");
  assert.equal(EMAIL_ICON_URL, "https://plantedproperty.com.au/brand/logos/png/planted-app-icon-512.png");
  assert.deepEqual([...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]), [EMAIL_LOCKUP_URL, EMAIL_ICON_URL], "the lockup, then the icon, nothing else");
  assert.doesNotMatch(html, /\?[^"]*\.png|\.png\?/, "no query string on an image (nothing identifies the recipient)");
  assert.doesNotMatch(withoutBrandImages(html), /<img|<link|<script|<a\s|url\(|https?:\/\//i);
});

test("images blocked: the lockup's alt text is the brand on forest, the icon is decoration", () => {
  const html = renderHtml(base);
  assert.match(html, new RegExp(`<img src="${EMAIL_LOCKUP_URL}" width="360" height="35" alt="PLANTED\\. Property Management" style="[^"]*color:#F7F5EF;`));
  assert.match(html, new RegExp(`<img src="${EMAIL_ICON_URL}" width="44" height="44" alt="" `));
});

test("the 2026 layout: ivory page, forest header with the lockup, white card with 28px corners, Hanken Grotesk, ink text", () => {
  const html = renderHtml(base);
  assert.match(html, /<body style="margin:0;padding:0;background:#F7F5EF;font-family:'Hanken Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif;color:#1D241E;">/);
  assert.match(html, /<td style="background:#14291F;padding:36px 36px 32px;border-radius:28px 28px 0 0;">\s*<img src="[^"]*planted-lockup-horizontal-ivory-lime-1200\.png"/);
  assert.match(html, /background:#FFFFFF;border-radius:0 0 28px 28px;padding:36px;/);
  assert.doesNotMatch(html, /#252525|#FAF8F4|#DED8D0|#A89A8B|Arial,'Helvetica Neue'/, "none of the old charcoal look");
  assert.match(html, /<html lang="en-AU">/);
  assert.match(html, /<title>Thank you for today<\/title>/);
});

test("the signature as the brand shows it: the icon beside \"Name · Role\", then the business; the business alone with no sender", () => {
  assert.match(renderHtml(base), /<span style="font-weight:600;">Shannon Langberg · Director<\/span><br \/><span style="color:#5A635B;">PLANTED\. Property Management<\/span>/);
  assert.match(renderHtml({ ...base, senderRole: null }), /<span style="font-weight:600;">Shannon Langberg<\/span><br \/>/);
  const none = renderHtml({ ...base, senderName: "", senderRole: null });
  assert.match(none, /<span style="font-weight:600;">PLANTED\. Property Management<\/span><\/td>/);
});

test("the signature is name, role and the business, and nothing invented", () => {
  assert.deepEqual(signatureLines("Shannon Langberg", "Director"), ["Shannon Langberg", "Director", BRAND_LINE]);
  assert.deepEqual(signatureLines("Shannon Langberg", null), ["Shannon Langberg", BRAND_LINE]);
  for (const out of [renderText(base), withoutBrandImages(renderHtml(base))]) {
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
