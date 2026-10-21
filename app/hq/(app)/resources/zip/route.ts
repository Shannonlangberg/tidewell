import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { listResources, readObject } from "@/lib/hq/resources/queries";
import {
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_LABEL,
  ZIP_MAX_BYTES,
  formatBytes,
  isResourceCategory,
  zipFileName,
} from "@/lib/hq/resources/rules";
import { createZip, uniqueZipNames, type ZipEntry } from "@/lib/hq/resources/zip";

/*
 * The brand library as one zip: GET /hq/resources/zip for everything, or ?category=logos for one category.
 *
 * Built here, as the signed-in person: requireStaff("resources.read"), the list is read under row level
 * security (live resources only, whatever this person may see), and every file is read from the private
 * bucket with THEIR session (the bucket's policy applies again). Only each resource's CURRENT file goes in,
 * in a folder per category, with an INDEX.txt naming each file's title, number, version and any note.
 *
 * The library is a few megabytes, so the archive is built in memory and sent whole (stored, not compressed:
 * lib/hq/resources/zip.ts). A library that grows past 80 MB is refused with a plain message that points at
 * the per-category zip. Nothing is cached; nothing is logged but an error code.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const plain = (body: string, status: number) => new Response(body, { status, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

/** Runs `fn` over the items with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(request: Request) {
  const { db, staff } = await requireStaff("resources.read");
  const raw = new URL(request.url).searchParams.get("category");
  if (raw !== null && raw !== "" && !isResourceCategory(raw)) return plain("That category does not exist.", 404);
  const category = raw && isResourceCategory(raw) ? raw : null;

  const list = await listResources(db, { category });
  if (!list.ok) return plain("We could not build the download. Try again in a moment.", 500);
  const rows = list.data;
  if (rows.length === 0) return plain("There is nothing to download yet.", 404);
  const total = rows.reduce((n, r) => n + r.sizeBytes, 0);
  if (total > ZIP_MAX_BYTES) {
    return plain(`The library is ${formatBytes(total)}, too large for one download. Download it one category at a time.`, 413);
  }

  const bytes = await mapLimit(rows, 8, (r) => readObject(db, r.storagePath));
  if (bytes.some((b) => b === null)) return plain("We could not read every file. Try again in a moment.", 500);

  const names = uniqueZipNames(rows.map((r) => `${RESOURCE_CATEGORY_LABEL[r.category]}/${r.fileName}`));
  const entries: ZipEntry[] = rows.map((r, i) => ({ name: names[i], data: bytes[i] as Uint8Array, modified: new Date(r.updatedAt) }));

  const today = todayIn(staff.timezone);
  const index = [
    `PLANTED. brand resources${category ? `: ${RESOURCE_CATEGORY_LABEL[category]}` : ""}`,
    `Downloaded ${today} from Planted HQ. ${rows.length} file${rows.length === 1 ? "" : "s"}.`,
    "",
    ...RESOURCE_CATEGORIES.filter((c) => rows.some((r) => r.category === c)).flatMap((c) => [
      RESOURCE_CATEGORY_LABEL[c],
      ...rows
        .map((r, i) => ({ r, name: names[i] }))
        .filter((x) => x.r.category === c)
        .flatMap(({ r, name }) => [`  ${name}`, `    ${r.ref} ${r.title}, ${r.version}${r.note ? `\n    Note: ${r.note.replace(/\s+/g, " ")}` : ""}`]),
      "",
    ]),
  ].join("\n");
  entries.push({ name: "INDEX.txt", data: new TextEncoder().encode(index), modified: new Date() });

  const zip = createZip(entries);
  const fileName = zipFileName(category, today);
  return new Response(zip as BodyInit, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/zip",
      "Content-Length": String(zip.length),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
