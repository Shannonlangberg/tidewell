import type { Metadata } from "next";
import { CATEGORY_LABEL, PARTNER_CATEGORIES, RELATIONSHIP_LABEL, RELATIONSHIP_STATUSES } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { plural } from "@/lib/hq/format";
import { nowLocalInput, todayInZone } from "@/lib/hq/growth/dates";
import { LIST_PAGE_SIZE, PARTNER_QUIET_DAYS, first, parseLogParam } from "@/lib/hq/growth/params";
import { organisationContacts } from "@/lib/hq/organisations/queries";
import { contactOptions, staffOptions, type Option } from "@/lib/hq/queries/options";
import { getReferralPartner, listReferralPartners, partnerListQuery, referralPartnerKindCounts, referralPartnerSummary } from "@/lib/hq/referral-partners/queries";
import type { ReferralPartner } from "@/lib/hq/referral-partners/types";
import { newTaskHref } from "@/lib/hq/tasks/rules";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  HQ_ROUTES,
  LinkButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Stat,
  StatBand,
  Tabs,
  buildHref,
  type SortState,
} from "@/components/hq";
import { LogInteractionDrawer } from "@/components/hq/features/contacts/LogInteractionDrawer";
import { PartnersTable, type PartnerActions } from "@/components/hq/features/referral-partners/PartnersTable";

export const metadata: Metadata = { title: "Referral partners" };

const PATH = HQ_ROUTES.referralPartners;

const SORT_LABEL: Record<string, string> = {
  name: "name",
  status: "relationship status",
  owner: "owner",
  last_contacted: "last contacted",
  follow_up: "next follow-up",
  referrals: "referrals received",
  signed: "managements signed",
  last_referral: "last referral",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReferralPartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(PATH, sp));

  const query = partnerListQuery(sp);
  const canWrite = can("growth.write");
  const canTask = can("tasks.write");
  const canImport = can("import.run");
  const tz = staff.timezone;
  const today = todayInZone(tz);
  const independent = query.kind === "independent";

  // ?log=call&partner=<id> opens the existing "log a call" drawer for that partner.
  const logOpen = canWrite && parseLogParam(sp.log) !== null;
  const logPartnerId = logOpen && isUuid(first(sp.partner)) ? first(sp.partner) : null;

  const [list, summary, kinds, staffList, logPartner] = await Promise.all([
    listReferralPartners(db, query, { staffId: staff.id }),
    referralPartnerSummary(db, query.kind),
    referralPartnerKindCounts(db),
    staffOptions(db),
    logPartnerId ? getReferralPartner(db, logPartnerId) : Promise.resolve(null),
  ]);
  const subject: ReferralPartner | null = logPartner && logPartner.ok ? logPartner.data : null;
  const pickerContacts: Option[] = !logOpen
    ? []
    : subject?.kind === "organisation"
      ? await organisationContacts(db, subject.id).then((r) => (r.ok ? r.data.map((c) => ({ value: c.id, label: c.fullName })) : []))
      : subject
        ? []
        : await contactOptions(db);

  // Everything that keeps this list as it is (filters, sort, page), for links that come back here.
  const here = buildHref(PATH, sp, { log: null, partner: null });
  const sort: SortState = { key: query.sort, dir: query.dir };
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir, page: null, log: null, partner: null });
  const kindHref = (kind: "organisation" | "independent") => buildHref(PATH, {}, { show: kind === "independent" ? "independent" : null });
  const filterHref = (extra: Record<string, string>) => buildHref(PATH, {}, { show: independent ? "independent" : null, ...extra });

  const actions: PartnerActions = {
    logHref: canWrite ? (p) => buildHref(PATH, sp, { log: "call", partner: p.id }) : undefined,
    referralHref: canWrite
      ? (p) => buildHref(HQ_ROUTES.referralNew, {}, p.kind === "organisation" ? { partner_organisation: p.id } : { partner_contact: p.id })
      : undefined,
    taskHref: canTask
      ? (p) =>
          newTaskHref({
            ...(p.kind === "organisation" ? { organisation: p.id } : { contact: p.id }),
            title: `Follow up with ${p.name}`,
            returnTo: here,
          })
      : undefined,
  };

  const ownerValue = query.owner ? (query.owner.kind === "staff" ? query.owner.id : query.owner.kind) : "";
  const s = summary.ok ? summary.data : null;
  const noneAtAll = list.ok && list.data.total === 0 && !query.filtered;

  const empty = noneAtAll ? (
    independent ? (
      <EmptyState
        title="No independent partners"
        action={
          canWrite ? (
            <LinkButton href={HQ_ROUTES.contactNew} variant="secondary" icon="plus">
              Add contact
            </LinkButton>
          ) : undefined
        }
      >
        A contact who does not belong to an organisation, such as a sole broker or an independent adviser, is listed here as a partner in their own right.
      </EmptyState>
    ) : (
      <EmptyState
        title="No referral partners yet"
        action={
          canWrite || canImport ? (
            <span className="flex flex-wrap justify-center gap-3">
              {canWrite ? (
                <LinkButton href={`${HQ_ROUTES.organisations}/new`} variant="primary" icon="plus">
                  Add organisation
                </LinkButton>
              ) : null}
              {canImport ? <LinkButton href="/hq/growth/import">Import contacts</LinkButton> : null}
            </span>
          ) : undefined
        }
      >
        {canWrite || canImport
          ? "Add the agencies, brokers and firms who refer clients to Planted, or import a list of research leads. Each one appears here with when you last spoke and what they have referred."
          : "Nothing has been added yet. Someone with write access can add partners or import a list."}
      </EmptyState>
    )
  ) : (
    <EmptyState
      title="No partners match those filters"
      action={
        <LinkButton href={kindHref(query.kind)} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try a shorter search, or clear the filters to see every partner.
    </EmptyState>
  );

  const quietCount = s ? s.partners - s.contactedRecently : null;

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Referral partners"
        description="The agencies, brokers and advisers who refer clients to Planted: when you last spoke, what happens next, and what each has referred. Every figure comes from the calls and referrals recorded in HQ."
        actions={
          canWrite ? (
            <LinkButton href={HQ_ROUTES.referralNew} variant="primary" icon="plus">
              Record a referral
            </LinkButton>
          ) : undefined
        }
      />

      <Tabs
        label="Kind of partner"
        items={[
          { label: "Organisations", href: kindHref("organisation"), current: !independent, count: kinds.organisation },
          { label: "Independent contacts", href: kindHref("independent"), current: independent, count: kinds.independent },
        ]}
      />

      {s ? (
        <StatBand label={independent ? "Independent partners at a glance" : "Referral partners at a glance"} columns={3}>
          <Stat label={independent ? "Independent partners" : "Partner organisations"} value={s.partners} hint={independent ? "Contacts with no organisation." : "Every organisation in Growth."} />
          <Stat
            label="Contacted in the last 30 days"
            value={s.contactedRecently}
            hint={s.partners === 0 ? "No partners yet." : `${plural(s.contactedRecently, "partner")} of ${s.partners}.`}
          />
          <Stat
            label="Not contacted in 30 days"
            value={quietCount}
            hint={quietCount ? "Including anyone never contacted." : "Everyone has been contacted this month."}
            href={quietCount ? filterHref({ quiet: String(PARTNER_QUIET_DAYS) }) : undefined}
          />
          <Stat label="Never contacted" value={s.neverContacted} hint={s.neverContacted ? "No call, meeting or note logged yet." : "Every partner has been contacted at least once."} />
          <Stat
            label="Have referred"
            value={s.haveReferred}
            hint={s.haveReferred ? `${plural(s.referralsReceived, "referral")} received between them.` : "No referrals received yet."}
            href={s.haveReferred ? filterHref({ referred: "yes" }) : undefined}
          />
          <Stat label="Managements signed" value={s.managementsSigned} hint="Each counted once, credited to the partner who first introduced it." />
        </StatBand>
      ) : (
        <div className="mt-8">
          <ErrorState
            title="We could not load the figures"
            action={
              <LinkButton href={here} size="sm">
                Try again
              </LinkButton>
            }
          />
        </div>
      )}

      <FilterBar
        action={PATH}
        label="Filter referral partners"
        hidden={{
          show: independent ? "independent" : undefined,
          sort: query.sort === "name" && query.dir === "asc" ? undefined : query.sort,
          dir: query.sort === "name" && query.dir === "asc" ? undefined : query.dir,
        }}
        resetHref={kindHref(query.kind)}
        active={query.filtered}
        moreActive={Boolean(query.quiet || query.referred || query.verify)}
        more={
          <>
            <Select
              name="quiet"
              label="Last contacted"
              hideLabel
              placeholder="Any last contact"
              defaultValue={query.quiet ? String(PARTNER_QUIET_DAYS) : ""}
              options={[{ value: String(PARTNER_QUIET_DAYS), label: "Not contacted in 30 days" }]}
            />
            <Select
              name="referred"
              label="Referrals"
              hideLabel
              placeholder="Any referrals"
              defaultValue={query.referred ?? ""}
              options={[
                { value: "yes", label: "Has referred" },
                { value: "no", label: "Never referred" },
              ]}
            />
            <Select
              name="verify"
              label="Verification"
              hideLabel
              placeholder="Any verification"
              defaultValue={query.verify ?? ""}
              options={[{ value: "needs", label: "Needs verifying" }]}
            />
          </>
        }
      >
        <SearchInput placeholder={independent ? "Search by name" : "Search by partner or contact name"} defaultValue={query.q} />
        <Select name="category" label="Category" hideLabel placeholder="All categories" defaultValue={query.category ?? ""} options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
        <Select
          name="status"
          label="Relationship status"
          hideLabel
          placeholder="Any status"
          defaultValue={query.status ?? ""}
          options={RELATIONSHIP_STATUSES.map((st) => ({ value: st, label: RELATIONSHIP_LABEL[st] }))}
        />
        <Select
          name="owner"
          label="Relationship owner"
          hideLabel
          placeholder="Any owner"
          defaultValue={ownerValue}
          options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...staffList.filter((o) => o.value !== staff.id).map((o) => ({ value: o.value, label: o.label }))]}
        />
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load referral partners"
            action={
              <LinkButton href={here} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <PartnersTable
              rows={list.data.rows}
              caption={`Referral partners, ${list.data.total} ${list.data.total === 1 ? "result" : "results"}, sorted by ${SORT_LABEL[query.sort]}`}
              sort={sort}
              hrefForSort={hrefForSort}
              timezone={tz}
              today={today}
              actions={actions}
              empty={empty}
            />
            <Pagination page={list.data.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="partner" className="mt-6" />
            {list.data.total > 0 ? (
              <p className="hq-muted mt-4 max-w-3xl text-[13px]">
                Last contacted is the latest call, meeting, email or note with anyone at the partner. Referred counts introductions to Planted; signed counts each management once,
                credited to the partner who first introduced it, so these figures match the Growth overview.
              </p>
            ) : null}
          </>
        )}
      </div>

      {logOpen && (subject || !logPartnerId) ? (
        <LogInteractionDrawer
          contact={subject?.kind === "independent" ? { id: subject.id, name: subject.name, organisation: null } : null}
          organisation={subject?.kind === "organisation" ? { id: subject.id, name: subject.name } : null}
          contactOptions={pickerContacts}
          staffOptions={staffList}
          canCreateTasks={canTask}
          staffId={staff.id}
          timezone={tz}
          serverNowLocal={nowLocalInput(tz)}
          today={today}
          returnTo="partners"
          returnPath={here}
        />
      ) : null}
    </>
  );
}
