/*
 * Input schemas for the Knowledge base MCP tools (zod raw shapes). Imports only zod: the enum lists are
 * written out and pinned to lib/hq/knowledge/rules.ts and edits.ts by knowledge-schemas.test.mts.
 */
import { z } from "zod";

export const KNOWLEDGE_CATEGORY_VALUES = [
  "company_procedure", "contractor_vetting", "referral_partner", "landlord_onboarding", "staff_policy", "operational_checklist", "brand_voice", "general",
] as const;
export const KNOWLEDGE_STATUS_FILTER_VALUES = ["approved", "draft", "waiting"] as const;
export const KNOWLEDGE_EDIT_OP_VALUES = ["replace_text", "append_section", "add_to_section", "replace_section"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORY_TEXT =
  "company_procedure (company procedures), contractor_vetting (contractor vetting procedures), referral_partner (referral partner procedures), landlord_onboarding (landlord onboarding guidance), staff_policy (staff policies), operational_checklist (operational checklists), brand_voice (brand, voice and vision: how PLANTED. speaks, its tone, words, vision, values and key messages), general";

const doc = (what: string) =>
  z.string().trim().min(1).max(200).describe(`${what}: its number as HQ shows it (KB-0001), its id from an earlier result, or words of its title (if several match you get candidates to choose from).`);
const limit = z.number().int().min(1).max(25).optional().describe("Optional. How many rows to return, 1 to 25 (default 10).");
const changeNote = z.string().trim().min(1).max(300).describe("Required. A short note saying what changed and why (at most 300 characters), kept in the version history.");
const expected = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe("Optional but recommended: the current_version you read with get_knowledge. If someone else saved a version since, nothing is changed and you are told to read it again.");

export const listKnowledgeShape = {
  category: z.enum(KNOWLEDGE_CATEGORY_VALUES).optional().describe(`Optional. Only this category: ${CATEGORY_TEXT}.`),
  status: z.enum(KNOWLEDGE_STATUS_FILTER_VALUES).optional().describe("Optional. approved (has an approved version), draft (never approved yet) or waiting (a written draft waiting for approval: a new document, or a newer draft of an approved one; unwritten starter templates are left out)."),
  review_due: z.boolean().optional().describe("Optional. true: only documents whose review date has passed or falls within 30 days."),
  owner: z.string().trim().max(200).optional().describe('Optional. Only documents owned by this person: "me", a staff name, or a staff id.'),
  limit,
};

export const searchKnowledgeShape = {
  query: z.string().trim().min(2).max(100).describe("Words to find in a document's title, summary or approved text (2 to 100 characters), or a number like KB-0001."),
  category: z.enum(KNOWLEDGE_CATEGORY_VALUES).optional().describe("Optional. Only this category (brand_voice for how PLANTED. speaks)."),
  limit,
};

export const getKnowledgeShape = {
  document: doc("The document"),
  which: z
    .enum(["approved", "draft", "both"])
    .optional()
    .describe("Optional. Which text to return: approved (what staff read), draft (the newer draft waiting for approval; people who can edit only), or both (default)."),
  section: z.string().trim().min(1).max(200).optional().describe("Optional. Return only the section under this heading (useful for long documents)."),
};

export const listKnowledgeVersionsShape = {
  document: doc("The document"),
  limit,
};

export const getKnowledgeVersionShape = {
  document: doc("The document"),
  version: z.number().int().min(1).describe("The version number to open (from list_knowledge_versions)."),
  compare_to: z.number().int().min(1).optional().describe("Optional. Another version to compare with (default: the version before it that you can see)."),
  section: z.string().trim().min(1).max(200).optional().describe("Optional. Return only the section under this heading."),
};

export const createKnowledgeShape = {
  title: z.string().trim().min(1).max(200).describe("The document's title (at most 200 characters; unique among live documents)."),
  category: z.enum(KNOWLEDGE_CATEGORY_VALUES).describe(`The category: ${CATEGORY_TEXT}.`),
  body: z
    .string()
    .min(1)
    .max(50_000)
    .describe(
      "The text, at most 50,000 characters, in this markdown subset: # / ## / ### headings, paragraphs, - bullet lists, 1. numbered lists, - [ ] checklist items, **bold**, *italic*, [links](https://...) and --- rules. Structure it: a first line 'Purpose: ...', then short sections under ## headings (for example Who this is for, Steps, Checklist, Owner, Review). Use only what the person said: never invent policies, prices, fees, legal or compliance claims.",
    ),
  summary: z.string().trim().max(500).optional().describe("Optional. One or two sentences saying what the document is for (at most 500 characters)."),
  owner: z.string().trim().max(200).optional().describe('Optional. Who keeps it up to date: "me" (default), an active staff name, or id.'),
  review_due: z.string().regex(DATE, "Use YYYY-MM-DD.").optional().describe("Optional. When it should next be reviewed (YYYY-MM-DD; today to five years ahead)."),
  change_note: z.string().trim().max(300).optional().describe("Optional. A note for the history (default: First draft)."),
};

export const updateKnowledgeShape = {
  document: doc("The document to change"),
  change_note: changeNote,
  expected_version: expected,
  body: z
    .string()
    .min(1)
    .max(50_000)
    .optional()
    .describe("Optional. The WHOLE new text, replacing the current text (same markdown subset as create_knowledge). For a small change to a long document, use edit instead so you do not resend everything."),
  edit: z
    .object({
      op: z
        .enum(KNOWLEDGE_EDIT_OP_VALUES)
        .describe(
          "replace_text: exactly one occurrence of old_text becomes new_text (empty new_text removes it). append_section: a new '## heading' section at the end. add_to_section: text added at the end of an existing section (a list item joins its list). replace_section: the content under an existing heading is replaced.",
        ),
      heading: z.string().trim().max(200).optional().describe("For append_section, add_to_section and replace_section: the section heading (without the # marks)."),
      text: z.string().max(50_000).optional().describe("For append_section, add_to_section and replace_section: the text to add or put in."),
      old_text: z.string().max(10_000).optional().describe("For replace_text: the exact words to replace, copied from the current text; they must appear exactly once."),
      new_text: z.string().max(50_000).optional().describe("For replace_text: the words to put in their place (empty removes them)."),
    })
    .optional()
    .describe("Optional. One targeted change to the current text (the newest draft if one is waiting, otherwise the approved text). Missing or ambiguous matches are refused, never guessed."),
  title: z.string().trim().min(1).max(200).optional().describe("Optional. A new title (part of the new draft; readers see it once approved)."),
  summary: z.string().trim().max(500).optional().describe('Optional. A new summary (part of the new draft), or "none" to remove it.'),
  category: z.enum(KNOWLEDGE_CATEGORY_VALUES).optional().describe("Optional. Move it to another category (a filing detail: changes straight away, recorded in the audit trail)."),
  owner: z.string().trim().max(200).optional().describe('Optional. A new owner: "me", an active staff name or id (changes straight away, audited).'),
  review_due: z.string().trim().max(10).optional().describe('Optional. A new review date (YYYY-MM-DD, today to five years ahead), or "none" to remove it (changes straight away, audited).'),
};

export const restoreKnowledgeVersionShape = {
  document: doc("The document"),
  version: z.number().int().min(1).describe("The older version to copy in as a new draft (from list_knowledge_versions)."),
  change_note: z.string().trim().max(300).optional().describe("Optional. Why (default: Restored from version N)."),
  expected_version: expected,
};

export const approveKnowledgeShape = {
  document: doc("The document"),
  version: z.number().int().min(1).describe("The draft version to approve: the newest draft, as shown by get_knowledge. Approving any other version is refused."),
};

export const discardKnowledgeDraftShape = {
  document: doc("The document"),
  version: z.number().int().min(1).describe("The draft version to discard: the newest draft, as shown by get_knowledge."),
  reason: z.string().trim().max(300).optional().describe("Optional. Why it is discarded (at most 300 characters)."),
};

export const archiveKnowledgeShape = {
  document: doc("The document to archive"),
  reason: z.string().trim().min(1).max(200).describe("Why it is archived (at most 200 characters), kept in the audit trail."),
};

export const restoreKnowledgeDocumentShape = {
  document: doc("The ARCHIVED document to bring back (its KB number or id is best)"),
};
