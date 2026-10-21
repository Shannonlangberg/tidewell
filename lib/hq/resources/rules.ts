/*
 * Resources, the brand library: vocabulary and rules shared by the screens, the Server Actions, the zip
 * route, the importer and the MCP tools. They mirror what the database enforces (migrations 0151, 0152):
 * the database is the control, these give people the same answer earlier and in plain words.
 *
 * The browser's check is a courtesy. The Server Actions repeat it, the storage bucket refuses other types
 * and sizes, and hq.register_brand_resource / replace_brand_resource_file re-check the stored object.
 *
 * HONEST LIMITATION (shown in the interface): HQ does not scan uploaded files for malware.
 *
 * Pure, with NO value imports on purpose (Node's type-stripping test runner and the importer script; see
 * lib/hq/tasks/rules.ts). The FormReader is passed in; only its type is imported.
 */
import type { FormReader } from "../forms";

// ── vocabulary (values MUST match hq.brand_resource_category) ──

export const RESOURCE_CATEGORIES = ["guidelines", "logos", "photos", "colours_type", "tokens", "ui_kit", "other"] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export const RESOURCE_CATEGORY_LABEL: Record<ResourceCategory, string> = {
  guidelines: "Guidelines",
  logos: "Logos",
  photos: "Photos",
  colours_type: "Colours and type",
  tokens: "Design tokens",
  ui_kit: "UI kit",
  other: "Other",
};

/** One line under each category heading. */
export const RESOURCE_CATEGORY_BLURB: Record<ResourceCategory, string> = {
  guidelines: "The brand book and the guideline cards: logo, colour, type, voice, photography.",
  logos: "Logo artwork: lockups, wordmarks, monograms, app icons, PNG exports.",
  photos: "Photographs for the brand.",
  colours_type: "The colour and type tokens, how the fonts load, and the base styles.",
  tokens: "The rest of the design-system CSS: layout, components and the brand-book stylesheet.",
  ui_kit: "Component code (JSX and types), their usage notes, and the website UI kit.",
  other: "Everything else: the bundle, the manifest, source notes.",
};

export const isResourceCategory = (v: unknown): v is ResourceCategory => typeof v === "string" && (RESOURCE_CATEGORIES as readonly string[]).includes(v);

// ── limits (values MUST match the database) ──

export const RESOURCE_BUCKET = "brand-resources";
export const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_RESOURCE_LABEL = "10 MB";
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const NOTE_MAX = 1000;
export const TAGS_MAX = 12;
export const TAG_MAX = 40;
export const SORT_MAX = 9999;
export const VERSION_LABEL_MAX = 40;
export const CHANGE_NOTE_MAX = 300;
/** The longest text file the detail page shows in a code block. Larger ones are download only. */
export const TEXT_PREVIEW_MAX_BYTES = 150_000;
/** The most the "Download all" zip carries before it asks for a category instead. */
export const ZIP_MAX_BYTES = 80 * 1024 * 1024;
/** How long a signed link lives: for opening or downloading a file, and for a thumbnail on the page. */
export const SIGNED_DOWNLOAD_SECONDS = 60;
export const SIGNED_PREVIEW_SECONDS = 300;

// ── file types (the bucket's allowlist, hq_private.brand_mimes()) ──

export const RESOURCE_MIME_TYPES = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "application/pdf",
  "text/css",
  "text/javascript",
  "application/json",
  "text/markdown",
  "text/plain",
  "text/html",
  "application/zip",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
] as const;
export type ResourceMime = (typeof RESOURCE_MIME_TYPES)[number];

/** The type each extension is stored as. The type comes from the NAME, never from the browser. */
const MIME_BY_EXTENSION: Record<string, ResourceMime> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  jsx: "text/plain",
  ts: "text/plain",
  tsx: "text/plain",
  txt: "text/plain",
  json: "application/json",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  zip: "application/zip",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** For the file input's `accept`. */
export const RESOURCE_ACCEPT = Object.keys(MIME_BY_EXTENSION)
  .map((e) => `.${e}`)
  .join(",");

export const ACCEPTED_TYPES_TEXT = "SVG, PNG, JPEG, PDF, CSS, JavaScript, JSON, Markdown, text, HTML, ZIP and font (WOFF, WOFF2, TTF, OTF) files";

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/** The stored type for a file name, or null when the library does not accept that kind of file. */
export function mimeForFile(fileName: string): ResourceMime | null {
  return Object.hasOwn(MIME_BY_EXTENSION, extensionOf(fileName)) ? MIME_BY_EXTENSION[extensionOf(fileName)] : null;
}

export function isResourceMime(v: unknown): v is ResourceMime {
  return typeof v === "string" && (RESOURCE_MIME_TYPES as readonly string[]).includes(v);
}

/** A short word for the kind of file, for the list. */
export function fileKindLabel(fileName: string, mime: string): string {
  const ext = extensionOf(fileName);
  if (fileName.toLowerCase().endsWith(".d.ts")) return "TypeScript types";
  if (ext === "jsx") return "JSX";
  if (ext === "tsx") return "TSX";
  if (ext === "ts") return "TypeScript";
  if (ext === "md" || ext === "markdown") return "Markdown";
  switch (mime) {
    case "image/svg+xml":
      return "SVG";
    case "image/png":
      return "PNG";
    case "image/jpeg":
      return "JPEG";
    case "application/pdf":
      return "PDF";
    case "text/css":
      return "CSS";
    case "text/javascript":
      return "JavaScript";
    case "application/json":
      return "JSON";
    case "text/markdown":
      return "Markdown";
    case "text/html":
      return "HTML";
    case "text/plain":
      return "Text";
    case "application/zip":
      return "ZIP";
    default:
      return mime.startsWith("font/") ? `Font (${ext.toUpperCase()})` : ext.toUpperCase() || "File";
  }
}

/**
 * How the detail page shows a file. `image`: a picture, from a short-lived signed link in an <img> (an uploaded
 * SVG is NEVER put into the page itself). `text`: shown as text in a code block, with a copy button, when it is
 * small enough. `none`: a download only (PDF, ZIP, fonts; HTML is offered as a download and shown only as text).
 */
export type PreviewKind = "image" | "text" | "none";

const TEXT_MIMES: readonly string[] = ["text/css", "text/javascript", "application/json", "text/markdown", "text/plain", "text/html"];

export function previewKind(mime: string): PreviewKind {
  if (mime === "image/svg+xml" || mime === "image/png" || mime === "image/jpeg") return "image";
  if (TEXT_MIMES.includes(mime)) return "text";
  return "none";
}

/** True for files whose content a chat app can be handed as text (svg, css, md, txt, json, js, ts, tsx, jsx, html). */
export function isTextLike(fileName: string, mime: string): boolean {
  if (mime === "image/svg+xml") return true;
  if (TEXT_MIMES.includes(mime)) return true;
  return ["jsx", "ts", "tsx", "js", "mjs", "cjs"].includes(extensionOf(fileName));
}

/** "245 KB", "1.2 MB": for the list. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;
}

// ── upload checks ────────────────────────────────────────────

export type UploadMeta = { fileName: string; sizeBytes: number };

/** A plain-English reason the file cannot be added, or null when it can. */
export function uploadProblem(meta: UploadMeta): string | null {
  const name = meta.fileName.trim();
  if (!name) return "Choose a file to upload.";
  if (name.length > 255) return "That file name is too long. Rename the file and try again.";
  if (mimeForFile(name) === null) return `That kind of file cannot be added. The library takes ${ACCEPTED_TYPES_TEXT}.`;
  if (!Number.isSafeInteger(meta.sizeBytes) || meta.sizeBytes <= 0) return "That file is empty.";
  if (meta.sizeBytes > MAX_RESOURCE_BYTES) return `That file is larger than ${MAX_RESOURCE_LABEL}. Choose a smaller one.`;
  return null;
}

/**
 * A storage-safe version of a file name: 1 to 120 characters of A-Z a-z 0-9 . _ -, no leading dot,
 * extension kept when the name has to be shortened.
 */
export function sanitiseFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  let s = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "");
  if (s.length > 120) {
    const ext = extensionOf(s);
    const keep = ext && ext.length <= 10 ? `.${ext}` : "";
    s = s.slice(0, 120 - keep.length) + keep;
  }
  return s || "file";
}

const UUID_LOWER = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `<resource id>/<object id>-<sanitised name>`: the only shape the bucket policy and the RPCs accept. */
export function buildStoragePath(resourceId: string, objectId: string, fileName: string): string {
  return `${resourceId.toLowerCase()}/${objectId.toLowerCase()}-${sanitiseFileName(fileName)}`;
}

export function isStoragePathFor(resourceId: string, path: string): boolean {
  return new RegExp(`^${resourceId.toLowerCase()}/${UUID_LOWER}-[A-Za-z0-9._-]{1,120}$`).test(path);
}

export const isSha256 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

// ── tags ─────────────────────────────────────────────────────

/** "brand, Logo mark" -> ["brand", "logo mark"]: lower case, single spaces, no duplicates. Problems are reported by the form reader. */
export function parseTags(text: string | null | undefined): { tags: string[]; problem: string | null } {
  const tags: string[] = [];
  for (const raw of (text ?? "").split(/[,\n]/)) {
    const t = raw.replace(/\s+/g, " ").trim().toLowerCase();
    if (!t) continue;
    if (t.length > TAG_MAX || !/^[a-z0-9][a-z0-9 ._:/-]*$/.test(t)) {
      return { tags: [], problem: `Each tag is 1 to ${TAG_MAX} characters: letters, numbers, spaces and - . _ : /` };
    }
    if (!tags.includes(t)) tags.push(t);
  }
  if (tags.length > TAGS_MAX) return { tags: [], problem: `Use at most ${TAGS_MAX} tags.` };
  return { tags, problem: null };
}

// ── forms ────────────────────────────────────────────────────

export type ResourceDetails = {
  title: string;
  category: ResourceCategory;
  description: string | null;
  tags: string[];
  note: string | null;
  sortOrder: number;
};

function readSortOrder(f: FormReader): number {
  const raw = f.text("sort_order", { max: 6 });
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw) || Number(raw) > SORT_MAX) {
    f.errors.sort_order = `Use a whole number from 0 to ${SORT_MAX}.`;
    return 0;
  }
  return Number(raw);
}

function readDetails(f: FormReader): ResourceDetails | null {
  const title = f.requiredText("title", { max: TITLE_MAX, label: "The title" });
  const category = f.oneOf("category", RESOURCE_CATEGORIES, { required: true });
  const description = f.text("description", { max: DESCRIPTION_MAX, label: "The description" });
  const note = f.text("note", { max: NOTE_MAX, label: "The note" });
  const tagText = f.text("tags", { max: 600, label: "The tags" });
  const parsed = parseTags(tagText);
  if (parsed.problem && !f.errors.tags) f.errors.tags = parsed.problem;
  const sortOrder = readSortOrder(f);
  if (!f.ok || !category) return null;
  return { title, category, description, tags: parsed.tags, note, sortOrder };
}

/** Editing a resource's details (not its file). */
export function readUpdateForm(f: FormReader): (ResourceDetails & { id: string }) | null {
  const id = f.uuid("id", { required: true });
  const v = readDetails(f);
  return v && id ? { ...v, id } : null;
}

export type FileDeclaration = { fileName: string; mimeType: ResourceMime; sizeBytes: number; sha256: string };

/** What the browser says about the file it is about to send (step 1) and has sent (step 3). */
function readFile(f: FormReader): FileDeclaration | null {
  const fileName = f.requiredText("file_name", { max: 255, label: "The file name" });
  const sizeText = f.text("size_bytes", { max: 15 });
  const sizeBytes = sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : 0;
  const sha256 = (f.text("sha256", { max: 64 }) ?? "").toLowerCase();
  if (f.ok) {
    const problem = uploadProblem({ fileName, sizeBytes });
    if (problem) f.errors.file = problem;
    else if (!isSha256(sha256)) f.errors.file = "We could not read that file. Choose it again.";
  }
  const mimeType = mimeForFile(fileName);
  if (!f.ok || !mimeType) return null;
  return { fileName, mimeType, sizeBytes, sha256 };
}

/** Step 1 of adding a file: the details and the file the browser is about to send. */
export function readPrepareAddForm(f: FormReader): (ResourceDetails & FileDeclaration) | null {
  const details = readDetails(f);
  const file = readFile(f);
  return details && file ? { ...details, ...file } : null;
}

/** Step 3 of adding a file: the same plus the object the browser uploaded to. */
export function readRegisterAddForm(f: FormReader): (ResourceDetails & FileDeclaration & { resourceId: string; storagePath: string }) | null {
  const v = readPrepareAddForm(f);
  const resourceId = f.uuid("resource_id", { required: true });
  const path = f.text("storage_path", { max: 300 });
  if (v && resourceId && (!path || !isStoragePathFor(resourceId, path))) {
    f.errors.file = "We could not match that upload. Try again.";
    return null;
  }
  return v && resourceId && path ? { ...v, resourceId, storagePath: path } : null;
}

export type ReplaceInput = FileDeclaration & { id: string; versionLabel: string | null; changeNote: string | null };

function readReplace(f: FormReader): ReplaceInput | null {
  const id = f.uuid("id", { required: true });
  const file = readFile(f);
  const versionLabel = f.text("version_label", { max: VERSION_LABEL_MAX, label: "The version label" });
  const changeNote = f.text("change_note", { max: CHANGE_NOTE_MAX, label: "The note" });
  return id && file && f.ok ? { ...file, id, versionLabel, changeNote } : null;
}

/** Step 1 of replacing a file. */
export function readPrepareReplaceForm(f: FormReader): ReplaceInput | null {
  return readReplace(f);
}

/** Step 3 of replacing a file. */
export function readRegisterReplaceForm(f: FormReader): (ReplaceInput & { storagePath: string }) | null {
  const v = readReplace(f);
  const path = f.text("storage_path", { max: 300 });
  if (v && (!path || !isStoragePathFor(v.id, path))) {
    f.errors.file = "We could not match that upload. Try again.";
    return null;
  }
  return v && path ? { ...v, storagePath: path } : null;
}

// ── the list page's search ───────────────────────────────────

export type ResourceListQuery = { q: string; category: ResourceCategory | null; filtered: boolean };

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseResourceListQuery(sp: Params): ResourceListQuery {
  const q = first(sp.q).trim().slice(0, 100);
  const c = first(sp.category).trim();
  const category = isResourceCategory(c) ? c : null;
  return { q, category, filtered: q !== "" || category !== null };
}

/** Does a resource match the words in the search box (title, file name, description, tags, ref)? */
export function matchesSearch(r: { title: string; fileName: string; description: string | null; tags: readonly string[]; ref: string }, q: string): boolean {
  const words = q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  const hay = [r.title, r.fileName, r.description ?? "", r.ref, ...r.tags].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The zip a person gets: all of the library, or one category. */
export function zipFileName(category: ResourceCategory | null, today: string): string {
  return `PLANTED-brand-resources-${category ? category.replace(/_/g, "-") : "all"}-${today}.zip`;
}

// ── database messages ────────────────────────────────────────

export type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

const sentence = (m: string) => {
  const t = m.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
};

export const GENERIC_RESOURCE_ERROR = "Something went wrong and nothing was saved. Try again in a moment.";
export const FORBIDDEN_RESOURCE = "You don't have permission to do that.";
export const RESOURCE_NOT_FOUND = "That resource could not be found. It may have been archived.";

/** A failure from the resource RPCs, in words a person can act on. The database's own messages are plain English. */
export function resourceErrorMessage(error: DbError): string {
  const code = error?.code ?? "";
  if (code === "42501") return FORBIDDEN_RESOURCE;
  if (code === "P0002" || code === "PGRST116") return error?.message?.includes("uploaded file") ? "The file was uploaded but could not be found. Try again." : RESOURCE_NOT_FOUND;
  if (code === "23505") return "That file is already in the library.";
  if ((code === "22023" || code === "23514") && error?.message) return sentence(error.message);
  return GENERIC_RESOURCE_ERROR;
}

// ── the RES number ───────────────────────────────────────────

/** "RES-0007" (or "res 7") -> 7; null for anything else. */
export function parseResourceRef(text: string): number | null {
  const m = /^RES[-\s]?0*(\d{1,9})$/i.exec(text.trim());
  return m ? Number(m[1]) : null;
}

/** 7 -> "RES-0007" (the database's own format, hq.brand_resource_overview.ref). */
export function resourceRef(n: number): string {
  return `RES-${String(n).padStart(Math.max(4, String(n).length), "0")}`;
}
