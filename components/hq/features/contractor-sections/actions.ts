"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { DOCUMENT_BUCKET, APPLIES_TO_CONTRACTOR, buildStoragePath, readPrepareForm, readRegisterForm, readVerifyForm, type DocumentType } from "@/lib/hq/contractors/documents-rules";
import { readReviewForm } from "@/lib/hq/contractors/reviews-form";
import { GENERIC_FAILURE, failureMessage, logCode } from "@/lib/hq/contractors/section-errors";
import { readVettingStepForm } from "@/lib/hq/contractors/vetting-steps";
import { FormReader, fail, succeed, type ActionState } from "@/lib/hq/forms";
import { safeNextPath } from "@/lib/hq/next-path";

/*
 * Server Actions for the contractor profile sections (vetting, documents, performance) and the
 * dashboard's expiry reminders.
 *
 * Every action calls requireStaff(<capability>) FIRST. The person's identity comes from the
 * session, never from a form field; verified_by, recorded_by, uploaded_by and completed_by are
 * stamped by the database. Every input is validated here on the server whatever the browser
 * did, and the database re-checks it (capability inside each RPC, RLS, constraints), so a
 * forged request fails in both places. Errors shown to people are plain and generic: the raw
 * database message is never shown and only the error CODE is logged.
 *
 *   setVettingStepAction        contractors.write
 *   prepareDocumentUploadAction contractors.documents   (step 1 of 3: validate, sign an upload)
 *   registerDocumentAction      contractors.documents   (step 3 of 3: record the uploaded file)
 *   reviewDocumentAction        contractors.documents   (verify / reject / reset)
 *   archiveDocumentAction       contractors.documents
 *   recordReviewAction          contractors.write
 *   archiveReviewAction         contractors.write       (the database also limits it to the recorder or an approver)
 *   createExpiryTasksAction     contractors.write       (the RPC also needs tasks.write)
 *
 * NO action carries file bytes: the browser uploads directly to Supabase Storage with the signed
 * token from step 1 (docs/hq-phase-2.md 11.7).
 */

/** What the person typed, handed back with a failure so React 19's post-action form reset does not lose it. */
function retained(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of formData.entries()) if (typeof val === "string" && !k.startsWith("$ACTION")) out[k] = val;
  return out;
}

// ── vetting ──────────────────────────────────────────────────

export async function setVettingStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const v = readVettingStepForm(f);
  if (!v) return { ...f.fail(), data: { values: retained(formData) } };

  const { error } = await db.rpc("set_vetting_step", {
    p_contractor: v.contractorId,
    p_step: v.step,
    p_status: v.status,
    ...(v.note ? { p_note: v.note } : {}),
  });
  if (error) {
    console.error("[hq] set_vetting_step failed:", logCode(error));
    return { ...fail(failureMessage(error)), data: { values: retained(formData) } };
  }
  refresh();
  return succeed("Saved.");
}

// ── documents: step 1, prepare ───────────────────────────────

/**
 * Validates the file's declared name, type and size, then returns a signed upload (path and token)
 * created with THE CALLER'S session, so Storage's row level security applies: a person without
 * contractors.documents is refused there as well. The path's folder is the contractor's id and the
 * document id is generated here, never taken from the browser.
 */
export async function prepareDocumentUploadAction(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.documents");
  const f = new FormReader(formData);
  const v = readPrepareForm(f);
  if (!v) return f.fail(f.errors.file ?? undefined);

  // The contractor must exist and be live and visible to this person.
  const found = await db.from("contractors").select("id").eq("id", v.contractorId).is("deleted_at", null).maybeSingle();
  if (found.error) {
    console.error("[hq] prepare upload lookup failed:", logCode(found.error));
    return fail(GENERIC_FAILURE);
  }
  if (!found.data) return fail("That contractor could not be found. It may have been archived.");

  const path = buildStoragePath(v.contractorId, randomUUID(), v.fileName);
  const signed = await db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) {
    console.error("[hq] createSignedUploadUrl failed:", signed.error?.name ?? "error");
    return fail("We could not start the upload. Try again in a moment.");
  }
  return succeed(undefined, { path, token: signed.data.token });
}

// ── documents: step 3, register ──────────────────────────────

export async function registerDocumentAction(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.documents");
  const f = new FormReader(formData);
  const v = readRegisterForm(f);
  if (!v) return f.fail(f.errors.file ?? undefined);

  const { error } = await db.rpc("add_contractor_document", {
    p_contractor: v.contractorId,
    p_document_type: v.documentType,
    p_file_name: v.fileName,
    p_storage_path: v.storagePath,
    p_mime_type: v.mimeType,
    p_size_bytes: v.sizeBytes,
    ...(v.expiresOn ? { p_expires_on: v.expiresOn } : {}),
    ...(v.notes ? { p_notes: v.notes } : {}),
  });
  if (error) {
    console.error("[hq] add_contractor_document failed:", logCode(error));
    return fail(failureMessage(error, "The file was uploaded but could not be recorded. Try again, or contact the team."));
  }
  refresh();
  return succeed("Document added. It is not verified until someone checks it.");
}

// ── documents: verify, reject, reset ─────────────────────────

export async function reviewDocumentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.documents");
  const f = new FormReader(formData);
  const v = readVerifyForm(f);
  if (!v) return { ...f.fail(), data: { values: retained(formData) } };

  // The row, as this person may see it: confirms it exists and tells us its type and current expiry.
  const doc = await db.from("contractor_documents").select("id, document_type, expires_on").eq("id", v.documentId).is("deleted_at", null).maybeSingle();
  if (doc.error) {
    console.error("[hq] document lookup failed:", logCode(doc.error));
    return fail(GENERIC_FAILURE);
  }
  if (!doc.data) return fail("That document could not be found. It may have been archived.");

  if (v.applyToContractor) {
    if (!APPLIES_TO_CONTRACTOR.includes(doc.data.document_type as DocumentType)) {
      return fail("Only a licence or public liability insurance can be recorded on the contractor.", { apply_to_contractor: "Only a licence or public liability insurance can be recorded on the contractor." });
    }
    if (!v.expiresOn && !doc.data.expires_on) {
      return fail("Enter the expiry date shown on the document to record it on the contractor.", { expires_on: "Enter the expiry date shown on the document." });
    }
  }

  const { error } = await db.rpc("verify_contractor_document", {
    p_document: v.documentId,
    p_verification: v.verification,
    ...(v.expiresOn ? { p_expires_on: v.expiresOn } : {}),
    ...(v.note ? { p_note: v.note } : {}),
    p_apply_to_contractor: v.applyToContractor,
  });
  if (error) {
    console.error("[hq] verify_contractor_document failed:", logCode(error));
    return fail(failureMessage(error));
  }
  refresh();
  return succeed("Saved.");
}

// ── archive (document or review) ─────────────────────────────

async function archive(entity: "contractor_document" | "contractor_review", capability: "contractors.documents" | "contractors.write", formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff(capability);
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const reason = f.text("reason", { max: 200, label: "The reason" });
  if (!f.ok || !id) return fail("We could not archive that. Reload the page and try again.", f.errors);

  const { error } = await db.rpc("archive_record", { p_entity: entity, p_id: id, ...(reason ? { p_reason: reason } : {}) });
  if (error) {
    console.error("[hq] archive_record failed:", entity, logCode(error));
    return fail(failureMessage(error, "We could not archive that. Try again in a moment."));
  }
  refresh();
  return succeed("Archived.");
}

/** The stored file is kept: archiving hides the row, it does not erase the object. */
export async function archiveDocumentAction(formData: FormData): Promise<ActionState> {
  return archive("contractor_document", "contractors.documents", formData);
}

export async function archiveReviewAction(formData: FormData): Promise<ActionState> {
  return archive("contractor_review", "contractors.write", formData);
}

// ── performance: record job feedback ─────────────────────────

export async function recordReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const v = readReviewForm(f);
  if (!v) return { ...f.fail(), data: { values: retained(formData) } };

  const { error } = await db.rpc("record_contractor_review", {
    p_contractor: v.contractorId,
    ...(v.jobDate ? { p_job_date: v.jobDate } : {}),
    ...(v.jobReference ? { p_job_reference: v.jobReference } : {}),
    ...(v.ratings.response_time !== null ? { p_response_time: v.ratings.response_time } : {}),
    ...(v.ratings.communication !== null ? { p_communication: v.ratings.communication } : {}),
    ...(v.ratings.work_quality !== null ? { p_work_quality: v.ratings.work_quality } : {}),
    ...(v.ratings.invoice_accuracy !== null ? { p_invoice_accuracy: v.ratings.invoice_accuracy } : {}),
    ...(v.tenantFeedback ? { p_tenant_feedback: v.tenantFeedback } : {}),
    ...(v.reworkRequired !== null ? { p_rework_required: v.reworkRequired } : {}),
    ...(v.notes ? { p_notes: v.notes } : {}),
  });
  if (error) {
    console.error("[hq] record_contractor_review failed:", logCode(error));
    return { ...fail(failureMessage(error)), data: { values: retained(formData) } };
  }
  refresh();
  return succeed("Feedback recorded.");
}

// ── dashboard: expiry reminder tasks ─────────────────────────

/**
 * "Create reminder tasks": one task per expired or expiring item that has no open task yet.
 * Idempotent in the database, so pressing it twice creates nothing the second time. It sends
 * no email or text: the tasks are the reminder.
 */
export async function createExpiryTasksAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("contractors.write");
  const back = safeNextPath(formData.get("next"));
  const { data, error } = await db.rpc("create_expiry_tasks");
  if (error) {
    console.error("[hq] create_expiry_tasks failed:", logCode(error));
    const message = error.code === "42501" ? "You need permission to create tasks as well as to manage contractors." : GENERIC_FAILURE;
    redirect(withToast(back, message, "error"));
  }
  const o = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const created = typeof o.created === "number" ? o.created : 0;
  const skipped = typeof o.skipped === "number" ? o.skipped : 0;
  const text =
    created === 0 && skipped === 0
      ? "Nothing to remind about."
      : created === 0
        ? `No new tasks. ${skipped === 1 ? "1 item already has" : `${skipped} items already have`} an open reminder.`
        : `Created ${created === 1 ? "1 reminder task" : `${created} reminder tasks`}${skipped > 0 ? `, skipped ${skipped} that already had one` : ""}.`;
  redirect(withToast(back, text));
}

