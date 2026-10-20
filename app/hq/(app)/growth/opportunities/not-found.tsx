import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

export default function LeadNotFound() {
  return (
    <>
      <PageHeader title="Lead not found" />
      <EmptyState
        title="We couldn't find that lead"
        action={
          <LinkButton href="/hq/growth/pipeline" variant="primary">
            Back to the pipeline
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
