"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, PARTNER_CATEGORIES } from "@/lib/hq/constants";
import { FormReader, fail } from "@/lib/hq/forms";
import { IMPORT_LIMITS, IMPORT_MAX_BYTES, parseImportText } from "@/lib/hq/import/parse";
import { applyImport, buildReview, fromPayload, prepare } from "@/lib/hq/import/review";
import type { ImportState } from "@/lib/hq/import/types";

/*
 * The partner import. ONE Server Action drives the whole flow, switching on `intent`, so the
 * screen can keep a single result (a review, then an outcome):
 *
 *   upload    read a JSON or CSV file, validate it, and show a review        (import.run)
 *   research  the same, for the research leads bundled with HQ               (import.run)
 *   review    re-check the review after the person changed a choice          (import.run)
 *   apply     write what the review showed, in one transaction               (import.run)
 *
 * Nothing is written until `apply`. Preview and apply call the same classifier in the
 * database, so the review is exactly what apply does. The file is parsed on the server; the
 * rows that travel between steps are validated again every time.
 */

const CONTACTS = `${HQ_BASE}/growth/contacts`;
const ORGANISATIONS = `${HQ_BASE}/growth/organisations`;

/** The bundled research leads. A fixed path: nothing from the request ever reaches it. */
const RESEARCH_FILE = path.join(process.cwd(), "hq", "seed", "referral-contacts.json");
const RESEARCH_FILE_LABEL = "referral-contacts.json";

const KNOWN_INTENTS = ["upload", "research", "review", "apply"] as const;

function describe(source: string | null, fallback: string): string {
  const s = (source ?? "").trim().slice(0, IMPORT_LIMITS.source);
  return s || fallback.slice(0, IMPORT_LIMITS.source);
}

/** A file name safe to store and show: no path, bounded. */
function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 200);
}

/** The line numbers ticked "import as a separate person". Anything that is not a whole number is ignored. */
function distinctLines(formData: FormData): Set<number> {
  const out = new Set<number>();
  for (const v of formData.getAll("distinct")) {
    if (typeof v === "string" && /^\d{1,6}$/.test(v)) out.add(Number(v));
  }
  return out;
}

export async function importAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { db } = await requireStaff("import.run");
  const f = new FormReader(formData);
  const intent = f.oneOf("intent", KNOWN_INTENTS, { required: true });
  if (!intent) return fail("That request was not understood.");

  // ── a new file, or the bundled research leads ──
  if (intent === "upload" || intent === "research") {
    let text: string;
    let fileName: string;
    let origin: "file" | "research";

    if (intent === "research") {
      try {
        text = await readFile(RESEARCH_FILE, "utf8");
      } catch (e) {
        console.error("[hq] research leads file could not be read:", e instanceof Error ? e.name : "error");
        return fail("The research leads file could not be read.");
      }
      fileName = RESEARCH_FILE_LABEL;
      origin = "research";
    } else {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return fail("Choose a file to import.", { file: "Choose a .json or .csv file." });
      if (file.size > IMPORT_MAX_BYTES) return fail("That file is too large.", { file: "That file is larger than 1 MB." });
      fileName = cleanFileName(file.name);
      if (!/\.(json|csv)$/i.test(fileName)) return fail("That file type is not supported.", { file: "Upload a .json or .csv file." });
      text = await file.text();
      origin = "file";
    }

    const parsed = parseImportText(text, PARTNER_CATEGORIES);
    if (!parsed.ok) return fail("That file could not be read.", { file: parsed.error });

    const typed = f.text("source", { max: IMPORT_LIMITS.source, label: "The source label" });
    if (!f.ok) return fail("Please check the highlighted fields and try again.", f.errors);
    const source = describe(typed ?? parsed.file.source, fileName);

    const review = await buildReview(db, {
      origin,
      fileName,
      source,
      prepared: prepare(parsed.file.lines),
      distinct: new Set<number>(),
      warnings: parsed.file.warnings,
    });
    if (!review.ok) return fail(review.message);
    return { ok: true, review: review.review };
  }

  // ── a later step: the rows come back from the review ──
  const prepared = fromPayload(String(formData.get("payload") ?? ""));
  if (!prepared) return fail("That review is out of date. Upload the file again.");
  const fileName = cleanFileName(String(formData.get("file_name") ?? "")) || "import";
  const origin = formData.get("origin") === "research" ? "research" : "file";
  const source = f.requiredText("source", { max: IMPORT_LIMITS.source, label: "The source label" });
  if (!f.ok) {
    // Keep the review on screen so the person can fix the label.
    const again = await buildReview(db, { origin, fileName, source: String(formData.get("source") ?? "").slice(0, IMPORT_LIMITS.source), prepared, distinct: distinctLines(formData), warnings: [] });
    return { ...fail("Please check the highlighted fields and try again.", f.errors), review: again.ok ? again.review : undefined };
  }
  const distinct = distinctLines(formData);

  if (intent === "review") {
    const review = await buildReview(db, { origin, fileName, source, prepared, distinct, warnings: [] });
    if (!review.ok) return fail(review.message);
    return { ok: true, review: review.review };
  }

  // intent === "apply"
  const applied = await applyImport(db, { prepared, distinct, source, fileName });
  if (!applied.ok) {
    const again = await buildReview(db, { origin, fileName, source, prepared, distinct, warnings: [] });
    return { ...fail(applied.message), review: again.ok ? again.review : undefined };
  }
  revalidatePath(CONTACTS);
  revalidatePath(ORGANISATIONS);
  revalidatePath(`${HQ_BASE}/growth/import`);
  return { ok: true, result: applied.result };
}
