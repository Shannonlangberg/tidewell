import "server-only";

import { requireStaff } from "../auth";
import type { RatingField, TenantFeedback } from "./reviews-form";
import { staffNameMap } from "./section-names";

export type ReviewRow = {
  id: string;
  jobDate: string | null;
  jobReference: string | null;
  ratings: Record<RatingField, number | null>;
  tenantFeedback: TenantFeedback | null;
  reworkRequired: boolean | null;
  notes: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
  createdAt: string;
};

export type PerformanceData = {
  reviews: ReviewRow[];
  /** From hq.contractor_directory: null unless enough RATED reviews exist. */
  rating: number | null;
  ratedReviewCount: number;
  reviewCount: number;
  threshold: number;
  dimensions: Record<RatingField, number | null>;
  today: string;
  businessName: string | null;
};

export async function loadPerformance(contractorId: string): Promise<PerformanceData> {
  const { db } = await requireStaff("contractors.read");
  const [dir, reviews, today] = await Promise.all([
    db
      .from("contractor_directory")
      .select("business_name, rating, rated_review_count, review_count, rating_threshold, rating_response_time, rating_communication, rating_work_quality, rating_invoice_accuracy")
      .eq("id", contractorId)
      .maybeSingle(),
    db
      .from("contractor_reviews")
      .select("id, job_date, job_reference, response_time, communication, work_quality, invoice_accuracy, tenant_feedback, rework_required, notes, recorded_by, created_at")
      .eq("contractor_id", contractorId)
      .is("deleted_at", null)
      .order("job_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(100),
    db.rpc("today"),
  ]);
  if (dir.error) throw new Error(`performance summary ${dir.error.code}`);
  if (reviews.error) throw new Error(`reviews ${reviews.error.code}`);
  if (today.error) throw new Error(`today ${today.error.code}`);

  const rows = reviews.data ?? [];
  const names = await staffNameMap(db, rows.map((r) => r.recorded_by));
  const d = dir.data;
  return {
    today: String(today.data),
    businessName: d?.business_name ?? null,
    rating: d?.rating ?? null,
    ratedReviewCount: d?.rated_review_count ?? 0,
    reviewCount: d?.review_count ?? rows.length,
    threshold: d?.rating_threshold ?? 3,
    dimensions: {
      response_time: d?.rating_response_time ?? null,
      communication: d?.rating_communication ?? null,
      work_quality: d?.rating_work_quality ?? null,
      invoice_accuracy: d?.rating_invoice_accuracy ?? null,
    },
    reviews: rows.map((r) => ({
      id: r.id,
      jobDate: r.job_date,
      jobReference: r.job_reference,
      ratings: { response_time: r.response_time, communication: r.communication, work_quality: r.work_quality, invoice_accuracy: r.invoice_accuracy },
      tenantFeedback: r.tenant_feedback as TenantFeedback | null,
      reworkRequired: r.rework_required,
      notes: r.notes,
      recordedBy: r.recorded_by,
      recordedByName: r.recorded_by ? (names.get(r.recorded_by) ?? null) : null,
      createdAt: r.created_at,
    })),
  };
}
