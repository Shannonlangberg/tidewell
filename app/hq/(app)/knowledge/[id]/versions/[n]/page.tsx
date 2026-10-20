import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { changeSummary } from "@/lib/hq/knowledge/diff";
import { getKnowledge, getVersion, previousVersion } from "@/lib/hq/knowledge/queries";
import { ErrorState, LinkButton, PageHeader, SectionLabel } from "@/components/hq";
import { ApproveButton, DiscardDraftButton, RestoreVersionButton } from "@/components/hq/features/knowledge/KnowledgeControls";
import { KnowledgeDiff } from "@/components/hq/features/knowledge/KnowledgeDiff";
import { KnowledgeMarkdown } from "@/components/hq/features/knowledge/KnowledgeMarkdown";
import { VersionStatusChip } from "@/components/hq/features/knowledge/KnowledgeParts";
import { approveKnowledgeAction, discardKnowledgeDraftAction, restoreKnowledgeVersionAction } from "../../../actions";

export const metadata: Metadata = { title: "Version" };

type Params = Promise<{ id: string; n: string }>;

/*
 * One version of a document: what changed compared with the version before it (or ?compare=N), and its
 * text. From here an approver approves the waiting draft, a writer discards their draft or brings an
 * older version back as a new draft. Readers without knowledge.write reach only approved and previously
 * approved versions (the database decides).
 */
export default async function KnowledgeVersionPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id, n } = await params;
  const sp = await searchParams;
  const version = /^\d{1,9}$/.test(n) ? Number(n) : null;
  const { db, staff, can } = await requireStaff("knowledge.read", false, isUuid(id) && version ? `/hq/knowledge/${id}/versions/${version}` : "/hq/knowledge");
  if (!isUuid(id) || !version) notFound();
  const compareRaw = typeof sp.compare === "string" && /^\d{1,9}$/.test(sp.compare) ? Number(sp.compare) : null;

  const [found, v] = await Promise.all([getKnowledge(db, id), getVersion(db, id, version)]);
  const cmp = compareRaw ? await getVersion(db, id, compareRaw) : await previousVersion(db, id, version);
  if (!found.ok || !v.ok || !cmp.ok) {
    return (
      <>
        <PageHeader title="Version" />
        <ErrorState
          title="We could not load this version"
          action={
            <LinkButton href={`/hq/knowledge/${id}/versions/${version}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data || !v.data) notFound();
  const d = found.data.doc;
  const ver = v.data;
  const other = cmp.data;
  const live = !d.archived;
  const isWaitingDraft = live && ver.status === "draft" && ver.version === d.currentVersion;
  const canApprove = can("knowledge.approve") && isWaitingDraft && !d.isTemplate;
  const canDiscard = can("knowledge.write") && isWaitingDraft && d.approvedVersion !== null && (ver.editedById === staff.id || can("knowledge.approve"));
  const canRestore = can("knowledge.write") && live && ver.version !== d.currentVersion;

  const summary = other
    ? changeSummary({ title: other.title, summary: other.summary, body: other.body ?? "" }, { title: ver.title, summary: ver.summary, body: ver.body ?? "" })
    : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Knowledge", href: "/hq/knowledge" }, { label: d.ref, href: `/hq/knowledge/${d.id}` }, { label: `Version ${ver.version}` }]}
        eyebrow={`${d.ref} · version ${ver.version}`}
        title={ver.title}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <VersionStatusChip status={ver.status} wasApproved={ver.approvedAt !== null} />
            <span className="text-[13px] text-grey-text">
              Saved {formatDateTime(ver.editedAt, staff.timezone)}
              {ver.editedByName ? ` by ${ver.editedByName}` : ""}
              {ver.via === "mcp" ? " through a chat app" : ""}
            </span>
          </span>
        }
        actions={
          canApprove || canDiscard || canRestore ? (
            <span className="flex flex-wrap gap-2">
              {canApprove ? <ApproveButton id={d.id} version={ver.version} title={d.title} approve={approveKnowledgeAction} label="Approve" /> : null}
              {canDiscard ? <DiscardDraftButton id={d.id} version={ver.version} discard={discardKnowledgeDraftAction} /> : null}
              {canRestore ? <RestoreVersionButton id={d.id} version={ver.version} baseVersion={d.currentVersion} restore={restoreKnowledgeVersionAction} /> : null}
            </span>
          ) : undefined
        }
      />

      {ver.changeNote ? <p className="mb-6 max-w-3xl text-[15px]">&ldquo;{ver.changeNote}&rdquo;</p> : null}
      {isWaitingDraft && d.approvedVersion !== null ? (
        <p className="hq-muted mb-6 max-w-3xl text-[14px]">This draft is not approved. Staff read version {d.approvedVersion} until it is.</p>
      ) : null}

      <div className="grid gap-10">
        <section aria-labelledby="kb-changes">
          <SectionLabel as="h2" id="kb-changes" className="mb-4 border-b border-line pb-3.5">
            {other ? `What changed since version ${other.version}` : "What changed"}
          </SectionLabel>
          {other ? (
            <>
              <p className="mb-4 text-[15px]">{summary}</p>
              <KnowledgeDiff before={other.body ?? ""} after={ver.body ?? ""} label={`Changes from version ${other.version} to version ${ver.version}`} />
            </>
          ) : (
            <p className="hq-muted">This is the first version you can see.</p>
          )}
        </section>

        <section aria-labelledby="kb-version-text">
          <SectionLabel as="h2" id="kb-version-text" className="mb-4 border-b border-line pb-3.5">
            Text of version {ver.version}
          </SectionLabel>
          {ver.summary ? <p className="mb-5 text-[15px] text-grey-text">{ver.summary}</p> : null}
          <KnowledgeMarkdown text={ver.body ?? ""} label={`Version ${ver.version}`} />
        </section>
      </div>
    </>
  );
}
