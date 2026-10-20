/*
 * Plain-language names for the audit log (app/hq/(app)/settings/audit/page.tsx).
 *
 * ENTITY_LABEL covers every entity_type the database writes to hq.audit_events: the audit_row()
 * triggers (0105, 0113, 0123) and the one-off hq_private.audit_write() calls (0110, 0116, 0117,
 * 0120, 0123). ACTION_LABEL covers every action: the trigger's own (create, update, delete,
 * archive, restore, stage_change, status_change) and the ones RPCs set through audit_context() or
 * audit_write(). audit-labels.test.mts reads the migrations and fails if one is missing.
 *
 * Pure: no imports, so `node --test` can run it.
 */

export const ENTITY_LABEL: Record<string, string> = {
  organisation: "Organisation",
  contact: "Contact",
  interaction: "Interaction",
  opportunity: "Opportunity",
  referral: "Referral",
  task: "Task",
  staff: "Person",
  pod: "Pod",
  setting: "Setting",
  role_capability: "Role capability",
  import_batch: "Import",
  contractor: "Contractor",
  contractor_document: "Contractor document",
  contractor_review: "Contractor feedback",
  contractor_vetting_step: "Vetting step",
  trade: "Trade",
  ai_request: "Connected app call",
  decision: "Decision",
  managed_property: "Managed property",
  property_handover_step: "Handover step",
  email_draft: "Email",
  enquiry: "Website enquiry",
};

export const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  archive: "Archived",
  restore: "Restored",
  stage_change: "Stage changed",
  status_change: "Status changed",
  link_task: "Task linked",
  unlink_task: "Task unlinked",
  import: "Imported",
  reorder: "Reordered",
  invite: "Invited",
  bootstrap: "First director set up",
  deactivate: "Deactivated",
  reinstate: "Reinstated",
  attribution: "Credit moved",
  approve: "Approved",
  prefer: "Made preferred",
  suspend: "Suspended",
  verify: "Verified",
  reject: "Rejected",
  apply_document: "Applied a document",
  record_use: "Job recorded",
  expiry_tasks: "Reminder tasks created",
  ai_begin: "Call started",
  ai_finish: "Call finished",
  discard: "Discarded",
  send_start: "Sending started",
  sent: "Sent",
  send_failed: "Not sent",
  enquiry_received: "Received from the website",
  mark_spam: "Marked as spam",
};

const fallback = (s: string) => {
  const words = s.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
};

/** "contractor_document" -> "Contractor document". Unknown values are made readable, never shown raw. */
export function entityLabel(entity: string): string {
  return Object.hasOwn(ENTITY_LABEL, entity) ? ENTITY_LABEL[entity] : fallback(entity);
}

/** "stage_change" -> "Stage changed". Unknown values are made readable, never shown raw. */
export function actionLabel(action: string): string {
  return Object.hasOwn(ACTION_LABEL, action) ? ACTION_LABEL[action] : fallback(action);
}
