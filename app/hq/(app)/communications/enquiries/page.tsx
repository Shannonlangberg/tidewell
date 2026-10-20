import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { COMMS_TAB_PATH } from "@/lib/hq/communications";
import { ENQUIRY_KINDS, ENQUIRY_KIND_LABEL, ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, parseEnquiryListParams } from "@/lib/hq/enquiry-rules";
import { ENQUIRY_PAGE_SIZE, countNewEnquiries, listEnquiries } from "@/lib/hq/enquiry-queries";
import { EmptyState, ErrorState, FilterBar, LinkButton, Pagination, Select, buildHref } from "@/components/hq";
import { CommsHeader } from "@/components/hq/features/communications/CommsHeader";
import { EnquiriesTable } from "@/components/hq/features/enquiries/EnquiryParts";

export const metadata: Metadata = { title: "Enquiries · Communications" };

const PATH = COMMS_TAB_PATH.enquiries;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Communications > Enquiries: every rental appraisal request and contact form from
 * plantedproperty.com.au, newest first, with whether the automatic thank-you went. Each one is already
 * a lead with an owner, a reply task due the day it arrived and a message on the lead's timeline
 * (hq.submit_enquiry). growth.read sees them; row level security decides, not this page.
 * (The old address /hq/growth/enquiries redirects here; an enquiry's own page stays at
 * /hq/growth/enquiries/<id>.)
 */
export default async function CommsEnquiriesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff } = await requireStaff("growth.read", false, buildHref(PATH, sp));
  const q = parseEnquiryListParams(sp);
  const [list, fresh] = await Promise.all([listEnquiries(db, { status: q.status, kind: q.kind, page: q.page }), countNewEnquiries(db)]);

  const empty = q.filtered ? (
    <EmptyState
      title="No enquiries match"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Clear the filters to see every website enquiry.
    </EmptyState>
  ) : (
    <EmptyState title="No website enquiries yet">They appear here the moment someone fills in a form on plantedproperty.com.au.</EmptyState>
  );

  return (
    <>
      <CommsHeader
        current="enquiries"
        capabilities={staff.capabilities}
        newEnquiries={fresh.ok ? fresh.data : null}
        actions={<LinkButton href="/hq/growth/pipeline">Pipeline</LinkButton>}
      />

      <FilterBar action={PATH} label="Filter website enquiries" resetHref={PATH} active={q.filtered} className="mt-6">
        <Select
          name="status"
          label="Status"
          hideLabel
          placeholder="Any status"
          defaultValue={q.status ?? ""}
          options={ENQUIRY_STATUSES.map((s) => ({ value: s, label: ENQUIRY_STATUS_LABEL[s] }))}
        />
        <Select
          name="kind"
          label="Form"
          hideLabel
          placeholder="Both forms"
          defaultValue={q.kind ?? ""}
          options={ENQUIRY_KINDS.map((k) => ({ value: k, label: ENQUIRY_KIND_LABEL[k] }))}
        />
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load the enquiries"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <EnquiriesTable
              rows={list.data.rows}
              caption={`Website enquiries, ${list.data.total} ${list.data.total === 1 ? "enquiry" : "enquiries"}, newest first`}
              empty={empty}
              timezone={staff.timezone}
            />
            <Pagination page={q.page} pageSize={ENQUIRY_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
