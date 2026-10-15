"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { EMPLOYMENT_STATUSES, HQ_BASE, STAFF_ROLES } from "@/lib/hq/constants";
import { FormReader, fail, isUuid, succeed, type ActionState } from "@/lib/hq/forms";
import { createStaffLogin, removeStaffLogin } from "@/lib/hq/staff-admin";
import { staffErrorMessage } from "@/lib/hq/staff-errors";

/*
 * Server Actions for People. Every one starts with requireStaff("people.admin") and calls the
 * database AS the administrator, so the hq.add_staff / update_staff / deactivate_staff RPCs and
 * row level security make the final decision (for example: only a director may add or change a
 * director; the last active director cannot be removed). Errors shown to people are written in
 * lib/hq/staff-errors.ts; the database's own words never reach the screen.
 *
 * Inviting is the one place the secret key is involved, through lib/hq/staff-admin.ts, and only
 * to create the login. No password is ever set: the person signs in with an emailed code.
 */

/** What the person typed, handed back so React 19's form reset does not wipe it after a failure. */
function withValues(state: ActionState, formData: FormData, names: readonly string[]): ActionState {
  const values: Record<string, string> = {};
  for (const n of names) {
    const v = formData.get(n);
    if (typeof v === "string") values[n] = v.slice(0, 2000);
  }
  return { ...state, data: { ...state.data, values } };
}

const firstNameOf = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? fullName;

// ── invite ───────────────────────────────────────────────────

const INVITE_FIELDS = ["fullName", "email", "role", "pod", "startDate", "responsibilities"] as const;

export async function inviteStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { staff, db } = await requireStaff("people.admin");

  const f = new FormReader(formData);
  const fullName = f.requiredText("fullName", { label: "Full name", max: 120 });
  const email = f.email("email", { required: true });
  const role = f.oneOf("role", STAFF_ROLES, { required: true });
  const pod = f.uuid("pod");
  const startDate = f.date("startDate");
  const responsibilities = f.text("responsibilities", { label: "Responsibilities", max: 2000 });
  // The database refuses this too; saying so here saves a round trip and a half-made login.
  if (role === "director" && staff.role !== "director") f.errors.role = "Only a director can add another director.";
  if (!f.ok || !email || !role) return withValues(f.fail(), formData, INVITE_FIELDS);

  const firstName = firstNameOf(fullName);
  const login = await createStaffLogin({ email, fullName, firstName });
  if (!login.ok) {
    return withValues(fail("We could not set up a sign-in for that address. Check it and try again."), formData, INVITE_FIELDS);
  }

  const { error } = await db.rpc("add_staff", {
    p_user_id: login.userId,
    p_email: email,
    p_full_name: fullName,
    p_role: role,
    p_first_name: firstName,
    ...(pod ? { p_pod: pod } : {}),
    ...(startDate ? { p_start_date: startDate } : {}),
    ...(responsibilities ? { p_responsibilities: responsibilities } : {}),
  });
  if (error) {
    // Do not leave a login behind that this flow made and that HQ does not know about.
    if (login.created) await removeStaffLogin(login.userId);
    console.error("[hq] add_staff failed:", error.code);
    return withValues(fail(staffErrorMessage(error, "We could not add that person. Try again in a moment.")), formData, INVITE_FIELDS);
  }

  redirect(withToast(`${HQ_BASE}/people/${login.userId}?invited=1`, `${fullName} has been added.`));
}

// ── edit ─────────────────────────────────────────────────────

const EDIT_FIELDS = ["fullName", "firstName", "role", "employmentStatus", "pod", "startDate", "responsibilities"] as const;

export async function updateStaffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { staff, db } = await requireStaff("people.admin");

  const f = new FormReader(formData);
  const id = f.uuid("staffId", { required: true });
  const fullName = f.requiredText("fullName", { label: "Full name", max: 120 });
  const firstName = f.requiredText("firstName", { label: "First name", max: 60 });
  const self = id === staff.id;
  // Nobody changes their own role or status (the database refuses it), so those fields are not even read.
  const role = self ? null : f.oneOf("role", STAFF_ROLES, { required: true });
  const status = self ? null : f.oneOf("employmentStatus", EMPLOYMENT_STATUSES, { required: true });
  const pod = f.uuid("pod");
  const startDate = f.date("startDate");
  const responsibilities = f.text("responsibilities", { label: "Responsibilities", max: 2000 });
  if (role === "director" && staff.role !== "director") f.errors.role = "Only a director can make someone a director.";
  if (!f.ok || !id) return withValues(f.fail(), formData, EDIT_FIELDS);

  // Only send the pod when it CHANGED: an unchanged pod that has since been deactivated would
  // otherwise be refused ("pod not found or inactive") on every save.
  const { data: current, error: readError } = await db.from("staff_profiles").select("pod_id").eq("id", id).maybeSingle();
  if (readError || !current) return withValues(fail("We could not find that person."), formData, EDIT_FIELDS);
  const podChanged = (pod ?? null) !== (current.pod_id ?? null);

  const { error } = await db.rpc("update_staff", {
    p_staff_id: id,
    p_full_name: fullName,
    p_first_name: firstName,
    ...(role ? { p_role: role } : {}),
    ...(status ? { p_employment_status: status } : {}),
    ...(podChanged ? (pod ? { p_pod: pod } : { p_clear_pod: true }) : {}),
    ...(startDate ? { p_start_date: startDate } : {}),
    ...(responsibilities ? { p_responsibilities: responsibilities } : {}),
  });
  if (error) {
    console.error("[hq] update_staff failed:", error.code);
    return withValues(fail(staffErrorMessage(error, "We could not save those changes. Try again in a moment.")), formData, EDIT_FIELDS);
  }
  refresh();
  return succeed("Changes saved.");
}

// ── deactivate ───────────────────────────────────────────────

/** Ends someone's access at once (the live staff row is read on every query). History is kept. */
export async function deactivateStaffAction(staffId: string): Promise<ActionState> {
  const { db } = await requireStaff("people.admin");
  if (!isUuid(staffId)) return fail("We could not find that person.");
  const id = staffId;

  const { error } = await db.rpc("deactivate_staff", { p_staff_id: id });
  if (error) {
    console.error("[hq] deactivate_staff failed:", error.code);
    return fail(staffErrorMessage(error, "We could not deactivate that person. Try again in a moment."));
  }
  refresh();
  return succeed("Their access has ended.");
}

// ── pods ─────────────────────────────────────────────────────

export async function createPodAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("people.admin");
  const f = new FormReader(formData);
  const name = f.requiredText("name", { label: "Pod name", max: 80 });
  const region = f.text("region", { label: "Region", max: 120 });
  if (!f.ok) return withValues(f.fail(), formData, ["name", "region"]);

  const { error } = await db.from("pods").insert({ name, region });
  if (error) {
    console.error("[hq] creating a pod failed:", error.code);
    return withValues(fail(staffErrorMessage(error, "We could not add that pod. Try again in a moment.")), formData, ["name", "region"]);
  }
  refresh();
  return succeed(`${name} added.`);
}

export async function setPodActiveAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("people.admin");
  const f = new FormReader(formData);
  const id = f.uuid("podId", { required: true });
  const active = f.oneOf("active", ["true", "false"] as const, { required: true });
  if (!f.ok || !id || !active) redirect(withToast(`${HQ_BASE}/people`, "We could not change that pod.", "error"));

  const { data, error } = await db.from("pods").update({ is_active: active === "true" }).eq("id", id).select("id");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing a pod failed:", error?.code);
    redirect(withToast(`${HQ_BASE}/people`, "We could not change that pod. Try again in a moment.", "error"));
  }
  redirect(withToast(`${HQ_BASE}/people`, active === "true" ? "Pod reactivated." : "Pod deactivated."));
}
