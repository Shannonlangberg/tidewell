import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for a property that does not exist, is archived (for a reader), OR is not visible to this
 * person. They look identical on purpose: a record you may not see must not be confirmable.
 */
export default function PropertyNotFound() {
  return (
    <>
      <PageHeader title="Property not found" />
      <EmptyState
        title="We couldn't find that property"
        action={
          <LinkButton href="/hq/portfolio" variant="primary">
            Back to properties
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
