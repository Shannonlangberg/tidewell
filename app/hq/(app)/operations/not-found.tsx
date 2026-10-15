import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a task that does not exist, is archived, OR is not visible to this person. The
 * three look identical on purpose: a task you may not see must not be confirmable.
 */
export default function TaskNotFound() {
  return (
    <>
      <PageHeader title="Task not found" />
      <EmptyState
        title="We couldn't find that task"
        action={
          <LinkButton href="/hq/operations" variant="primary">
            Back to tasks
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
