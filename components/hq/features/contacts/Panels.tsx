import Link from "next/link";
import type { ReactNode } from "react";
import { OPPORTUNITY_STAGES, SENT_OUTCOME_LABEL, isOneOf, type SentOutcome } from "@/lib/hq/constants";
import { formatDay } from "@/lib/hq/growth/dates";
import type { Contact, Loaded, ReferralSummary, TaskItem } from "@/lib/hq/growth/types";
import { LinkButton } from "../../Button";
import { SectionLabel } from "../../Primitives";
import { RelationshipChip, StageChip, StatusChip, TaskStatusChip } from "../../StatusChip";
import { NeedsVerifyingChip } from "./Bits";

/*
 * The blocks down the side of a profile: other people at the same organisation, referrals,
 * open tasks. Each is a heading with a hairline above, not a boxed card. Server-rendered.
 */

export function SideBlock({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-5 first:border-t-0 first:pt-0" aria-label={title}>
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <SectionLabel as="h3">{title}</SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="text-[14px] text-grey-text">{children}</p>;
const Unavailable = ({ what }: { what: string }) => <Quiet>We couldn&rsquo;t load {what} just now. Reload the page to try again.</Quiet>;

// ── same organisation ────────────────────────────────────────

export function SameOrganisationBlock({
  organisationName,
  organisationHref,
  contacts,
  addHref,
}: {
  organisationName: string;
  organisationHref: string;
  contacts: Loaded<Contact[]>;
  /** Present when the person may add contacts. */
  addHref?: string;
}) {
  return (
    <SideBlock
      title="Same organisation"
      action={
        <Link href={organisationHref} className="text-[13px] underline underline-offset-2">
          {organisationName}
        </Link>
      }
    >
      {!contacts.ok ? (
        <Unavailable what="the other contacts here" />
      ) : contacts.data.length === 0 ? (
        <Quiet>No one else is recorded at {organisationName}.</Quiet>
      ) : (
        <ul className="grid gap-3">
          {contacts.data.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 text-[14px]">
              <div className="min-w-0">
                <Link href={`/hq/growth/contacts/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                  {c.fullName}
                </Link>
                <p className="text-[13px] text-grey-text">
                  {c.orgContactRole === "primary" ? "Primary contact" : c.orgContactRole === "secondary" ? "Secondary contact" : "Other"}
                  {c.position ? ` · ${c.position}` : ""}
                </p>
              </div>
              <span className="flex flex-none flex-col items-end gap-1.5">
                <RelationshipChip status={c.status} />
                {c.needsVerification ? <NeedsVerifyingChip /> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {addHref ? (
        <div className="mt-4">
          <LinkButton href={addHref} size="sm" icon="plus">
            Add someone here
          </LinkButton>
        </div>
      ) : null}
    </SideBlock>
  );
}

// ── referrals ────────────────────────────────────────────────

export function ReferralsBlock({
  summary,
  recordHref,
  /** "this partner" on a contact, "this organisation" on an organisation. */
  who,
}: {
  summary: Loaded<ReferralSummary>;
  /** Present when the person may record a referral. */
  recordHref?: string;
  who: string;
}) {
  return (
    <SideBlock title={`Referrals from ${who}`}>
      {!summary.ok ? (
        <Unavailable what="referrals" />
      ) : summary.data.received + summary.data.sent === 0 ? (
        <Quiet>No referrals recorded yet. When {who} introduces someone, record it here and it is followed through to a signed management.</Quiet>
      ) : (
        <>
          <dl className="grid gap-2.5 text-[14px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt>
                Received
                <span className="block text-[13px] text-grey-text">Introductions to Planted</span>
              </dt>
              <dd className="font-semibold tabular-nums">{summary.data.received}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>
                Sent
                <span className="block text-[13px] text-grey-text">Introductions from Planted</span>
              </dt>
              <dd className="font-semibold tabular-nums">{summary.data.sent}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt>
                Signed managements
                <span className="block text-[13px] text-grey-text">Each counted once, ever</span>
              </dt>
              <dd className="font-semibold tabular-nums">{summary.data.signed}</dd>
            </div>
          </dl>
          <ul className="mt-4 grid gap-3 border-t border-line pt-4">
            {summary.data.recent.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 text-[14px]">
                <div className="min-w-0">
                  <Link href={`/hq/growth/referrals/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                    {r.refLabel}
                  </Link>
                  <p className="text-[13px] text-grey-text">
                    {r.direction === "received" ? "Received" : "Sent"}
                    {r.prospectName ? ` · ${r.prospectName}` : ""}
                  </p>
                </div>
                {r.direction === "received" && r.stage && isOneOf(OPPORTUNITY_STAGES, r.stage) ? (
                  <StageChip stage={r.stage} />
                ) : r.direction === "sent" && r.sentOutcome && isOneOf(Object.keys(SENT_OUTCOME_LABEL) as SentOutcome[], r.sentOutcome) ? (
                  <StatusChip>{SENT_OUTCOME_LABEL[r.sentOutcome]}</StatusChip>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {recordHref ? (
        <div className="mt-4">
          <LinkButton href={recordHref} size="sm" icon="plus">
            Record a referral
          </LinkButton>
        </div>
      ) : null}
    </SideBlock>
  );
}

// ── open tasks ───────────────────────────────────────────────

export function OpenTasksBlock({ tasks, today, createHref }: { tasks: Loaded<TaskItem[]>; today: string; createHref?: string }) {
  return (
    <SideBlock title="Open tasks">
      {!tasks.ok ? (
        <Unavailable what="tasks" />
      ) : tasks.data.length === 0 ? (
        <Quiet>No open tasks for this contact.</Quiet>
      ) : (
        <ul className="grid gap-3">
          {tasks.data.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 text-[14px]">
              <div className="min-w-0">
                <Link href={`/hq/operations/tasks/${t.id}`} className="font-medium underline-offset-2 hover:underline">
                  {t.title}
                </Link>
                <p className="text-[13px] text-grey-text">
                  {t.dueDate ? `Due ${formatDay(t.dueDate, today)}` : "No due date"}
                  {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                </p>
              </div>
              <TaskStatusChip status={t.status} />
            </li>
          ))}
        </ul>
      )}
      {createHref ? (
        <div className="mt-4">
          <LinkButton href={createHref} size="sm" icon="plus">
            Create follow-up task
          </LinkButton>
        </div>
      ) : null}
    </SideBlock>
  );
}
