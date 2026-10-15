import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { formatDateTime } from "@/lib/hq/format";
import { logTag } from "@/lib/hq/growth/db-errors";
import { DataTable, EmptyState, PageHeader, SectionLabel } from "@/components/hq";
import { ImportFlow } from "@/components/hq/features/import/ImportFlow";

export const metadata: Metadata = { title: "Import partners" };

type Batch = {
  id: string;
  source: string;
  file_name: string | null;
  row_count: number;
  organisations_created: number;
  contacts_created: number;
  duplicates_skipped: number;
  applied_at: string;
};

export default async function ImportPage() {
  const { db, staff } = await requireStaff("import.run");

  const batches = await db
    .from("import_batches")
    .select("id, source, file_name, row_count, organisations_created, contacts_created, duplicates_skipped, applied_at")
    .order("applied_at", { ascending: false })
    .limit(8);
  if (batches.error) console.error("[hq] import_batches failed:", logTag(batches.error));
  const recent = (batches.data ?? []) as Batch[];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Contacts", href: "/hq/growth/contacts" }, { label: "Import" }]}
        title="Import partners"
        description="Bring in a list of organisations and the people at them. You review exactly what would happen to every row before anything is added, and anyone already in HQ is skipped."
      />

      <ImportFlow />

      <section aria-labelledby="recent-h" className="mt-16">
        <SectionLabel as="h2" id="recent-h" className="mb-1 border-b border-line pb-3">
          Recent imports
        </SectionLabel>
        <DataTable
          caption="Recent imports"
          rows={recent}
          rowKey={(b) => b.id}
          empty={
            <EmptyState compact title="No imports yet">
              Imports you confirm are listed here, with what each one created.
            </EmptyState>
          }
          columns={[
            { key: "when", header: "When", primary: true, nowrap: true, cell: (b) => formatDateTime(b.applied_at, staff.timezone) },
            { key: "source", header: "Source", cell: (b) => b.source },
            { key: "file", header: "File", hideBelow: "lg", cell: (b) => b.file_name ?? <span className="hq-cell-nil">Not recorded</span> },
            { key: "rows", header: "Rows", align: "right", cell: (b) => <span className="tabular-nums">{b.row_count}</span> },
            { key: "orgs", header: "Organisations", align: "right", hideBelow: "lg", cell: (b) => <span className="tabular-nums">{b.organisations_created}</span> },
            { key: "contacts", header: "Contacts", align: "right", cell: (b) => <span className="tabular-nums">{b.contacts_created}</span> },
            { key: "skipped", header: "Skipped", align: "right", hideBelow: "lg", cell: (b) => <span className="tabular-nums">{b.duplicates_skipped}</span> },
          ]}
        />
      </section>
    </>
  );
}
