/*
 * Job feedback on a contractor: reading the form, and wording the summary.
 *
 * Pure with no value imports (see vetting-steps.ts for why), so `node --test` runs it.
 *
 * Rules mirror hq.record_contractor_review: each of the four ratings is 1 to 5 or left blank
 * ("rate what you know"); at least one rating or a note is required; the job date cannot be in
 * the future. The database enforces them again. The overall rating is NEVER computed here:
 * it comes from hq.contractor_directory and is null until enough rated reviews exist.
 */

import type { FormReader } from "../forms";

export const RATING_FIELDS = ["response_time", "communication", "work_quality", "invoice_accuracy"] as const;
export type RatingField = (typeof RATING_FIELDS)[number];

export const RATING_LABEL: Record<RatingField, string> = {
  response_time: "Response time",
  communication: "Communication",
  work_quality: "Quality of work",
  invoice_accuracy: "Invoice accuracy",
};

export const TENANT_FEEDBACK = ["positive", "neutral", "negative", "none_received"] as const;
export type TenantFeedback = (typeof TENANT_FEEDBACK)[number];

export const TENANT_FEEDBACK_LABEL: Record<TenantFeedback, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  none_received: "None received",
};

export const TENANT_FEEDBACK_TONE: Record<TenantFeedback, "success" | "neutral" | "error"> = {
  positive: "success",
  neutral: "neutral",
  negative: "error",
  none_received: "neutral",
};

export const RATING_VALUES = ["1", "2", "3", "4", "5"] as const;

/** What each point on the scale means, shown beside the controls. */
export const RATING_SCALE_HINT = "1 is poor, 5 is excellent. Leave a rating blank if you do not know.";

export type ReviewInput = {
  contractorId: string;
  jobDate: string | null;
  jobReference: string | null;
  ratings: Record<RatingField, number | null>;
  tenantFeedback: TenantFeedback | null;
  reworkRequired: boolean | null;
  notes: string | null;
};

export function readReviewForm(f: FormReader): ReviewInput | null {
  const contractorId = f.uuid("contractor_id", { required: true });
  const jobDate = f.date("job_date");
  const jobReference = f.text("job_reference", { max: 200, label: "The job reference" });
  const ratings = {} as Record<RatingField, number | null>;
  for (const field of RATING_FIELDS) {
    const v = f.oneOf(field, RATING_VALUES);
    ratings[field] = v === null ? null : Number(v);
  }
  const tenantFeedback = f.oneOf("tenant_feedback", TENANT_FEEDBACK);
  const rework = f.oneOf("rework_required", ["yes", "no"] as const);
  const notes = f.text("notes", { max: 2000, label: "The notes" });

  const anyRating = RATING_FIELDS.some((k) => ratings[k] !== null);
  if (f.ok && !anyRating && !notes) {
    f.errors.notes = "Give at least one rating, or write a note.";
  }
  if (!f.ok || !contractorId) return null;
  return {
    contractorId,
    jobDate,
    jobReference,
    ratings,
    tenantFeedback,
    reworkRequired: rework === null ? null : rework === "yes",
    notes,
  };
}

/**
 * The summary line. `rating` comes from the database and is null unless `rated >= threshold`;
 * this never invents a figure.
 */
export function ratingSummary(rating: number | null | undefined, rated: number, threshold: number): { enough: boolean; text: string } {
  if (rating !== null && rating !== undefined && rated >= threshold) {
    return { enough: true, text: `${(Math.round(rating * 10) / 10).toFixed(1)} out of 5` };
  }
  return { enough: false, text: `Not enough feedback yet (${rated} of ${threshold})` };
}

/** "Quality of work 4, Communication 5". Ratings left blank are left out. */
export function describeRatings(r: Partial<Record<RatingField, number | null>>): string {
  return RATING_FIELDS.filter((k) => r[k] !== null && r[k] !== undefined)
    .map((k) => `${RATING_LABEL[k]} ${r[k]}`)
    .join(", ");
}
