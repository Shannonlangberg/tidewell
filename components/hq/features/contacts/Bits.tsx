import { CATEGORY_LABEL, type PartnerCategory } from "@/lib/hq/constants";
import { followUpState, formatDay, overdueLabel } from "@/lib/hq/growth/dates";
import { StatusChip } from "../../StatusChip";

/*
 * Small server-safe pieces shared by the contacts and organisations screens.
 */

/** "Needs verifying": a research lead nobody has checked yet. A dot and words, never colour alone. */
export function NeedsVerifyingChip({ className }: { className?: string }) {
  return (
    <StatusChip tone="warning" className={className} title="Research lead: not yet checked by a person">
      Needs verifying
    </StatusChip>
  );
}

/** Category tags (no dot): one chip per category. */
export function CategoryTags({ categories, max }: { categories: readonly PartnerCategory[]; max?: number }) {
  if (categories.length === 0) return <span className="hq-cell-nil">Not recorded</span>;
  const shown = max ? categories.slice(0, max) : categories;
  const rest = categories.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <StatusChip key={c} plain>
          {CATEGORY_LABEL[c]}
        </StatusChip>
      ))}
      {rest > 0 ? <StatusChip plain>+{rest}</StatusChip> : null}
    </span>
  );
}

/**
 * A next follow-up date, in words. Overdue gets the error-tone chip ("3 days overdue") with the
 * date beneath it; today and upcoming dates read plainly; no date reads "Not set".
 */
export function FollowUpCell({ date, today }: { date: string | null; today: string }) {
  const state = followUpState(date, today);
  if (state.kind === "none") return <span className="hq-cell-nil">Not set</span>;
  const day = formatDay(date, today);
  if (state.kind === "overdue") {
    return (
      <>
        <StatusChip tone="error">{overdueLabel(state.days)}</StatusChip>
        <span className="hq-cell-sub">{day}</span>
      </>
    );
  }
  if (state.kind === "today") return <span className="font-medium">Today</span>;
  return <span>{day}</span>;
}

/** The text form, for places that cannot hold a chip (mobile cards, tooltips). */
export function followUpText(date: string | null, today: string): string | null {
  const state = followUpState(date, today);
  if (state.kind === "none") return null;
  if (state.kind === "overdue") return `Follow-up ${overdueLabel(state.days)}`;
  if (state.kind === "today") return "Follow up today";
  return `Follow up ${formatDay(date, today)}`;
}
