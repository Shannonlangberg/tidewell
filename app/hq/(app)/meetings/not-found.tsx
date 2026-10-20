import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a meeting that does not exist, is archived, OR is not visible to this person (a
 * confidential meeting they were not at). They look identical on purpose: a meeting you may not see
 * must not be confirmable.
 */
export default function MeetingNotFound() {
  return (
    <>
      <PageHeader title="Meeting not found" />
      <EmptyState
        title="We couldn't find that meeting"
        action={
          <LinkButton href="/hq/meetings" variant="primary">
            Back to meetings
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
