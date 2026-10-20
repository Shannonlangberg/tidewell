import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { HANDOVER_STEP_STATUS_LABEL, SERVICE_TYPE_LABEL, feeText } from "@/lib/hq/portfolio/rules";
import { getProperty } from "@/lib/hq/portfolio/queries";
import { ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, type KeyValueItem } from "@/components/hq";
import { HandoverChecklist, type ChecklistStep } from "@/components/hq/features/portfolio/HandoverChecklist";
import { AiloChip, HandoverProgress, ManagedStatusChip, ServiceChip } from "@/components/hq/features/portfolio/PortfolioParts";
import { ArchiveProperty, RestoreProperty } from "@/components/hq/features/portfolio/PropertyControls";
import { archiveProperty, restoreProperty, setHandoverStepAction } from "../actions";

export const metadata: Metadata = { title: "Property" };

type Params = Promise<{ id: string }>;

const nil = <span className="hq-cell-nil">Not recorded</span>;

export default async function PropertyPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("portfolio.read", false, isUuid(id) ? `/hq/portfolio/${id}` : "/hq/portfolio");
  if (!isUuid(id)) notFound();
  const canWrite = can("portfolio.write");

  const found = await getProperty(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Property" breadcrumbs={[{ label: "Properties", href: "/hq/portfolio" }, { label: "Property" }]} />
        <ErrorState
          title="We could not load this property"
          action={
            <LinkButton href={`/hq/portfolio/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  // Missing, archived (for a reader) and "not yours to see" are the same answer.
  if (!found.data) notFound();
  const { property: p, steps } = found.data;

  const checklist: ChecklistStep[] = steps.map((s, i) => ({
    step: s.step,
    number: i + 1,
    status: s.status,
    note: s.note,
    completedLine:
      (s.status === "done" || s.status === "not_applicable") && s.completedAt
        ? `${HANDOVER_STEP_STATUS_LABEL[s.status]}${s.completedByName ? ` by ${s.completedByName}` : ""}, ${formatDateTime(s.completedAt, staff.timezone)}`
        : null,
  }));
  const date = (d: string | null) => (d ? <time dateTime={d}>{formatDate(d)}</time> : nil);

  const details: KeyValueItem[] = [
    { label: "Status", value: <ManagedStatusChip status={p.status} /> },
    { label: "Service", value: SERVICE_TYPE_LABEL[p.serviceType] },
    { label: "Fee", value: feeText(p.feeBasis, p.feePercent, p.feeNotes) },
    { label: "Agreement signed", value: date(p.agreementSignedOn) },
    { label: "Managed from", value: date(p.managedFrom) },
    ...(p.status === "ended" ? [{ label: "Ended on", value: date(p.endedOn) }] : []),
    { label: "Last changed", value: <time dateTime={p.updatedAt}>{formatDateTime(p.updatedAt, staff.timezone)}</time> },
  ];
  const owner: KeyValueItem[] = [
    {
      label: "Owner",
      value: p.ownerContactId ? (
        <Link href={`/hq/growth/contacts/${p.ownerContactId}`} className="underline underline-offset-4">
          {p.ownerDisplayName ?? "Contact"}
        </Link>
      ) : (
        (p.ownerDisplayName ?? nil)
      ),
    },
    ...(p.ownerPhone ? [{ label: "Phone", value: <a href={`tel:${p.ownerPhone.replace(/[^\d+]/g, "")}`}>{p.ownerPhone}</a> }] : []),
    ...(p.ownerEmail ? [{ label: "Email", value: <a href={`mailto:${p.ownerEmail}`}>{p.ownerEmail}</a> }] : []),
    {
      label: "Came from",
      value: p.opportunityId ? (
        <Link href={`/hq/growth/opportunities/${p.opportunityId}`} className="underline underline-offset-4">
          Signed lead{p.opportunityProspectName ? `: ${p.opportunityProspectName}` : ""}
        </Link>
      ) : (
        <span>Signed before HQ{p.manualOriginNote ? `: ${p.manualOriginNote}` : ""}</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Properties", href: "/hq/portfolio" }, { label: p.ref }]}
        eyebrow={p.ref}
        title={p.propertyAddress}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ManagedStatusChip status={p.status} />
            <ServiceChip service={p.serviceType} />
            <AiloChip status={p.ailoStatus} prefix />
            {p.suburb ? <span className="text-[13px] text-grey-text">{p.suburb}</span> : null}
          </span>
        }
        actions={
          canWrite && !p.archived ? (
            <LinkButton href={`/hq/portfolio/${p.id}/edit`} icon="note">
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      {p.archived ? <InlineNote className="mb-6">This property is archived: it is not in the portfolio and does not count towards the goal. Restore it to bring it back.</InlineNote> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-10">
          <section aria-labelledby="p-ailo">
            <SectionLabel as="h2" id="p-ailo" className="mb-4 border-b border-line pb-3.5">
              Ailo
            </SectionLabel>
            <p className="mb-4 text-[15px]">Ailo is where rent, trust accounting and maintenance live; HQ only records the reference.</p>
            <KeyValueList
              items={[
                { label: "Ailo reference", value: p.ailoReference ?? nil },
                { label: "Ailo status", value: <AiloChip status={p.ailoStatus} /> },
              ]}
            />
          </section>

          <section aria-labelledby="p-handover">
            <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3.5">
              <SectionLabel as="h2" id="p-handover">
                Handover to Ailo
              </SectionLabel>
              <p className="text-[13px] text-grey-text">
                <HandoverProgress done={p.handoverDone} total={p.handoverTotal} /> steps
              </p>
            </div>
            <InlineNote className="mb-5">Finishing these steps does not change the property&rsquo;s status. Mark it active yourself when management starts.</InlineNote>
            <HandoverChecklist propertyId={p.id} steps={checklist} canWrite={canWrite && !p.archived} action={setHandoverStepAction} />
            {!canWrite ? <p className="hq-muted mt-4 text-[13px]">Your role can read this checklist but not change it.</p> : null}
          </section>

          <section aria-labelledby="p-notes">
            <SectionLabel as="h2" id="p-notes" className="mb-4 border-b border-line pb-3.5">
              Notes
            </SectionLabel>
            {p.notes ? <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{p.notes}</p> : <p className="hq-muted">No notes.</p>}
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Property details">
          <Panel aria-labelledby="p-details">
            <PanelHeader id="p-details" title="Details" level={2} />
            <KeyValueList items={details} />
          </Panel>
          <Panel aria-labelledby="p-owner">
            <PanelHeader id="p-owner" title="Owner" level={2} />
            <KeyValueList items={owner} />
          </Panel>
          {canWrite ? (
            <Panel aria-labelledby="p-manage">
              <PanelHeader id="p-manage" title="Manage" level={2} />
              {p.archived ? <RestoreProperty id={p.id} restore={restoreProperty} /> : <ArchiveProperty id={p.id} label={`${p.ref} ${p.propertyAddress}`} archive={archiveProperty} />}
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
