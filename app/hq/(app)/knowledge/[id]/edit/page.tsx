import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { getKnowledge, getVersion } from "@/lib/hq/knowledge/queries";
import { staffOptions, type Option } from "@/lib/hq/queries/options";
import { ErrorState, InlineNote, LinkButton, PageHeader } from "@/components/hq";
import { KnowledgeForm } from "@/components/hq/features/knowledge/KnowledgeForm";
import { updateKnowledgeAction } from "../../actions";

export const metadata: Metadata = { title: "Edit document" };

type Params = Promise<{ id: string }>;

export default async function EditKnowledgePage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff } = await requireStaff("knowledge.write", false, isUuid(id) ? `/hq/knowledge/${id}/edit` : "/hq/knowledge");
  if (!isUuid(id)) notFound();

  const [found, people] = await Promise.all([getKnowledge(db, id), staffOptions(db)]);
  const failed = (
    <>
      <PageHeader title="Edit document" />
      <ErrorState
        title="We could not load this document"
        action={
          <LinkButton href={`/hq/knowledge/${id}/edit`} size="sm">
            Try again
          </LinkButton>
        }
      />
    </>
  );
  if (!found.ok) return failed;
  if (!found.data || found.data.doc.archived) notFound();
  const d = found.data.doc;
  // The edit starts from the newest version: the waiting draft if there is one, otherwise the approved text.
  const working = await getVersion(db, id, d.currentVersion);
  if (!working.ok) return failed;
  if (!working.data) notFound();
  const w = working.data;
  const fromDraft = w.status === "draft";

  // An owner who has since left is not in the active list: keep them visible so saving does not silently change it.
  const owners: Option[] = !d.ownerId || people.some((p) => p.value === d.ownerId) ? people : [{ value: d.ownerId, label: d.ownerName ?? "Current owner" }, ...people];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: "/hq/knowledge" }, { label: d.ref, href: `/hq/knowledge/${d.id}` }, { label: "Edit" }]}
        title={`Edit ${d.ref}`}
        description="Saving makes a new draft version. Staff keep reading the approved version until a director or administrator approves the draft."
      />
      <InlineNote className="mb-6 max-w-3xl">
        You are editing version {w.version}
        {fromDraft ? (d.approvedVersion === null ? " (the draft, not yet approved)" : ` (the draft waiting for approval; version ${d.approvedVersion} is approved)`) : " (the approved version)"}. Saving makes version{" "}
        {/* the next number is decided by the database; this is what it will normally be */}
        {Math.max(...found.data.versions.map((v) => v.version), w.version) + 1}.
      </InlineNote>
      <KnowledgeForm
        mode="edit"
        action={updateKnowledgeAction}
        documentId={d.id}
        baseVersion={d.currentVersion}
        initial={{ title: w.title, category: d.category, summary: w.summary ?? "", ownerId: d.ownerId ?? "", reviewDue: d.reviewDue ?? "", body: w.body ?? "" }}
        staff={owners}
        today={todayIn(staff.timezone)}
        cancelHref={`/hq/knowledge/${d.id}`}
      />
    </>
  );
}
