import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

/*
 * Shown for an email that does not exist OR is not visible to this person (someone else's draft).
 * They look identical on purpose: an email you may not see must not be confirmable.
 */
export default function EmailNotFound() {
  return (
    <>
      <PageHeader title="Email not found" />
      <EmptyState
        title="We couldn't find that email"
        action={
          <LinkButton href="/hq/communications/emails" variant="primary">
            Back to email
          </LinkButton>
        }
      >
        It may belong to someone else, or the link may be out of date.
      </EmptyState>
    </>
  );
}
