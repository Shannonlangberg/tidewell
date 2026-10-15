/*
 * Which status actions a person is offered for a contractor, and how the database's approval
 * preview is read. Pure and import-free.
 *
 * What is offered is a courtesy: the database decides (guard trigger plus the RPCs). Hiding a
 * button is never the control, and a forged request is refused there.
 *
 *   approve / prefer      contractors.approve   through approve_contractor
 *   suspend               contractors.write     through set_contractor_status (a safety action: quick)
 *   reinstate             contractors.approve   through reinstate_contractor, always back to vetting
 *   other moves           contractors.write     through set_contractor_status, never to approved / preferred
 */

type Status = "prospect" | "contacted" | "vetting" | "approved" | "preferred" | "suspended" | "inactive";

/** Where set_contractor_status may send a contractor, whatever it is now (never approved or preferred, never out of suspended). */
export const MOVE_TARGETS: readonly Status[] = ["prospect", "contacted", "vetting", "inactive"];

export type StatusActionSet = {
  approve: boolean;
  prefer: boolean;
  removePreferred: boolean;
  suspend: boolean;
  reinstate: boolean;
  /** The statuses the "Change status" action can send this contractor to. Empty hides the action. */
  moves: Status[];
};

export function statusActions(status: Status, caps: { write: boolean; approve: boolean }): StatusActionSet {
  return {
    // Approval from prospect / contacted / vetting is allowed once the checklist is done (the preview says whether it is).
    approve: caps.approve && (status === "prospect" || status === "contacted" || status === "vetting"),
    prefer: caps.approve && status === "approved",
    removePreferred: caps.approve && status === "preferred",
    suspend: caps.write && status !== "suspended",
    reinstate: caps.approve && status === "suspended",
    moves: caps.write && status !== "suspended" ? MOVE_TARGETS.filter((s) => s !== status) : [],
  };
}

export type ApprovalWarning = {
  code: string;
  message: string;
  expiresOn: string | null;
  daysRemaining: number | null;
};

export type ApprovalPreview = {
  status: string;
  canApprove: boolean;
  /** not_permitted | suspended | inactive | checklist_incomplete */
  blockedBy: string[];
  /** Step keys among steps 1 to 8 that are neither done nor not applicable, in checklist order. */
  missingSteps: string[];
  warnings: ApprovalWarning[];
};

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parseWarnings(v: unknown): ApprovalWarning[] {
  if (!Array.isArray(v)) return [];
  const out: ApprovalWarning[] = [];
  for (const w of v) {
    if (!w || typeof w !== "object") continue;
    const r = w as Record<string, unknown>;
    if (typeof r.code !== "string" || typeof r.message !== "string") continue;
    out.push({
      code: r.code,
      message: r.message,
      expiresOn: typeof r.expires_on === "string" ? r.expires_on : null,
      daysRemaining: typeof r.days_remaining === "number" ? r.days_remaining : null,
    });
  }
  return out;
}

/** Reads preview_contractor_approval's jsonb. Null when it does not have the expected shape. */
export function parseApprovalPreview(data: unknown): ApprovalPreview | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  if (typeof r.status !== "string" || typeof r.can_approve !== "boolean") return null;
  return { status: r.status, canApprove: r.can_approve, blockedBy: strings(r.blocked_by), missingSteps: strings(r.missing_steps), warnings: parseWarnings(r.warnings) };
}

/** A plain sentence for why approval is not possible right now. */
export function blockedText(blockedBy: readonly string[]): string | null {
  if (blockedBy.includes("not_permitted")) return "Only a director or administrator can approve a contractor.";
  if (blockedBy.includes("suspended")) return "This contractor is suspended. Reinstate them first; they return to vetting.";
  if (blockedBy.includes("inactive")) return "This contractor is inactive. Move them back to vetting before approving.";
  if (blockedBy.includes("checklist_incomplete")) return "The vetting checklist is not complete yet.";
  return blockedBy.length > 0 ? "This contractor cannot be approved right now." : null;
}
