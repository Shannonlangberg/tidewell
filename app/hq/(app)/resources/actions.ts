"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { FormReader, fail, isUuid, succeed, type ActionState } from "@/lib/hq/forms";
import { findDuplicate, readObject, titleTaken } from "@/lib/hq/resources/queries";
import {
  GENERIC_RESOURCE_ERROR,
  RESOURCE_BUCKET,
  RESOURCE_NOT_FOUND,
  buildStoragePath,
  readPrepareAddForm,
  readPrepareReplaceForm,
  readRegisterAddForm,
  readRegisterReplaceForm,
  readUpdateForm,
  resourceErrorMessage,
  type DbError,
} from "@/lib/hq/resources/rules";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for Resources. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff("resources.manage") FIRST (everyone reads and downloads; only a director or
 *      administrator adds, changes, replaces, archives or restores),
 *   2. takes identity from the session only (the database stamps who added and who changed),
 *   3. validates every input on the server (FormReader + the resource rules),
 *   4. writes ONLY through the hq RPCs (register_brand_resource, update_brand_resource,
 *      replace_brand_resource_file, archive_brand_resource, restore_brand_resource), which check the
 *      capability again, enforce the rules and write the audit trail.
 *
 * Adding or replacing a file is the three steps of contractor documents (docs/hq-phase-2.md 11.7):
 *   1. prepare*   validates the details, refuses a title or content already in the library, and returns a
 *                 signed upload path and token made with THIS person's session (the bucket's policy applies);
 *   2. the BROWSER uploads the file straight to Storage (file bytes never pass through a Server Action);
 *   3. register*  reads the stored object back as the person, checks its size and SHA-256 against what the
 *                 browser declared, then records it through the RPC (which checks the object again).
 * People see plain messages; only error codes are logged.
 */

const LIB = `${HQ_BASE}/resources`;
const CHECK = "Please check the highlighted fields and try again.";

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string) {
  revalidatePath(LIB);
  if (id) revalidatePath(`${LIB}/${id}`, "layout");
}

/** A problem with one field: the field says it in full, the summary only points at it. */
const fieldFail = (field: string, message: string): ActionState => fail(CHECK, { [field]: message });

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { ...base.data, values: retainedValues(formData) } });

// ── add a file ───────────────────────────────────────────────

export async function prepareAddResourceAction(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("resources.manage");
  const f = new FormReader(formData);
  const v = readPrepareAddForm(f);
  if (!v) return f.fail(f.errors.file ?? CHECK);

  const [taken, dup] = await Promise.all([titleTaken(db, v.title), findDuplicate(db, v.category, v.sha256)]);
  if (!taken.ok || !dup.ok) return fail(GENERIC_RESOURCE_ERROR);
  if (taken.data) return fieldFail("title", "Another resource already has that title. Choose a different one.");
  if (dup.data) return fieldFail("file", `This file is already in the library as ${dup.data.ref} "${dup.data.title}" (the same content in the same category).`);

  const resourceId = randomUUID();
  const path = buildStoragePath(resourceId, randomUUID(), v.fileName);
  const signed = await db.storage.from(RESOURCE_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) {
    console.error("[hq] createSignedUploadUrl failed:", signed.error?.name ?? "error");
    return fail("We could not start the upload. Try again in a moment.");
  }
  return succeed(undefined, { resourceId, path, token: signed.data.token });
}

/** Reads the uploaded object back as the person and checks it is the file the browser described. */
async function checkStored(db: Parameters<typeof readObject>[0], path: string, sizeBytes: number, sha256: string): Promise<string | null> {
  const bytes = await readObject(db, path);
  if (!bytes) return "The file was uploaded but we could not check it. Try again.";
  if (bytes.length !== sizeBytes || createHash("sha256").update(bytes).digest("hex") !== sha256) {
    return "The uploaded file does not match the one you chose. Try again.";
  }
  return null;
}

export async function registerAddResourceAction(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("resources.manage");
  const f = new FormReader(formData);
  const v = readRegisterAddForm(f);
  if (!v) return f.fail(f.errors.file ?? CHECK);

  const mismatch = await checkStored(db, v.storagePath, v.sizeBytes, v.sha256);
  if (mismatch) return fieldFail("file", mismatch);

  const { data, error } = await db.rpc("register_brand_resource", {
    p_title: v.title,
    p_category: v.category,
    p_description: v.description ?? "",
    p_file_name: v.fileName,
    p_storage_path: v.storagePath,
    p_mime_type: v.mimeType,
    p_size_bytes: v.sizeBytes,
    p_content_sha256: v.sha256,
    p_tags: v.tags,
    p_note: v.note ?? "",
    p_sort_order: v.sortOrder,
  });
  const out = data as { resource_id?: string; ref?: string } | null;
  if (error || !out?.resource_id) {
    logged("register_brand_resource", error);
    return fail(error ? resourceErrorMessage(error) : GENERIC_RESOURCE_ERROR);
  }
  refresh(out.resource_id);
  return succeed(`${out.ref ?? "Resource"} added.`, { id: out.resource_id });
}

// ── replace a file ───────────────────────────────────────────

export async function prepareReplaceResourceAction(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("resources.manage");
  const f = new FormReader(formData);
  const v = readPrepareReplaceForm(f);
  if (!v) return f.fail(f.errors.file ?? CHECK);

  const current = await db.from("brand_resources").select("category, content_sha256").eq("id", v.id).is("deleted_at", null).maybeSingle();
  if (current.error) {
    logged("prepare replace lookup", current.error);
    return fail(GENERIC_RESOURCE_ERROR);
  }
  if (!current.data) return fail(RESOURCE_NOT_FOUND);
  if (current.data.content_sha256 === v.sha256) return fieldFail("file", "That file is the same as the current version.");
  const dup = await findDuplicate(db, current.data.category, v.sha256, v.id);
  if (!dup.ok) return fail(GENERIC_RESOURCE_ERROR);
  if (dup.data) return fieldFail("file", `This file is already in the library as ${dup.data.ref} "${dup.data.title}" (the same content in the same category).`);

  const path = buildStoragePath(v.id, randomUUID(), v.fileName);
  const signed = await db.storage.from(RESOURCE_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data) {
    console.error("[hq] createSignedUploadUrl failed:", signed.error?.name ?? "error");
    return fail("We could not start the upload. Try again in a moment.");
  }
  return succeed(undefined, { path, token: signed.data.token });
}

export async function registerReplaceResourceAction(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("resources.manage");
  const f = new FormReader(formData);
  const v = readRegisterReplaceForm(f);
  if (!v) return f.fail(f.errors.file ?? CHECK);

  const mismatch = await checkStored(db, v.storagePath, v.sizeBytes, v.sha256);
  if (mismatch) return fieldFail("file", mismatch);

  const { data, error } = await db.rpc("replace_brand_resource_file", {
    p_id: v.id,
    p_file_name: v.fileName,
    p_storage_path: v.storagePath,
    p_mime_type: v.mimeType,
    p_size_bytes: v.sizeBytes,
    p_content_sha256: v.sha256,
    ...(v.versionLabel ? { p_version_label: v.versionLabel } : {}),
    ...(v.changeNote ? { p_change_note: v.changeNote } : {}),
  });
  const out = data as { version?: string; ref?: string } | null;
  if (error || !out) {
    logged("replace_brand_resource_file", error);
    return fail(error ? resourceErrorMessage(error) : GENERIC_RESOURCE_ERROR);
  }
  refresh(v.id);
  return succeed(`${out.ref ?? "Resource"} is now ${out.version ?? "updated"}. The earlier file is kept in the version history.`, { id: v.id });
}

// ── edit the details ─────────────────────────────────────────

export async function updateResourceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("resources.manage");
  const f = new FormReader(formData);
  const v = readUpdateForm(f);
  if (!v) return withValues(f.fail(CHECK), formData);

  const { data, error } = await db.rpc("update_brand_resource", {
    p_id: v.id,
    p_title: v.title,
    p_description: v.description ?? "",
    p_category: v.category,
    p_tags: v.tags,
    p_note: v.note ?? "",
    p_sort_order: v.sortOrder,
  });
  if (error || !data) {
    logged("update_brand_resource", error);
    return withValues(fail(error ? resourceErrorMessage(error) : GENERIC_RESOURCE_ERROR), formData);
  }
  refresh(v.id);
  const changed = (data as { changed?: boolean }).changed !== false;
  redirect(withToast(`${LIB}/${v.id}`, changed ? "Details saved" : "Nothing had changed"));
}

// ── archive and restore ──────────────────────────────────────

function idFrom(formData: FormData): string | null {
  const raw = formData.get("id");
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

export async function archiveResourceAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("resources.manage");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIB, RESOURCE_NOT_FOUND, "error"));
  const { error } = await db.rpc("archive_brand_resource", { p_id: id, p_reason: "Archived from the resource page" });
  if (error) {
    logged("archive_brand_resource", error);
    redirect(withToast(`${LIB}/${id}`, resourceErrorMessage(error), "error"));
  }
  refresh(id);
  redirect(withToast(LIB, "Resource archived. Nothing was erased: a director or administrator can restore it."));
}

export async function restoreResourceAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("resources.manage");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIB, RESOURCE_NOT_FOUND, "error"));
  const { error } = await db.rpc("restore_brand_resource", { p_id: id });
  if (error) {
    logged("restore_brand_resource", error);
    redirect(withToast(`${LIB}/${id}`, resourceErrorMessage(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${LIB}/${id}`, "Resource restored"));
}
