import type { Metadata } from "next";
import { LinkButton } from "@/components/hq/Button";
import { PageHeader } from "@/components/hq/PageHeader";
import { InlineNote, SectionLabel } from "@/components/hq/Primitives";
import { HQ_ROUTES } from "@/components/hq/nav";
import { requireStaff } from "@/lib/hq/auth";

export const metadata: Metadata = { title: "Insights" };

/*
 * Insights is business intelligence, planned for Phase 4. This page says so plainly and shows what
 * it will hold. It shows no figures and has no controls: nothing here is real yet. The figures that
 * do exist today are on the dashboard and in Growth.
 */
export default async function InsightsPage() {
  const { can } = await requireStaff();

  return (
    <>
      <PageHeader
        eyebrow="Planned for Phase 4"
        title="Insights"
        description="Insights will bring the business numbers together. It is not built yet, so this page shows no figures."
      />

      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <section aria-labelledby="will-h">
          <SectionLabel as="h2" id="will-h" className="mb-3.5">
            What will be here
          </SectionLabel>
          <ul className="grid list-disc gap-2 pl-5">
            <li>A growth dashboard across partners, referrals and managements.</li>
            <li>Forecast assumptions you can edit and see the effect of.</li>
            <li>Reporting by pod.</li>
            <li>Search across the knowledge base.</li>
          </ul>
        </section>

        <section aria-labelledby="now-h">
          <SectionLabel as="h2" id="now-h" className="mb-3.5">
            What you can use now
          </SectionLabel>
          <p className="mb-4">The figures that exist today are real counts from the records in HQ. They are on the dashboard and in Growth.</p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href={HQ_ROUTES.dashboard}>Dashboard</LinkButton>
            {can("growth.read") ? <LinkButton href={HQ_ROUTES.growth}>Growth overview</LinkButton> : null}
            {can("growth.read") ? <LinkButton href={HQ_ROUTES.pipeline}>Referral pipeline</LinkButton> : null}
          </div>
          {!can("growth.read") ? <InlineNote className="mt-4">Growth figures are not part of your role. Ask a director or administrator if you need them.</InlineNote> : null}
        </section>
      </div>
    </>
  );
}
