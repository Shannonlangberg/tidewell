// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FormReader } from "../forms.ts";
import { CAPABILITIES } from "../constants.ts";
import {
  CHANGE_NOTE_MAX,
  DESCRIPTION_MAX,
  MAX_RESOURCE_BYTES,
  NOTE_MAX,
  RESOURCE_ACCEPT,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_BLURB,
  RESOURCE_CATEGORY_LABEL,
  RESOURCE_MIME_TYPES,
  SORT_MAX,
  TAGS_MAX,
  TAG_MAX,
  TITLE_MAX,
  VERSION_LABEL_MAX,
  buildStoragePath,
  extensionOf,
  fileKindLabel,
  formatBytes,
  isStoragePathFor,
  isTextLike,
  matchesSearch,
  mimeForFile,
  parseResourceListQuery,
  parseResourceRef,
  parseTags,
  previewKind,
  readPrepareAddForm,
  readPrepareReplaceForm,
  readRegisterAddForm,
  readRegisterReplaceForm,
  readUpdateForm,
  resourceErrorMessage,
  resourceRef,
  sanitiseFileName,
  uploadProblem,
  zipFileName,
} from "./rules.ts";

/* The resource rules mirror migrations 0151 and 0152; the vocabulary and the limits are pinned to the migration's own text. */

const M151 = readFileSync(new URL("../../../supabase/migrations/0151_hq_brand_resources.sql", import.meta.url), "utf8");
const M152 = readFileSync(new URL("../../../supabase/migrations/0152_hq_brand_resources_rpc.sql", import.meta.url), "utf8");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return new FormReader(f);
};
const UUID_A = "6b0c1f2e-0000-4000-8000-000000000001";
const UUID_B = "6b0c1f2e-0000-4000-8000-000000000002";
const SHA = "a".repeat(64);

test("the categories match hq.brand_resource_category", () => {
  const m = /create type hq\.brand_resource_category as enum \(([^)]*)\)/.exec(M151);
  assert.ok(m);
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), [...RESOURCE_CATEGORIES]);
  for (const c of RESOURCE_CATEGORIES) {
    assert.ok(RESOURCE_CATEGORY_LABEL[c] && RESOURCE_CATEGORY_BLURB[c], c);
    assert.doesNotMatch(RESOURCE_CATEGORY_LABEL[c], /_/);
  }
});

test("the accepted file types match the bucket's allowlist (hq_private.brand_mimes)", () => {
  const m = /create function hq_private\.brand_mimes\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(M151);
  assert.ok(m);
  assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [...RESOURCE_MIME_TYPES]);
});

test("the limits match the database", () => {
  assert.equal(MAX_RESOURCE_BYTES, 10485760);
  assert.match(M151, /file_size_limit[\s\S]*10485760/);
  assert.match(M151, /char_length\(btrim\(title\)\) between 1 and 200/);
  assert.equal(TITLE_MAX, 200);
  assert.match(M151, /char_length\(description\) <= 2000/);
  assert.equal(DESCRIPTION_MAX, 2000);
  assert.match(M151, /char_length\(btrim\(note\)\) between 1 and 1000/);
  assert.equal(NOTE_MAX, 1000);
  assert.match(M151, /cardinality\(tags\) <= 12/);
  assert.equal(TAGS_MAX, 12);
  assert.match(M151, /\{0,39\}/);
  assert.equal(TAG_MAX, 40);
  assert.match(M151, /sort_order between 0 and 9999/);
  assert.equal(SORT_MAX, 9999);
  assert.match(M151, /char_length\(btrim\(version\)\) between 1 and 40/);
  assert.equal(VERSION_LABEL_MAX, 40);
  assert.match(M152, /brand_line\(p_change_note, 300/);
  assert.equal(CHANGE_NOTE_MAX, 300);
});

test("the capabilities are in the constants and the migration gives read to all eight roles and manage to two", () => {
  assert.ok(CAPABILITIES.includes("resources.read") && CAPABILITIES.includes("resources.manage"));
  const rows = [...M151.matchAll(/\('([a-z_]+)', 'resources\.(read|manage)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
  const roles = ["director", "administrator", "senior_property_manager", "property_manager", "junior_property_manager", "business_development_manager", "virtual_assistant", "read_only"];
  for (const r of roles) assert.ok(rows.includes(`${r}:read`), `${r} reads`);
  assert.deepEqual(rows.filter((r) => r.endsWith(":manage")).sort(), ["administrator:manage", "director:manage"]);
  assert.equal(rows.length, 10);
});

test("a file's type comes from its name", () => {
  assert.equal(mimeForFile("logo.SVG"), "image/svg+xml");
  assert.equal(mimeForFile("photo.jpg"), "image/jpeg");
  assert.equal(mimeForFile("photo.jpeg"), "image/jpeg");
  assert.equal(mimeForFile("a.d.ts"), "text/plain");
  assert.equal(mimeForFile("Button.jsx"), "text/plain");
  assert.equal(mimeForFile("x.md"), "text/markdown");
  assert.equal(mimeForFile("x.woff2"), "font/woff2");
  assert.equal(mimeForFile("setup.exe"), null);
  assert.equal(mimeForFile("noextension"), null);
  assert.equal(mimeForFile("toString"), null, "an inherited key is not an extension");
  assert.equal(extensionOf("Brand Guidelines.html"), "html");
  // every extension maps to a type the bucket accepts
  for (const ext of RESOURCE_ACCEPT.split(",")) assert.ok((RESOURCE_MIME_TYPES as readonly string[]).includes(mimeForFile(`f${ext}`) ?? ""), ext);
});

test("which files show as a picture, as text, or only download", () => {
  assert.equal(previewKind("image/svg+xml"), "image");
  assert.equal(previewKind("image/png"), "image");
  assert.equal(previewKind("text/css"), "text");
  assert.equal(previewKind("text/html"), "text");
  assert.equal(previewKind("application/pdf"), "none");
  assert.equal(previewKind("application/zip"), "none");
  assert.equal(previewKind("font/woff2"), "none");
  assert.equal(isTextLike("a.svg", "image/svg+xml"), true);
  assert.equal(isTextLike("Button.jsx", "text/plain"), true);
  assert.equal(isTextLike("a.png", "image/png"), false);
  assert.equal(isTextLike("a.pdf", "application/pdf"), false);
  assert.equal(fileKindLabel("Button.d.ts", "text/plain"), "TypeScript types");
  assert.equal(fileKindLabel("a.woff2", "font/woff2"), "Font (WOFF2)");
});

test("upload checks give plain reasons", () => {
  assert.equal(uploadProblem({ fileName: "logo.svg", sizeBytes: 1000 }), null);
  assert.equal(uploadProblem({ fileName: "", sizeBytes: 1000 }), "Choose a file to upload.");
  assert.match(uploadProblem({ fileName: "setup.exe", sizeBytes: 1000 }) ?? "", /cannot be added/);
  assert.equal(uploadProblem({ fileName: "a.svg", sizeBytes: 0 }), "That file is empty.");
  assert.match(uploadProblem({ fileName: "a.svg", sizeBytes: MAX_RESOURCE_BYTES + 1 }) ?? "", /larger than 10 MB/);
  assert.equal(uploadProblem({ fileName: "a.svg", sizeBytes: MAX_RESOURCE_BYTES }), null, "exactly 10 MiB is accepted");
  assert.match(uploadProblem({ fileName: `${"a".repeat(260)}.svg`, sizeBytes: 5 }) ?? "", /too long/);
});

test("storage-safe names and the only path shape the bucket accepts", () => {
  assert.equal(sanitiseFileName("Brand Guidelines.html"), "Brand-Guidelines.html");
  assert.equal(sanitiseFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitiseFileName("café logo.svg"), "cafe-logo.svg");
  assert.equal(sanitiseFileName("..."), "file");
  assert.ok(sanitiseFileName(`${"x".repeat(200)}.svg`).length <= 120);
  assert.ok(sanitiseFileName(`${"x".repeat(200)}.svg`).endsWith(".svg"));
  const p = buildStoragePath(UUID_A.toUpperCase(), UUID_B, "Brand Guidelines.html");
  assert.equal(p, `${UUID_A}/${UUID_B}-Brand-Guidelines.html`);
  assert.equal(isStoragePathFor(UUID_A, p), true);
  assert.equal(isStoragePathFor(UUID_B, p), false, "another resource's id");
  assert.equal(isStoragePathFor(UUID_A, `${UUID_A}/notes.pdf`), false);
  assert.equal(isStoragePathFor(UUID_A, `${UUID_A}/${UUID_B}-bad name.pdf`), false);
  // the same shape the database and the bucket policy use
  assert.match(M151, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}-\[A-Za-z0-9\._-\]\{1,120\}\$/);
});

test("tags are tidied and checked", () => {
  assert.deepEqual(parseTags("Brand, logo  mark,brand").tags, ["brand", "logo mark"]);
  assert.deepEqual(parseTags("").tags, []);
  assert.deepEqual(parseTags(null).tags, []);
  assert.ok(parseTags("bad!tag").problem);
  assert.ok(parseTags("x".repeat(41)).problem);
  assert.equal(parseTags("x".repeat(40)).problem, null);
  assert.equal(parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`).join(",")).problem, null);
  assert.ok(parseTags(Array.from({ length: 13 }, (_, i) => `t${i}`).join(",")).problem);
  assert.deepEqual(parseTags("on dark, png export, unadopted alternative direction").tags, ["on dark", "png export", "unadopted alternative direction"]);
});

test("the add form: details and the file, validated on the server", () => {
  const ok = { title: "Wordmark", category: "logos", description: "d", tags: "a, b", note: "", file_name: "w.svg", size_bytes: "1000", sha256: SHA };
  const v = readPrepareAddForm(form(ok));
  assert.ok(v);
  assert.equal(v.mimeType, "image/svg+xml");
  assert.deepEqual(v.tags, ["a", "b"]);
  assert.equal(v.note, null);
  assert.equal(v.sortOrder, 0);
  for (const bad of [{ title: "" }, { category: "nope" }, { category: "" }, { file_name: "x.exe" }, { size_bytes: "0" }, { size_bytes: "99999999" }, { sha256: "xyz" }, { tags: "bad!" }, { note: "n".repeat(NOTE_MAX + 1) }, { title: "t".repeat(TITLE_MAX + 1) }]) {
    const f = form({ ...ok, ...bad });
    assert.equal(readPrepareAddForm(f), null, JSON.stringify(bad));
    assert.ok(Object.keys(f.errors).length > 0);
  }
  // registering also needs the resource id and an object under it
  const reg = { ...ok, resource_id: UUID_A, storage_path: `${UUID_A}/${UUID_B}-w.svg` };
  assert.ok(readRegisterAddForm(form(reg)));
  assert.equal(readRegisterAddForm(form({ ...reg, storage_path: `${UUID_B}/${UUID_B}-w.svg` })), null, "an object under another resource");
  assert.equal(readRegisterAddForm(form({ ...reg, storage_path: "" })), null);
  assert.equal(readRegisterAddForm(form({ ...reg, resource_id: "nope" })), null);
});

test("the update form: the whole editable set", () => {
  const ok = { id: UUID_A, title: "T", category: "tokens", description: "", tags: "", note: "", sort_order: "7" };
  const v = readUpdateForm(form(ok));
  assert.ok(v);
  assert.equal(v.sortOrder, 7);
  assert.equal(v.description, null);
  assert.equal(readUpdateForm(form({ ...ok, sort_order: "10000" })), null);
  assert.equal(readUpdateForm(form({ ...ok, sort_order: "-1" })), null);
  assert.equal(readUpdateForm(form({ ...ok, sort_order: "x" })), null);
  assert.equal(readUpdateForm(form({ ...ok, id: "nope" })), null);
  assert.equal(readUpdateForm(form({ ...ok, description: "d".repeat(DESCRIPTION_MAX + 1) })), null);
  assert.equal(readUpdateForm(form({ ...ok, sort_order: "" }))?.sortOrder, 0);
});

test("the replace form: the new file, an optional label and note", () => {
  const ok = { id: UUID_A, file_name: "w2.svg", size_bytes: "10", sha256: SHA, version_label: "", change_note: "" };
  const v = readPrepareReplaceForm(form(ok));
  assert.ok(v);
  assert.equal(v.versionLabel, null);
  assert.equal(readPrepareReplaceForm(form({ ...ok, version_label: "v".repeat(VERSION_LABEL_MAX + 1) })), null);
  assert.equal(readPrepareReplaceForm(form({ ...ok, change_note: "c".repeat(CHANGE_NOTE_MAX + 1) })), null);
  const reg = { ...ok, storage_path: `${UUID_A}/${UUID_B}-w2.svg` };
  assert.ok(readRegisterReplaceForm(form(reg)));
  assert.equal(readRegisterReplaceForm(form({ ...reg, storage_path: `${UUID_B}/${UUID_B}-w2.svg` })), null);
});

test("the list query and the search", () => {
  assert.deepEqual(parseResourceListQuery({}), { q: "", category: null, filtered: false });
  assert.deepEqual(parseResourceListQuery({ q: " logo ", category: "logos" }), { q: "logo", category: "logos", filtered: true });
  assert.equal(parseResourceListQuery({ category: "nope" }).category, null);
  const r = { title: "Primary lockup, forest", fileName: "planted-lockup-forest.svg", description: "For ivory", tags: ["logo", "on light"], ref: "RES-0007" };
  assert.equal(matchesSearch(r, ""), true);
  assert.equal(matchesSearch(r, "lockup forest"), true);
  assert.equal(matchesSearch(r, "PLANTED-LOCKUP"), true);
  assert.equal(matchesSearch(r, "on light"), true);
  assert.equal(matchesSearch(r, "res-0007"), true);
  assert.equal(matchesSearch(r, "ivory lime"), false);
});

test("RES numbers", () => {
  assert.equal(parseResourceRef("RES-0007"), 7);
  assert.equal(parseResourceRef("res 7"), 7);
  assert.equal(parseResourceRef("RES-12345"), 12345);
  assert.equal(parseResourceRef("RES-"), null);
  assert.equal(parseResourceRef("KB-0007"), null);
  assert.equal(parseResourceRef("Primary lockup"), null);
  assert.equal(resourceRef(7), "RES-0007");
  assert.equal(resourceRef(12345), "RES-12345");
  assert.match(M151, /'RES-' \|\| lpad\(r\.ref_number::text, greatest\(4/);
});

test("sizes, zip names and database messages read plainly", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(1_258_291), "1.2 MB");
  assert.equal(zipFileName(null, "2026-10-21"), "PLANTED-brand-resources-all-2026-10-21.zip");
  assert.equal(zipFileName("colours_type", "2026-10-21"), "PLANTED-brand-resources-colours-type-2026-10-21.zip");
  assert.equal(resourceErrorMessage({ code: "42501" }), "You don't have permission to do that.");
  assert.equal(resourceErrorMessage({ code: "P0002", message: "resource not found" }), "That resource could not be found. It may have been archived.");
  assert.equal(resourceErrorMessage({ code: "23514", message: "another resource already has that title" }), "Another resource already has that title.");
  assert.equal(resourceErrorMessage({ code: "22023", message: "a file must be larger than 0 bytes and at most 10 MiB" }), "A file must be larger than 0 bytes and at most 10 MiB.");
  assert.match(resourceErrorMessage({ code: "XX000", message: "secret internals" }), /Something went wrong/);
  assert.doesNotMatch(resourceErrorMessage({ code: "XX000", message: "secret internals" }), /secret/);
});
