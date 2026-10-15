import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { contactOptions, organisationOptions, staffOptions, type Option } from "@/lib/hq/queries/options";
import { safeReturnPath } from "@/lib/hq/tasks/return-path";
import { parseNewTaskQuery } from "@/lib/hq/tasks/rules";
import { prefillRelated } from "@/lib/hq/tasks/queries";
import { InlineNote, PageHeader, buildHref } from "@/components/hq";
import { TaskForm, type LinkedSummary } from "@/components/hq/features/tasks/TaskForm";
import { createTask } from "../../actions";

export const metadata: Metadata = { title: "New task" };

const PATH = "/hq/operations/tasks/new";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewTaskPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("tasks.write", false, buildHref(PATH, sp));

  // The link contract: anything that is not a uuid, a real date or a safe /hq path was already dropped here.
  const prefill = parseNewTaskQuery(sp, safeReturnPath);
  const canLink = can("growth.read");

  const [staffList, related, contacts, organisations] = await Promise.all([
    staffOptions(db),
    // Only records that exist AND that this person can read are kept; the rest are dropped, never linked blindly.
    prefillRelated(db, prefill, canLink),
    canLink ? contactOptions(db) : Promise.resolve<Option[]>([]),
    canLink ? organisationOptions(db) : Promise.resolve<Option[]>([]),
  ]);

  // The pickers are capped, so make sure a prefilled record is always one of the choices.
  const withSelected = (options: Option[], rel: { id: string; label: string | null } | null, group: string): Option[] =>
    rel && rel.label && !options.some((o) => o.value === rel.id) ? [{ value: rel.id, label: rel.label, group }, ...options] : options;

  const linked: LinkedSummary[] = [];
  if (related.contact) linked.push({ kind: "contact", label: related.contact.label, href: `/hq/growth/contacts/${related.contact.id}` });
  if (related.organisation) linked.push({ kind: "organisation", label: related.organisation.label, href: `/hq/growth/organisations/${related.organisation.id}` });
  if (related.referral) linked.push({ kind: "referral", label: related.referral.label, href: `/hq/growth/referrals/${related.referral.id}` });
  if (related.opportunity) linked.push({ kind: "opportunity", label: related.opportunity.label, href: null });

  const dropped = canLink && [
    [prefill.contact, related.contact],
    [prefill.organisation, related.organisation],
    [prefill.referral, related.referral],
    [prefill.opportunity, related.opportunity],
  ].some(([asked, found]) => asked && !found);

  const returnTo = prefill.returnTo;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Operations", href: "/hq/operations" }, { label: "New task" }]}
        title="New task"
        description="Add something that needs doing. It appears in the assignee's task list straight away."
      />
      {dropped ? (
        <InlineNote className="mb-6 max-w-2xl">
          One of the records this link pointed to could not be found, or you don&rsquo;t have access to it, so the task won&rsquo;t be linked to it.
        </InlineNote>
      ) : null}
      <TaskForm
        mode="create"
        action={createTask}
        initial={{
          title: prefill.title ?? "",
          description: "",
          dueDate: prefill.due ?? "",
          priority: "normal",
          assignedTo: staff.id,
          contactId: related.contact?.id ?? "",
          organisationId: related.organisation?.id ?? "",
          referralId: related.referral?.id ?? "",
          opportunityId: related.opportunity?.id ?? "",
        }}
        returnTo={returnTo}
        staff={staffList}
        contacts={withSelected(contacts, related.contact, "Linked contact")}
        organisations={withSelected(organisations, related.organisation, "Linked organisation")}
        canLink={canLink}
        linked={linked}
        referralLink={related.referral ? { id: related.referral.id, label: related.referral.label } : null}
        opportunityLink={related.opportunity ? { id: related.opportunity.id, label: related.opportunity.label } : null}
        today={todayIn(staff.timezone)}
        cancelHref={returnTo ?? "/hq/operations"}
      />
    </>
  );
}
