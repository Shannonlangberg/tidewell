import "server-only";

import type { HqClient } from "../db";
import { logTag } from "./db-errors";
import type { TaskFormValues } from "./rules";

/*
 * Checks a Server Action makes before it writes a task: that the person chosen as assignee is
 * an active member of staff, and that each record the task is to be linked to exists AND is
 * visible to this person (a read through row level security, so a record they may not see is
 * indistinguishable from one that does not exist).
 *
 * The foreign keys in the database would also refuse a missing id, but they ignore row level
 * security (a junior could probe whether an id exists from the error), and their errors are not
 * field-level. These checks give the person a useful message and keep the probe closed.
 */

export type LinkCheck = { ok: true } | { ok: false; fieldErrors: Record<string, string> } | { ok: "error" };

const CHOOSE = "Choose one of the options.";

async function exists(promise: PromiseLike<{ data: { id: string } | null; error: { code?: string | null; message?: string | null } | null }>, what: string): Promise<boolean | null> {
  const { data, error } = await promise;
  if (error) {
    console.error(`[hq] task ${what} check failed:`, logTag(error));
    return null;
  }
  return !!data;
}

/**
 * Validates the people and records a task form points at. `canLink` is whether the person may
 * read growth data (growth.read): without it they have no pickers, so any related id they send
 * is refused rather than trusted.
 */
export async function checkTaskReferences(db: HqClient, values: TaskFormValues, opts: { canLink: boolean }): Promise<LinkCheck> {
  const fieldErrors: Record<string, string> = {};
  let failed = false;

  const jobs: Array<Promise<void>> = [];
  const verify = (field: string, id: string | null, run: () => PromiseLike<{ data: { id: string } | null; error: { code?: string | null; message?: string | null } | null }>, what: string) => {
    if (!id) return;
    jobs.push(
      (async () => {
        const found = await exists(run(), what);
        if (found === null) failed = true;
        else if (!found) fieldErrors[field] = CHOOSE;
      })(),
    );
  };

  verify(
    "assigned_to",
    values.assignedTo,
    () => db.from("staff_profiles").select("id").eq("id", values.assignedTo as string).eq("is_active", true).eq("employment_status", "active").maybeSingle(),
    "assignee",
  );

  if (opts.canLink) {
    verify("related_contact_id", values.contactId, () => db.from("contacts").select("id").eq("id", values.contactId as string).is("deleted_at", null).maybeSingle(), "contact");
    verify(
      "related_organisation_id",
      values.organisationId,
      () => db.from("organisations").select("id").eq("id", values.organisationId as string).is("deleted_at", null).maybeSingle(),
      "organisation",
    );
    verify("related_referral_id", values.referralId, () => db.from("referrals").select("id").eq("id", values.referralId as string).is("deleted_at", null).maybeSingle(), "referral");
    verify(
      "related_opportunity_id",
      values.opportunityId,
      () => db.from("opportunities").select("id").eq("id", values.opportunityId as string).is("deleted_at", null).maybeSingle(),
      "opportunity",
    );
  } else {
    // No growth.read: no pickers, so no related ids are accepted.
    if (values.contactId) fieldErrors.related_contact_id = "You can't link this task to a contact.";
    if (values.organisationId) fieldErrors.related_organisation_id = "You can't link this task to an organisation.";
    if (values.referralId) fieldErrors.related_referral_id = "You can't link this task to a referral.";
    if (values.opportunityId) fieldErrors.related_opportunity_id = "You can't link this task to an opportunity.";
  }

  await Promise.all(jobs);
  if (failed) return { ok: "error" };
  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true };
}
