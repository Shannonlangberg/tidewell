import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

export default function OrganisationNotFound() {
  return (
    <>
      <PageHeader title="Organisation not found" />
      <EmptyState
        title="We couldn't find that organisation"
        action={
          <LinkButton href="/hq/growth/organisations" variant="primary">
            Back to organisations
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
