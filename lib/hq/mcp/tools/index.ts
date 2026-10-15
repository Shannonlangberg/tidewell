/*
 * Every tool the Planted HQ MCP server offers (docs/hq-mcp.md section 2). lib/hq/mcp/server.ts
 * registers these and shows a person only the ones their capabilities allow; each handler ALSO
 * refuses on its own when the capability is missing, and the database refuses again.
 *
 * Single record, named, no bulk, no deletes. Deliberately not available through chat (HQ screens
 * only): approving, preferring, suspending, reinstating or deactivating a contractor; signing a
 * management or marking it lost; archiving or deleting anything; documents; imports; people and
 * roles; settings.
 */
import type { ToolDef } from "../types";
import { fetchRecord, search } from "./read-search";
import { contractorExpiries, getContractor, searchContractors } from "./read-contractors";
import { getContact, listReferrals, pipelineSummary, searchContacts, searchOrganisations, whoToContact } from "./read-growth";
import { listTasks, teamDirectory } from "./read-team";
import { contractorReport, dailyBrief, growthReport, weeklyReport } from "./reports";
import { createTask, updateTask } from "./write-tasks";
import { createContact, createOrganisation, logInteraction, moveOpportunity, recordReferral, updateContact } from "./write-growth";
import { logContractorContact, recordContractorReview, setVettingStep, updateContractor } from "./write-contractors";

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
  // reports
  dailyBrief,
  growthReport,
  contractorReport,
  weeklyReport,
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
  setVettingStep,
  recordReferral,
  moveOpportunity,
];

/** The tools a person with these capabilities may see and call. */
export function toolsFor(capabilities: readonly string[]): ToolDef[] {
  return TOOLS.filter((t) => t.capability === null || capabilities.includes(t.capability));
}
