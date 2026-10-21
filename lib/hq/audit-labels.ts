/*
 * Plain-language names for the audit log (app/hq/(app)/settings/audit/page.tsx).
 *
 * ENTITY_LABEL covers every entity_type the database writes to hq.audit_events: the audit_row()
 * triggers (0105, 0113, 0123, 0142, 0151) and the one-off hq_private.audit_write() calls (0110, 0116, 0117,
 * 0120, 0123, 0144). ACTION_LABEL covers every action: the trigger's own (create, update, delete,
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
  knowledge_document: "Knowledge document",
  meeting: "Meeting",
  // projects (0142, 0144)
  project: "Project",
  project_milestone: "Milestone",
  planning_item: "Planning item",
  task_batch: "Batch of tasks",
  // resources (0151, 0152)
  brand_resource: "Brand resource",
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
  auto_reply_sent: "Thank-you sent",
  auto_reply_failed: "Thank-you not sent",
  auto_reply_skipped: "Thank-you not sent",
  edit: "New draft saved",
  discard_draft: "Draft discarded",
  restore_version: "Older version brought back as a draft",
  // meetings (0140): written by hq_private.meeting_bump
  add_attendee: "Attendee added",
  remove_attendee: "Attendee removed",
  link: "Record linked",
  unlink: "Record unlinked",
  add_action: "Action added",
  promote_decision: "Decision added to the register",
  // projects (0144): one event per bulk call through a connected app
  bulk_create: "Tasks created in bulk",
  bulk_update: "Tasks updated in bulk",
  // resources (0152): a new file registered as the current one (the old object is kept)
  replace_file: "File replaced",
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
