import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { getContractor, openTasksForContractor, previewApproval } from "@/lib/hq/contractors/queries";
import { statusActions } from "@/lib/hq/contractors/status";
import { clearedButExpired } from "@/lib/hq/contractors/types";
import { isUuid } from "@/lib/hq/forms";
import { nowLocalInput, todayInZone } from "@/lib/hq/growth/dates";
import { staffOptions } from "@/lib/hq/queries/options";
import { newTaskHref } from "@/lib/hq/tasks/rules";
import { ErrorState, InlineNote, LinkButton, PageHeader, buildHref } from "@/components/hq";
import { ArchiveButton } from "@/components/hq/features/contacts/ArchiveButton";
import { NeedsVerifyingChip } from "@/components/hq/features/contacts/Bits";
import { VerifyNotice } from "@/components/hq/features/contacts/Verify";
import { ClearedButExpired, ContractorStatusChip } from "@/components/hq/features/contractors/Bits";
import { ContractorDetails } from "@/components/hq/features/contractors/ContractorDetails";
import { ContractorTasks } from "@/components/hq/features/contractors/ContractorTasks";
import { LogContactDrawer } from "@/components/hq/features/contractors/LogContactDrawer";
import { StatusActions } from "@/components/hq/features/contractors/StatusActions";
import { RecordJobButton } from "@/components/hq/features/contractors/RecordJob";
import { DocumentsSection } from "@/components/hq/features/contractor-sections/DocumentsSection";
import { PerformanceSection } from "@/components/hq/features/contractor-sections/PerformanceSection";
import { TimelineSection } from "@/components/hq/features/contractor-sections/TimelineSection";
import { VettingSection } from "@/components/hq/features/contractor-sections/VettingSection";
import { archiveContractor, markContractorVerified } from "../actions";

export const metadata: Metadata = { title: "Contractor" };

const BASE = "/hq/partners";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContractorPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("contractors.read", false, buildHref(`${BASE}/${isUuid(id) ? id : ""}`, sp));
  if (!isUuid(id)) notFound();

  const crumbs = [{ label: "Contractors", href: BASE }];
  const found = await getContractor(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader breadcrumbs={[...crumbs, { label: "Contractor" }]} title="Contractor" />
        <ErrorState title="We could not load this contractor" action={<LinkButton href={`${BASE}/${id}`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const c = found.data;

  const canWrite = can("contractors.write");
  const canApprove = can("contractors.approve");
  const canTask = can("tasks.write");
  const today = todayInZone(staff.timezone);
  const tz = staff.timezone;
  const actions = statusActions(c.status, { write: canWrite, approve: canApprove });

  const [tasks, staffList, preview] = await Promise.all([
    openTasksForContractor(db, id),
    canWrite ? staffOptions(db) : Promise.resolve([]),
    actions.approve || actions.prefer ? previewApproval(db, id) : Promise.resolve(null),
  ]);

  const taskHref = newTaskHref({ contractor: c.id, title: `Follow up with ${c.businessName}`, returnTo: `${BASE}/${c.id}` });
  const logHref = (type: string) => buildHref(`${BASE}/${id}`, sp, { log: type });
  const trades = c.tradeLabels.join(", ");

  return (
    <>
      <PageHeader
        breadcrumbs={[...crumbs, { label: c.businessName }]}
        title={c.businessName}
        description={[trades, c.primaryContactName].filter(Boolean).join(" · ") || undefined}
        meta={
          <>
            <ContractorStatusChip status={c.status} />
            {c.needsVerification ? <NeedsVerifyingChip /> : null}
            <ClearedButExpired contractor={c} />
          </>
        }
        actions={
          canWrite ? (
            <>
              <LinkButton href={logHref("phone_call")} variant="primary" icon="phone">
                Log contact
              </LinkButton>
              <LinkButton href={logHref("note")} icon="note">
                Add note
              </LinkButton>
            </>
          ) : undefined
        }
      />

      <div className="-mt-4 mb-8 flex flex-wrap items-center gap-2">
        {canTask ? (
          <LinkButton href={taskHref} size="sm" icon="task">
            Create follow-up task
          </LinkButton>
        ) : null}
        {canWrite ? (
          <LinkButton href={`${BASE}/${id}/edit`} size="sm">
            Edit
          </LinkButton>
        ) : null}
        {canWrite ? <RecordJobButton contractorId={c.id} businessName={c.businessName} lastJobDate={c.lastJobDate} today={today} /> : null}
        <StatusActions contractorId={c.id} businessName={c.businessName} status={c.status} actions={actions} preview={preview && preview.ok ? preview.data : null} />
        {canApprove ? (
          <ArchiveButton
            id={c.id}
            noun="contractor"
            name={c.businessName}
            size="sm"
            action={archiveContractor}
            consequence="Their history and documents are kept, and they will no longer appear in lists, search or the dashboard. A director or administrator can restore them."
          />
        ) : null}
      </div>

      {clearedButExpired(c) ? (
        <ErrorState title={`Approved, but ${c.insuranceState === "expired" && c.licenceState === "expired" ? "their insurance and licence have" : c.insuranceState === "expired" ? "their insurance has" : "their licence has"} expired`} className="mb-8">
          They stay {c.status === "preferred" ? "preferred" : "approved"} until a person decides otherwise: nothing changes by itself. Check the paperwork before anyone sends them to a property, then upload the new document or suspend them.
        </ErrorState>
      ) : null}

      {c.status === "suspended" ? (
        <InlineNote className="mb-8">
          <b>Suspended.</b> {c.statusReason ? `Reason: ${c.statusReason}` : "No reason is recorded."} Nobody should send them to a property. Only a director or administrator can reinstate them, and they return to vetting.
        </InlineNote>
      ) : c.status === "inactive" ? (
        <InlineNote className="mb-8">
          <b>Inactive.</b> {c.statusReason ? `Note: ${c.statusReason} ` : ""}They are kept for the record but are not being used.
        </InlineNote>
      ) : null}

      {c.needsVerification ? <VerifyNotice id={c.id} noun="contractor" action={markContractorVerified} canVerify={canWrite} /> : null}

      <div className="grid max-w-5xl gap-14">
        <ContractorDetails c={c} timezone={tz} />
        <VettingSection contractorId={c.id} />
        <DocumentsSection contractorId={c.id} />
        <PerformanceSection contractorId={c.id} />
        <ContractorTasks tasks={tasks} today={today} createHref={canTask ? taskHref : undefined} />
        <TimelineSection contractorId={c.id} />
      </div>

      {canWrite ? (
        <LogContactDrawer
          contractor={{ id: c.id, name: c.businessName, status: c.status }}
          staffOptions={staffList}
          canCreateTasks={canTask}
          staffId={staff.id}
          timezone={tz}
          serverNowLocal={nowLocalInput(tz)}
          today={today}
        />
      ) : null}
    </>
  );
}
