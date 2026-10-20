"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { isUuid } from "@/lib/hq/forms";
import { ENQUIRY_STATUS_LABEL } from "@/lib/hq/enquiry-rules";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for website enquiries. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff(capability) FIRST (growth.write for the status and spam; settings.admin for
 *      who gets enquiries), so a forged request from a role without it is redirected out before
 *      anything is read or written;
 *   2. takes identity from the session only (the database stamps who handled it);
 *   3. validates every input on the server (ids are UUIDs, statuses from the list);
 *   4. writes ONLY through the hq RPCs (set_enquiry_status, mark_enquiry_spam, set_enquiry_owner),
 *      which check the capability again and audit.
 * People see plain messages; only error codes are logged.
 */

const LIST = `${HQ_BASE}/growth/enquiries`;
const GENERIC = "Something went wrong and nothing was changed. Try again in a moment.";

function idFrom(formData: FormData): string | null {
  const raw = formData.get("id");
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

function refresh(id?: string) {
  revalidatePath(LIST);
  revalidatePath(HQ_BASE);
  if (id) revalidatePath(`${LIST}/${id}`);
}

const STATUSES = ["new", "in_progress", "archived"] as const;
type SettableStatus = (typeof STATUSES)[number];

export async function setEnquiryStatusAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIST, "That enquiry could not be found.", "error"));
  const raw = formData.get("status");
  const status = typeof raw === "string" && (STATUSES as readonly string[]).includes(raw) ? (raw as SettableStatus) : null;
  if (!status) redirect(withToast(`${LIST}/${id}`, GENERIC, "error"));
  const { data, error } = await db.rpc("set_enquiry_status", { p_id: id, p_status: status });
  if (error) {
    console.error("[hq] setEnquiryStatus failed:", error.code ?? "unknown");
    redirect(withToast(`${LIST}/${id}`, error.code === "P0002" ? "That enquiry could not be found." : GENERIC, "error"));
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${LIST}/${id}`, changed ? `Marked ${ENQUIRY_STATUS_LABEL[status].toLowerCase()}` : "Nothing changed", changed ? "success" : "info"));
}

export async function markEnquirySpamAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIST, "That enquiry could not be found.", "error"));
  const { data, error } = await db.rpc("mark_enquiry_spam", { p_id: id, p_note: "Marked as spam in HQ" });
  if (error) {
    console.error("[hq] markEnquirySpam failed:", error.code ?? "unknown");
    redirect(withToast(`${LIST}/${id}`, error.code === "P0002" ? "That enquiry could not be found." : GENERIC, "error"));
  }
  refresh(id);
  revalidatePath(`${HQ_BASE}/growth/pipeline`);
  const out = (data ?? {}) as { changed?: boolean; lead_archived?: boolean; contact_archived?: boolean };
  const tidy = out.lead_archived ? (out.contact_archived ? " Its lead and contact were archived." : " Its lead was archived.") : "";
  redirect(withToast(`${LIST}/${id}`, out.changed === false ? "Already marked as spam" : `Marked as spam.${tidy}`, out.changed === false ? "info" : "success"));
}

/** Directors: who gets website enquiries (an active member of staff, or empty for the earliest director). */
export async function setEnquiryOwnerAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("settings.admin");
  const raw = formData.get("owner");
  const owner = typeof raw === "string" && raw !== "" ? (isUuid(raw) ? raw.toLowerCase() : null) : "";
  const back = `${HQ_BASE}/settings`;
  if (owner === null) redirect(withToast(back, "Choose someone from the list.", "error"));
  const { data, error } = await db.rpc("set_enquiry_owner", owner ? { p_staff: owner } : {});
  if (error) {
    console.error("[hq] setEnquiryOwner failed:", error.code ?? "unknown");
    redirect(withToast(back, error.code === "22023" ? "That person is not an active member of staff." : GENERIC, "error"));
  }
  revalidatePath(`${HQ_BASE}/settings`);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(back, changed ? (owner ? "Saved. New website enquiries go to them." : "Saved. New website enquiries go to the first director.") : "Nothing changed", changed ? "success" : "info"));
}
