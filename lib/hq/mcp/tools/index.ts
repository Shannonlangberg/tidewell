/*
 * Every tool the Planted HQ MCP server offers (docs/hq-mcp.md section 2). lib/hq/mcp/server.ts
 * registers these and shows a person only the ones their capabilities allow; each handler ALSO
 * refuses on its own when the capability is missing, and the database refuses again.
 *
 * Single record and named, except the two bulk task tools (bulk-tasks.ts: one call, one transaction,
 * up to 50 tasks, the database's own bulk budget); no deletes. Deliberately not available through chat (HQ screens
 * only): approving, preferring, suspending, reinstating or deactivating a contractor; signing a
 * management or marking it lost; archiving or deleting anything (knowledge documents aside, below); documents; imports; people and
 * roles; settings. Leads can be added, listed, opened, updated and have calls logged; moving a lead's
 * stage stays move_opportunity (never signed or lost). Decisions can be listed, searched, opened, recorded and updated, never archived.
 * Managed properties can be listed, opened, made from a signed lead, updated and have a handover step
 * set, never archived; adding a property signed before HQ and the business goal are HQ screens only.
 * Emails can be drafted (to someone HQ holds, or a typed address that becomes a contact needing a check), listed, opened, changed and discarded,
 * and an APPROVED email sent; approving is a tap in HQ only (chat-send mode aside, see email.ts).
 * Website enquiries can be listed and opened (their text is untrusted public input), and archived or
 * restored (growth.write; reversible, nothing erased); marking spam, the other status changes and
 * choosing who gets them are HQ screens only.
 * The knowledge base can be fully maintained from chat (knowledge.ts): every change to the words is a NEW
 * DRAFT version; approving from chat works only while a director has switched it on; archiving is a
 * reversible soft archive (approvers only). Meetings (meetings.ts) can be saved, listed, searched, opened,
 * summarised for the week, updated (a new version each time), given actions (real tasks) and have a
 * decision added to the register; archiving a meeting is an HQ screen. Projects (projects.ts, focus.ts,
 * project-tasks.ts, bulk-tasks.ts) can be listed, opened, created and changed with their milestones;
 * tasks get projects, milestones, subtasks, dependencies, checklists and comments, can be created or
 * changed 50 at a time, and the focus tools answer "what are my priorities", "what is overdue" and
 * "what is blocking"; archiving a project, its documents and related records are HQ screens only.
 * The brand library (brand.ts) can be listed, opened (text files as content, pictures and PDFs as a 10-minute
 * signed link) and summarised, by anyone with resources.read; adding, replacing and archiving files are HQ screens only.
 * The command center (leadership.ts) answers focus, workboard, launch, waiting, the weekly review and
 * planning items through the dashboard's own rules; it moves tasks between lanes, sets and clears what a
 * task waits on, proposes (then, if agreed, saves) a week plan, and records planning items; it never
 * changes a priority or due date unless asked, and a planning amount is never a balance.
 * Nothing anywhere is hard-deleted.
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
import { archiveEnquiryTool, getEnquiryTool, listEnquiriesTool, restoreEnquiryTool } from "./enquiries";
import {
  approveKnowledge,
  archiveKnowledge,
  createKnowledge,
  discardKnowledgeDraft,
  getKnowledge,
  getKnowledgeVersion,
  listKnowledge,
  listKnowledgeVersions,
  restoreKnowledgeDocument,
  restoreKnowledgeVersion,
  searchKnowledge,
  updateKnowledge,
} from "./knowledge";
import { addMeetingAction, createMeeting, getMeeting, listMeetings, meetingDigest, promoteMeetingDecision, searchMeetings, updateMeeting } from "./meetings";
import { completeMilestone, createMilestone, createProject, getProject, listProjects, updateMilestone, updateProject } from "./projects";
import { addTaskComment, addTaskDependency, completeTask, getTask, removeTaskDependency, setTaskChecklist } from "./project-tasks";
import { founderPriorities, listOverdue, whatIsBlocking } from "./focus";
import { bulkCreateTasks, bulkUpdateTasks } from "./bulk-tasks";
import { getBrandResource, getBrandSummary, listBrandResources } from "./brand";
import {
  focusToday,
  launchProgress,
  listPlanningItems,
  moveTaskToLane,
  planNextWeek,
  resolveWaitingTool,
  savePlanningItemTool,
  setLaunchRequirement,
  setTaskWaiting,
  waitingOn,
  weeklyLeadershipReview,
  workboard,
} from "./leadership";

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
  // website enquiries (reads, and archive / restore; spam and the other statuses are HQ screens)
  listEnquiriesTool,
  getEnquiryTool,
  archiveEnquiryTool,
  restoreEnquiryTool,
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
  // knowledge base (reads for everyone; drafts for writers; approve, archive and restore for approvers)
  listKnowledge,
  searchKnowledge,
  getKnowledge,
  listKnowledgeVersions,
  getKnowledgeVersion,
  createKnowledge,
  updateKnowledge,
  restoreKnowledgeVersion,
  discardKnowledgeDraft,
  approveKnowledge,
  archiveKnowledge,
  restoreKnowledgeDocument,
  // meetings (saved from chat: the assistant writes the minutes, HQ stores them; no archive or delete here)
  listMeetings,
  searchMeetings,
  getMeeting,
  meetingDigest,
  createMeeting,
  updateMeeting,
  addMeetingAction,
  promoteMeetingDecision,
  // projects and richer tasks (projects.read / projects.write; tasks.write for task changes)
  listProjects,
  getProject,
  createProject,
  updateProject,
  createMilestone,
  updateMilestone,
  completeMilestone,
  getTask,
  completeTask,
  addTaskDependency,
  removeTaskDependency,
  addTaskComment,
  setTaskChecklist,
  // focus (read): what to do next, what is late, what is stuck
  founderPriorities,
  listOverdue,
  whatIsBlocking,
  // bulk (kind "bulk": one call, one transaction, the database's bulk budget)
  bulkCreateTasks,
  bulkUpdateTasks,
  // brand resources (read only: the library is added to and changed in HQ by a director or administrator)
  listBrandResources,
  getBrandResource,
  getBrandSummary,
  // command center (leadership.ts): the dashboard's focus, lanes, launch readiness, waiting and planning, through the same rules
  focusToday,
  workboard,
  launchProgress,
  waitingOn,
  weeklyLeadershipReview,
  listPlanningItems,
  setTaskWaiting,
  resolveWaitingTool,
  moveTaskToLane,
  planNextWeek,
  savePlanningItemTool,
  setLaunchRequirement,
];

/** The tools a person with these capabilities may see and call. */
export function toolsFor(capabilities: readonly string[]): ToolDef[] {
  return TOOLS.filter((t) => t.capability === null || capabilities.includes(t.capability));
}
