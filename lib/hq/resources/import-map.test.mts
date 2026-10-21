// Run with: npm test   (node --test, no extra dependencies)
// How the design-system folder maps onto the library, and the voice rule: the older voice material is imported
// untouched with a note, and "Voice and wording (current)" is built from section 11 of docs/brand-design-system.md.
import "../../../scripts/hq/ts-hooks.mts"; // import-map.ts imports its neighbours without an extension
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { ALT_LOGO_TAG, DROPPED_PHRASES, LOGO_FILES, VOICE, VOICE_DOC_TITLE, VOICE_OUT_OF_DATE_NOTE } = await import("../brand.ts");
const { buildVoiceDocument, dsCard, planImport, voiceSection, VOICE_ENTRY } = await import("./import-map.ts");
const { RESOURCE_CATEGORIES, mimeForFile } = await import("./rules.ts");

const DOC = readFileSync(new URL("../../../docs/brand-design-system.md", import.meta.url), "utf8");

// The folder's file list (names and places only), as the importer sees it.
const COMPONENTS: Record<string, string[]> = {
  actions: ["Arrow", "Button", "RuleLink"],
  brand: ["Icon", "Logo"],
  forms: ["CheckboxField", "TextField"],
};
const PATHS = [
  ".DS_Store", ".thumbnail", "assets/.DS_Store", "SKILL.md", "readme.md", "github.md", "styles.css", "thumbnail.html", "_ds_bundle.js", "_ds_manifest.json", "_adherence.oxlintrc.json",
  "brand/Brand Guidelines.html", "brand/guidelines.css",
  "tokens/colors.css", "tokens/typography.css", "tokens/fonts.css", "tokens/layout.css", "styles/base.css", "styles/components.css",
  ...["colors-primary", "colors-accent", "voice", "type-text", "logos"].map((g) => `guidelines/${g}.html`),
  ...LOGO_FILES.map((l) => `assets/logos/${l.file}`),
  "assets/photos/12-bayview-road.jpg", "assets/photos/north-beach.jpg",
  ...Object.entries(COMPONENTS).flatMap(([g, names]) => [...names.flatMap((n) => [`components/${g}/${n}.jsx`, `components/${g}/${n}.d.ts`, `components/${g}/${n}.prompt.md`]), `components/${g}/${g}.card.html`]),
  "components/forms/FieldParts.jsx",
  "ui_kits/website/index.html", "ui_kits/website/kit.css", "ui_kits/website/Motion.jsx", "ui_kits/website/People.jsx", "ui_kits/website/Sections.jsx", "ui_kits/website/image-slot.js",
];
const TEXT: Record<string, string> = {
  "guidelines/colors-primary.html": '<!-- @dsCard group="Colors" viewport="700x150" name="Primary" subtitle="Forest, ivory, ink — the core of every page" -->\n<!doctype html>',
  "guidelines/voice.html": '<!-- @dsCard group="Brand" viewport="700x220" name="Voice" subtitle="Approved phrases — warm, confident, understated" -->',
  "guidelines/logos.html": '<!-- @dsCard group="Brand" viewport="700x260" name="Logo suite" subtitle="Outlined lockups" -->',
  "guidelines/type-text.html": '<!-- @dsCard group="Type" viewport="700x230" name="Text styles" subtitle="Statement, lede, body, caption" -->',
  "guidelines/colors-accent.html": '<!-- @dsCard group="Colors" viewport="700x150" name="Accent" subtitle="Pale lime &amp; the stop" -->',
  "components/actions/Button.prompt.md": "The PLANTED. pill button with a trailing arrow disc.\n\n```jsx\n<Button/>\n```",
  "components/actions/actions.card.html": '<!-- @dsCard group="Components" viewport="700x260" name="Actions — Button & RuleLink" subtitle="Pill buttons" -->',
};
const plan = planImport(PATHS, (p) => TEXT[p] ?? null);
const by = (title: string) => plan.entries.find((e) => e.title === title);

const DEV_FILES = ["_ds_bundle.js", "_ds_manifest.json", "_adherence.oxlintrc.json", "github.md", "thumbnail.html"];
const KIT_PATHS = PATHS.filter((p) => /^(components|ui_kits)\//.test(p));

test("system and developer files are skipped, the UI kit becomes one zip, everything else is imported", () => {
  assert.deepEqual(plan.skipped.map((s) => s.path).sort(), [".DS_Store", ".thumbnail", "_adherence.oxlintrc.json", "_ds_bundle.js", "_ds_manifest.json", "assets/.DS_Store", "github.md", "thumbnail.html"]);
  assert.equal(plan.unmapped.length, 0);
  assert.equal(plan.entries.length, PATHS.length - 3 - DEV_FILES.length - KIT_PATHS.length + 1);
  assert.equal(plan.entries.filter((e) => e.category === "other").length, 0, "nothing lands in other");
});

test("the UI kit is one zip: the components and the website, with the stylesheets and tokens it needs", () => {
  const kits = plan.entries.filter((e) => e.category === "ui_kit");
  assert.equal(kits.length, 1);
  const kit = kits[0];
  assert.equal(kit.title, "Website UI kit (code)");
  assert.equal(kit.fileName, "planted-website-ui-kit.zip");
  assert.equal(kit.mime, "application/zip");
  assert.ok(kit.bundle);
  for (const p of KIT_PATHS) assert.ok(kit.bundle.includes(p), p);
  for (const p of ["styles.css", "readme.md", "tokens/colors.css", "styles/base.css"]) assert.ok(kit.bundle.includes(p), p);
  for (const p of DEV_FILES.filter((d) => d !== "readme.md")) assert.ok(!kit.bundle.includes(p), p);
  assert.ok(!kit.bundle.some((p) => p.startsWith("assets/")), "logos and photos stay separate resources");
});

test("the guideline cards carry the foundation tag; the brand book, readme and skill do not", () => {
  for (const e of plan.entries.filter((x) => /^guidelines\//.test(x.path))) assert.ok(e.tags.includes("foundation"), e.path);
  for (const p of ["brand/Brand Guidelines.html", "readme.md", "SKILL.md"]) assert.ok(!plan.entries.find((e) => e.path === p)!.tags.includes("foundation"), p);
});

test("the mapping to categories", () => {
  const cat = (p: string) => plan.entries.find((e) => e.path === p)?.category;
  for (const p of ["readme.md", "SKILL.md", "brand/Brand Guidelines.html", "guidelines/voice.html", "guidelines/colors-primary.html", "guidelines/logos.html"]) assert.equal(cat(p), "guidelines", p);
  for (const l of LOGO_FILES) assert.equal(cat(`assets/logos/${l.file}`), "logos", l.file);
  assert.equal(cat("assets/photos/north-beach.jpg"), "photos");
  for (const p of ["tokens/colors.css", "tokens/typography.css", "tokens/fonts.css", "styles/base.css"]) assert.equal(cat(p), "colours_type", p);
  for (const p of ["styles.css", "tokens/layout.css", "styles/components.css", "brand/guidelines.css"]) assert.equal(cat(p), "tokens", p);
  for (const p of ["components/actions/Button.jsx", "components/actions/Button.d.ts", "components/actions/Button.prompt.md", "components/forms/FieldParts.jsx", "components/brand/brand.card.html", "ui_kits/website/index.html", "ui_kits/website/image-slot.js"]) assert.equal(cat(p), undefined, `${p} is inside the zip, not its own resource`);
  //assert.equal(cat(p), "ui_kit", p);
  for (const e of plan.entries) assert.ok((RESOURCE_CATEGORIES as readonly string[]).includes(e.category));
});

test("every file gets a type the library accepts, a unique title and a short description", () => {
  const titles = plan.entries.map((e) => e.title.toLowerCase());
  assert.equal(new Set(titles).size, titles.length, "titles are unique");
  for (const e of plan.entries) {
    assert.equal(e.mime, mimeForFile(e.fileName));
    assert.ok(e.title.length > 0 && e.title.length <= 200, e.title);
    assert.ok((e.description ?? "").length <= 2000);
    assert.ok(e.sortOrder >= 0 && e.sortOrder <= 9999);
    assert.ok(e.tags.length <= 12 && e.tags.every((t) => t.length <= 40));
  }
});

test("guideline cards take their title and description from their @dsCard line", () => {
  assert.deepEqual(dsCard(TEXT["guidelines/colors-primary.html"]), { group: "Colors", name: "Primary", subtitle: "Forest, ivory, ink — the core of every page" });
  assert.equal(dsCard("<p>no card</p>"), null);
  assert.equal(by("Colors: Primary")?.description, "Forest, ivory, ink — the core of every page");
  assert.equal(by("Colors: Accent")?.description, "Pale lime & the stop", "html entities are decoded");
  assert.equal(by("Type: Text styles")?.category, "guidelines");
});

test("logos: alt/ is tagged as an unadopted alternative direction, the rest are not", () => {
  const alt = plan.entries.filter((e) => e.path.startsWith("assets/logos/alt/"));
  assert.equal(alt.length, 2);
  for (const e of alt) assert.ok(e.tags.includes(ALT_LOGO_TAG), e.title);
  for (const e of plan.entries.filter((x) => x.category === "logos" && !x.path.includes("/alt/"))) assert.ok(!e.tags.includes(ALT_LOGO_TAG), e.title);
  assert.equal(ALT_LOGO_TAG, "unadopted alternative direction");
  assert.equal(by("Primary lockup, forest")?.sortOrder, 0);
});

test("THE VOICE RULE: only the three older voice files carry the note, and the note is exactly the agreed words", () => {
  assert.equal(VOICE_OUT_OF_DATE_NOTE, 'Parts of the voice guidance in this file are out of date. Where it conflicts with "Voice and wording (current)", follow that document.');
  const noted = plan.entries.filter((e) => e.note === VOICE_OUT_OF_DATE_NOTE).map((e) => e.path).sort();
  assert.deepEqual(noted, ["brand/Brand Guidelines.html", "guidelines/voice.html", "readme.md"]);
  // nothing else carries that note, and the other notes are about something else
  assert.equal(plan.entries.filter((e) => e.note && e.note !== VOICE_OUT_OF_DATE_NOTE).every((e) => e.category === "photos"), true);
});

test("section 11 is found in the design doc, up to the next section", () => {
  const section = voiceSection(DOC);
  assert.ok(section);
  assert.match(section, /^Warm, confident, personal, uncomplicated\./);
  assert.match(section, /\*\*The test:\*\*/);
  assert.match(section, /\*\*Do\*\*/);
  assert.match(section, /\*\*Don't\*\*/);
  assert.match(section, /\*\*Liked lines\*\*/);
  assert.match(section, /^Approved: A better place for your property\./m);
  assert.doesNotMatch(section, /Future brand architecture/, "stops before section 12");
  assert.equal(voiceSection("# nothing here"), null);
});

test("lib/hq/brand.ts repeats section 11 as it reads now", () => {
  const section = voiceSection(DOC)!;
  const plain = (s: string) => s.replace(/\*\*/g, "");
  // (the doc's "The test: would a ..." is a lower-case sentence start; brand.ts capitalises it)
  const has = (s: string) => assert.ok(plain(section).toLowerCase().includes(s.toLowerCase()), `section 11 does not contain: ${s}`);
  has(VOICE.summary);
  has(VOICE.test);
  for (const s of [...VOICE.do, ...VOICE.dont, ...VOICE.liked]) has(s);
  for (const s of VOICE.approved) has(s);
});

test("the current voice document: section 11 verbatim, the tagline rule and the name rule", () => {
  const text = buildVoiceDocument(DOC)!;
  assert.ok(text);
  assert.ok(text.startsWith(`# ${VOICE_DOC_TITLE}`));
  assert.ok(text.includes(voiceSection(DOC)!), "section 11 as it reads, word for word");
  assert.match(text, /The primary tagline is: A better place for your property\./);
  assert.ok(text.includes("PLANTED. in headings and UI; PLANTED in running prose."));
  assert.equal(buildVoiceDocument("no section"), null);
  assert.equal(VOICE_ENTRY.title, VOICE_DOC_TITLE);
  assert.equal(VOICE_ENTRY.category, "guidelines");
  assert.equal(VOICE_ENTRY.mime, "text/markdown");
  assert.equal(VOICE_ENTRY.note, null);
});

test("the dropped phrases appear only as dropped, never as approved", () => {
  const text = buildVoiceDocument(DOC)!;
  const [head, tail] = text.split("## Phrases that are no longer used");
  for (const p of DROPPED_PHRASES) {
    assert.ok(tail.includes(p), `${p} is listed as no longer used`);
    assert.ok(!head.includes(p), `${p} is not in the guidance itself`);
    assert.ok(!VOICE.approved.some((a) => a === p || a.includes(p)), `${p} is not an approved line`);
    assert.ok(!VOICE.liked.some((a) => a.includes(p)));
  }
  assert.ok(DROPPED_PHRASES.includes("Consider it cared for."));
  assert.equal(DROPPED_PHRASES.length, 4);
});
