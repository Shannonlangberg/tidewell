import "server-only";

import type { Json } from "../database.types";
import type { HqClient } from "../db";
import type { Trade } from "../trades/rules";
import { abnProblem, stripAbn } from "./abn";
import { logTag } from "./db-errors";
import {
  IMPORT_LIMITS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  normaliseContractorRow,
  type ContractorImportLine,
  type ContractorImportRow,
  type ImportVocab,
} from "./import-parse";
import type {
  ContractorImportClassification,
  ContractorImportCounts,
  ContractorImportResult,
  ContractorImportReview,
  ContractorReviewRow,
} from "./import-types";

/*
 * The server half of the contractor import: build a review with hq.preview_contractor_import and
 * apply it with hq.apply_contractor_import. Neither trusts the browser: the rows that travel between
 * steps are validated again by the same parser every time, and the database classifies them again.
 * Nothing is written until apply, and apply makes every contractor a prospect that needs verifying.
 */

/** What a file may say for a trade: the ACTIVE trades (slug, or label in any case), read from hq.trades. */
export function importVocab(trades: readonly Pick<Trade, "slug" | "label" | "isActive">[]): ImportVocab {
  const active = trades.filter((t) => t.isActive);
  return { categories: active.map((t) => t.slug), labels: new Map(active.map((t) => [t.label.replace(/\s+/g, " ").trim().toLowerCase(), t.slug])), abnProblem, stripAbn };
}

type ValidLine = { line: number; row: ContractorImportRow };
type InvalidLine = { line: number; label: string; problems: string[] };
export type PreparedLines = { valid: ValidLine[]; invalid: InvalidLine[] };

export function prepare(lines: ContractorImportLine[]): PreparedLines {
  const valid: ValidLine[] = [];
  const invalid: InvalidLine[] = [];
  for (const l of lines) {
    if (l.row) valid.push({ line: l.line, row: l.row });
    else invalid.push({ line: l.line, label: l.label, problems: l.problems });
  }
  return { valid, invalid };
}

export function toPayload(p: PreparedLines): string {
  return JSON.stringify(p);
}

/** Reads a payload back and runs every row through the parser again. Null for anything that does not hold up. */
export function fromPayload(payload: string, vocab: ImportVocab): PreparedLines | null {
  if (typeof payload !== "string" || payload.length === 0 || payload.length > IMPORT_MAX_BYTES * 3) return null;
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as { valid?: unknown; invalid?: unknown };
  if (!Array.isArray(d.valid) || !Array.isArray(d.invalid)) return null;
  if (d.valid.length + d.invalid.length === 0 || d.valid.length + d.invalid.length > IMPORT_MAX_ROWS) return null;

  const valid: ValidLine[] = [];
  const seen = new Set<number>();
  for (const item of d.valid) {
    if (!item || typeof item !== "object") return null;
    const { line, row } = item as { line?: unknown; row?: unknown };
    if (typeof line !== "number" || !Number.isInteger(line) || line < 1 || line > IMPORT_MAX_ROWS * 2 || seen.has(line)) return null;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const again = normaliseContractorRow(row as Record<string, unknown>, line, vocab);
    if (!again.row) return null; // a row that was valid is no longer valid: the payload was altered
    seen.add(line);
    valid.push({ line, row: again.row });
  }

  const invalid: InvalidLine[] = [];
  for (const item of d.invalid) {
    if (!item || typeof item !== "object") return null;
    const { line, label, problems } = item as { line?: unknown; label?: unknown; problems?: unknown };
    if (typeof line !== "number" || !Number.isInteger(line) || line < 1 || line > IMPORT_MAX_ROWS * 2 || seen.has(line)) return null;
    if (typeof label !== "string" || !Array.isArray(problems)) return null;
    seen.add(line);
    invalid.push({
      line,
      label: label.slice(0, IMPORT_LIMITS.business_name + 10),
      problems: problems.filter((p): p is string => typeof p === "string").slice(0, 8).map((p) => p.slice(0, 200)),
    });
  }
  valid.sort((a, b) => a.line - b.line);
  invalid.sort((a, b) => a.line - b.line);
  return { valid, invalid };
}

// ── review ───────────────────────────────────────────────────

type PlanRow = {
  row: number;
  business_name: string | null;
  classification: ContractorImportClassification;
  action: "create" | "skip";
  reason: string | null;
  match_contractor_id: string | null;
  match_row: number | null;
  flagged: boolean;
};

const CLASSIFICATIONS: readonly string[] = ["new_contractor", "duplicate", "possible_duplicate", "invalid"];

function readPlan(data: unknown): PlanRow[] | null {
  if (!data || typeof data !== "object") return null;
  const rows = (data as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const out: PlanRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") return null;
    const x = r as Record<string, unknown>;
    if (typeof x.row !== "number" || typeof x.classification !== "string" || !CLASSIFICATIONS.includes(x.classification)) return null;
    out.push({
      row: x.row,
      business_name: typeof x.business_name === "string" ? x.business_name : null,
      classification: x.classification as ContractorImportClassification,
      action: x.action === "create" ? "create" : "skip",
      reason: typeof x.reason === "string" ? x.reason : null,
      match_contractor_id: typeof x.match_contractor_id === "string" ? x.match_contractor_id : null,
      match_row: typeof x.match_row === "number" ? x.match_row : null,
      flagged: x.flagged === true,
    });
  }
  return out;
}

function rowsForDatabase(valid: ValidLine[], distinct: ReadonlySet<number>): Json {
  return valid.map(({ line, row }) => ({ ...row, ...(distinct.has(line) ? { confirm_distinct: true } : {}) })) as unknown as Json;
}

export function countsOf(rows: ContractorReviewRow[]): ContractorImportCounts {
  const n = (c: ContractorImportClassification) => rows.filter((r) => r.classification === c).length;
  return {
    rows: rows.length,
    toCreate: rows.filter((r) => r.action === "create").length,
    skipped: rows.filter((r) => r.action === "skip").length,
    duplicates: n("duplicate"),
    possibleDuplicates: n("possible_duplicate"),
    invalid: n("invalid"),
    flagged: rows.filter((r) => r.flagged).length,
  };
}

/** Next.js caps a Server Action request at 1 MB, and the rows travel back as one form field: refuse a file that would not fit at review time. */
export const PAYLOAD_LIMIT = 900_000;

export type ReviewInput = {
  origin: "file" | "prospects";
  fileName: string;
  source: string;
  prepared: PreparedLines;
  distinct: ReadonlySet<number>;
  warnings: string[];
};

export async function buildReview(db: HqClient, input: ReviewInput): Promise<{ ok: true; review: ContractorImportReview } | { ok: false; message: string }> {
  const { valid, invalid } = input.prepared;
  const rows: ContractorReviewRow[] = [];

  if (valid.length > 0) {
    const { data, error } = await db.rpc("preview_contractor_import", { p_rows: rowsForDatabase(valid, input.distinct) });
    if (error) {
      console.error("[hq] preview_contractor_import failed:", logTag(error));
      return { ok: false, message: error.code === "42501" ? "Importing contractors needs permission to import and to edit contractors." : "We couldn't check that file against HQ. Nothing was imported. Try again in a moment." };
    }
    const plan = readPlan(data);
    if (!plan || plan.length !== valid.length) {
      console.error("[hq] preview_contractor_import returned an unexpected shape");
      return { ok: false, message: "We couldn't check that file against HQ. Nothing was imported." };
    }
    for (const p of plan) {
      const source = valid[p.row - 1];
      if (!source) continue;
      rows.push({
        line: source.line,
        businessName: source.row.business_name,
        classification: p.classification,
        reason: p.reason ?? "",
        action: p.action,
        matchContractorId: p.match_contractor_id,
        matchRow: p.match_row !== null ? (valid[p.match_row - 1]?.line ?? null) : null,
        confirmedDistinct: p.classification === "possible_duplicate" && input.distinct.has(source.line),
        flagged: p.flagged,
      });
    }
  }
  for (const i of invalid) {
    rows.push({ line: i.line, businessName: i.label, classification: "invalid", reason: i.problems.join(" "), action: "skip", matchContractorId: null, matchRow: null, confirmedDistinct: false, flagged: false });
  }
  rows.sort((a, b) => a.line - b.line);

  const payload = toPayload(input.prepared);
  if (payload.length > PAYLOAD_LIMIT) return { ok: false, message: "That file is too large to review in one go. Split it into two or more smaller files." };

  return {
    ok: true,
    review: { version: Date.now(), origin: input.origin, fileName: input.fileName, source: input.source, rows, counts: countsOf(rows), payload, warnings: input.warnings },
  };
}

// ── apply ────────────────────────────────────────────────────

export type ApplyInput = { prepared: PreparedLines; distinct: ReadonlySet<number>; source: string; fileName: string };

export async function applyImport(db: HqClient, input: ApplyInput): Promise<{ ok: true; result: ContractorImportResult } | { ok: false; message: string }> {
  const { valid, invalid } = input.prepared;
  if (invalid.length > 0) return { ok: false, message: "Some rows in the file are not valid, so nothing was imported. Fix the file and upload it again." };
  if (valid.length === 0) return { ok: false, message: "There are no rows to import." };

  const { data, error } = await db.rpc("apply_contractor_import", {
    p_rows: rowsForDatabase(valid, input.distinct),
    p_source: input.source,
    p_file_name: input.fileName || undefined,
  });
  if (error) {
    console.error("[hq] apply_contractor_import failed:", logTag(error));
    if (error.code === "42501") return { ok: false, message: "Importing contractors needs permission to import and to edit contractors." };
    if (error.code === "22023") return { ok: false, message: "HQ refused the file, so nothing was imported. Review it again, or fix the file and upload it again." };
    return { ok: false, message: "The import did not finish, so nothing was imported. Try again in a moment." };
  }

  const d = (data ?? {}) as { batch_id?: unknown; counts?: Record<string, unknown> };
  const c = d.counts ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
  return {
    ok: true,
    result: {
      batchId: typeof d.batch_id === "string" ? d.batch_id : null,
      rowsInFile: num(c.rows),
      contractorsCreated: num(c.contractors_created),
      alreadyInHq: num(c.duplicate),
      possibleDuplicates: num(c.possible_duplicate),
      invalid: num(c.invalid),
      skipped: num(c.skipped),
      flagged: num(c.flagged),
      fileName: input.fileName,
      source: input.source,
    },
  };
}
