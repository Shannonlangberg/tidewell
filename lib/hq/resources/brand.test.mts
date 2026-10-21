// Run with: npm test   (node --test, no extra dependencies)
// The brand facts in lib/hq/brand.ts: the values come only from the design-system folder (colors.css, typography.css,
// fonts.css, readme.md, the brand book), so they are pinned here to what those files say, and to the HQ tokens where the two agree.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BRAND_COLOURS,
  DROPPED_PHRASES,
  FETCH_FOR_MORE,
  GOOGLE_FONTS_IMPORT,
  GOOGLE_FONTS_URL,
  KEY_RULES,
  LOGO_FILES,
  NAME_RULES,
  TAGLINE,
  TYPEFACES,
  TYPE_STYLES,
  VOICE,
  VOICE_DOC_TITLE,
  isLightColour,
  rgbOf,
} from "../brand.ts";

const HQ_TOKENS = readFileSync(new URL("../../../app/planted-tokens.css", import.meta.url), "utf8");

test("the colours are the folder's tokens, with the brand book's RGB and CMYK for the six", () => {
  const by = new Map(BRAND_COLOURS.map((c) => [c.key, c]));
  assert.equal(by.size, BRAND_COLOURS.length, "keys are unique");
  // tokens/colors.css
  const hex: Record<string, string> = {
    forest: "#14291F", "forest-2": "#1B3428", "forest-3": "#20392D", ivory: "#F7F5EF", white: "#FFFFFF", stone: "#EAE7DF", sage: "#A6B09B",
    lime: "#E4F0A5", ink: "#1D241E", muted: "#5A635B", "muted-dark": "#B9C1AF", error: "#8A3A24", "error-dark": "#E8B4A0",
  };
  for (const [k, v] of Object.entries(hex)) assert.equal(by.get(k)?.hex, v, k);
  assert.equal(BRAND_COLOURS.length, Object.keys(hex).length);
  // the brand book: RGB and CMYK for forest, ivory, stone, sage, lime and ink
  const book: Record<string, [string, string]> = {
    forest: ["20 41 31", "80 45 75 70"], ivory: ["247 245 239", "2 2 5 0"], stone: ["234 231 223", "7 6 11 0"],
    sage: ["166 176 155", "35 20 40 2"], lime: ["228 240 165", "12 0 45 0"], ink: ["29 36 30", "70 55 70 75"],
  };
  for (const [k, [rgb, cmyk]] of Object.entries(book)) {
    assert.equal(rgbOf(by.get(k)!.hex), rgb, `${k} RGB`);
    assert.equal(by.get(k)!.cmyk, cmyk, `${k} CMYK`);
  }
  assert.deepEqual(BRAND_COLOURS.filter((c) => c.cmyk).map((c) => c.key).sort(), Object.keys(book).sort(), "CMYK only for the six the book lists");
  assert.deepEqual(BRAND_COLOURS.filter((c) => c.group === "core").map((c) => c.key), ["forest", "ivory", "stone", "sage", "lime", "ink"]);
  for (const c of BRAND_COLOURS) {
    assert.match(c.hex, /^#[0-9A-F]{6}$/);
    assert.match(c.token, /^--planted-[a-z0-9-]+$/);
    assert.ok(c.role && c.use);
  }
});

test("where HQ's own tokens carry the same colour, the hex agrees", () => {
  // HQ's white is a deliberately slightly whiter app ground (#FCFBF8); the design system's white is #FFFFFF.
  for (const c of BRAND_COLOURS.filter((x) => x.key !== "white")) {
    const m = new RegExp(`${c.token}:\\s*(#[0-9A-Fa-f]{6})`).exec(HQ_TOKENS);
    if (m) assert.equal(m[1].toUpperCase(), c.hex, c.token);
  }
  assert.ok(/--planted-forest:\s*#14291F/i.test(HQ_TOKENS));
});

test("text on a colour: dark ink on the light ones, ivory on the dark ones", () => {
  for (const k of ["ivory", "stone", "sage", "lime", "white"]) assert.equal(isLightColour(BRAND_COLOURS.find((c) => c.key === k)!.hex), true, k);
  for (const k of ["forest", "forest-2", "forest-3", "ink", "muted", "error"]) assert.equal(isLightColour(BRAND_COLOURS.find((c) => c.key === k)!.hex), false, k);
});

test("the two typefaces, their weights and the Google Fonts links", () => {
  assert.deepEqual(TYPEFACES.map((t) => t.family), ["Hanken Grotesk", "Cormorant Garamond"]);
  assert.match(GOOGLE_FONTS_URL, /family=Hanken\+Grotesk:wght@300;400;500;600/);
  assert.match(GOOGLE_FONTS_URL, /family=Cormorant\+Garamond:ital,wght@0,500;1,400;1,500/);
  assert.equal(GOOGLE_FONTS_IMPORT, `@import url("${GOOGLE_FONTS_URL}");`);
  for (const t of TYPEFACES) assert.ok(t.googleUrl.startsWith("https://fonts.googleapis.com/css2?family="));
  assert.ok(TYPEFACES[0].weights.length === 4 && TYPEFACES[1].weights.length === 3);
  assert.ok(TYPE_STYLES.some((s) => s.name === "Body" && s.spec.startsWith("17px")));
});

test("the logo files: 16 SVG, 7 PNG and 2 alternatives, each with a unique title", () => {
  assert.equal(LOGO_FILES.length, 25);
  assert.equal(LOGO_FILES.filter((l) => l.file.startsWith("alt/")).length, 2);
  assert.ok(LOGO_FILES.filter((l) => l.alt).every((l) => l.file.startsWith("alt/")));
  assert.equal(LOGO_FILES.filter((l) => l.file.startsWith("png/")).length, 7);
  assert.equal(LOGO_FILES.filter((l) => /^planted-[a-z-]+\.svg$/.test(l.file)).length, 16);
  assert.equal(new Set(LOGO_FILES.map((l) => l.title)).size, LOGO_FILES.length);
  assert.ok(LOGO_FILES.filter((l) => l.strip).length >= 4);
  // forest and ink artwork is for light grounds; ivory artwork for dark
  for (const l of LOGO_FILES) {
    if (/forest\.svg$|ink\.svg$/.test(l.file) && !l.file.includes("app-icon") && !l.file.includes("favicon")) assert.equal(l.ground, "light", l.file);
    if (/ivory(-lime)?\.svg$/.test(l.file) && !l.file.includes("app-icon")) assert.equal(l.ground, "dark", l.file);
  }
});

test("the voice rules are the current ones; the dropped phrases are never approved", () => {
  assert.equal(TAGLINE, "A better place for your property.");
  assert.deepEqual([...VOICE.approved], ["A better place for your property.", "Good property management starts with people.", "Let's talk about your property."]);
  assert.deepEqual([...DROPPED_PHRASES], ["Property management, thoughtfully reimagined", "People. Property. Potential.", "More than management. Peace of mind.", "Consider it cared for."]);
  for (const p of DROPPED_PHRASES) {
    assert.ok(!VOICE.approved.some((a) => a.includes(p.replace(/\.$/, ""))), p);
    assert.ok(![...KEY_RULES, ...NAME_RULES].some((r) => r.includes(p)), `${p} is not in the rules`);
  }
  assert.ok(NAME_RULES.some((r) => r === "PLANTED. in headings and UI; PLANTED in running prose where the full stop would read as the end of a sentence."));
  assert.ok(FETCH_FOR_MORE.some((f) => f.title === VOICE_DOC_TITLE));
});
