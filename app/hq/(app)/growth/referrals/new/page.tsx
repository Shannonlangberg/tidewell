import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { STAGE_LABEL } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { parseNewReferralParams } from "@/lib/hq/referrals/params";
import { existingOpportunityChoices } from "@/lib/hq/referrals/queries";
import { contactOptions, organisationOptions, staffOptions } from "@/lib/hq/queries/options";
import { buildHref, PageHeader } from "@/components/hq";
import { ReferralForm } from "@/components/hq/features/referrals/ReferralForm";

export const metadata: Metadata = { title: "Record a referral" };

const PATH = "/hq/growth/referrals/new";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewReferralPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff } = await requireStaff("growth.write", false, buildHref(PATH, sp));
  const prefill = parseNewReferralParams(sp);

  const [organisations, contacts, staffList, opportunities] = await Promise.all([
    organisationOptions(db),
    contactOptions(db),
    staffOptions(db),
    existingOpportunityChoices(db, (stage) => STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage),
  ]);

  // A partner or prospect named in the address (from a contact's page, an organisation's page or a
  // prospect) is chosen for the person only if it is a real, live one they can see.
  const contact = prefill.partnerContact && contacts.some((c) => c.value === prefill.partnerContact) ? prefill.partnerContact : "";
  const organisation = prefill.partnerOrganisation && organisations.some((o) => o.value === prefill.partnerOrganisation) ? prefill.partnerOrganisation : "";
  const existing = prefill.existingOpportunity && opportunities.some((o) => o.value === prefill.existingOpportunity) ? prefill.existingOpportunity : "";
  // Attaching to an existing prospect only makes sense for a received referral.
  const direction = existing ? "received" : prefill.direction;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Referrals", href: "/hq/growth/referrals" }, { label: "Record a referral" }]}
        title="Record a referral"
        description="An introduction from a partner, or one you have sent to them. It takes a minute, and a received referral becomes a prospect in the pipeline."
      />
      <ReferralForm
        organisations={organisations}
        contacts={contacts}
        staff={staffList}
        opportunities={opportunities}
        today={todayIn(staff.timezone)}
        staffId={staff.id}
        initial={{ direction, partnerContact: contact, partnerOrganisation: organisation, existingOpportunity: existing }}
      />
    </>
  );
}
