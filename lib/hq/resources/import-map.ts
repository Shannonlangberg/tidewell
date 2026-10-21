/*
 * How the "PLANTED. Design System" folder maps onto the Resources library, used by
 * scripts/hq/import-brand-resources.mts (and pinned by import-map.test.mts).
 *
 *   guidelines   guidelines/*.html, brand/Brand Guidelines.html, readme.md, SKILL.md, and the generated
 *                "Voice and wording (current)"
 *   logos        assets/logos/** (alt/ carries the tag "unadopted alternative direction")
 *   photos       assets/photos/*
 *   colours_type tokens/colors.css, tokens/typography.css, tokens/fonts.css, styles/base.css
 *   tokens       the remaining CSS: styles.css, tokens/layout.css, styles/components.css, brand/guidelines.css
 *   ui_kit       ONE zip, "Website UI kit (code)": components/** and ui_kits/** with the stylesheets and tokens they need
 *
 * Skipped: .DS_Store and .thumbnail (and any other dot file), and the developer files that help nobody in HQ
 * (_ds_bundle.js, _ds_manifest.json, _adherence.oxlintrc.json, github.md, thumbnail.html). Anything else the map does
 * not know goes to "other" under its path, so nothing is dropped silently.
 *
 * The guideline cards (guidelines/*.html) carry the tag "foundation": the library shows them under "More guidelines".
 *
 * THE VOICE RULE: the folder's readme "Approved phrases" line, guidelines/voice.html and the voice section of
 * the brand book still list phrases the business has dropped. They are imported UNTOUCHED, with a note saying so,
 * and "Voice and wording (current)" is built from section 11 of docs/brand-design-system.md.
 *
 * Titles are the keys of the import: a title that exists is the same resource, so a changed file becomes a new
 * version of it and an unchanged one adds nothing. Titles are unique across the whole plan (the library requires it).
 *
 * Pure: it reads nothing itself (the caller passes the paths and a way to read a file's text).
 */
import { ALT_LOGO_TAG, DROPPED_PHRASES, LOGO_FILES, TAGLINE, VOICE_DOC_TITLE, VOICE_OUT_OF_DATE_NOTE } from "../brand";
import { mimeForFile, type ResourceCategory, type ResourceMime } from "./rules";

export type ImportEntry = {
  /** Path inside the folder, with forward slashes. */
  path: string;
  fileName: string;
  category: ResourceCategory;
  title: string;
  description: string | null;
  tags: string[];
  note: string | null;
  sortOrder: number;
  mime: ResourceMime;
  /** A bundle: the paths (inside the folder) that are zipped into this one file. Its own path is a label, not a file. */
  bundle?: string[];
};

export type ImportPlan = {
  entries: ImportEntry[];
  /** Files left out on purpose (dot files) or that the library cannot hold (an unknown type). */
  skipped: Array<{ path: string; reason: string }>;
  /** Files the map did not know: they are in `entries` under "other". */
  unmapped: string[];
};

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** `<!-- @dsCard group="Colors" ... name="Primary" subtitle="..." -->` -> its three values. */
export function dsCard(html: string | null): { group: string; name: string; subtitle: string } | null {
  const m = /<!--\s*@dsCard\s+([^>]*?)-->/.exec(html ?? "");
  if (!m) return null;
  const get = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(m[1])?.[1] ?? "";
  const out = { group: get("group"), name: get("name"), subtitle: get("subtitle") };
  return out.group && out.name ? out : null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

const FIXED: Record<string, Omit<ImportEntry, "path" | "fileName" | "mime">> = {
  "readme.md": {
    category: "guidelines",
    title: "Design system readme",
    description: "Overview of the PLANTED. 2026 design system: sources, content fundamentals, visual foundations, iconography, an index of the files, the components and the caveats.",
    tags: ["design system", "readme"],
    note: VOICE_OUT_OF_DATE_NOTE,
    sortOrder: 3,
  },
  "SKILL.md": {
    category: "guidelines",
    title: "Design system skill (SKILL.md)",
    description: "The skill definition for the design system: how an AI assistant should use its guidelines, colours, type, fonts, assets and UI kit to design on brand.",
    tags: ["design system", "skill"],
    note: null,
    sortOrder: 4,
  },
  "brand/Brand Guidelines.html": {
    category: "guidelines",
    title: "Brand Guidelines (brand book)",
    description: "The brand book, edition 01 (2026): the idea, the logo, colour with RGB and CMYK, typography, graphic language, photography, voice, applications and files. Open it as a web page after downloading.",
    tags: ["brand book", "guidelines"],
    note: VOICE_OUT_OF_DATE_NOTE,
    sortOrder: 2,
  },
  "tokens/colors.css": {
    category: "colours_type",
    title: "Colour tokens (colors.css)",
    description: "The 2026 palette as CSS custom properties: forest, ivory, stone, sage, lime, ink, muted, the status colours and the semantic aliases.",
    tags: ["tokens", "colour"],
    note: null,
    sortOrder: 0,
  },
  "tokens/typography.css": {
    category: "colours_type",
    title: "Type tokens (typography.css)",
    description: "The type system as CSS custom properties: the font families, the display scale, text sizes, tracking and leading.",
    tags: ["tokens", "type"],
    note: null,
    sortOrder: 1,
  },
  "tokens/fonts.css": {
    category: "colours_type",
    title: "Font loading (fonts.css)",
    description: "The one Google Fonts import that loads Hanken Grotesk and Cormorant Garamond. The design system has no font files.",
    tags: ["tokens", "fonts", "google fonts"],
    note: null,
    sortOrder: 2,
  },
  "styles/base.css": {
    category: "colours_type",
    title: "Base styles (base.css)",
    description: "Base element styles and the type class hooks (display sizes, statement, italic accent, label, lede, layout shell).",
    tags: ["styles", "type"],
    note: null,
    sortOrder: 3,
  },
  "styles.css": {
    category: "tokens",
    title: "Design system stylesheet (styles.css)",
    description: "The entry stylesheet: it imports the font, colour, type and layout tokens and the base and component styles.",
    tags: ["styles", "entry"],
    note: null,
    sortOrder: 0,
  },
  "tokens/layout.css": {
    category: "tokens",
    title: "Layout tokens (layout.css)",
    description: "Layout, spacing, radius and motion tokens as CSS custom properties: gutter, max width, section spacing, the spacing scale.",
    tags: ["tokens", "layout"],
    note: null,
    sortOrder: 1,
  },
  "styles/components.css": {
    category: "tokens",
    title: "Component styles (components.css)",
    description: "Class hooks for the React components (buttons, links, reveals), for the states inline styles cannot express: hover and focus.",
    tags: ["styles", "components"],
    note: null,
    sortOrder: 2,
  },
  "brand/guidelines.css": {
    category: "tokens",
    title: "Brand book stylesheet (guidelines.css)",
    description: "A standalone stylesheet used by the brand book only.",
    tags: ["styles", "brand book"],
    note: null,
    sortOrder: 3,
  },
};

/** Developer files that are not kept in the library, with the reason shown in the importer's output. */
const NOT_KEPT: Record<string, string> = {
  "_ds_bundle.js": "a compiled developer bundle, not kept in HQ",
  "_ds_manifest.json": "a developer manifest, not kept in HQ",
  "_adherence.oxlintrc.json": "a developer lint config, not kept in HQ",
  "github.md": "developer sync notes, not kept in HQ",
  "thumbnail.html": "a thumbnail page, not kept in HQ",
};

/** Files the UI kit zip carries besides components/** and ui_kits/**, so it runs on its own. */
const KIT_EXTRAS = (p: string) => p === "styles.css" || p === "readme.md" || p.startsWith("tokens/") || p.startsWith("styles/");

export const UI_KIT_TITLE = "Website UI kit (code)";
export const UI_KIT_FILE = "planted-website-ui-kit.zip";

export function planImport(paths: readonly string[], readText: (path: string) => string | null): ImportPlan {
  const entries: ImportEntry[] = [];
  const skipped: ImportPlan["skipped"] = [];
  const unmapped: string[] = [];
  const sorted = [...paths].map((p) => p.replace(/\\/g, "/")).sort((a, b) => a.localeCompare(b));

  let cardIndex = 0;
  const kit: string[] = [];
  let photoIndex = 0;
  for (const path of sorted) {
    const fileName = baseName(path);
    if (fileName.startsWith(".")) {
      skipped.push({ path, reason: "a system file" });
      continue;
    }
    const mime = mimeForFile(fileName);
    if (!mime) {
      skipped.push({ path, reason: "a kind of file the library does not hold" });
      continue;
    }
    const add = (e: Omit<ImportEntry, "path" | "fileName" | "mime">) => entries.push({ path, fileName, mime, ...e });

    if (NOT_KEPT[path]) {
      skipped.push({ path, reason: NOT_KEPT[path] });
      continue;
    }
    if (/^(components|ui_kits)\//.test(path)) {
      kit.push(path);
      continue;
    }

    if (FIXED[path]) {
      add(FIXED[path]);
    } else if (/^guidelines\/[^/]+\.html$/.test(path)) {
      const card = dsCard(readText(path));
      const stem = fileName.replace(/\.html$/, "");
      const isVoice = stem === "voice";
      add({
        category: "guidelines",
        title: card ? `${card.group}: ${decode(card.name)}` : `Guideline card: ${stem}`,
        description: card?.subtitle ? decode(card.subtitle) : null,
        tags: ["guideline card", "foundation", ...(card ? [card.group.toLowerCase()] : [])],
        note: isVoice ? VOICE_OUT_OF_DATE_NOTE : null,
        sortOrder: 10 + cardIndex,
      });
      cardIndex += 1;
    } else if (path.startsWith("assets/logos/")) {
      const rel = path.slice("assets/logos/".length);
      const i = LOGO_FILES.findIndex((l) => l.file === rel);
      const logo = i >= 0 ? LOGO_FILES[i] : null;
      add({
        category: "logos",
        title: logo?.title ?? `Logo file: ${rel}`,
        description: logo?.description ?? null,
        tags: ["logo", ...(logo ? (logo.alt ? [ALT_LOGO_TAG] : [logo.ground === "dark" ? "on dark" : "on light"]) : []), ...(rel.startsWith("alt/") && !logo ? [ALT_LOGO_TAG] : []), ...(rel.endsWith(".png") ? ["png export"] : [])],
        note: null,
        sortOrder: i >= 0 ? i : 100,
      });
      if (!logo) unmapped.push(path);
    } else if (path.startsWith("assets/photos/")) {
      const stem = fileName.replace(/\.[^.]+$/, "");
      const words = stem.split("-").map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
      add({
        category: "photos",
        title: `Photo: ${words}`,
        description: "A photograph from the design system. The location is unconfirmed.",
        tags: ["photo"],
        note: "The place named in the file name is unconfirmed. Do not caption the photo as that place until it is confirmed.",
        sortOrder: photoIndex,
      });
      photoIndex += 1;
    } else {
      unmapped.push(path);
      add({ category: "other", title: `Other file: ${path}`.slice(0, 200), description: null, tags: [], note: null, sortOrder: 900 });
    }
  }
  if (kit.length > 0) {
    const bundle = [...kit, ...sorted.filter(KIT_EXTRAS)];
    entries.push({
      path: UI_KIT_FILE,
      fileName: UI_KIT_FILE,
      mime: "application/zip",
      category: "ui_kit",
      title: UI_KIT_TITLE,
      description:
        "The redesigned PLANTED. website as code: the design-system React components (with usage notes and types), the website page and sections, and the stylesheets and tokens they need, as one zip. Logos and photos are separate resources.",
      tags: ["ui kit", "code", "zip"],
      note: null,
      sortOrder: 0,
      bundle,
    });
  }
  return { entries, skipped, unmapped };
}

// ── the current voice document ───────────────────────────────

/** Section 11 of docs/brand-design-system.md: from "## 11." up to (not including) the next "## " heading. Null when it is not there. */
export function voiceSection(designDoc: string): string | null {
  const lines = designDoc.split("\n");
  const start = lines.findIndex((l) => /^## 11\.\s/.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body || null;
}

/** The first "Primary tagline" and "Homepage line" lines of the brand identity section (docs section 1). */
function identityLines(designDoc: string): { tagline: string | null; homepage: string | null } {
  return {
    tagline: /^\*\*Primary tagline:\*\*\s*(.+)$/m.exec(designDoc)?.[1].trim() ?? null,
    homepage: /^\*\*Homepage line:\*\*\s*(.+)$/m.exec(designDoc)?.[1].trim() ?? null,
  };
}

/**
 * The text of "Voice and wording (current)": section 11 as it reads in the design doc, then the tagline rule and the
 * name rule, then the phrases that are no longer used. Null when the design doc has no section 11.
 */
export function buildVoiceDocument(designDoc: string): string | null {
  const section = voiceSection(designDoc);
  if (!section) return null;
  const { tagline, homepage } = identityLines(designDoc);
  return [
    `# ${VOICE_DOC_TITLE}`,
    "",
    "How PLANTED. writes and speaks. This is the current guidance: where an older file in the library (the design system readme, the voice guideline card, the voice section of the brand book) says something different, follow this document.",
    "",
    "## Brand voice",
    "",
    section,
    "",
    "## Tagline and name",
    "",
    `- The primary tagline is: ${tagline ?? TAGLINE}`,
    ...(homepage ? [`- The homepage line is: ${homepage}`] : []),
    "- The tagline is the signature: it appears in the footer, on the hero photograph and on signage. Use it as written.",
    "- PLANTED. in headings and UI; PLANTED in running prose.",
    "",
    "## Phrases that are no longer used",
    "",
    "Older material still lists these. The business has dropped them: do not use them as slogans or headlines.",
    "",
    ...DROPPED_PHRASES.map((p) => `- ${p}`),
    "",
  ].join("\n");
}

export const VOICE_ENTRY: Omit<ImportEntry, "path"> = {
  fileName: "voice-and-wording-current.md",
  category: "guidelines",
  title: VOICE_DOC_TITLE,
  description: "The current guidance on how PLANTED. writes and speaks: the test, what to do and not do, liked lines, approved phrases, the tagline and the name. It replaces the older voice material in the design system files.",
  tags: ["voice", "wording", "current"],
  note: null,
  sortOrder: 0,
  mime: "text/markdown",
};
