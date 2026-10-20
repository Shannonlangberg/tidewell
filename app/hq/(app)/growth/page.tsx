import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABEL, PARTNER_CATEGORIES } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { formatAud, formatDate, plural, todayIn } from "@/lib/hq/format";
import { formatConversion } from "@/lib/hq/referrals/numbers";
import { GROWTH_PERIODS, GROWTH_PERIOD_LABEL, DEFAULT_GROWTH_PERIOD, growthPeriodStart, growthPeriodTitle, parseGrowthPeriod } from "@/lib/hq/referrals/periods";
import { PARTNERS_PAGE_SIZE, parsePartnerParams } from "@/lib/hq/referrals/params";
import { countAdditionalClaims, listPartnerPerformance, loadGrowthSummary } from "@/lib/hq/referrals/queries";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  InlineNote,
  LinkButton,
  PageHeader,
  Pagination,
  SectionLabel,
  Select,
  Stat,
  StatBand,
  Tabs,
  HQ_ROUTES,
  buildHref,
  type SortState,
} from "@/components/hq";
import { GrowthLinks, QuietPartnersNote } from "@/components/hq/features/referrals/GrowthLinks";
import { PartnerPerformanceTable } from "@/components/hq/features/referrals/PartnerPerformanceTable";

export const metadata: Metadata = { title: "Growth" };

const PATH = "/hq/growth";
const REFERRALS = "/hq/growth/referrals";
/** The contacts list filters on `stale` (days since last contact). */
const NOT_CONTACTED_HREF = "/hq/growth/contacts?stale=30";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SORT_LABEL: Record<string, string> = {
  name: "partner",
  received: "received",
  sent: "sent",
  qualified: "qualified",
  signed: "signed",
  conversion: "conversion",
  value: "estimated value signed",
};

export default async function GrowthOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(PATH, sp));
  const canWrite = can("growth.write");
  const canImport = can("import.run");

  const today = todayIn(staff.timezone);
  const period = parseGrowthPeriod(sp.period);
  const since = growthPeriodStart(period, today);
  const partnerQuery = parsePartnerParams(sp, PARTNER_CATEGORIES);

  const [summary, claims, partners] = await Promise.all([
    loadGrowthSummary(db, since),
    countAdditionalClaims(db, since),
    listPartnerPerformance(db, partnerQuery),
  ]);

  const s = summary.ok ? summary.data : null;
  const periodTitle = growthPeriodTitle(period, today);
  const periodHref = (p: (typeof GROWTH_PERIODS)[number]) => buildHref(PATH, sp, { period: p === DEFAULT_GROWTH_PERIOD ? null : p, page: null });
  const registerFrom = period === "all" ? {} : { from: since };

  const sort: SortState = { key: partnerQuery.sort, dir: partnerQuery.dir };
  const hrefForSort = (next: SortState) => buildHref(PATH, sp, { sort: next.key, dir: next.dir, page: null });

  const signedValue = s && s.managementsSigned > 0 && s.estimatedValueSignedCents > 0 ? formatAud(s.estimatedValueSignedCents) : null;

  const recordAction = canWrite ? (
    <LinkButton href={`${REFERRALS}/new`} variant="primary" icon="plus">
      Record a referral
    </LinkButton>
  ) : undefined;


  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Growth overview"
        description="Referrals from your partners, how they move to a signed management, and who sends you the most. Every figure comes from the referrals recorded in HQ."
        actions={
          <>
            <LinkButton href={HQ_ROUTES.referralPartners}>Referral partners</LinkButton>
            <LinkButton href="/hq/growth/pipeline">Pipeline</LinkButton>
            <LinkButton href="/hq/growth/enquiries">Website enquiries</LinkButton>
            {recordAction}
          </>
        }
      />

      <Tabs
        label="Reporting period"
        items={GROWTH_PERIODS.map((p) => ({ label: GROWTH_PERIOD_LABEL[p], href: periodHref(p), current: p === period }))}
      />

      {s ? (
        <>
          <StatBand label={`Referrals and managements, ${periodTitle.toLowerCase()}`} columns={3}>
            <Stat
              label="Referrals received"
              value={s.referralsReceived}
              hint={
                s.referralsReceived === 0
                  ? "None recorded in this period."
                  : claims
                    ? `Includes ${plural(claims, "further claim")} on prospects already in the pipeline.`
                    : "Introductions from partners."
              }
              href={buildHref(REFERRALS, {}, { direction: "received", ...registerFrom })}
            />
            <Stat
              label="Referrals sent"
              value={s.referralsSent}
              hint={s.referralsSent === 0 ? "None recorded in this period." : "Introductions you made to partners."}
              href={buildHref(REFERRALS, {}, { direction: "sent", ...registerFrom })}
            />
            <Stat label="Qualified opportunities" value={s.qualified} hint="Prospects that reached Qualified in this period." href="/hq/growth/pipeline" />
            <Stat label="Managements signed" value={s.managementsSigned} hint="Each counted once, credited to its original source." />
            <Stat
              label="Conversion"
              value={s.conversion === null ? null : formatConversion(s.conversion)}
              hint={
                s.conversion === null
                  ? "Needs at least one referral received."
                  : claims
                    ? "Signed divided by received, which includes the further claims."
                    : "Signed divided by received."
              }
            />
            <Stat
              label="Estimated value signed"
              value={signedValue}
              hint={signedValue ? "An estimate: the sum of your own yearly figures." : "Appears once a signed management has an estimate."}
            />
          </StatBand>
          <p className="hq-muted mt-3 text-[13px]">
            {periodTitle}
            {period === "all" ? "." : `, from ${formatDate(since, staff.timezone)} to today.`} Referrals are counted by the date of the introduction, and managements by the date they were
            signed.
          </p>
        </>
      ) : (
        <div className="mt-8">
          <ErrorState
            title="We could not load the figures"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        </div>
      )}

      <section aria-labelledby="partner-performance" className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <SectionLabel as="h2" id="partner-performance">
            Partner performance
          </SectionLabel>
          <span className="hq-label">All time</span>
        </div>
        <InlineNote className="mt-3 max-w-3xl">
          Received and sent count every introduction. Qualified means the prospect reached the Qualified stage at some point. Signed counts each management once, credited to the
          partner who first introduced the prospect, even if other partners also claimed them. Conversion is signed divided by received. These figures cover all time, whatever
          period is chosen above, and only partners that are organisations. The{" "}
          <Link className="underline underline-offset-4" href={HQ_ROUTES.referralPartners}>
            Referral partners
          </Link>{" "}
          page shows the same figures beside when you last spoke to each partner.
        </InlineNote>

        <FilterBar
          action={PATH}
          label="Filter partners"
          hidden={{
            period: period === DEFAULT_GROWTH_PERIOD ? undefined : period,
            sort: partnerQuery.sort === "received" && partnerQuery.dir === "desc" ? undefined : partnerQuery.sort,
            dir: partnerQuery.sort === "received" && partnerQuery.dir === "desc" ? undefined : partnerQuery.dir,
            show: partnerQuery.showAll ? "all" : undefined,
          }}
          resetHref={buildHref(PATH, sp, { category: null, page: null })}
          active={partnerQuery.filtered}
        >
          <Select
            name="category"
            label="Partner category"
            hideLabel
            placeholder="All categories"
            defaultValue={partnerQuery.category ?? ""}
            options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
          />
        </FilterBar>

        <div className="mt-6">
          {!partners.ok ? (
            <ErrorState
              title="We could not load partner performance"
              action={
                <LinkButton href={buildHref(PATH, sp)} size="sm">
                  Try again
                </LinkButton>
              }
            />
          ) : (
            <>
              <PartnerPerformanceTable
                rows={partners.data.rows}
                caption={`Partner performance, ${partners.data.total} ${partners.data.total === 1 ? "partner" : "partners"}, sorted by ${SORT_LABEL[partnerQuery.sort]}`}
                sort={sort}
                hrefForSort={hrefForSort}
                empty={
                  partners.data.allPartners === 0 ? (
                    <EmptyState
                      title="No partner organisations yet"
                      action={
                        <LinkButton href="/hq/growth/organisations" variant="secondary">
                          Open organisations
                        </LinkButton>
                      }
                    >
                      Partner performance is shown per organisation. Add the organisations you work with, or import your research leads, then record referrals from them.
                    </EmptyState>
                  ) : partners.data.withActivity === 0 && !partnerQuery.filtered && !partnerQuery.showAll ? (
                    <EmptyState title="No referrals recorded yet" action={recordAction}>
                      Record your first introduction, whether a partner sent you someone or you sent someone to them. Each partner&rsquo;s figures appear here as referrals are recorded and
                      move through the pipeline.
                    </EmptyState>
                  ) : (
                    <EmptyState
                      title="No partners match"
                      action={
                        <LinkButton href={buildHref(PATH, sp, { category: null, show: null, page: null })} variant="secondary">
                          Clear filters
                        </LinkButton>
                      }
                    >
                      {partnerQuery.showAll ? "Try a different category." : "No partner in this category has a referral yet. Show all partners to see everyone."}
                    </EmptyState>
                  )
                }
              />
              <Pagination page={partners.data.page} pageSize={PARTNERS_PAGE_SIZE} total={partners.data.total} pathname={PATH} searchParams={sp} noun="partner" className="mt-4" />
              {partners.data.allPartners > partners.data.withActivity ? (
                <p className="hq-muted mt-3 text-[13px]">
                  {partnerQuery.showAll ? (
                    <>
                      Showing every partner, including {plural(partners.data.allPartners - partners.data.withActivity, "partner")} with no referrals.{" "}
                      <Link className="underline underline-offset-4" href={buildHref(PATH, sp, { show: null, page: null })}>
                        Show only partners with referrals
                      </Link>
                    </>
                  ) : (
                    <>
                      Showing {partners.data.withActivity} of {partners.data.allPartners} partners, the ones with at least one referral.{" "}
                      <Link className="underline underline-offset-4" href={buildHref(PATH, sp, { show: "all", page: null })}>
                        Show all {partners.data.allPartners} partners
                      </Link>
                    </>
                  )}
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="growth-links" className="mt-12">
        <SectionLabel as="h2" id="growth-links" className="mb-3">
          Around Growth
        </SectionLabel>
        <GrowthLinks
          label="Growth sections"
          links={[
            {
              href: HQ_ROUTES.referralPartners,
              title: "Referral partners",
              description: "Every partner at a glance: when you last spoke, the next follow-up, and what each has referred.",
            },
            { href: "/hq/growth/contacts", title: "Contacts", description: "The people at your referral partners, and the calls and meetings you have had." },
            { href: "/hq/growth/organisations", title: "Organisations", description: "The agencies, brokers and firms those people work for." },
            { href: REFERRALS, title: "Referrals", description: "Every introduction, received and sent." },
            { href: "/hq/growth/pipeline", title: "Pipeline", description: "Open prospects from introduction to signed management." },
            { href: "/hq/growth/enquiries", title: "Website enquiries", description: "Appraisal requests and contact forms from the website, each already a lead." },
            ...(canImport ? [{ href: "/hq/growth/import", title: "Import", description: "Add a list of research leads, checked before anything is saved." }] : []),
          ]}
        />
        {s ? <QuietPartnersNote count={s.contactsNotContacted30d} href={NOT_CONTACTED_HREF} partnersHref={`${HQ_ROUTES.referralPartners}?quiet=30`} /> : null}
      </section>
    </>
  );
}
