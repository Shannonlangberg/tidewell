import { EmptyState, LinkButton, PageHeader } from "@/components/hq";

export default function ReferralNotFound() {
  return (
    <>
      <PageHeader title="Referral not found" />
      <EmptyState
        title="We couldn't find that referral"
        action={
          <LinkButton href="/hq/growth/referrals" variant="primary">
            Back to referrals
          </LinkButton>
        }
      >
        It may have been archived, or the link may be out of date.
      </EmptyState>
    </>
  );
}
