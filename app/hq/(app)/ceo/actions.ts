"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { FormReader, fail, succeed, type ActionState } from "@/lib/hq/forms";
import { TARGET_KEYS, TARGET_LABEL, type Targets } from "@/lib/hq/ceo/rules";

/*
 * Server Actions for the CEO Command Centre. Reachable by a direct POST, so each starts with
 * requireStaff(capability), takes identity from the session only, checks its inputs and writes ONLY
 * through an hq RPC (set_ceo_targets), which checks settings.admin again, validates the values and is
 * audited through the settings row. People see plain messages; only error codes are logged.
 */

const CHECK = "Please check the highlighted targets and try again.";

export async function setCeoTargets(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  const reader = new FormReader(formData);
  const targets: Targets = {};
  for (const key of TARGET_KEYS) {
    const raw = (reader.text(key, { max: 5, label: TARGET_LABEL[key] }) ?? "").trim();
    if (!raw) continue;
    if (!/^\d{1,4}$/.test(raw) || Number(raw) > 1000) {
      reader.errors[key] = "A whole number from 0 to 1000, or leave it empty for no target.";
      continue;
    }
    targets[key] = Number(raw);
  }
  if (!reader.ok) return fail(CHECK, reader.errors);
  const { data, error } = await db.rpc("set_ceo_targets", { p_targets: targets });
  if (error) {
    console.error("[hq] setCeoTargets failed:", error.code ?? "unknown");
    return fail(error.code === "42501" ? "You don't have permission to do that." : "Something went wrong and nothing was saved. Try again in a moment.");
  }
  revalidatePath(`${HQ_BASE}/ceo`, "layout");
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  return succeed(changed ? (Object.keys(targets).length ? "Weekly targets saved." : "Weekly targets cleared.") : "Nothing changed.");
}
