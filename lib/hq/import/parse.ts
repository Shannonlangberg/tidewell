/*
 * Reading a partner import file (JSON or CSV) into validated rows.
 *
 * This runs on the SERVER, on whatever file was uploaded, so it assumes nothing: every field is
 * bounded, categories are checked against the allowed list, control characters are stripped (a
 * NUL byte would make Postgres refuse the whole import), and the file size and row count are
 * limited. A bad row is KEPT, with its problems listed, so the review screen can show it; only
 * the file as a whole can be refused (too big, not JSON or CSV, no rows).
 *
 * Accepted shapes (see hq/seed/referral-contacts.json and .csv):
 *   JSON: an array of rows, or { "source": "...", "rows": [ ... ] }
 *   CSV:  a header row, then one row per person
 *   Columns: organisation, full_name, categories (an array, or `|` separated), service_region,
 *            and optionally position, phone, email, website, location, notes, flags
 *            (flags: an array, or `|` separated)
 *
 * Pure and dependency-free so it runs under `node --test`. The allowed categories are passed in.
 */

export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 2000;
const MAX_COLUMNS = 40;

export const IMPORT_LIMITS = {
  organisation: 200,
  full_name: 200,
  position: 200,
  phone: 50,
  email: 254,
  website: 300,
  location: 300,
  service_region: 120,
  notes: 2000,
  flag: 300,
  flags: 10,
  source: 120,
} as const;

export type ImportRow = {
  organisation: string;
  full_name: string;
  categories: string[];
  service_region?: string;
  position?: string;
  phone?: string;
  email?: string;
  website?: string;
  location?: string;
  notes?: string;
  flags?: string[];
};

export type ImportLine = {
  /** 1-based position among the data rows of the file (the header row is not counted). */
  line: number;
  /** A short description for the review table when the row is not valid: "Organisation, Full name". */
  label: string;
  /** The cleaned row, or null when it has problems. */
  row: ImportRow | null;
  problems: string[];
};

export type ImportFile = {
  format: "json" | "csv";
  /** The `source` the file declares, if any (bounded). */
  source: string | null;
  lines: ImportLine[];
  /** Things worth knowing that do not stop the import, such as an ignored column. */
  warnings: string[];
};

export type ImportParse = { ok: true; file: ImportFile } | { ok: false; error: string };

// ── field names ──────────────────────────────────────────────

const FIELD_SYNONYMS: Record<string, string> = {
  organisation: "organisation",
  organization: "organisation",
  org: "organisation",
  company: "organisation",
  full_name: "full_name",
  fullname: "full_name",
  name: "full_name",
  contact_name: "full_name",
  categories: "categories",
  category: "categories",
  service_region: "service_region",
  region: "service_region",
  position: "position",
  phone: "phone",
  email: "email",
  website: "website",
  location: "location",
  notes: "notes",
  flags: "flags",
};

function canonicalField(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FIELD_SYNONYMS[key] ?? null;
}

// ── text cleaning ────────────────────────────────────────────

/** Control characters other than tab and newline (including NUL, which Postgres cannot store). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function clean(value: string): string {
  return value.replace(CONTROL, "").trim();
}

function slugCategory(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── CSV ──────────────────────────────────────────────────────

/**
 * RFC 4180 style: fields separated by commas, optionally wrapped in double quotes, with "" for a
 * quote inside a quoted field, and line breaks (CRLF, LF or CR) allowed inside quotes. Blank
 * lines are skipped. `unterminated` is true when a quote was opened and never closed.
 */
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

function readText(raw: RawRecord, field: keyof typeof IMPORT_LIMITS, label: string, problems: string[]): string | undefined {
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
  const max = IMPORT_LIMITS[field];
  if (cleaned.length > max) {
    problems.push(`${label} is longer than ${max} characters.`);
    return undefined;
  }
  return cleaned;
}

/** Splits a list that is either an array or a `|` separated string. */
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

export function normaliseRow(raw: RawRecord, line: number, categories: readonly string[]): ImportLine {
  const problems: string[] = [];
  const organisation = readText(raw, "organisation", "Organisation", problems);
  const fullName = readText(raw, "full_name", "Full name", problems);
  if (!organisation && !problems.some((p) => p.startsWith("Organisation"))) problems.push("Organisation is required.");
  if (!fullName && !problems.some((p) => p.startsWith("Full name"))) problems.push("Full name is required.");

  const cats: string[] = [];
  for (const c of readList(raw.categories, "Categories", problems)) {
    const slug = slugCategory(c);
    if (!categories.includes(slug)) {
      problems.push(`Unknown category "${c.slice(0, 40)}".`);
    } else if (!cats.includes(slug)) {
      cats.push(slug);
    }
  }
  if (cats.length === 0 && !problems.some((p) => p.startsWith("Categor") || p.startsWith("Unknown category"))) {
    problems.push("Choose at least one category.");
  }

  const region = readText(raw, "service_region", "Service region", problems);
  const position = readText(raw, "position", "Position", problems);
  const phone = readText(raw, "phone", "Phone", problems);
  const emailRaw = readText(raw, "email", "Email", problems);
  const website = readText(raw, "website", "Website", problems);
  const location = readText(raw, "location", "Location", problems);
  const notes = readText(raw, "notes", "Notes", problems);

  let email: string | undefined;
  if (emailRaw) {
    if (EMAIL.test(emailRaw)) email = emailRaw.toLowerCase();
    else problems.push("Email address isn't valid.");
  }

  const flagsAll = readList(raw.flags, "Flags", problems);
  if (flagsAll.length > IMPORT_LIMITS.flags) problems.push(`Flags: no more than ${IMPORT_LIMITS.flags} per row.`);
  const flags = flagsAll.slice(0, IMPORT_LIMITS.flags);
  if (flags.some((f) => f.length > IMPORT_LIMITS.flag)) problems.push(`Each flag must be ${IMPORT_LIMITS.flag} characters or fewer.`);

  const label = [organisation, fullName].filter(Boolean).join(" · ") || "Unnamed row";
  if (problems.length > 0) return { line, label, row: null, problems };

  const row: ImportRow = { organisation: organisation!, full_name: fullName!, categories: cats };
  if (region) row.service_region = region;
  if (position) row.position = position;
  if (phone) row.phone = phone;
  if (email) row.email = email;
  if (website) row.website = website;
  if (location) row.location = location;
  if (notes) row.notes = notes;
  if (flags.length > 0) row.flags = flags;
  return { line, label, row, problems: [] };
}

// ── the file ─────────────────────────────────────────────────

/** Maps a raw object's keys to the canonical field names. Unknown keys are reported once via `ignored`. */
function canonicalise(obj: Record<string, unknown>, ignored: Set<string>): RawRecord {
  const out: RawRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    const field = canonicalField(key);
    if (!field) {
      ignored.add(key.slice(0, 40));
    } else if (!(field in out)) {
      out[field] = value;
    }
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
  const names = [...ignored].slice(0, 8).join(", ");
  return [`Ignored ${ignored.size === 1 ? "column" : "columns"} that HQ does not use: ${names}${ignored.size > 8 ? ", and more" : ""}.`];
}

export function parseImportText(text: string, categories: readonly string[]): ImportParse {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.length > IMPORT_MAX_BYTES) return { ok: false, error: "That file is larger than 1 MB." };
  const trimmed = body.trimStart();
  if (!trimmed) return { ok: false, error: "That file is empty." };

  const ignored = new Set<string>();
  const lines: ImportLine[] = [];

  // ── JSON ──
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { ok: false, error: "That file isn't valid JSON." };
    }
    let rows: unknown;
    let source: string | null = null;
    if (Array.isArray(data)) {
      rows = data;
    } else if (data && typeof data === "object") {
      rows = (data as Record<string, unknown>).rows;
      source = sourceOf((data as Record<string, unknown>).source);
    }
    if (!Array.isArray(rows)) return { ok: false, error: 'The JSON must be a list of rows, or an object with a "rows" list.' };
    if (rows.length === 0) return { ok: false, error: "That file has no rows." };
    if (rows.length > IMPORT_MAX_ROWS) return { ok: false, error: `That file has more than ${IMPORT_MAX_ROWS.toLocaleString("en-AU")} rows. Split it into smaller files.` };
    rows.forEach((r, i) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) {
        lines.push({ line: i + 1, label: "Unnamed row", row: null, problems: ["This row is not an object."] });
      } else {
        lines.push(normaliseRow(canonicalise(r as Record<string, unknown>, ignored), i + 1, categories));
      }
    });
    return { ok: true, file: { format: "json", source, lines, warnings: warningsFor(ignored) } };
  }

  // ── CSV ──
  const { rows: records, unterminated } = parseCsv(body);
  if (unterminated) return { ok: false, error: "The CSV has a quote that is never closed. Check the file and try again." };
  if (records.length === 0) return { ok: false, error: "That file is empty." };
  const header = records[0];
  if (header.length > MAX_COLUMNS) return { ok: false, error: "That file has too many columns." };
  const fields = header.map((h) => canonicalField(h));
  if (!fields.includes("organisation") || !fields.includes("full_name")) {
    return { ok: false, error: "The first row must name the columns, including organisation and full_name." };
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
    lines.push(normaliseRow(raw, i + 1, categories));
  });
  return { ok: true, file: { format: "csv", source: null, lines, warnings: warningsFor(ignored) } };
}

/** The rows with no problems, each with the line number it came from. */
export function validLines(file: ImportFile): Array<{ line: number; row: ImportRow }> {
  const out: Array<{ line: number; row: ImportRow }> = [];
  for (const l of file.lines) if (l.row) out.push({ line: l.line, row: l.row });
  return out;
}

/** The rows with problems. */
export function invalidLines(file: ImportFile): ImportLine[] {
  return file.lines.filter((l) => !l.row);
}
