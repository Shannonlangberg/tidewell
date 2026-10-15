import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

export default function ContractorNotFound() {
  return (
    <>
      <PageHeader title="Contractor not found" />
      <EmptyState
        title="We couldn't find that contractor"
        action={
          <LinkButton href="/hq/partners" variant="primary">
            Back to contractors
          </LinkButton>
        }
      >
        They may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
