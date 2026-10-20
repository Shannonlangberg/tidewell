import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { getKnowledge } from "@/lib/hq/knowledge/queries";
import { ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, StatusChip, type KeyValueItem } from "@/components/hq";
import { ApproveButton, ArchiveKnowledgeButton, RestoreKnowledgeButton } from "@/components/hq/features/knowledge/KnowledgeControls";
import { KnowledgeHistory } from "@/components/hq/features/knowledge/KnowledgeHistory";
import { KnowledgeMarkdown } from "@/components/hq/features/knowledge/KnowledgeMarkdown";
import { KnowledgeStatusChip, categoryLabel } from "@/components/hq/features/knowledge/KnowledgeParts";
import { approveKnowledgeAction, archiveKnowledgeAction, restoreKnowledgeDocumentAction } from "../actions";

export const metadata: Metadata = { title: "Knowledge" };

type Params = Promise<{ id: string }>;

export default async function KnowledgeDocumentPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("knowledge.read", false, isUuid(id) ? `/hq/knowledge/${id}` : "/hq/knowledge");
  if (!isUuid(id)) notFound();
  const canWrite = can("knowledge.write");
  const canApprove = can("knowledge.approve");

  const found = await getKnowledge(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Knowledge" breadcrumbs={[{ label: "Knowledge", href: "/hq/knowledge" }, { label: "Document" }]} />
        <ErrorState
          title="We could not load this document"
          action={
            <LinkButton href={`/hq/knowledge/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  // Missing, archived (for someone who cannot restore it) and "not yours to see" are the same answer.
  if (!found.data) notFound();
  const { doc: d, draft, versions } = found.data;
  const live = !d.archived;
  const versionsHref = (n: number) => `/hq/knowledge/${d.id}/versions/${n}`;

  const details: KeyValueItem[] = [
    { label: "Category", value: categoryLabel(d.category) },
    { label: "Owner", value: d.ownerName, empty: "No owner yet" },
    {
      label: "Review due",
      value: d.reviewDue ? (
        <span className="flex flex-wrap items-center gap-2">
          <time dateTime={d.reviewDue}>{formatDate(d.reviewDue)}</time>
          {d.reviewState === "overdue" ? <StatusChip tone="warning">Overdue</StatusChip> : d.reviewState === "due_soon" ? <StatusChip tone="info">Due soon</StatusChip> : null}
        </span>
      ) : null,
      empty: "No date set",
    },
    {
      label: "Approved",
      value: d.approvedVersion ? `Version ${d.approvedVersion}${d.approvedAt ? `, ${formatDate(d.approvedAt)}` : ""}${d.approvedByName ? ` by ${d.approvedByName}` : ""}` : null,
      empty: "Not yet",
    },
    { label: "Last changed", value: <time dateTime={d.updatedAt}>{formatDateTime(d.updatedAt, staff.timezone)}</time> },
  ];

  const banner = !live ? null : d.approvedVersion === null ? (
    <div className="hq-kb-banner mb-6" role="note">
      <span className="hq-kb-banner__text">
        <span className="hq-kb-banner__title">Draft, not yet approved</span>
        {d.isTemplate
          ? "This is a starter template. Replace the prompts in square brackets with your own words; it can be approved once it is written."
          : "Read it as a draft, not yet as how we do things. A director or administrator approves it."}
      </span>
      <span className="flex flex-wrap gap-2">
        {canWrite ? (
          <LinkButton href={`/hq/knowledge/${d.id}/edit`} size="sm" icon="note">
            {d.isTemplate ? "Write it" : "Edit draft"}
          </LinkButton>
        ) : null}
        {canApprove && !d.isTemplate ? <ApproveButton id={d.id} version={d.currentVersion} title={d.title} approve={approveKnowledgeAction} /> : null}
      </span>
    </div>
  ) : d.hasPendingDraft ? (
    <div className="hq-kb-banner mb-6" data-tone="info" role="note">
      <span className="hq-kb-banner__text">
        <span className="hq-kb-banner__title">A newer draft is waiting for approval</span>
        Below is the approved version {d.approvedVersion}, which is what staff follow.
        {draft ? ` Draft version ${draft.version} was saved by ${draft.editedByName ?? "a colleague"} ${formatDateTime(draft.editedAt, staff.timezone)}.` : ""}
      </span>
      {canWrite ? (
        <LinkButton href={versionsHref(d.currentVersion)} size="sm" variant={canApprove ? "primary" : "secondary"}>
          {canApprove ? "Review and approve" : "View draft"}
        </LinkButton>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: "/hq/knowledge" }, { label: d.ref }]}
        eyebrow={d.ref}
        title={d.title}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <KnowledgeStatusChip doc={d} />
            <span className="text-[13px] text-grey-text">
              {categoryLabel(d.category)}
              {d.ownerName ? ` · owner ${d.ownerName}` : ""}
            </span>
          </span>
        }
        actions={
          canWrite && live ? (
            <LinkButton href={`/hq/knowledge/${d.id}/edit`} icon="note">
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      {d.archived ? <InlineNote className="mb-6">This document is archived: staff do not see it. Nothing was erased; restore it to bring it back.</InlineNote> : null}
      {banner}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-10">
          <section aria-labelledby="kb-text">
            <SectionLabel as="h2" id="kb-text" className="mb-4 border-b border-line pb-3.5">
              {d.readingIsDraft ? `Draft text (version ${d.readingVersion})` : `Approved text (version ${d.readingVersion})`}
            </SectionLabel>
            {d.summary ? <p className="mb-5 text-[15px] text-grey-text">{d.summary}</p> : null}
            <KnowledgeMarkdown text={d.body ?? ""} label={d.readingIsDraft ? "Draft text" : "Approved text"} />
          </section>

          <section aria-labelledby="kb-history">
            <SectionLabel as="h2" id="kb-history" className="mb-5 border-b border-line pb-3.5">
              Version history
            </SectionLabel>
            {versions.length > 0 ? <KnowledgeHistory docId={d.id} versions={versions} timezone={staff.timezone} /> : <p className="hq-muted">No versions to show.</p>}
            {!canWrite && d.hasPendingDraft && d.approvedVersion !== null ? <p className="hq-muted mt-3 text-[13px]">Drafts are shown to people who can edit.</p> : null}
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Document details">
          <Panel aria-labelledby="kb-details">
            <PanelHeader id="kb-details" title="Details" level={2} />
            <KeyValueList items={details} />
            {d.approvedVersion !== null && live ? (
              <p className="mt-4 text-[13px]">
                <Link href={versionsHref(d.approvedVersion)} className="underline underline-offset-4">
                  What changed in the approved version
                </Link>
              </p>
            ) : null}
          </Panel>

          {canApprove ? (
            <Panel aria-labelledby="kb-manage">
              <PanelHeader id="kb-manage" title="Manage" level={2} />
              {d.archived ? (
                <RestoreKnowledgeButton id={d.id} restore={restoreKnowledgeDocumentAction} />
              ) : (
                <div className="grid gap-3">
                  <p className="text-[14px] text-grey-text">Archive a document nobody should follow any more. Nothing is erased, and it can be restored.</p>
                  <div>
                    <ArchiveKnowledgeButton id={d.id} title={d.title} archive={archiveKnowledgeAction} />
                  </div>
                </div>
              )}
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
