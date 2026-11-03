"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, RELATIONSHIP_LABEL } from "@/lib/hq/constants";
import { FormReader } from "@/lib/hq/forms";
import { PATHWAY_STEPS, STEP_LABEL } from "@/lib/hq/growth/pathway";
import { movePartner } from "@/lib/hq/growth/pathway-queries";
import { safeNextPath } from "@/lib/hq/next-path";

/*
 * "Move to Cultivate" / "Move back to Connect" on a referral partner. Reachable by a direct POST, so it
 * starts with requireStaff("growth.write") and takes identity from the session only. Who changes is
 * worked out again here from the people as they are now (lib/hq/growth/pathway.ts); the page only showed
 * a preview. Each change is an ordinary contact update, so it is in the audit trail.
 */
export async function movePartnerStage(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const kind = f.oneOf("kind", ["organisation", "independent"] as const, { required: true });
  const id = f.uuid("id", { required: true });
  const to = f.oneOf("to", PATHWAY_STEPS, { required: true });
  const fallback = kind === "independent" && id ? `${HQ_BASE}/growth/contacts/${id}` : id ? `${HQ_BASE}/growth/organisations/${id}` : `${HQ_BASE}/growth/partners`;
  const back = safeNextPath(formData.get("return_to"), fallback);
  if (!f.ok || !kind || !id || !to) redirect(withToast(back, "That move could not be made.", "error"));

  const result = await movePartner(db, { kind, id }, to);
  if (!result.ok) redirect(withToast(back, result.message, result.kind === "refused" ? "info" : "error"));

  revalidatePath(`${HQ_BASE}/growth`, "layout");
  revalidatePath(HQ_BASE);
  const who = result.plan.changes.map((c) => `${c.name} is now ${RELATIONSHIP_LABEL[c.to]}`).join("; ");
  redirect(withToast(back, `Moved to ${STEP_LABEL[to]}. ${who}.`));
}
