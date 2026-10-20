import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CATEGORY_LABEL, PARTNER_CATEGORIES, RELATIONSHIP_LABEL, RELATIONSHIP_STATUSES } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { plural } from "@/lib/hq/format";
import { nowLocalInput, todayInZone } from "@/lib/hq/growth/dates";
import { LIST_PAGE_SIZE, PARTNER_GROUPS, PARTNER_QUIET_DAYS, first, parseLogParam, type PartnerGroup } from "@/lib/hq/growth/params";
import { organisationContacts } from "@/lib/hq/organisations/queries";
import { contactOptions, staffOptions, type Option } from "@/lib/hq/queries/options";
import {
  getReferralPartner,
  listPartnerGroups,
  listReferralPartners,
  partnerListQuery,
  referralPartnerKindCounts,
  referralPartnerSummary,
  type PartnerSummary,
} from "@/lib/hq/referral-partners/queries";
import type { ReferralPartner } from "@/lib/hq/referral-partners/types";
import { newTaskHref } from "@/lib/hq/tasks/rules";
import { EmptyState, ErrorState, FilterBar, HQ_ROUTES, LinkButton, PageHeader, Pagination, SearchInput, Select, Tabs, buildHref } from "@/components/hq";
import { LogInteractionDrawer } from "@/components/hq/features/contacts/LogInteractionDrawer";
import {
  GROUP_HINT,
  GROUP_TITLE,
  PartnerGroupSection,
  PartnerRows,
  type PartnerActions,
  type VerifyMarker,
} from "@/components/hq/features/referral-partners/PartnerGroups";

export const metadata: Metadata = { title: "Referral partners" };

const PATH = HQ_ROUTES.referralPartners;

/** How many rows each group shows before "Show all". */
const GROUP_LIMIT = 25;
/** The Never spoken group starts closed when it is longer than this and anything else is on the page. */
const NEVER_OPEN_UP_TO = 5;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** "19 partners · 3 spoken to in the last 30 days · 2 referrals so far · 1 signed". */
function summarySentence(s: PartnerSummary, independent: boolean): string {
  return [
    plural(s.partners, independent ? "independent partner" : "partner"),
    `${s.contactedRecently.toLocaleString("en-AU")} spoken to in the last ${PARTNER_QUIET_DAYS} days`,
    `${plural(s.referralsReceived, "referral")} so far`,
    s.managementsSigned > 0 ? `${s.managementsSigned.toLocaleString("en-AU")} signed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The one line above the list when all or most partners still need verifying, and which rows then carry a marker. */
function verification(s: PartnerSummary | null): { marker: VerifyMarker; line: string | null } {
  if (!s || s.partners === 0 || s.needsVerifying === 0) return { marker: "none", line: null };
  if (s.needsVerifying === s.partners) {
    return { marker: "none", line: `All ${s.partners.toLocaleString("en-AU")} are research leads nobody has verified yet.` };
  }
  if (s.needsVerifying * 2 > s.partners) {
    return { marker: "verified", line: `${s.needsVerifying.toLocaleString("en-AU")} of ${s.partners.toLocaleString("en-AU")} are research leads nobody has verified yet. The rest are marked Verified.` };
  }
  return { marker: "needs", line: null };
}

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
  const ctx = { staffId: staff.id, today };

  // ?log=call&partner=<id> opens the existing "log a call" drawer for that partner.
  const logOpen = canWrite && parseLogParam(sp.log) !== null;
  const logPartnerId = logOpen && isUuid(first(sp.partner)) ? first(sp.partner) : null;

  const [groups, single, summary, kinds, staffList, logPartner] = await Promise.all([
    query.group ? Promise.resolve(null) : listPartnerGroups(db, query, ctx, GROUP_LIMIT),
    query.group ? listReferralPartners(db, query, ctx, { group: query.group }) : Promise.resolve(null),
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
        : await contactOptions(db, 500, { partnersOnly: true });

  // Everything that keeps this list as it is (filters, group, sort, page), for links that come back here.
  const here = buildHref(PATH, sp, { log: null, partner: null });
  const kindHref = (kind: "organisation" | "independent") => buildHref(PATH, {}, { show: kind === "independent" ? "independent" : null });
  const groupHref = (g: PartnerGroup | null) => buildHref(PATH, sp, { group: g, page: null, log: null, partner: null });

  const actions: PartnerActions = {
    logHref: canWrite ? (p) => buildHref(PATH, sp, { log: "call", partner: p.id }) : undefined,
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
  const verify = verification(s);
  const moreFilters = [query.category, query.status, query.owner, query.quiet, query.referred, query.verify].filter(Boolean).length;

  const loadFailed = groups ? PARTNER_GROUPS.some((g) => !groups[g].ok) : !single?.ok;
  const shownTotal = groups
    ? PARTNER_GROUPS.reduce((n, g) => n + (groups[g].ok ? groups[g].data.total : 0), 0)
    : single?.ok
      ? single.data.total
      : 0;
  const noneAtAll = !loadFailed && shownTotal === 0 && !query.filtered && !query.group;

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
      title={query.group ? `No partners in ${GROUP_TITLE[query.group]}` : "No partners match those filters"}
      action={
        <LinkButton href={query.group && !query.filtered ? groupHref(null) : kindHref(query.kind)} variant="secondary">
          {query.group && !query.filtered ? "Show every group" : "Clear filters"}
        </LinkButton>
      }
    >
      {query.filtered ? "Try a shorter search, or clear the filters to see every partner." : "Nobody is in this group just now."}
    </EmptyState>
  );

  const retry = (
    <LinkButton href={here} size="sm">
      Try again
    </LinkButton>
  );

  let list: ReactNode;
  if (loadFailed) {
    list = <ErrorState title="We could not load referral partners" action={retry} />;
  } else if (shownTotal === 0) {
    list = empty;
  } else if (groups) {
    const ok = (g: PartnerGroup) => (groups[g].ok ? groups[g].data : { rows: [], total: 0, page: 1 });
    const othersShown = ok("call").total + ok("warm").total + ok("quiet").total > 0;
    const neverTotal = ok("never").total;
    list = (
      <>
        {ok("call").total === 0 ? (
          <p className="hq-pgroup__none">
            <span className="font-medium text-charcoal">Nobody to call first.</span>{" "}
            {query.filtered ? "None of these partners has a follow-up due." : "No follow-ups are due or overdue."}
          </p>
        ) : null}
        {PARTNER_GROUPS.map((g) => {
          const page = ok(g);
          if (page.total === 0) return null;
          return (
            <PartnerGroupSection
              key={g}
              group={g}
              rows={page.rows}
              total={page.total}
              today={today}
              actions={actions}
              marker={verify.marker}
              moreHref={groupHref(g)}
              collapsed={g === "never" ? othersShown && neverTotal > NEVER_OPEN_UP_TO && !query.q : undefined}
            />
          );
        })}
      </>
    );
  } else if (single?.ok && query.group) {
    list = (
      <section aria-labelledby="group-one" className="hq-pgroup">
        <div className="hq-pgroup__head">
          <h2 id="group-one" className="hq-pgroup__h">
            <span className="hq-pgroup__title">{GROUP_TITLE[query.group]}</span>
            <span className="hq-pgroup__count">{single.data.total.toLocaleString("en-AU")}</span>
            <span className="hq-pgroup__hint">{GROUP_HINT[query.group]}</span>
          </h2>
        </div>
        <PartnerRows rows={single.data.rows} group={query.group} today={today} actions={actions} marker={verify.marker} label={GROUP_TITLE[query.group]} />
        <Pagination page={single.data.page} pageSize={LIST_PAGE_SIZE} total={single.data.total} pathname={PATH} searchParams={sp} noun="partner" className="mt-6" />
      </section>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Referral partners"
        description={s ? summarySentence(s, independent) : undefined}
        actions={
          canWrite ? (
            <LinkButton href={HQ_ROUTES.referralNew} variant="primary" icon="plus">
              Record a referral
            </LinkButton>
          ) : undefined
        }
      />

      {/* Independent contacts only earn a tab once there are some (or someone is looking at them). */}
      {independent || (kinds.independent ?? 0) > 0 ? (
        <Tabs
          label="Kind of partner"
          items={[
            { label: "Organisations", href: kindHref("organisation"), current: !independent, count: kinds.organisation },
            { label: "Independent contacts", href: kindHref("independent"), current: independent, count: kinds.independent },
          ]}
        />
      ) : null}

      <FilterBar
        action={PATH}
        label="Search and filter referral partners"
        className="hq-pfilter"
        hidden={{
          show: independent ? "independent" : undefined,
          group: query.group ?? undefined,
          sort: query.sorted ? query.sort : undefined,
          dir: query.sorted ? query.dir : undefined,
        }}
        resetHref={query.group ? buildHref(PATH, {}, { show: independent ? "independent" : null, group: query.group }) : kindHref(query.kind)}
        active={query.filtered}
        applyLabel="Search"
        moreLabel={moreFilters > 0 ? `Filter (${moreFilters})` : "Filter"}
        moreActive={moreFilters > 0}
        more={
          <>
            <Select name="category" label="Category" hideLabel placeholder="All categories" defaultValue={query.category ?? ""} options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
            <Select
              name="status"
              label="Contact stage"
              hideLabel
              placeholder="Any contact stage"
              defaultValue={query.status ?? ""}
              options={RELATIONSHIP_STATUSES.map((st) => ({ value: st, label: RELATIONSHIP_LABEL[st] }))}
            />
            <Select
              name="owner"
              label="Owner"
              hideLabel
              placeholder="Any owner"
              defaultValue={ownerValue}
              options={[{ value: "me", label: "Mine" }, { value: "none", label: "No owner" }, ...staffList.filter((o) => o.value !== staff.id).map((o) => ({ value: o.value, label: o.label }))]}
            />
            <Select
              name="quiet"
              label="Last spoke"
              hideLabel
              placeholder="Any last spoke"
              defaultValue={query.quiet ? String(PARTNER_QUIET_DAYS) : ""}
              options={[{ value: String(PARTNER_QUIET_DAYS), label: `Not spoken to in ${PARTNER_QUIET_DAYS} days` }]}
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
        <SearchInput placeholder={independent ? "Search by name" : "Search by partner or person"} defaultValue={query.q} />
      </FilterBar>

      {!s && !loadFailed ? <p className="hq-muted mt-4 text-[13px]">The totals could not be loaded just now; the list below is complete.</p> : null}
      {verify.line && shownTotal > 0 ? <p className="hq-pnote">{verify.line}</p> : null}

      {query.group ? (
        <p className="mt-5 text-[13px]">
          <Link href={groupHref(null)} className="underline underline-offset-2">
            Back to every group
          </Link>
        </p>
      ) : null}

      <div className="hq-pgroups">{list}</div>

      {shownTotal > 0 ? (
        <details className="hq-pcount">
          <summary>How these are counted</summary>
          <p>
            Last spoke is the latest call, meeting, email or note with anyone at the partner. Referred counts introductions to Planted; signed counts each management once, credited to the
            partner who first introduced it, so these figures match the Growth overview.
          </p>
        </details>
      ) : null}

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
