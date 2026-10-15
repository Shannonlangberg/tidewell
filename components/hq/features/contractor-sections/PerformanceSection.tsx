import { EmptyState, ErrorState } from "@/components/hq/EmptyState";
import { SectionLabel } from "@/components/hq/Primitives";
import { StatusChip } from "@/components/hq/StatusChip";
import { ArchiveButton } from "@/components/hq/features/contacts/ArchiveButton";
import { requireStaff } from "@/lib/hq/auth";
import { loadPerformance } from "@/lib/hq/contractors/reviews-queries";
import {
  RATING_FIELDS,
  RATING_LABEL,
  TENANT_FEEDBACK_LABEL,
  TENANT_FEEDBACK_TONE,
  describeRatings,
  ratingSummary,
} from "@/lib/hq/contractors/reviews-form";
import { formatDate, plural } from "@/lib/hq/format";
import { archiveReviewAction } from "./actions";
import { ReviewForm } from "./ReviewForm";

/*
 * The performance section of a contractor's profile: recorded job feedback and, ONLY when there is
 * enough of it, a summary. The summary is the database's own (hq.contractor_directory.rating): it is
 * null until `rating_threshold` reviews that carry a rating exist, and until then this says
 * "Not enough feedback yet (n of m)". There is never a placeholder rating or a partial average.
 */
export async function PerformanceSection({ contractorId }: { contractorId: string }) {
  const { staff, can } = await requireStaff("contractors.read");
  const canWrite = can("contractors.write");

  let data: Awaited<ReturnType<typeof loadPerformance>>;
  try {
    data = await loadPerformance(contractorId);
  } catch (e) {
    console.error("[hq] performance section failed:", e instanceof Error ? e.message : "error");
    return (
      <section aria-labelledby="performance-h">
        <div className="mb-3.5 border-b border-line pb-3.5">
          <SectionLabel as="h2" id="performance-h">
            Performance
          </SectionLabel>
        </div>
        <ErrorState title="We could not load the feedback" />
      </section>
    );
  }

  const summary = ratingSummary(data.rating, data.ratedReviewCount, data.threshold);
  const unrated = data.reviewCount - data.ratedReviewCount;

  return (
    <section aria-labelledby="performance-h">
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pb-3.5">
        <SectionLabel as="h2" id="performance-h">
          Performance
        </SectionLabel>
        {canWrite ? <ReviewForm contractorId={contractorId} businessName={data.businessName ?? "this contractor"} today={data.today} /> : null}
      </div>

      <div className="mb-5">
        {summary.enough ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="hq-nums text-[20px] font-semibold">{summary.text}</span>
              <span className="hq-muted text-[13px]">from {plural(data.ratedReviewCount, "rated review")}</span>
            </p>
            <dl className="hq-muted mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
              {RATING_FIELDS.filter((k) => data.dimensions[k] !== null).map((k) => (
                <div key={k} className="flex gap-1.5">
                  <dt>{RATING_LABEL[k]}</dt>
                  <dd className="hq-nums font-medium text-charcoal">{(Math.round((data.dimensions[k] ?? 0) * 10) / 10).toFixed(1)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p className="text-[14px]">
            <span className="font-medium">{summary.text}.</span>{" "}
            <span className="hq-muted">An overall rating appears once {plural(data.threshold, "review")} with a rating are recorded.</span>
          </p>
        )}
        {unrated > 0 ? <p className="hq-muted mt-1 text-[13px]">{plural(unrated, "note-only review")} recorded without ratings.</p> : null}
      </div>

      {data.reviews.length === 0 ? (
        <EmptyState compact title="No feedback yet">
          {canWrite ? "After a job, record how it went: ratings, whether the tenant said anything, and whether rework was needed." : "No feedback has been recorded for this contractor."}
        </EmptyState>
      ) : (
        <ul aria-label="Job feedback, newest first" className="m-0 list-none p-0">
          {data.reviews.map((r) => {
            const ratings = describeRatings(r.ratings);
            const canArchive = canWrite && (r.recordedBy === staff.id || can("contractors.approve"));
            return (
              <li key={r.id} className="border-t border-line py-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="font-medium">
                      {r.jobDate ? formatDate(r.jobDate) : `Recorded ${formatDate(r.createdAt, staff.timezone)}`}
                      {r.jobReference ? <span className="hq-muted font-normal"> · {r.jobReference}</span> : null}
                    </p>
                    {ratings ? <p className="hq-nums mt-1 text-[14px]">{ratings}</p> : <p className="hq-muted mt-1 text-[13px]">No ratings given.</p>}
                    {r.tenantFeedback || r.reworkRequired !== null ? (
                      <p className="mt-2 flex flex-wrap items-center gap-2">
                        {r.tenantFeedback ? (
                          <StatusChip tone={TENANT_FEEDBACK_TONE[r.tenantFeedback]} plain={r.tenantFeedback === "none_received"}>
                            Tenant feedback: {TENANT_FEEDBACK_LABEL[r.tenantFeedback].toLowerCase()}
                          </StatusChip>
                        ) : null}
                        {r.reworkRequired !== null ? (
                          <StatusChip tone={r.reworkRequired ? "warning" : "neutral"} plain={!r.reworkRequired}>
                            {r.reworkRequired ? "Rework needed" : "No rework needed"}
                          </StatusChip>
                        ) : null}
                      </p>
                    ) : null}
                    {r.notes ? <p className="mt-2 whitespace-pre-line text-[14px]">{r.notes}</p> : null}
                    <p className="hq-muted mt-2 text-[13px]">
                      Recorded{r.recordedByName ? ` by ${r.recordedByName}` : ""}, {formatDate(r.createdAt, staff.timezone)}.
                    </p>
                  </div>
                  {canArchive ? (
                    <div className="flex-none">
                      <ArchiveButton
                        id={r.id}
                        noun="feedback"
                        name="this feedback"
                        size="sm"
                        action={archiveReviewAction}
                        consequence="It stops counting towards the rating and leaves this list. The record is kept in the audit log."
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
