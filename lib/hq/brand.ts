/*
 * PLANTED.'s brand facts, as constants, for the Resources screens (the "Brand at a glance" band) and
 * the MCP tools (get_brand_summary). Pure: no imports, so `node --test` and the importer script can read it.
 *
 * Source: the "PLANTED. Design System" folder (2026): tokens/colors.css, tokens/typography.css,
 * tokens/fonts.css, readme.md, brand/Brand Guidelines.html and guidelines/*.html. Nothing here is
 * invented: a value that is not in that folder is not here. The voice rules are the CURRENT ones from
 * docs/brand-design-system.md section 11 (brand-resources.test.mts pins them to that file); the folder's
 * own older voice material is partly superseded (see DROPPED_PHRASES).
 *
 * The files themselves live in the Resources library (hq.brand_resources); LOGO_FILES, GUIDE_TITLES and
 * the other titles here are the titles the importer gives them, so the band, the summary and the library
 * agree.
 */

// ── colours ──────────────────────────────────────────────────

export type BrandColour = {
  key: string;
  /** The name people use, from the brand book where it names the colour, else from the token. */
  name: string;
  hex: string;
  /** The CSS custom property in tokens/colors.css. */
  token: string;
  /** What the colour is for, in a few words. */
  role: string;
  /** Where to use it, and where not to. */
  use: string;
  /** Starting points from the brand book (proof against the stock before printing); only the six it lists. */
  cmyk?: string;
  /** Which swatch row it sits in. */
  group: "core" | "supporting" | "functional";
};

export const BRAND_COLOURS: readonly BrandColour[] = [
  {
    key: "forest",
    name: "Deep forest",
    hex: "#14291F",
    token: "--planted-forest",
    role: "Contrast",
    use: "Contrast moments such as the footer and the contact band; about 30% of a surface. Text on it: ivory, sage or lime.",
    cmyk: "80 45 75 70",
    group: "core",
  },
  {
    key: "ivory",
    name: "Warm ivory",
    hex: "#F7F5EF",
    token: "--planted-ivory",
    role: "Page",
    use: "The default page, about half of every surface. Text on it: ink, forest or muted.",
    cmyk: "2 2 5 0",
    group: "core",
  },
  {
    key: "stone",
    name: "Soft stone",
    hex: "#EAE7DF",
    token: "--planted-stone",
    role: "Secondary band",
    use: "One secondary band on a page, about 12% of a surface.",
    cmyk: "7 6 11 0",
    group: "core",
  },
  {
    key: "sage",
    name: "Natural sage",
    hex: "#A6B09B",
    token: "--planted-sage",
    role: "Muted text on forest",
    use: "Muted text and marks on forest.",
    cmyk: "35 20 40 2",
    group: "core",
  },
  {
    key: "lime",
    name: "Pale lime",
    hex: "#E4F0A5",
    token: "--planted-lime",
    role: "Accent only",
    use: "The full stop, hover fill, selected chips and focus on dark. Under 3% of a surface; it never fills a large area.",
    cmyk: "12 0 45 0",
    group: "core",
  },
  {
    key: "ink",
    name: "Dark ink",
    hex: "#1D241E",
    token: "--planted-ink",
    role: "Text",
    use: "Body and heading text on light backgrounds.",
    cmyk: "70 55 70 75",
    group: "core",
  },
  {
    key: "white",
    name: "White",
    hex: "#FFFFFF",
    token: "--planted-white",
    role: "Raised surface",
    use: "The background a card lifts to on hover.",
    group: "supporting",
  },
  {
    key: "muted",
    name: "Muted",
    hex: "#5A635B",
    token: "--planted-muted",
    role: "Secondary text on light",
    use: "Secondary text on ivory and stone; it passes WCAG AA there.",
    group: "supporting",
  },
  {
    key: "forest-2",
    name: "Forest 2",
    hex: "#1B3428",
    token: "--planted-forest-2",
    role: "Raised surface on forest",
    use: "A forest tint for raised surfaces and fields on dark.",
    group: "supporting",
  },
  {
    key: "forest-3",
    name: "Forest 3",
    hex: "#20392D",
    token: "--planted-forest-3",
    role: "Raised surface on forest",
    use: "A second forest tint for raised surfaces and fields on dark.",
    group: "supporting",
  },
  {
    key: "muted-dark",
    name: "Muted on dark",
    hex: "#B9C1AF",
    token: "--planted-muted-dark",
    role: "Secondary text on forest",
    use: "Secondary text on forest (the token behind text-on-dark-muted).",
    group: "supporting",
  },
  {
    key: "error",
    name: "Error",
    hex: "#8A3A24",
    token: "--planted-error",
    role: "Error text",
    use: "Error text on light backgrounds.",
    group: "functional",
  },
  {
    key: "error-dark",
    name: "Error on dark",
    hex: "#E8B4A0",
    token: "--planted-error-dark",
    role: "Error text on forest",
    use: "Error text on forest.",
    group: "functional",
  },
];

export const COLOUR_GROUP_LABEL: Record<BrandColour["group"], string> = {
  core: "The six brand colours",
  supporting: "Supporting colours",
  functional: "Error",
};

/** "#14291F" -> "20 41 31" (the RGB the brand book prints). */
export function rgbOf(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [m[1], m[2], m[3]].map((h) => parseInt(h, 16)).join(" ") : "";
}

export const COLOUR_NOTES = [
  "Warm ivory dominates and forest brings the contrast. Use colour with restraint: pale lime is an accent for the full stop, hover and focus states.",
  "Text pairings that pass WCAG AA: ink, forest or muted on ivory and stone; ivory, sage or lime on forest.",
  "CMYK values are starting points: proof against uncoated stock before printing.",
  "There are no gradients except photo scrims.",
] as const;

// ── typefaces ────────────────────────────────────────────────

export type Typeface = {
  key: "hanken" | "cormorant";
  family: string;
  /** Primary or accent. */
  role: string;
  /** What it is used for. */
  use: string;
  /** The weights and styles in tokens/fonts.css. */
  weights: readonly string[];
  /** The CSS custom property in tokens/typography.css. */
  token: string;
  /** The family's own Google Fonts link. */
  googleUrl: string;
  /** A line to show the face in. Taken from the brand book. */
  sample: string;
};

export const TYPEFACES: readonly Typeface[] = [
  {
    key: "hanken",
    family: "Hanken Grotesk",
    role: "Primary",
    use: "Headlines, navigation, body copy, forms and data. Headlines at weight 400 with tight negative tracking (-0.04 to -0.05em).",
    weights: ["300 Light", "400 Regular", "500 Medium", "600 Semibold"],
    token: "--font-sans",
    googleUrl: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&display=swap",
    sample: "A better place for your property.",
  },
  {
    key: "cormorant",
    family: "Cormorant Garamond",
    role: "Accent",
    use: "Italic only, for one or two words per headline: never a whole sentence, never in UI, forms or data. Medium 500 is also the basis of the logo.",
    weights: ["500 Medium", "400 Italic", "500 Italic"],
    token: "--font-serif",
    googleUrl: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,400;1,500&display=swap",
    sample: "cared for.",
  },
];

/** The one import that loads both families (tokens/fonts.css). The folder has no font files: they load from Google Fonts. */
export const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&family=Cormorant+Garamond:ital,wght@0,500;1,400;1,500&display=swap";

export const GOOGLE_FONTS_IMPORT = `@import url("${GOOGLE_FONTS_URL}");`;

export type TypeStyle = { name: string; spec: string; note: string };

/** The type scale from tokens/typography.css, the brand book and the type cards. */
export const TYPE_STYLES: readonly TypeStyle[] = [
  { name: "Display hero", spec: "120px / 0.94, -0.052em, weight 400", note: "--type-display-hero: clamp(3.1rem, 7.2vw, 7.6rem)" },
  { name: "Display xl", spec: "90px, -0.045em, weight 400", note: "--type-display-xl: clamp(2.6rem, 5.6vw, 5.6rem)" },
  { name: "Display lg", spec: "58px, -0.038em, weight 400", note: "--type-display-lg: clamp(2.1rem, 3.8vw, 3.6rem)" },
  { name: "Display md", spec: "30px, -0.025em, weight 400", note: "--type-display-md: clamp(1.45rem, 2vw, 1.9rem)" },
  { name: "Statement", spec: "50px / 1.14", note: "--type-statement: clamp(1.7rem, 3.3vw, 3.15rem)" },
  { name: "Lede", spec: "20px / 1.55", note: "--type-lede: clamp(1.0625rem, 1.3vw, 1.25rem)" },
  { name: "Body", spec: "17px / 1.6", note: "--type-body: 1.0625rem" },
  { name: "Caption", spec: "13px", note: "--type-caption: 0.8125rem" },
  { name: "Eyebrow", spec: "12px, weight 500, uppercase, 0.14em", note: "Short, with a 6px dot" },
  { name: "Button", spec: "15.8px, weight 500, sentence case", note: "--type-button: 0.9875rem" },
];

// ── logos ────────────────────────────────────────────────────

export type LogoFile = {
  /** The path inside the folder's assets/logos. */
  file: string;
  /** The resource's title in the library. */
  title: string;
  description: string;
  /** Which ground the artwork is made for: light (ivory, white) or dark (forest). */
  ground: "light" | "dark";
  /** True for the two directions that were explored but not adopted. */
  alt?: boolean;
  /** Shown in the logo strip on the Resources page, in this order. */
  strip?: boolean;
};

export const LOGO_FILES: readonly LogoFile[] = [
  { file: "planted-lockup-forest.svg", title: "Primary lockup, forest", description: "The wordmark with the descriptor, in forest. The primary lockup for ivory and other light backgrounds.", ground: "light", strip: true },
  { file: "planted-lockup-ivory-lime.svg", title: "Primary lockup, ivory and lime", description: "The primary lockup reversed for forest: ivory letters, pale lime full stop.", ground: "dark", strip: true },
  { file: "planted-lockup-horizontal-forest.svg", title: "Horizontal lockup, forest", description: "The wordmark and descriptor side by side, for signage, email and narrow bands. Forest, for light backgrounds.", ground: "light", strip: true },
  { file: "planted-lockup-horizontal-ivory-lime.svg", title: "Horizontal lockup, ivory and lime", description: "The horizontal lockup reversed for forest: ivory letters, pale lime full stop.", ground: "dark", strip: true },
  { file: "planted-monogram-forest.svg", title: "Monogram P., forest", description: "The monogram for small marks, emboss and social. Forest, for light backgrounds.", ground: "light", strip: true },
  { file: "planted-app-icon.svg", title: "App icon, forest", description: "The app icon on a forest square with the lime full stop.", ground: "dark", strip: true },
  { file: "planted-lockup-ink.svg", title: "Primary lockup, ink", description: "The primary lockup in dark ink, for one-colour use on light backgrounds.", ground: "light" },
  { file: "planted-lockup-ivory.svg", title: "Primary lockup, ivory", description: "The primary lockup in ivory only (the full stop matches the letters), for dark grounds.", ground: "dark" },
  { file: "planted-wordmark-forest.svg", title: "Wordmark, forest", description: "The wordmark alone, for use when the descriptor is already present. Forest, for light backgrounds.", ground: "light" },
  { file: "planted-wordmark-ink.svg", title: "Wordmark, ink", description: "The wordmark alone in dark ink, for one-colour use on light backgrounds.", ground: "light" },
  { file: "planted-wordmark-ivory-lime.svg", title: "Wordmark, ivory and lime", description: "The wordmark alone, reversed for forest: ivory letters, pale lime full stop.", ground: "dark" },
  { file: "planted-wordmark-ivory.svg", title: "Wordmark, ivory", description: "The wordmark alone in ivory only, for dark grounds.", ground: "dark" },
  { file: "planted-monogram-ivory-lime.svg", title: "Monogram P., ivory and lime", description: "The monogram reversed for forest: ivory P, pale lime full stop.", ground: "dark" },
  { file: "planted-monogram-ivory.svg", title: "Monogram P., ivory", description: "The monogram in ivory only, for dark grounds.", ground: "dark" },
  { file: "planted-app-icon-ivory.svg", title: "App icon, ivory", description: "The app icon on an ivory square.", ground: "light" },
  { file: "planted-favicon.svg", title: "Favicon", description: "The favicon: a forest square with rounded corners and the lime full stop.", ground: "dark" },
  { file: "png/planted-lockup-forest-2400.png", title: "Primary lockup, forest (PNG 2400)", description: "PNG export of the forest primary lockup, 2400 by 1000 pixels. Use the SVG on screen.", ground: "light" },
  { file: "png/planted-lockup-ivory-lime-2400.png", title: "Primary lockup, ivory and lime (PNG 2400)", description: "PNG export of the reversed primary lockup, 2400 by 1000 pixels.", ground: "dark" },
  { file: "png/planted-app-icon-512.png", title: "App icon (PNG 512)", description: "PNG export of the app icon, 512 by 512 pixels.", ground: "dark" },
  { file: "png/planted-apple-touch-180.png", title: "Apple touch icon (PNG 180)", description: "PNG export for the Apple touch icon, 180 by 180 pixels.", ground: "dark" },
  { file: "png/planted-favicon-32.png", title: "Favicon (PNG 32)", description: "PNG export of the favicon, 32 by 32 pixels.", ground: "dark" },
  { file: "png/planted-social-avatar-1080.png", title: "Social avatar (PNG 1080)", description: "The social profile image, 1080 by 1080 pixels.", ground: "dark" },
  { file: "png/planted-social-cover-1500x500.png", title: "Social cover (PNG 1500 by 500)", description: "The social cover image, 1500 by 500 pixels.", ground: "dark" },
  { file: "alt/direction-b-grotesk.svg", title: "Alternative direction B, grotesk", description: "Direction B from the logo exploration: Hanken Grotesk 500, sentence case. Explored and kept for reference; not adopted.", ground: "light", alt: true },
  { file: "alt/direction-c-spaced.svg", title: "Alternative direction C, spaced caps", description: "Direction C from the logo exploration: Hanken Grotesk 600, spaced capitals. Explored and kept for reference; not adopted.", ground: "light", alt: true },
];

/** The tag every file in alt/ carries. */
export const ALT_LOGO_TAG = "unadopted alternative direction";

export const LOGO_RULES = [
  "A refined serif wordmark with a permanent full stop. It is set in Cormorant Garamond Medium with open tracking and converted to outlines, so every logo file is outlined vector artwork.",
  "On forest the full stop turns pale lime; everywhere else it matches the wordmark.",
  "Use only the supplied artwork. Never retype the wordmark.",
  "Keep clear space equal to the height of the P on every side.",
  "Minimum widths: wordmark 80px (20mm); lockup 120px (30mm), and below that drop the descriptor; monogram from 16px.",
  "Do not stretch or condense it, put ivory and lime on light grounds, put it on busy photography, or add tints, effects or icons.",
  "Use SVG on screen; send SVG or the PNGs to printers.",
] as const;

// ── the name, the tagline and the voice (current) ────────────

export const NAME_RULES = [
  "The name is PLANTED. with the full stop, and the descriptor is Property Management.",
  "PLANTED. in headings and UI; PLANTED in running prose where the full stop would read as the end of a sentence.",
] as const;

/** The tagline rule: one signature line, used in the footer, on the hero photograph and on signage. */
export const TAGLINE = "A better place for your property.";

/** Section 11 of docs/brand-design-system.md, as it reads now. */
export const VOICE = {
  summary: "Warm, confident, personal, uncomplicated. Australian English, sentence case. Avoid exaggerated sales claims.",
  test: "Would a thoughtful, capable property manager say this out loud to an owner over a coffee? If not, rewrite it.",
  do: [
    'Say something specific. "You hear from us while it is happening" beats "proactive communication".',
    "Write short, natural sentences. A plain sentence is often the strongest one.",
    'Use "we" and "you". Write for one person, not a market.',
    'Keep service-area facts (towns, "starting on the Copper Coast") in location sections, contact details and area pages. The brand itself is Australian and built to grow. Never imply we operate somewhere we do not yet.',
    `Name the next step gently: "Let's talk about your property."`,
  ],
  dont: [
    'No hollow lines ("thoughtfully reimagined", "more than management", "peace of mind", "protecting today, preparing for tomorrow").',
    "No forced contrasts (\"not just X, but Y\"), no rhythmic three-part slogans, no unnecessary em dashes.",
    'Leave out "seamless", "tailored", "elevated", "innovative", "solutions", "empowering", "exceptional" and "unparalleled" unless the word is doing real work.',
    "Never invent testimonials, numbers, awards, team members, years of experience, locations or licences. Flag anything unconfirmed instead.",
  ],
  liked: [
    "Most owners don't want more paperwork. They want to stop wondering.",
    "We would far rather you rang us than sat wondering.",
    "Collecting the rent is the straightforward part. Everything that matters sits around it.",
  ],
  approved: [TAGLINE, "Good property management starts with people.", "Let's talk about your property."],
} as const;

/**
 * Phrases that older material (the design system's readme "Approved phrases" line, guidelines/voice.html and the
 * voice section of the brand book) still lists but the business has dropped. Never present these as approved.
 */
export const DROPPED_PHRASES = [
  "Property management, thoughtfully reimagined",
  "People. Property. Potential.",
  "More than management. Peace of mind.",
  "Consider it cared for.",
] as const;

/** The note shown on the files that still carry the older voice material. Set by the importer. */
export const VOICE_OUT_OF_DATE_NOTE =
  'Parts of the voice guidance in this file are out of date. Where it conflicts with "Voice and wording (current)", follow that document.';

/** The title of the current voice document the importer creates from section 11 of docs/brand-design-system.md. */
export const VOICE_DOC_TITLE = "Voice and wording (current)";

// ── shape, layout, motion ────────────────────────────────────

export const KEY_RULES = [
  "Colour: warm ivory is the default page (about 50%), forest the contrast (about 30%), stone one secondary band (about 12%), pale lime an accent under 3%. No gradients except photo scrims.",
  "Type: Hanken Grotesk for everything. Cormorant Garamond italic only for one or two accent words in a headline, never in UI, forms or data.",
  "Headlines are sentence case and end in a full stop. Buttons are sentence case. Eyebrows are short and uppercase. No emoji, no exclamation marks, curly apostrophes.",
  "Shape: pills for every button, chip and the nav; 12px radius on inputs, 20px on tiles, 28px on images, cards and panels.",
  "Cards sit ivory on stone with no borders and no drop shadows; borders are 1px hairlines (12% ink on light, 14% ivory on forest).",
  "Focus: a 2px forest outline (lime on dark) with a 3px offset. Motion uses cubic-bezier(.22, 1, .36, 1) and is off under prefers-reduced-motion.",
  "Photography: real Copper Coast homes and candid people in warm natural light. Commission portraits of the actual team; never present stock models as staff or clients. Avoid sunsets as a default, staged luxury and handshakes.",
  "Hard rules: no invented testimonials, statistics, yields, awards, team names or credentials. Unconfirmed facts stay hidden and placeholders read as placeholders. Australian English.",
] as const;

/** The business, from the folder's readme.md: only what it states. */
export const BUSINESS_LINE =
  "PLANTED. Property Management is a residential property management business on South Australia's Copper Coast, trading as Planted Property Group.";

// ── what to fetch ────────────────────────────────────────────

/** Titles in the library to open for more, by need (get_brand_summary names them; the importer creates them). */
export const FETCH_FOR_MORE = [
  { need: "Voice and wording", title: VOICE_DOC_TITLE },
  { need: "The full brand book", title: "Brand Guidelines (brand book)" },
  { need: "The colour tokens as CSS", title: "Colour tokens (colors.css)" },
  { need: "The type tokens as CSS", title: "Type tokens (typography.css)" },
  { need: "The Google Fonts import", title: "Font loading (fonts.css)" },
  { need: "Logo files", title: "Primary lockup, forest" },
  { need: "The design system overview", title: "Design system readme" },
] as const;

/** True when dark text reads better on this colour (a plain relative-luminance test). */
export function isLightColour(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}
