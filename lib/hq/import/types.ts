/*
 * Shapes shared by the import Server Action and its client screen. Plain data only, so they
 * cross the server/client boundary safely.
 */

import type { ActionState } from "../forms";

export type ImportClassification = "new_organisation" | "new_contact" | "duplicate" | "possible_duplicate" | "invalid";

export const CLASSIFICATION_LABEL: Record<ImportClassification, string> = {
  new_organisation: "New organisation",
  new_contact: "New contact",
  duplicate: "Duplicate",
  possible_duplicate: "Possible duplicate",
  invalid: "Invalid",
};

export type ImportReviewRow = {
  /** 1-based position of the row among the file's data rows. */
  line: number;
  organisation: string;
  fullName: string;
  classification: ImportClassification;
  /** The reason in plain words: why it is new, a duplicate, or invalid. */
  reason: string;
  /** What would happen to it now: create it, or skip it. */
  action: "create" | "skip";
  /** The person ticked "import as a separate person" (possible duplicates only). */
  confirmedDistinct: boolean;
};

export type ImportCounts = {
  rows: number;
  organisationsToCreate: number;
  contactsToCreate: number;
  /** Rows that will not be written: duplicates, unconfirmed possible duplicates and invalid rows. */
  skipped: number;
  duplicates: number;
  possibleDuplicates: number;
  invalid: number;
};

export type ImportReview = {
  /** Changes with every review, so the form can start fresh from the new defaults. */
  version: number;
  /** Where the rows came from: "file" the person uploaded or the "research" leads bundled with HQ. */
  origin: "file" | "research";
  fileName: string;
  /** The label stored as the source of every imported row. */
  source: string;
  rows: ImportReviewRow[];
  counts: ImportCounts;
  /** The valid rows, as JSON, carried to the next step. Validated again on the server every time. */
  payload: string;
  warnings: string[];
};

export type ImportResult = {
  batchId: string | null;
  rowsInFile: number;
  organisationsCreated: number;
  contactsCreated: number;
  alreadyInHq: number;
  possibleDuplicates: number;
  invalid: number;
  skipped: number;
  fileName: string;
  source: string;
};

/** What the import Server Action returns: an ordinary form result, plus a review or an outcome. */
export type ImportState = ActionState & {
  review?: ImportReview;
  result?: ImportResult;
};
