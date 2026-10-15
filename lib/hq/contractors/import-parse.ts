/*
 * Reading a contractor import file (JSON or CSV) into validated rows.
 *
 * This runs on the SERVER, on whatever file was uploaded, so it assumes nothing: every field is
 * bounded, trades are checked against the allowed list, an ABN must pass the checksum, control
 * characters are stripped (a NUL byte would make Postgres refuse the whole import), and file size
 * and row count are limited. A bad row is KEPT, with its problems listed, so the review screen can
 * show it; only the file as a whole can be refused (too big, not JSON or CSV, no rows).
 *
 * Nothing is invented. A row carries only what the file says. In particular a file can NEVER set a
 * status or clear "needs verifying": columns named status or needs_verification are ignored, and the
 * database makes every imported contractor a prospect that needs verifying.
 *
 * Accepted shapes (see hq/seed/maintenance-contractors.json and .csv):
 *   JSON: an array of rows, or { "source": "...", "rows": [ ... ] } (other top-level keys are ignored)
 *   CSV:  a header row, then one row per contractor
 *   Columns: business_name and categories are required (categories: an array, or `|` separated).
 *            Optional: primary_contact_name, phone, email, website, abn, service_suburbs,
 *            service_regions (arrays, or `|` separated), notes, flags (array, or `|` separated)
 *
 * Pure and import-free so it runs under `node --test`; the trade list and the ABN rule are passed in.
 */

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 2000;
const MAX_COLUMNS = 40;

export const IMPORT_LIMITS = {
  business_name: 200,
  primary_contact_name: 200,
  phone: 50,
  email: 254,
  website: 300,
  abn: 20,
  place: 80,
  places: 60,
  notes: 2000,
  flag: 300,
  flags: 10,
  source: 120,
} as const;

export type ContractorImportRow = {
  business_name: string;
  categories: string[];
  primary_contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** 11 digits, no spaces. */
  abn?: string;
  service_suburbs?: string[];
  service_regions?: string[];
  notes?: string;
  flags?: string[];
};

export type ContractorImportLine = {
  /** 1-based position among the data rows of the file (the header row is not counted). */
  line: number;
  /** A short description for the review table when the row is not valid. */
  label: string;
  row: ContractorImportRow | null;
  problems: string[];
};

export type ContractorImportFile = {
  format: "json" | "csv";
  source: string | null;
  lines: ContractorImportLine[];
  /** Things worth knowing that do not stop the import, such as an ignored column. */
  warnings: string[];
};

export type ContractorImportParse = { ok: true; file: ContractorImportFile } | { ok: false; error: string };

export type ImportVocab = {
  /** The trade slugs a row may use (the ACTIVE trades in hq.trades). */
  categories: readonly string[];
  /** Optional: a trade label (lower case) -> its slug, so a file may say "Plumbers" as well as "plumbing". */
  labels?: ReadonlyMap<string, string>;
  /** Returns a plain-language problem for an ABN, or null when it is acceptable. */
  abnProblem: (abn: string) => string | null;
  /** Whitespace stripped, as the database does. */
  stripAbn: (abn: string) => string;
};

// ── field names ──────────────────────────────────────────────

const FIELD_SYNONYMS: Record<string, string> = {
  business_name: "business_name",
  businessname: "business_name",
  business: "business_name",
  name: "business_name",
  contractor: "business_name",
  company: "business_name",
  categories: "categories",
  category: "categories",
  trade: "categories",
  trades: "categories",
  primary_contact_name: "primary_contact_name",
  contact_name: "primary_contact_name",
  contact: "primary_contact_name",
  phone: "phone",
  email: "email",
  website: "website",
  abn: "abn",
  service_suburbs: "service_suburbs",
  suburbs: "service_suburbs",
  service_regions: "service_regions",
  regions: "service_regions",
  notes: "notes",
  flags: "flags",
};

function canonicalField(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FIELD_SYNONYMS[key] ?? null;
}

// ── text cleaning ────────────────────────────────────────────

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string): string => value.replace(CONTROL, "").trim();
const slug = (value: string): string => value.trim().toLowerCase().replace(/[\s-]+/g, "_");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLACE = /^[\p{L}\p{N} '’.-]+$/u;

// ── CSV ──────────────────────────────────────────────────────

/** RFC 4180 style, as the partner import reads it: quotes, "" for a quote, line breaks inside quotes, blank lines skipped. */
export function parseCsv(text: string): { rows: string[][]; unterminated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
    } else if (c === "\n") {
      endRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  const unterminated = inQuotes;
  if (field !== "" || row.length > 0) endRow();
  return { rows, unterminated };
}

// ── one row ──────────────────────────────────────────────────

type RawRecord = Record<string, unknown>;

function readText(raw: RawRecord, field: string, max: number, label: string, problems: string[]): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" && Number.isFinite(value)) text = String(value);
  else {
    problems.push(`${label} must be text.`);
    return undefined;
  }
  const cleaned = clean(text);
  if (!cleaned) return undefined;
  if (cleaned.length > max) {
    problems.push(`${label} is longer than ${max} characters.`);
    return undefined;
  }
  return cleaned;
}

/** A list that is either an array or a `|` separated string. */
function readList(value: unknown, label: string, problems: string[]): string[] {
  if (value === undefined || value === null || value === "") return [];
  let items: unknown[];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") items = value.split("|");
  else {
    problems.push(`${label} must be a list.`);
    return [];
  }
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      problems.push(`${label} must be a list of text.`);
      return [];
    }
    const c = clean(item);
    if (c) out.push(c);
  }
  return out;
}

function readPlaces(value: unknown, label: string, problems: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of readList(value, label, problems)) {
    const p = raw.replace(/\s+/g, " ");
    if (p.length > IMPORT_LIMITS.place || !PLACE.test(p)) {
      problems.push(`${label}: "${p.slice(0, 30)}" is not a place name.`);
      continue;
    }
    if (seen.has(p.toLowerCase())) continue;
    seen.add(p.toLowerCase());
    out.push(p);
  }
  if (out.length > IMPORT_LIMITS.places) problems.push(`${label}: no more than ${IMPORT_LIMITS.places} places per row.`);
  return out.slice(0, IMPORT_LIMITS.places);
}

export function normaliseContractorRow(raw: RawRecord, line: number, vocab: ImportVocab): ContractorImportLine {
  const problems: string[] = [];
  const businessName = readText(raw, "business_name", IMPORT_LIMITS.business_name, "Business name", problems);
  if (!businessName && !problems.some((p) => p.startsWith("Business name"))) problems.push("Business name is required.");

  const cats: string[] = [];
  for (const c of readList(raw.categories, "Trades", problems)) {
    const bySlug = slug(c);
    const s = vocab.categories.includes(bySlug) ? bySlug : (vocab.labels?.get(c.replace(/\s+/g, " ").trim().toLowerCase()) ?? bySlug);
    if (!vocab.categories.includes(s)) problems.push(`Unknown trade "${c.slice(0, 40)}". Use a trade name or slug from the Trades page.`);
    else if (!cats.includes(s)) cats.push(s);
  }
  if (cats.length === 0 && !problems.some((p) => p.startsWith("Trades") || p.startsWith("Unknown trade"))) problems.push("Choose at least one trade.");

  const contact = readText(raw, "primary_contact_name", IMPORT_LIMITS.primary_contact_name, "Contact person", problems);
  const phone = readText(raw, "phone", IMPORT_LIMITS.phone, "Phone", problems);
  const emailRaw = readText(raw, "email", IMPORT_LIMITS.email, "Email", problems);
  const website = readText(raw, "website", IMPORT_LIMITS.website, "Website", problems);
  const abnRaw = readText(raw, "abn", IMPORT_LIMITS.abn, "ABN", problems);
  const notes = readText(raw, "notes", IMPORT_LIMITS.notes, "Notes", problems);
  const suburbs = readPlaces(raw.service_suburbs, "Suburbs", problems);
  const regions = readPlaces(raw.service_regions, "Regions", problems);

  let email: string | undefined;
  if (emailRaw) {
    if (EMAIL.test(emailRaw)) email = emailRaw.toLowerCase();
    else problems.push("Email address isn't valid.");
  }
  let abn: string | undefined;
  if (abnRaw) {
    const problem = vocab.abnProblem(abnRaw);
    if (problem) problems.push(problem);
    else abn = vocab.stripAbn(abnRaw);
  }

  const flagsAll = readList(raw.flags, "Flags", problems);
  if (flagsAll.length > IMPORT_LIMITS.flags) problems.push(`Flags: no more than ${IMPORT_LIMITS.flags} per row.`);
  const flags = flagsAll.slice(0, IMPORT_LIMITS.flags);
  if (flags.some((f) => f.length > IMPORT_LIMITS.flag)) problems.push(`Each flag must be ${IMPORT_LIMITS.flag} characters or fewer.`);

  const label = businessName || "Unnamed row";
  if (problems.length > 0) return { line, label, row: null, problems };

  const row: ContractorImportRow = { business_name: businessName!, categories: cats };
  if (contact) row.primary_contact_name = contact;
  if (phone) row.phone = phone;
  if (email) row.email = email;
  if (website) row.website = website;
  if (abn) row.abn = abn;
  if (suburbs.length > 0) row.service_suburbs = suburbs;
  if (regions.length > 0) row.service_regions = regions;
  if (notes) row.notes = notes;
  if (flags.length > 0) row.flags = flags;
  return { line, label, row, problems: [] };
}

// ── the file ─────────────────────────────────────────────────

/** Columns that must never be taken from a file, named in the warning so nobody thinks they were applied. */
const REFUSED_COLUMNS = new Set(["status", "needs_verification"]);

function canonicalise(obj: Record<string, unknown>, ignored: Set<string>): RawRecord {
  const out: RawRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    const field = canonicalField(key);
    if (!field) ignored.add(key.slice(0, 40));
    else if (!(field in out)) out[field] = value;
  }
  return out;
}

function sourceOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const c = clean(value).slice(0, IMPORT_LIMITS.source);
  return c || null;
}

function warningsFor(ignored: Set<string>): string[] {
  if (ignored.size === 0) return [];
  const names = [...ignored];
  const refused = names.filter((n) => REFUSED_COLUMNS.has(n.toLowerCase()));
  const out: string[] = [];
  if (refused.length > 0) out.push(`The column ${refused.join(" and ")} was ignored. An import never sets a status or clears "needs verifying": every contractor arrives as a prospect that needs verifying.`);
  const others = names.filter((n) => !REFUSED_COLUMNS.has(n.toLowerCase()));
  if (others.length > 0) out.push(`Ignored ${others.length === 1 ? "column" : "columns"} that HQ does not use: ${others.slice(0, 8).join(", ")}${others.length > 8 ? ", and more" : ""}.`);
  return out;
}

export function parseContractorImport(text: string, vocab: ImportVocab): ContractorImportParse {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.length > IMPORT_MAX_BYTES) return { ok: false, error: "That file is larger than 1 MB." };
  const trimmed = body.trimStart();
  if (!trimmed) return { ok: false, error: "That file is empty." };

  const ignored = new Set<string>();
  const lines: ContractorImportLine[] = [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { ok: false, error: "That file isn't valid JSON." };
    }
    let rows: unknown;
    let source: string | null = null;
    if (Array.isArray(data)) rows = data;
    else if (data && typeof data === "object") {
      rows = (data as Record<string, unknown>).rows;
      source = sourceOf((data as Record<string, unknown>).source);
    }
    if (!Array.isArray(rows)) return { ok: false, error: 'The JSON must be a list of rows, or an object with a "rows" list.' };
    if (rows.length === 0) return { ok: false, error: "That file has no rows." };
    if (rows.length > IMPORT_MAX_ROWS) return { ok: false, error: `That file has more than ${IMPORT_MAX_ROWS.toLocaleString("en-AU")} rows. Split it into smaller files.` };
    rows.forEach((r, i) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) lines.push({ line: i + 1, label: "Unnamed row", row: null, problems: ["This row is not an object."] });
      else lines.push(normaliseContractorRow(canonicalise(r as Record<string, unknown>, ignored), i + 1, vocab));
    });
    return { ok: true, file: { format: "json", source, lines, warnings: warningsFor(ignored) } };
  }

  const { rows: records, unterminated } = parseCsv(body);
  if (unterminated) return { ok: false, error: "The CSV has a quote that is never closed. Check the file and try again." };
  if (records.length === 0) return { ok: false, error: "That file is empty." };
  const header = records[0];
  if (header.length > MAX_COLUMNS) return { ok: false, error: "That file has too many columns." };
  const fields = header.map((h) => canonicalField(h));
  if (!fields.includes("business_name") || !fields.includes("categories")) {
    return { ok: false, error: "The first row must name the columns, including business_name and categories." };
  }
  header.forEach((h, i) => {
    if (!fields[i] && clean(h)) ignored.add(clean(h).slice(0, 40));
  });
  const data = records.slice(1);
  if (data.length === 0) return { ok: false, error: "That file has a header but no rows." };
  if (data.length > IMPORT_MAX_ROWS) return { ok: false, error: `That file has more than ${IMPORT_MAX_ROWS.toLocaleString("en-AU")} rows. Split it into smaller files.` };
  data.forEach((cells, i) => {
    const raw: RawRecord = {};
    fields.forEach((field, col) => {
      if (field && !(field in raw)) raw[field] = cells[col] ?? "";
    });
    lines.push(normaliseContractorRow(raw, i + 1, vocab));
  });
  return { ok: true, file: { format: "csv", source: null, lines, warnings: warningsFor(ignored) } };
}
