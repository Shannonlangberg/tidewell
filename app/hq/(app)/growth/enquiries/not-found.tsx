import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

export default function EnquiryNotFound() {
  return (
    <>
      <PageHeader title="Enquiry not found" />
      <EmptyState
        title="We couldn't find that enquiry"
        action={
          <LinkButton href="/hq/growth/enquiries" variant="primary">
            Back to website enquiries
          </LinkButton>
        }
      >
        The link may be out of date.
      </EmptyState>
    </>
  );
}
