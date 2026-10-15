/*
 * Shapes shared by the contractor import Server Action and its client screen. Plain data only, so
 * they cross the server/client boundary safely.
 */

import type { ActionState } from "../forms";

export type ContractorImportClassification = "new_contractor" | "duplicate" | "possible_duplicate" | "invalid";

export const CONTRACTOR_CLASSIFICATION_LABEL: Record<ContractorImportClassification, string> = {
  new_contractor: "New contractor",
  duplicate: "Already in HQ",
  possible_duplicate: "Possible duplicate",
  invalid: "Invalid",
};

export type ContractorReviewRow = {
  /** 1-based position of the row among the file's data rows. */
  line: number;
  businessName: string;
  classification: ContractorImportClassification;
  /** The reason in plain words, from the database. */
  reason: string;
  action: "create" | "skip";
  /** The existing contractor this row matches, so the person can open it before deciding. */
  matchContractorId: string | null;
  /** The earlier row of the same file this one matches. */
  matchRow: number | null;
  /** The person ticked "import as a separate contractor" (possible duplicates only). */
  confirmedDistinct: boolean;
  /** Carries a flag that will be written into the internal notes for a person to verify. */
  flagged: boolean;
};

export type ContractorImportCounts = {
  rows: number;
  toCreate: number;
  /** Rows that will not be written: duplicates, unconfirmed possible duplicates and invalid rows. */
  skipped: number;
  duplicates: number;
  possibleDuplicates: number;
  invalid: number;
  flagged: number;
};

export type ContractorImportReview = {
  /** Changes with every review, so the form can start fresh from the new defaults. */
  version: number;
  /** "file" the person uploaded, or the "prospects" bundled with HQ. */
  origin: "file" | "prospects";
  fileName: string;
  source: string;
  rows: ContractorReviewRow[];
  counts: ContractorImportCounts;
  /** The valid rows as JSON, carried to the next step. Validated again on the server every time. */
  payload: string;
  warnings: string[];
};

export type ContractorImportResult = {
  batchId: string | null;
  rowsInFile: number;
  contractorsCreated: number;
  alreadyInHq: number;
  possibleDuplicates: number;
  invalid: number;
  skipped: number;
  flagged: number;
  fileName: string;
  source: string;
};

/** What the import Server Action returns: an ordinary form result, plus a review or an outcome. */
export type ContractorImportState = ActionState & {
  review?: ContractorImportReview;
  result?: ContractorImportResult;
};
