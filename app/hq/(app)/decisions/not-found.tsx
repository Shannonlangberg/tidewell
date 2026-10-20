import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a decision that does not exist, is archived (for a reader), OR is not visible to this
 * person. They look identical on purpose: a decision you may not see must not be confirmable.
 */
export default function DecisionNotFound() {
  return (
    <>
      <PageHeader title="Decision not found" />
      <EmptyState
        title="We couldn't find that decision"
        action={
          <LinkButton href="/hq/decisions" variant="primary">
            Back to decisions
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
