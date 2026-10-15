import { LinkButton } from "@/components/hq/Button";
import { EmptyState, ErrorState } from "@/components/hq/EmptyState";
import { InlineNote, SectionLabel } from "@/components/hq/Primitives";
import { StatusChip } from "@/components/hq/StatusChip";
import { ArchiveButton } from "@/components/hq/features/contacts/ArchiveButton";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { loadDocuments } from "@/lib/hq/contractors/documents-queries";
import {
  APPLIES_TO_CONTRACTOR,
  DOCUMENT_TYPE_LABEL,
  MAX_DOCUMENT_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_TONE,
  expiryBadge,
  formatBytes,
} from "@/lib/hq/contractors/documents-rules";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { archiveDocumentAction } from "./actions";
import { DocumentReview } from "./DocumentReview";
import { DocumentUpload } from "./DocumentUpload";

/*
 * The documents section of a contractor's profile. A Server Component that loads its own data.
 *
 *  - contractors.read: sees that each document exists (type, file name, expiry, verification status,
 *    who uploaded it and when). Cannot open it, upload, verify or archive.
 *  - contractors.documents: can also upload, open (a link that lasts 60 seconds, checked first
 *    under row level security by the route handler), verify or reject, and archive.
 *
 * No file bytes pass through here or through any Server Action. HQ does not scan files for malware.
 */

export const DOCUMENT_OPEN_PATH = (id: string) => `${HQ_BASE}/partners/documents/${id}/open`;

export async function DocumentsSection({ contractorId }: { contractorId: string }) {
  const { staff, can } = await requireStaff("contractors.read");
  const canDocs = can("contractors.documents");

  const heading = (
    <SectionLabel as="h2" id="documents-h">
      Documents
    </SectionLabel>
  );
  let data: Awaited<ReturnType<typeof loadDocuments>>;
  let businessName = "this contractor";
  try {
    data = await loadDocuments(contractorId);
    businessName = data.businessName ?? businessName;
  } catch (e) {
    console.error("[hq] documents section failed:", e instanceof Error ? e.message : "error");
    return (
      <section aria-labelledby="documents-h">
        <div className="mb-3.5 border-b border-line pb-3.5">{heading}</div>
        <ErrorState title="We could not load the documents" />
      </section>
    );
  }

  return (
    <section aria-labelledby="documents-h">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3.5">
        {heading}
        {canDocs ? <DocumentUpload contractorId={contractorId} businessName={businessName} /> : null}
      </div>

      <InlineNote className="mb-5">
        {canDocs
          ? `Documents are kept in private storage (PDF, JPEG or PNG, up to ${MAX_DOCUMENT_LABEL}) and open through a link that lasts 60 seconds. HQ does not scan files for viruses, so only upload files you trust. Verifying a document never approves a contractor.`
          : "You can see which documents exist, their expiry and whether they have been checked. Opening or uploading files needs document access, which your role does not include."}
      </InlineNote>

      {data.rows.length === 0 ? (
        <EmptyState compact title="No documents yet">
          {canDocs ? "Upload a licence, insurance certificate or agreement, and record when it expires so HQ can warn before it lapses." : "No documents have been uploaded for this contractor."}
        </EmptyState>
      ) : (
        <ul aria-label="Documents" className="m-0 list-none p-0">
          {data.rows.map((d) => {
            const badge = expiryBadge(d.expiresOn, data.today, data.warningDays);
            const appliesTo = d.documentType === "licence" ? "licence" : d.documentType === "public_liability_insurance" ? "insurance" : null;
            return (
              <li key={d.id} className="border-t border-line py-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="font-medium">{DOCUMENT_TYPE_LABEL[d.documentType]}</p>
                    <p className="hq-muted mt-0.5 break-words text-[13px]">
                      {d.fileName} · {formatBytes(d.sizeBytes)}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusChip tone={VERIFICATION_TONE[d.verification]}>{VERIFICATION_LABEL[d.verification]}</StatusChip>
                      <StatusChip tone={badge.tone} plain={badge.plain}>
                        {badge.label}
                      </StatusChip>
                    </p>
                    <p className="hq-muted mt-2 text-[13px]">
                      Uploaded{d.uploadedByName ? ` by ${d.uploadedByName}` : ""}, {formatDateTime(d.uploadedAt, staff.timezone)}
                      {d.verifiedAt ? `. ${d.verification === "rejected" ? "Rejected" : "Verified"}${d.verifiedByName ? ` by ${d.verifiedByName}` : ""}, ${formatDate(d.verifiedAt, staff.timezone)}` : ""}
                      {d.expiresOn ? `. Expiry date ${formatDate(d.expiresOn)}` : ""}.
                    </p>
                    {d.verificationNote ? <p className="mt-1 whitespace-pre-line text-[14px]">{d.verificationNote}</p> : null}
                    {d.notes ? <p className="hq-muted mt-1 whitespace-pre-line text-[13px]">{d.notes}</p> : null}
                  </div>

                  {canDocs ? (
                    <div className="flex flex-none flex-wrap items-center gap-2">
                      <LinkButton href={DOCUMENT_OPEN_PATH(d.id)} external target="_blank" rel="noopener noreferrer" size="sm" variant="secondary" aria-label={`Open ${d.fileName}`}>
                        Open
                      </LinkButton>
                      <DocumentReview
                        doc={{
                          id: d.id,
                          documentType: d.documentType,
                          fileName: d.fileName,
                          verification: d.verification,
                          expiresOn: d.expiresOn,
                          note: d.verificationNote,
                          canApply: APPLIES_TO_CONTRACTOR.includes(d.documentType),
                          appliesTo,
                        }}
                      />
                      <ArchiveButton
                        id={d.id}
                        noun="document"
                        name={`${DOCUMENT_TYPE_LABEL[d.documentType]}: ${d.fileName}`}
                        size="sm"
                        action={archiveDocumentAction}
                        consequence="It will no longer appear here or count towards expiry warnings. The stored file is kept, not erased."
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
