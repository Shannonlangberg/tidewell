import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { ENQUIRY_KINDS, ENQUIRY_KIND_LABEL, ENQUIRY_STATUSES, ENQUIRY_STATUS_LABEL, parseEnquiryListParams } from "@/lib/hq/enquiry-rules";
import { ENQUIRY_PAGE_SIZE, listEnquiries } from "@/lib/hq/enquiry-queries";
import { EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, Pagination, Select, buildHref } from "@/components/hq";
import { EnquiriesTable } from "@/components/hq/features/enquiries/EnquiryParts";

export const metadata: Metadata = { title: "Website enquiries" };

const PATH = "/hq/growth/enquiries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Website enquiries: every rental appraisal request and contact form from plantedproperty.com.au,
 * newest first. Each one is already a lead with an owner, a reply task due the day it arrived and a
 * message on the lead's timeline (hq.submit_enquiry). growth.read sees them; row level security
 * decides, not this page.
 */
export default async function EnquiriesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff } = await requireStaff("growth.read", false, buildHref(PATH, sp));
  const q = parseEnquiryListParams(sp);
  const list = await listEnquiries(db, { status: q.status, kind: q.kind, page: q.page });

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
    <EmptyState title="No website enquiries yet">
      They appear here the moment someone fills in a form on plantedproperty.com.au.
    </EmptyState>
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Website enquiries" }]}
        eyebrow="Growth"
        title="Website enquiries"
        description="Rental appraisal requests and contact forms from the website. Each one is already a lead with an owner and a reply task due the day it arrived."
        actions={<LinkButton href="/hq/growth/pipeline">Pipeline</LinkButton>}
      />

      <FilterBar action={PATH} label="Filter website enquiries" resetHref={PATH} active={q.filtered}>
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
