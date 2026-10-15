import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { logTag } from "@/lib/hq/contractors/db-errors";
import { formatDateTime } from "@/lib/hq/format";
import { DataTable, EmptyState, PageHeader, SectionLabel } from "@/components/hq";
import { ContractorImportFlow } from "@/components/hq/features/contractors/ContractorImportFlow";

export const metadata: Metadata = { title: "Import contractors" };

type Batch = {
  id: string;
  source: string;
  file_name: string | null;
  row_count: number;
  contractors_created: number;
  duplicates_skipped: number;
  applied_at: string;
};

export default async function ImportContractorsPage() {
  // Both are needed: the database checks both too. A person with only one is sent back out.
  const { db, staff, can } = await requireStaff("contractors.write");
  if (!can("import.run")) redirect(`${HQ_BASE}?denied=import.run`);

  const batches = await db
    .from("import_batches")
    .select("id, source, file_name, row_count, contractors_created, duplicates_skipped, applied_at")
    .eq("kind", "contractor")
    .order("applied_at", { ascending: false })
    .limit(8);
  if (batches.error) console.error("[hq] contractor import_batches failed:", logTag(batches.error));
  const recent = (batches.data ?? []) as Batch[];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Contractors", href: "/hq/partners" }, { label: "Import" }]}
        title="Import contractors"
        description="Bring in a list of contractors. You review exactly what would happen to every row before anything is added, and anyone already in HQ is skipped. Everyone imported is a prospect who needs verifying: an import never approves anyone."
      />

      <ContractorImportFlow />

      <section aria-labelledby="recent-h" className="mt-16">
        <SectionLabel as="h2" id="recent-h" className="mb-1 border-b border-line pb-3">
          Recent imports
        </SectionLabel>
        <DataTable
          caption="Recent contractor imports"
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
            { key: "created", header: "Contractors", align: "right", cell: (b) => <span className="tabular-nums">{b.contractors_created}</span> },
            { key: "skipped", header: "Skipped", align: "right", hideBelow: "lg", cell: (b) => <span className="tabular-nums">{b.duplicates_skipped}</span> },
          ]}
        />
      </section>
    </>
  );
}
