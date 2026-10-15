import "server-only";

import { requireStaff } from "../auth";
import type { DocumentType, Verification } from "./documents-rules";
import { staffNameMap } from "./section-names";

export type DocumentRow = {
  id: string;
  documentType: DocumentType;
  fileName: string;
  sizeBytes: number;
  verification: Verification;
  verifiedByName: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  expiresOn: string | null;
  notes: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
};

export type DocumentsData = { rows: DocumentRow[]; warningDays: number; today: string; businessName: string | null };

const DEFAULT_WARNING_DAYS = 30;

/**
 * The contractor's live documents, newest first. Needs contractors.read (document METADATA is
 * visible to everyone who can read contractors); the files themselves need contractors.documents
 * and are opened through the route handler, never from here.
 */
export async function loadDocuments(contractorId: string): Promise<DocumentsData> {
  const { db } = await requireStaff("contractors.read");
  const [docs, today, summary, contractor] = await Promise.all([
    db
      .from("contractor_documents")
      .select("id, document_type, file_name, size_bytes, verification, verified_by, verified_at, verification_note, expires_on, notes, uploaded_by, uploaded_at")
      .eq("contractor_id", contractorId)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(200),
    db.rpc("today"),
    db.rpc("contractor_summary"),
    db.from("contractor_directory").select("business_name").eq("id", contractorId).maybeSingle(),
  ]);
  if (docs.error) throw new Error(`documents ${docs.error.code}`);
  if (today.error) throw new Error(`today ${today.error.code}`);

  const rows = docs.data ?? [];
  const names = await staffNameMap(db, rows.flatMap((d) => [d.uploaded_by, d.verified_by]));
  const sj = summary.data;
  const warningDays =
    sj && typeof sj === "object" && !Array.isArray(sj) && typeof sj.warning_days === "number" && sj.warning_days > 0 ? sj.warning_days : DEFAULT_WARNING_DAYS;

  return {
    today: String(today.data),
    warningDays,
    businessName: contractor.data?.business_name ?? null,
    rows: rows.map((d) => ({
      id: d.id,
      documentType: d.document_type,
      fileName: d.file_name,
      sizeBytes: d.size_bytes,
      verification: d.verification,
      verifiedByName: d.verified_by ? (names.get(d.verified_by) ?? null) : null,
      verifiedAt: d.verified_at,
      verificationNote: d.verification_note,
      expiresOn: d.expires_on,
      notes: d.notes,
      uploadedByName: d.uploaded_by ? (names.get(d.uploaded_by) ?? null) : null,
      uploadedAt: d.uploaded_at,
    })),
  };
}
