"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { IMPORT_LIMITS, IMPORT_MAX_BYTES, parseContractorImport } from "@/lib/hq/contractors/import-parse";
import { applyImport, buildReview, fromPayload, importVocab, prepare } from "@/lib/hq/contractors/import-review";
import { loadTrades } from "@/lib/hq/trades/queries";
import type { ContractorImportState } from "@/lib/hq/contractors/import-types";
import { FormReader, fail } from "@/lib/hq/forms";

/*
 * The contractor import. ONE Server Action drives the whole flow, switching on `intent`, so the
 * screen keeps a single result (a review, then an outcome):
 *
 *   upload     read a JSON or CSV file, validate it, and show a review        (import.run + contractors.write)
 *   prospects  the same, for the maintenance prospects bundled with HQ        (import.run + contractors.write)
 *   review     re-check the review after the person changed a choice
 *   apply      write what the review showed, in one transaction
 *
 * Nothing is written until `apply`. Preview and apply call the same classifier in the database, so
 * the review is exactly what apply does. The file is parsed on the server; the rows that travel
 * between steps are validated again every time. A file can never approve anyone or clear "needs
 * verifying": every imported contractor is a prospect that needs verifying.
 *
 * Both capabilities are needed (the database needs both too). requireStaff takes one, so the second
 * is checked straight after it and sends the person out the same way.
 */

const PARTNERS = `${HQ_BASE}/partners`;

/** The bundled prospects. A fixed path: nothing from the request ever reaches it. */
const PROSPECTS_FILE = path.join(process.cwd(), "hq", "seed", "maintenance-contractors.json");
const PROSPECTS_FILE_LABEL = "maintenance-contractors.json";

const KNOWN_INTENTS = ["upload", "prospects", "review", "apply"] as const;

async function requireImporter() {
  const ctx = await requireStaff("contractors.write");
  if (!ctx.can("import.run")) redirect(`${HQ_BASE}?denied=import.run`);
  return ctx;
}

function describe(source: string | null, fallback: string): string {
  const s = (source ?? "").trim().slice(0, IMPORT_LIMITS.source);
  return s || fallback.slice(0, IMPORT_LIMITS.source);
}

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 200);
}

/** The line numbers ticked "import as a separate contractor". Anything that is not a whole number is ignored. */
function distinctLines(formData: FormData): Set<number> {
  const out = new Set<number>();
  for (const v of formData.getAll("distinct")) if (typeof v === "string" && /^\d{1,6}$/.test(v)) out.add(Number(v));
  return out;
}

export async function importContractorsAction(_prev: ContractorImportState, formData: FormData): Promise<ContractorImportState> {
  const { db } = await requireImporter();
  const f = new FormReader(formData);
  const intent = f.oneOf("intent", KNOWN_INTENTS, { required: true });
  if (!intent) return fail("That request was not understood.");

  // The trades a file may use are read from hq.trades (active ones), every step, never a fixed list.
  const trades = await loadTrades(db);
  if (!trades.ok) return fail("The list of trades could not be loaded. Try again in a moment.");
  const vocab = importVocab(trades.data);

  if (intent === "upload" || intent === "prospects") {
    let text: string;
    let fileName: string;
    let origin: "file" | "prospects";

    if (intent === "prospects") {
      try {
        text = await readFile(PROSPECTS_FILE, "utf8");
      } catch (e) {
        console.error("[hq] maintenance prospects file could not be read:", e instanceof Error ? e.name : "error");
        return fail("The maintenance prospects file could not be read.");
      }
      fileName = PROSPECTS_FILE_LABEL;
      origin = "prospects";
    } else {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return fail("Choose a file to import.", { file: "Choose a .json or .csv file." });
      if (file.size > IMPORT_MAX_BYTES) return fail("That file is too large.", { file: "That file is larger than 1 MB." });
      fileName = cleanFileName(file.name);
      if (!/\.(json|csv)$/i.test(fileName)) return fail("That file type is not supported.", { file: "Upload a .json or .csv file." });
      text = await file.text();
      origin = "file";
    }

    const parsed = parseContractorImport(text, vocab);
    if (!parsed.ok) return fail("That file could not be read.", { file: parsed.error });

    const typed = f.text("source", { max: IMPORT_LIMITS.source, label: "The source label" });
    if (!f.ok) return fail("Please check the highlighted fields and try again.", f.errors);
    const source = describe(typed ?? parsed.file.source, fileName);

    const review = await buildReview(db, { origin, fileName, source, prepared: prepare(parsed.file.lines), distinct: new Set<number>(), warnings: parsed.file.warnings });
    if (!review.ok) return fail(review.message);
    return { ok: true, review: review.review };
  }

  // ── a later step: the rows come back from the review ──
  const prepared = fromPayload(String(formData.get("payload") ?? ""), vocab);
  if (!prepared) return fail("That review is out of date. Upload the file again.");
  const fileName = cleanFileName(String(formData.get("file_name") ?? "")) || "import";
  const origin = formData.get("origin") === "prospects" ? "prospects" : "file";
  const source = f.requiredText("source", { max: IMPORT_LIMITS.source, label: "The source label" });
  if (!f.ok) {
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
  revalidatePath(PARTNERS);
  revalidatePath(`${PARTNERS}/import`);
  revalidatePath(HQ_BASE);
  return { ok: true, result: applied.result };
}
