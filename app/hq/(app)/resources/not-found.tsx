import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a resource that does not exist, is archived (for anyone who cannot restore it), OR is not
 * visible to this person. They look identical on purpose.
 */
export default function ResourceNotFound() {
  return (
    <>
      <PageHeader title="Resource not found" />
      <EmptyState
        title="We couldn't find that resource"
        action={
          <LinkButton href="/hq/resources" variant="primary">
            Back to Resources
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
