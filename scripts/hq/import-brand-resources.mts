/*
 * Imports the "PLANTED. Design System" folder into the Resources library (docs/hq-resources.md).
 *
 *   node --env-file=.env.local scripts/hq/import-brand-resources.mts "<folder>" [--target local|live] [--dry-run] [--as <staff email>] [--confirm]
 *
 *   --target local   (the default) the local Supabase stack only: refuses any other host.
 *   --target live    the hosted project named by NEXT_PUBLIC_SUPABASE_URL, with SUPABASE_SECRET_KEY, both read
 *                    from the environment. Refuses a local host, needs --as <the email of an active director or
 *                    administrator>, and for a real (not --dry-run) import also --confirm.
 *   --dry-run        prints what would be added, replaced or left alone, and changes nothing.
 *   --as <email>     the member of staff the import acts for (audit trail: "Imported ... by <name>"). Local
 *                    default: shannon@planted.test (the seeded director).
 *
 * What it does: maps the folder to the library's categories (lib/hq/resources/import-map.ts), uploads each
 * file to the private bucket brand-resources and registers it through the service-role function
 * hq.import_brand_resource, which acts for the named person and applies every library rule (type allowlist,
 * 10 MiB, one title, no duplicate content in a category) and writes the audit trail.
 *
 * IDEMPOTENT: a file whose content is already in the library (same category, same SHA-256) is left alone; a
 * file whose title exists but whose content changed becomes a NEW VERSION of that resource (the old file is
 * kept); anything else is added. Running it twice adds nothing. A resource whose title was edited in HQ is not
 * found by title: its unchanged file is still recognised by content, a changed one would be added as a new
 * resource.
 *
 * It also creates "Voice and wording (current)" from section 11 of docs/brand-design-system.md, and sets a
 * note on the older voice material (it imports those files untouched).
 *
 * The secret key is used here and nowhere in the app: it is read from the environment, never imported from
 * lib/supabase/secret.ts, and never printed. The folder's files are only read.
 */
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

await import("./ts-hooks.mts");
const { createZip } = (await import("../../lib/hq/resources/zip.ts")) as typeof import("../../lib/hq/resources/zip");
const { planImport, buildVoiceDocument, VOICE_ENTRY } = (await import("../../lib/hq/resources/import-map.ts")) as typeof import("../../lib/hq/resources/import-map");
const { RESOURCE_BUCKET, RESOURCE_CATEGORIES, RESOURCE_CATEGORY_LABEL, MAX_RESOURCE_BYTES, buildStoragePath } = (await import("../../lib/hq/resources/rules.ts")) as typeof import("../../lib/hq/resources/rules");

type Entry = import("../../lib/hq/resources/import-map").ImportEntry;

// ── arguments ────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--target", "--as"].includes(args[i - 1] ?? ""));

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

const folder = positional[0];
if (!folder) stop('Usage: node --env-file=.env.local scripts/hq/import-brand-resources.mts "<folder>" [--target local|live] [--dry-run] [--as <staff email>] [--confirm]');
const target = value("--target") ?? "local";
if (target !== "local" && target !== "live") stop('--target must be "local" or "live".');
const dryRun = flag("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) stop("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (run with --env-file=.env.local for the local stack).");
const host = new URL(url).hostname;
const isLocalHost = ["127.0.0.1", "localhost"].includes(host);
if (target === "local" && !isLocalHost) stop(`--target local, but the environment points at ${host}. Refusing: that is not the local stack. (Use --target live deliberately for a hosted project.)`);
if (target === "live" && isLocalHost) stop(`--target live, but the environment points at ${host}, the local stack. Use --target local.`);
const actorEmail = (value("--as") ?? (target === "local" ? "shannon@planted.test" : "")).trim().toLowerCase();
if (!actorEmail) stop("--target live needs --as <the email of an active director or administrator>: the import is recorded in the audit trail as that person.");
if (target === "live" && !dryRun && !flag("--confirm")) stop(`This would change the HOSTED project ${host}. Re-run with --confirm to do it, or with --dry-run to see the plan first.`);

const root = path.resolve(folder);
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) stop(`${root} is not a folder.`);

// ── read the folder ──────────────────────────────────────────

function walk(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    return d.isDirectory() ? walk(path.join(dir, d.name), rel) : [rel];
  });
}

const texts = new Map<string, string>();
const readText = (rel: string): string | null => {
  if (!texts.has(rel)) {
    try {
      texts.set(rel, readFileSync(path.join(root, rel), "utf8"));
    } catch {
      return null;
    }
  }
  return texts.get(rel) ?? null;
};

const plan = planImport(walk(root), readText);

// The current voice document, from the repository's own design doc (as it reads now).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const designDoc = readFileSync(path.join(repoRoot, "docs/brand-design-system.md"), "utf8");
const voiceText = buildVoiceDocument(designDoc);
if (!voiceText) stop("docs/brand-design-system.md has no section 11 (Brand voice): the current voice document cannot be built.");

type Item = { entry: Entry; bytes: Buffer; sha: string; source: string };
const items: Item[] = [];
for (const e of plan.entries) {
  // A bundle is zipped here, the same way every run (sorted names, one fixed date), so an unchanged kit has an unchanged hash.
  const bytes = e.bundle
    ? Buffer.from(createZip(e.bundle.map((rel) => ({ name: rel, data: readFileSync(path.join(root, rel)), modified: new Date(2026, 0, 1, 0, 0, 0) }))))
    : readFileSync(path.join(root, e.path));
  items.push({ entry: e, bytes, sha: createHash("sha256").update(bytes).digest("hex"), source: e.bundle ? `${e.bundle.length} files zipped` : e.path });
}
{
  const bytes = Buffer.from(voiceText, "utf8");
  items.push({ entry: { ...VOICE_ENTRY, path: "docs/brand-design-system.md#11" }, bytes, sha: createHash("sha256").update(bytes).digest("hex"), source: "docs/brand-design-system.md (section 11)" });
}

// ── what the library has now ─────────────────────────────────

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const hq = admin.schema("hq");

const staff = await hq.from("staff_profiles").select("id, full_name, role, is_active").eq("email", actorEmail).maybeSingle();
if (staff.error) stop(`Could not read hq.staff_profiles (${staff.error.code}). Are the migrations applied?`);
if (!staff.data || !staff.data.is_active) stop(`No active member of staff has the email ${actorEmail}.`);
const actorId = staff.data.id;

const live = await hq.from("brand_resources").select("id, ref_number, title, category, content_sha256, version").is("deleted_at", null);
if (live.error) stop(`Could not read hq.brand_resources (${live.error.code}). Are migrations 0151 to 0153 applied?`);
const byTitle = new Map((live.data ?? []).map((r) => [r.title.trim().toLowerCase(), r]));
const byContent = new Map((live.data ?? []).map((r) => [`${r.category}|${r.content_sha256}`, r]));
const refOf = (n: number) => `RES-${String(n).padStart(4, "0")}`;

// ── check the plan before touching anything ──────────────────

const problems: string[] = [];
const seenTitles = new Set<string>();
for (const it of items) {
  const key = it.entry.title.trim().toLowerCase();
  if (seenTitles.has(key)) problems.push(`two files would have the title "${it.entry.title}" (${it.source})`);
  seenTitles.add(key);
  if (it.bytes.length === 0) problems.push(`${it.source} is empty`);
  if (it.bytes.length > MAX_RESOURCE_BYTES) problems.push(`${it.source} is larger than 10 MiB`);
  if (it.entry.title.length > 200) problems.push(`the title of ${it.source} is over 200 characters`);
}
if (problems.length) stop(`The folder cannot be imported as it is:\n- ${problems.join("\n- ")}`);

type Action = "new" | "version" | "unchanged" | "duplicate";
function decide(it: Item): { action: Action; existing?: { id: string; ref: string; title: string } } {
  const same = byContent.get(`${it.entry.category}|${it.sha}`);
  const titled = byTitle.get(it.entry.title.trim().toLowerCase());
  if (same && titled && same.id === titled.id) return { action: "unchanged", existing: { id: same.id, ref: refOf(same.ref_number), title: same.title } };
  if (same) return { action: "duplicate", existing: { id: same.id, ref: refOf(same.ref_number), title: same.title } };
  if (titled) return { action: "version", existing: { id: titled.id, ref: refOf(titled.ref_number), title: titled.title } };
  return { action: "new" };
}

console.log(`Folder:  ${root}`);
console.log(`Project: ${host}${isLocalHost ? "  (local development stack)" : "  (HOSTED)"}`);
console.log(`Acting as: ${staff.data.full_name} <${actorEmail}> (${staff.data.role})`);
console.log(`Files: ${plan.entries.length} from the folder + the generated voice document; ${plan.skipped.length} skipped${plan.unmapped.length ? `; ${plan.unmapped.length} not in the map (imported under Other)` : ""}.`);
for (const s of plan.skipped) console.log(`  skipped  ${s.path} (${s.reason})`);
for (const p of plan.unmapped) console.log(`  unmapped ${p}`);
console.log(dryRun ? "\nDRY RUN: nothing will be changed.\n" : "");

// ── do it ────────────────────────────────────────────────────

type Tally = { files: number; new: number; version: number; unchanged: number; duplicate: number; failed: number };
const tally = new Map<string, Tally>(RESOURCE_CATEGORIES.map((c) => [c, { files: 0, new: 0, version: 0, unchanged: 0, duplicate: 0, failed: 0 }]));
const failures: string[] = [];

for (const it of items) {
  const t = tally.get(it.entry.category)!;
  t.files += 1;
  const d = decide(it);
  const label = `${it.entry.category.padEnd(12)} ${it.entry.title}`;
  if (d.action === "unchanged" || d.action === "duplicate") {
    t[d.action] += 1;
    console.log(`${d.action === "unchanged" ? "unchanged" : "duplicate"}  ${label}${d.action === "duplicate" ? ` (same content as ${d.existing!.ref} "${d.existing!.title}")` : ""}`);
    continue;
  }
  if (dryRun) {
    t[d.action] += 1;
    console.log(`${d.action === "new" ? "would add " : "would add a new version of"} ${label}${d.existing ? ` (${d.existing.ref})` : ""}`);
    continue;
  }

  // 1. the object, in a new <resource id>/<object id>-<name> path (a replacement keeps the old object)
  const resourceId = d.action === "version" ? d.existing!.id : randomUUID();
  const storagePath = buildStoragePath(resourceId, randomUUID(), it.entry.fileName);
  const up = await admin.storage.from(RESOURCE_BUCKET).upload(storagePath, it.bytes, { contentType: it.entry.mime, upsert: false });
  if (up.error) {
    t.failed += 1;
    failures.push(`${it.source}: the upload failed (${up.error.message})`);
    console.log(`FAILED     ${label}: the upload failed`);
    continue;
  }
  // 2. the row (or the new version), through the library's own function
  const res = await hq.rpc("import_brand_resource", {
    p_actor: actorId,
    p_resource: d.action === "version" ? resourceId : null,
    p_title: it.entry.title,
    p_category: it.entry.category,
    p_description: it.entry.description ?? "",
    p_file_name: it.entry.fileName,
    p_storage_path: storagePath,
    p_mime_type: it.entry.mime,
    p_size_bytes: it.bytes.length,
    p_content_sha256: it.sha,
    p_tags: it.entry.tags,
    p_note: it.entry.note ?? "",
    p_sort_order: it.entry.sortOrder,
    p_change_note: d.action === "version" ? "Changed in the source folder" : undefined,
  });
  if (res.error) {
    t.failed += 1;
    failures.push(`${it.source}: ${res.error.message}`);
    console.log(`FAILED     ${label}: ${res.error.message}`);
    continue;
  }
  const out = res.data as { ref?: string; version?: string };
  t[d.action] += 1;
  console.log(`${d.action === "new" ? "added    " : "new version"} ${label} -> ${out.ref ?? ""} ${out.version ?? ""}`);
}

// ── summary ──────────────────────────────────────────────────

console.log(`\n${dryRun ? "Plan" : "Result"} by category`);
console.log("category".padEnd(16) + "files".padStart(6) + (dryRun ? "would add".padStart(11) : "added".padStart(8)) + "new version".padStart(13) + "unchanged".padStart(11) + "duplicate".padStart(11) + "failed".padStart(8));
const sum: Tally = { files: 0, new: 0, version: 0, unchanged: 0, duplicate: 0, failed: 0 };
for (const c of RESOURCE_CATEGORIES) {
  const t = tally.get(c)!;
  if (t.files === 0) continue;
  console.log(RESOURCE_CATEGORY_LABEL[c].padEnd(16) + String(t.files).padStart(6) + String(t.new).padStart(dryRun ? 11 : 8) + String(t.version).padStart(13) + String(t.unchanged).padStart(11) + String(t.duplicate).padStart(11) + String(t.failed).padStart(8));
  for (const k of Object.keys(sum) as Array<keyof Tally>) sum[k] += t[k];
}
console.log("Total".padEnd(16) + String(sum.files).padStart(6) + String(sum.new).padStart(dryRun ? 11 : 8) + String(sum.version).padStart(13) + String(sum.unchanged).padStart(11) + String(sum.duplicate).padStart(11) + String(sum.failed).padStart(8));
if (failures.length) {
  console.error(`\n${failures.length} file(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
