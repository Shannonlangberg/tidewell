/*
 * Contractor documents: the rules both the browser and the server apply before a file is
 * uploaded, how an expiry is worded, and how the upload, register, review and archive forms
 * are read. Pure and client-safe, so `node --test` runs it and the upload form can use the
 * same checks as the Server Actions.
 *
 * The browser's check is a courtesy. The Server Actions repeat it, the storage bucket refuses
 * other types and sizes, and hq.add_contractor_document re-checks the stored object.
 *
 * HONEST LIMITATION (shown in the interface): HQ does not scan uploaded files for malware.
 */

import type { FormReader } from "../forms";

/*
 * No value imports on purpose (see vetting-steps.ts). Three tiny helpers from format.ts are written
 * out below and pinned to their originals by documents-rules.test.mts.
 */

/** format.ts daysFromToday */
function daysFromToday(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** format.ts formatDate, for a bare YYYY-MM-DD date. */
function formatDate(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** format.ts plural */
function plural(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

export const DOCUMENT_BUCKET = "contractor-documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_LABEL = "10 MB";

export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];

const EXTENSIONS: Record<DocumentMime, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};

/** For the file input's `accept`. */
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export const DOCUMENT_TYPES = [
  "licence",
  "public_liability_insurance",
  "workers_compensation",
  "professional_indemnity",
  "abn_confirmation",
  "price_list",
  "agreement",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  licence: "Licence",
  public_liability_insurance: "Public liability insurance",
  workers_compensation: "Workers compensation",
  professional_indemnity: "Professional indemnity",
  abn_confirmation: "ABN confirmation",
  price_list: "Price list",
  agreement: "Agreement",
  other: "Other",
};

/** Document types whose verification may be recorded on the contractor itself (licence and insurance dates). */
export const APPLIES_TO_CONTRACTOR: readonly DocumentType[] = ["licence", "public_liability_insurance"];

export const VERIFICATIONS = ["pending", "verified", "rejected"] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const VERIFICATION_LABEL: Record<Verification, string> = {
  pending: "Not yet checked",
  verified: "Verified",
  rejected: "Rejected",
};

export const VERIFICATION_TONE: Record<Verification, "warning" | "success" | "error"> = {
  pending: "warning",
  verified: "success",
  rejected: "error",
};

export const DOCUMENT_NOTE_MAX = 1000;

// ── expiry wording ───────────────────────────────────────────

export type ExpiryBadge = { tone: "neutral" | "warning" | "error"; label: string; plain: boolean };

/**
 * How a document's expiry reads. Matches the database: `days < 0` is expired, `0..warningDays` is
 * expiring soon (the expiry date itself is still valid), anything later is simply a date.
 */
export function expiryBadge(expiresOn: string | null | undefined, today: string, warningDays: number): ExpiryBadge {
  if (!expiresOn) return { tone: "neutral", label: "No expiry date", plain: true };
  const days = daysFromToday(expiresOn, today);
  if (days === null) return { tone: "neutral", label: "No expiry date", plain: true };
  if (days < 0) {
    return { tone: "error", label: days === -1 ? "Expired yesterday" : `Expired ${plural(-days, "day")} ago`, plain: false };
  }
  if (days === 0) return { tone: "warning", label: "Expires today", plain: false };
  if (days <= warningDays) {
    return { tone: "warning", label: days === 1 ? "Expires tomorrow" : `Expires in ${plural(days, "day")}`, plain: false };
  }
  return { tone: "neutral", label: `Expires ${formatDate(expiresOn)}`, plain: true };
}

// ── upload checks ────────────────────────────────────────────

export type UploadMeta = { fileName: string; mimeType: string; sizeBytes: number };

export function isDocumentMime(v: unknown): v is DocumentMime {
  return typeof v === "string" && (DOCUMENT_MIME_TYPES as readonly string[]).includes(v);
}

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/** A plain-English reason the file cannot be uploaded, or null when it can. */
export function uploadProblem(meta: UploadMeta): string | null {
  const name = meta.fileName.trim();
  if (!name) return "Choose a file to upload.";
  if (name.length > 255) return "That file name is too long. Rename the file and try again.";
  if (!isDocumentMime(meta.mimeType)) return "Only PDF, JPEG and PNG files can be uploaded.";
  if (!EXTENSIONS[meta.mimeType].includes(extensionOf(name))) {
    return "The file name does not match its type. Only PDF, JPEG and PNG files can be uploaded.";
  }
  if (!Number.isSafeInteger(meta.sizeBytes) || meta.sizeBytes <= 0) return "That file is empty.";
  if (meta.sizeBytes > MAX_DOCUMENT_BYTES) return `That file is larger than ${MAX_DOCUMENT_LABEL}. Choose a smaller one.`;
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
  return s || "document";
}

const UUID_LOWER = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** `<contractor id>/<document id>-<sanitised name>`: the only shape the bucket policy and the RPC accept. */
export function buildStoragePath(contractorId: string, documentId: string, fileName: string): string {
  return `${contractorId.toLowerCase()}/${documentId.toLowerCase()}-${sanitiseFileName(fileName)}`;
}

export function isStoragePathFor(contractorId: string, path: string): boolean {
  return new RegExp(`^${contractorId.toLowerCase()}/${UUID_LOWER}-[A-Za-z0-9._-]{1,120}$`).test(path);
}

// ── forms ────────────────────────────────────────────────────

export type DocumentMetaInput = {
  contractorId: string;
  documentType: DocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresOn: string | null;
  notes: string | null;
};

function readMeta(f: FormReader): DocumentMetaInput | null {
  const contractorId = f.uuid("contractor_id", { required: true });
  const documentType = f.oneOf("document_type", DOCUMENT_TYPES, { required: true });
  const fileName = f.requiredText("file_name", { max: 255, label: "The file name" });
  const mimeType = f.requiredText("mime_type", { max: 100, label: "The file type" });
  const sizeText = f.text("size_bytes", { max: 15 });
  const sizeBytes = sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : 0;
  const expiresOn = f.date("expires_on");
  const notes = f.text("notes", { max: DOCUMENT_NOTE_MAX, label: "The note" });
  if (f.ok) {
    const problem = uploadProblem({ fileName, mimeType, sizeBytes });
    if (problem) f.errors.file = problem;
  }
  if (!f.ok || !contractorId || !documentType) return null;
  return { contractorId, documentType, fileName, mimeType, sizeBytes, expiresOn, notes };
}

/** Step 1 of an upload: the details of the file the browser is about to send. */
export function readPrepareForm(f: FormReader): DocumentMetaInput | null {
  return readMeta(f);
}

/** Step 3 of an upload: the same details plus the path the browser uploaded to. */
export function readRegisterForm(f: FormReader): (DocumentMetaInput & { storagePath: string }) | null {
  const value = readMeta(f);
  const path = f.text("storage_path", { max: 300 });
  if (value && (!path || !isStoragePathFor(value.contractorId, path))) {
    f.errors.file = "We could not match that upload. Try again.";
    return null;
  }
  return value && path ? { ...value, storagePath: path } : null;
}

export type VerifyInput = {
  documentId: string;
  verification: Verification;
  expiresOn: string | null;
  note: string | null;
  applyToContractor: boolean;
};

export function readVerifyForm(f: FormReader): VerifyInput | null {
  const documentId = f.uuid("document_id", { required: true });
  const verification = f.oneOf("verification", VERIFICATIONS, { required: true });
  const expiresOn = f.date("expires_on");
  const note = f.text("note", { max: DOCUMENT_NOTE_MAX, label: "The note" });
  const applyToContractor = f.bool("apply_to_contractor");
  if (verification === "rejected" && !note && !f.errors.note) f.errors.note = "Say why this document is rejected.";
  if (!f.ok || !documentId || !verification) return null;
  return { documentId, verification, expiresOn, note, applyToContractor: applyToContractor && verification === "verified" };
}

/** "245 KB", "1.2 MB": for the list. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`;
}
