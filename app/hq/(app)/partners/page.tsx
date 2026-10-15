import type { Metadata } from "next";
import { LinkButton } from "@/components/hq/Button";
import { PageHeader } from "@/components/hq/PageHeader";
import { InlineNote, SectionLabel } from "@/components/hq/Primitives";
import { HQ_ROUTES } from "@/components/hq/nav";
import { requireStaff } from "@/lib/hq/auth";

export const metadata: Metadata = { title: "Partners" };

/*
 * Partners is the contractors module, planned for Phase 2. This page says so plainly and shows what
 * the module will hold. It shows no figures and has no controls: nothing here is real yet.
 */
export default async function PartnersPage() {
  const { can } = await requireStaff();

  return (
    <>
      <PageHeader
        eyebrow="Planned for Phase 2"
        title="Partners"
        description="Partners will hold the contractors and trades Planted works with. It is not built yet, so there is nothing to enter or look up here."
      />

      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <section aria-labelledby="will-h">
          <SectionLabel as="h2" id="will-h" className="mb-3.5">
            What will be here
          </SectionLabel>
          <ul className="grid list-disc gap-2 pl-5">
            <li>A directory of contractors and trades.</li>
            <li>A vetting checklist for each contractor.</li>
            <li>Secure storage for documents such as licences and insurance.</li>
            <li>Reminders before those documents expire.</li>
            <li>An import of the maintenance prospects already gathered.</li>
          </ul>
        </section>

        <section aria-labelledby="now-h">
          <SectionLabel as="h2" id="now-h" className="mb-3.5">
            What you can use now
          </SectionLabel>
          <p className="mb-4">
            The people who refer property owners to Planted, such as mortgage brokers, conveyancers and agents, are looked after in Growth, not here.
          </p>
          {can("growth.read") ? (
            <div className="flex flex-wrap gap-3">
              <LinkButton href={HQ_ROUTES.contacts}>Contacts</LinkButton>
              <LinkButton href={HQ_ROUTES.organisations}>Organisations</LinkButton>
              <LinkButton href={HQ_ROUTES.referrals}>Referrals</LinkButton>
            </div>
          ) : (
            <InlineNote>Your role does not include Growth. Ask a director or administrator if you need it.</InlineNote>
          )}
        </section>
      </div>
    </>
  );
}
