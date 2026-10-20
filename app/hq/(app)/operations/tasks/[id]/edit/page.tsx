import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { contractorOptions } from "@/lib/hq/contractors/queries";
import { contactOptions, organisationOptions, staffOptions, type Option } from "@/lib/hq/queries/options";
import { getTask } from "@/lib/hq/tasks/queries";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { TaskForm, type LinkedSummary } from "@/components/hq/features/tasks/TaskForm";
import { updateTask } from "../../../actions";

export const metadata: Metadata = { title: "Edit task" };

type Params = Promise<{ id: string }>;

export default async function EditTaskPage({ params }: { params: Params }) {
  const { id } = await params;
  // Editing needs tasks.write: a read-only person who opens this URL is sent back out before anything loads.
  const { db, staff, can } = await requireStaff("tasks.write", false, isUuid(id) ? `/hq/operations/tasks/${id}/edit` : "/hq/operations");
  if (!isUuid(id)) notFound();

  const canLink = can("growth.read");
  const canLinkContractors = can("contractors.read");
  const [found, staffList, contacts, organisations, contractors] = await Promise.all([
    getTask(db, id, { canGrowth: canLink, canContractors: canLinkContractors }),
    staffOptions(db),
    canLink ? contactOptions(db) : Promise.resolve<Option[]>([]),
    canLink ? organisationOptions(db) : Promise.resolve<Option[]>([]),
    canLinkContractors ? contractorOptions(db) : Promise.resolve<Option[]>([]),
  ]);

  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit task" />
        <ErrorState
          title="We could not load this task"
          action={
            <LinkButton href={`/hq/operations/tasks/${id}/edit`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data) notFound();
  const t = found.data;

  const withSelected = (options: Option[], rel: { id: string; label: string | null } | null, group: string): Option[] =>
    rel && rel.label && !options.some((o) => o.value === rel.id) ? [{ value: rel.id, label: rel.label, group }, ...options] : options;

  // A person assigned a task who has since left is not in the active list: keep them selectable so saving does not silently reassign it.
  const assigneeOptions: Option[] =
    t.assignedTo && !staffList.some((s) => s.value === t.assignedTo) ? [{ value: t.assignedTo, label: t.assignedToName ?? "Current assignee" }, ...staffList] : staffList;

  // The assignee of a task they did not create, who cannot see every task, cannot hand it on: the database refuses it.
  const mayHandOver = t.createdBy === staff.id || can("tasks.read_all");
  const lockAssignee = !mayHandOver && t.assignedTo === staff.id ? { id: staff.id, name: staff.fullName } : null;

  const linked: LinkedSummary[] = [];
  if (t.related.contact) linked.push({ kind: "contact", label: t.related.contact.label, href: t.related.contact.label ? `/hq/growth/contacts/${t.related.contact.id}` : null });
  if (t.related.organisation) {
    linked.push({ kind: "organisation", label: t.related.organisation.label, href: t.related.organisation.label ? `/hq/growth/organisations/${t.related.organisation.id}` : null });
  }
  if (t.related.referral) linked.push({ kind: "referral", label: t.related.referral.label, href: t.related.referral.label ? `/hq/growth/referrals/${t.related.referral.id}` : null });
  if (t.related.opportunity) linked.push({ kind: "opportunity", label: t.related.opportunity.label, href: t.related.opportunity.label ? `/hq/growth/opportunities/${t.related.opportunity.id}` : null });
  if (t.related.contractor) linked.push({ kind: "contractor", label: t.related.contractor.label, href: t.related.contractor.label ? `/hq/partners/${t.related.contractor.id}` : null });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Operations", href: "/hq/operations" }, { label: "Task", href: `/hq/operations/tasks/${t.id}` }, { label: "Edit" }]}
        title="Edit task"
        description={
          lockAssignee
            ? "Change the details. To complete, reopen or cancel the task, use its own page."
            : "Change the details or hand the task to someone else. To complete, reopen or cancel it, use the task's own page."
        }
      />
      <TaskForm
        mode="edit"
        action={updateTask}
        taskId={t.id}
        version={t.updatedAt}
        initial={{
          title: t.title,
          description: t.description ?? "",
          dueDate: t.dueDate ?? "",
          priority: t.priority,
          assignedTo: t.assignedTo ?? "",
          contactId: t.related.contact?.id ?? "",
          organisationId: t.related.organisation?.id ?? "",
          referralId: t.related.referral?.id ?? "",
          opportunityId: t.related.opportunity?.id ?? "",
          contractorId: t.related.contractor?.id ?? "",
        }}
        staff={assigneeOptions}
        contacts={withSelected(contacts, t.related.contact, "Linked contact")}
        organisations={withSelected(organisations, t.related.organisation, "Linked organisation")}
        contractors={withSelected(contractors, t.related.contractor, "Linked contractor")}
        canLinkContractors={canLinkContractors}
        canLink={canLink}
        linked={linked}
        referralLink={t.related.referral ? { id: t.related.referral.id, label: t.related.referral.label } : null}
        opportunityLink={t.related.opportunity ? { id: t.related.opportunity.id, label: t.related.opportunity.label } : null}
        today={todayIn(staff.timezone)}
        cancelHref={`/hq/operations/tasks/${t.id}`}
        lockAssignee={lockAssignee}
      />
    </>
  );
}
