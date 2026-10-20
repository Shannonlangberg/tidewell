/*
 * Every tool the Planted HQ MCP server offers (docs/hq-mcp.md section 2). lib/hq/mcp/server.ts
 * registers these and shows a person only the ones their capabilities allow; each handler ALSO
 * refuses on its own when the capability is missing, and the database refuses again.
 *
 * Single record, named, no bulk, no deletes. Deliberately not available through chat (HQ screens
 * only): approving, preferring, suspending, reinstating or deactivating a contractor; signing a
 * management or marking it lost; archiving or deleting anything; documents; imports; people and
 * roles; settings. Leads can be added, listed, opened, updated and have calls logged; moving a lead's
 * stage stays move_opportunity (never signed or lost). Decisions can be listed, searched, opened, recorded and updated, never archived.
 * Managed properties can be listed, opened, made from a signed lead, updated and have a handover step
 * set, never archived; adding a property signed before HQ and the business goal are HQ screens only.
 * Emails can be drafted (to someone HQ holds an address for), listed, opened, changed and discarded,
 * and an APPROVED email sent; approving is a tap in HQ only (chat-send mode aside, see email.ts).
 * Website enquiries can be listed and opened (their text is untrusted public input); marking spam,
 * changing a status and choosing who gets them are HQ screens only.
 */
import type { ToolDef } from "../types";
import { fetchRecord, search } from "./read-search";
import { contractorExpiries, getContractor, searchContractors } from "./read-contractors";
import { getContact, listReferrals, pipelineSummary, searchContacts, searchOrganisations, whoToContact } from "./read-growth";
import { listTasks, teamDirectory } from "./read-team";
import { contractorReport, dailyBrief, growthReport, weeklyReport } from "./reports";
import { createTask, updateTask } from "./write-tasks";
import { createContact, createOrganisation, logInteraction, moveOpportunity, recordReferral, updateContact } from "./write-growth";
import { logContractorContact, recordContractorJob, recordContractorReview, setVettingStep, updateContractor } from "./write-contractors";
import { createDecision, getDecision, listDecisions, searchDecisions, updateDecision } from "./decisions";
import { createOpportunity, getOpportunity, listInteractions, listOpportunities, logOpportunityActivity, updateOpportunity } from "./opportunities";
import { businessSummary, createManagedProperty, getManagedProperty, listManagedProperties, setHandoverStep, updateManagedProperty } from "./portfolio";
import { discardEmailDraft, draftEmail, getEmailDraft, listEmailDrafts, sendEmailDraft, updateEmailDraft } from "./email";
import { getEnquiryTool, listEnquiriesTool } from "./enquiries";

export const TOOLS: ToolDef[] = [
  // read
  search,
  fetchRecord,
  searchContractors,
  getContractor,
  contractorExpiries,
  searchContacts,
  getContact,
  searchOrganisations,
  listTasks,
  listReferrals,
  pipelineSummary,
  whoToContact,
  teamDirectory,
  listDecisions,
  searchDecisions,
  getDecision,
  listOpportunities,
  getOpportunity,
  listInteractions,
  listManagedProperties,
  getManagedProperty,
  // website enquiries (read only: spam and status are HQ screens)
  listEnquiriesTool,
  getEnquiryTool,
  // reports
  dailyBrief,
  growthReport,
  contractorReport,
  weeklyReport,
  businessSummary,
  // write
  createTask,
  updateTask,
  logInteraction,
  logContractorContact,
  createContact,
  updateContact,
  createOrganisation,
  updateContractor,
  recordContractorReview,
  recordContractorJob,
  setVettingStep,
  recordReferral,
  moveOpportunity,
  createDecision,
  updateDecision,
  createOpportunity,
  updateOpportunity,
  logOpportunityActivity,
  createManagedProperty,
  updateManagedProperty,
  setHandoverStep,
  // email (drafts, and sending an approved one)
  listEmailDrafts,
  getEmailDraft,
  draftEmail,
  updateEmailDraft,
  discardEmailDraft,
  sendEmailDraft,
];

/** The tools a person with these capabilities may see and call. */
export function toolsFor(capabilities: readonly string[]): ToolDef[] {
  return TOOLS.filter((t) => t.capability === null || capabilities.includes(t.capability));
}
