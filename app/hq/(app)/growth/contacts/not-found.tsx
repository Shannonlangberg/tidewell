import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

export default function ContactNotFound() {
  return (
    <>
      <PageHeader title="Contact not found" />
      <EmptyState
        title="We couldn't find that contact"
        action={
          <LinkButton href="/hq/growth/contacts" variant="primary">
            Back to contacts
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
