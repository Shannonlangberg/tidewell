import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/hq/EmptyState";
import { LinkButton } from "@/components/hq/Button";
import { HQ_ROUTES, hrefForSearchHit } from "@/components/hq/nav";
import { Panel, PanelHeader, Skeleton, SkeletonText } from "@/components/hq/Primitives";
import { PriorityChip, RelationshipChip, StatusChip } from "@/components/hq/StatusChip";
import { Stat, StatBand } from "@/components/hq/Stat";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { Timeline, TimelineItem } from "@/components/hq/Timeline";
import type { IconName } from "@/components/hq/icons";
import { INTERACTION_LABEL, STAGE_LABEL, OPEN_STAGES, type InteractionType, type TaskPriority } from "@/lib/hq/constants";
import { daysFromToday, daysSince, formatDateTime, plural } from "@/lib/hq/format";
import { shortDay } from "@/lib/hq/greeting";
import { PERIOD_LABEL, type Period } from "@/lib/hq/periods";
import type { WidgetId } from "@/lib/hq/dashboard-widgets";
import {
  AwaitingVettingWidget,
  ExpiringDocumentsWidget,
  PreferredCoverageWidget,
  RecentContractorActivityWidget,
} from "../contractor-sections/widgets-contractors";
import { completeTaskAction } from "./actions";
import { MoreLink, Rows, WidgetFailed, WidgetPanel, attempt, rowClass } from "./widget-chrome";
import {
  bucketFor,
  hasCap,
  loadContactCounts,
  loadFollowUps,
  loadGrowthSummary,
  loadMyTasks,
  loadOpenStageCounts,
  loadRecentInteractions,
  loadStaleContacts,
  loadTeamTasks,
  loadTopPartners,
  type DashCtx,
  type DashTask,
  type OpenStage,
  type TaskBucket,
} from "./data";

/*
 * The dashboard widgets. Server Components: each loads its own data and renders it, so the
 * page can stream them one by one inside Suspense boundaries.
 *
 * Rules every widget follows:
 *  - REAL data only. No placeholder figures. A widget with nothing to show says so and says what
 *    to do next, with a link to the right place.
 *  - A failure is contained. A loader that throws becomes a quiet error panel for that widget;
 *    the rest of the page carries on.
 *  - Figures are DM Sans (the kit's Stat); the only serif is an empty-state title.
 */

// ── chrome ───────────────────────────────────────────────────

/** What shows while a panel's data loads. */
export function PanelSkeleton({ id, title }: { id: WidgetId; title: string }) {
  return (
    <Panel aria-labelledby={`w-${id}`}>
      <PanelHeader id={`w-${id}`} title={title} />
      <div aria-busy="true" className="grid gap-3 pb-2">
        <Skeleton width="62%" />
        <SkeletonText lines={3} />
      </div>
    </Panel>
  );
}

export function StatsSkeleton() {
  return (
    <div role="group" aria-label="Loading figures" aria-busy="true" className="hq-statband" data-cols="4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="hq-stat">
          <Skeleton width="55%" />
          <Skeleton variant="heading" width="35%" className="mt-3" />
        </div>
      ))}
    </div>
  );
}


function dueChip(dueDate: string | null, today: string): ReactNode {
  if (!dueDate) return <StatusChip plain>No due date</StatusChip>;
  const n = daysFromToday(dueDate, today) ?? 0;
  if (n < 0) return <StatusChip tone="error">{plural(-n, "day")} overdue</StatusChip>;
  if (n === 0) return <StatusChip tone="warning">Due today</StatusChip>;
  return <StatusChip tone="info">Due {shortDay(dueDate)}</StatusChip>;
}

// ── the figures band ─────────────────────────────────────────

/**
 * One band across the top, built from whichever stat widgets the person has. Each stat widget
 * contributes its own cells; the band loads what it needs once.
 */
export async function StatsBand({ ids, period, since }: { ids: readonly WidgetId[]; period: Period; since: string }) {
  const wantContacts = ids.includes("contacts-identified");
  const wantReferrals = ids.includes("referrals-summary");
  const wantManaged = ids.includes("managed-properties");

  const [contacts, referrals] = await Promise.all([
    wantContacts ? attempt("contacts-identified", () => loadContactCounts()) : null,
    wantReferrals ? attempt("referrals-summary", () => loadGrowthSummary(since)) : null,
  ]);

  const cells: ReactNode[] = [];
  const failedHint = "We could not load this. Reload to try again.";

  if (wantContacts) {
    if (contacts?.ok) {
      const c = contacts.data;
      cells.push(
        <Stat
          key="contacts"
          label="Contacts identified"
          value={c.total}
          href={HQ_ROUTES.contacts}
          hint={
            c.total === 0
              ? "None yet. Add a contact or import a list."
              : `Across ${plural(c.organisations, "organisation")}.${c.contacted === 0 ? " None contacted yet." : ""}`
          }
        />,
        <Stat
          key="verify"
          label="Need verifying"
          value={c.needsVerification}
          href={HQ_ROUTES.contacts}
          hint={c.needsVerification === 0 ? (c.total === 0 ? "Nothing to check yet." : "Everything has been checked.") : "Research leads, not confirmed relationships."}
        />,
      );
    } else {
      cells.push(<Stat key="contacts" label="Contacts identified" value={null} hint={failedHint} />);
    }
  }

  if (wantReferrals) {
    if (referrals?.ok) {
      const r = referrals.data;
      const window = `${PERIOD_LABEL[period]}.`;
      cells.push(
        <Stat key="received" label="Referrals received" value={r.referralsReceived} href={HQ_ROUTES.referrals} hint={r.referralsReceived === 0 ? `None recorded. ${window}` : window} />,
        <Stat key="sent" label="Referrals sent" value={r.referralsSent} href={HQ_ROUTES.referrals} hint={r.referralsSent === 0 ? `None recorded. ${window}` : window} />,
        <Stat key="signed" label="Managements signed" value={r.managementsSigned} href={HQ_ROUTES.pipeline} hint={`${window} Each counted once.`} />,
        <Stat
          key="conversion"
          label="Conversion"
          value={r.conversion === null ? null : `${Math.round(r.conversion * 1000) / 10}%`}
          hint={r.conversion === null ? "Appears once a referral is received." : "Signed, out of referrals received."}
        />,
      );
    } else {
      cells.push(<Stat key="referrals" label="Referrals" value={null} hint={failedHint} />);
    }
  }

  if (wantManaged) {
    cells.push(<Stat key="managed" label="Managed properties" value={null} hint="Appears once HQ is connected to Ailo." />);
  }

  if (cells.length === 0) return null;
  const columns = cells.length <= 2 ? 2 : cells.length === 3 ? 3 : 4;
  return (
    <StatBand label="Figures" columns={columns}>
      {cells}
    </StatBand>
  );
}

// ── who to call ──────────────────────────────────────────────

async function WhoToCall({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("who-to-call", () => loadFollowUps(ctx));
  if (!r.ok) return <WidgetFailed id="who-to-call" title="Who to call this week" />;
  const { items, total } = r.data;
  const canWrite = hasCap(ctx, "growth.write");

  return (
    <WidgetPanel id="who-to-call" title="Who to call this week" meta={total > 0 ? "Oldest first" : undefined}>
      {items.length === 0 ? (
        <EmptyState
          compact
          title="No follow-ups scheduled"
          action={
            <LinkButton href={HQ_ROUTES.growth} size="sm">
              Open Growth
            </LinkButton>
          }
        >
          When you log a call or meeting, set the next follow-up and it will appear here, oldest first.
        </EmptyState>
      ) : (
        <>
          <Rows label="Follow-ups due">
            {items.map((f) => (
              <li key={f.id} className={rowClass}>
                <div className="min-w-0">
                  <Link href={`${HQ_ROUTES.contacts}/${f.id}`} className="font-medium underline-offset-2 hover:underline">
                    {f.name}
                  </Link>
                  <p className="hq-muted truncate text-[13px]">{f.organisation ?? "No organisation"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {dueChip(f.dueDate, ctx.today)}
                  {canWrite ? (
                    <LinkButton href={`${HQ_ROUTES.contacts}/${f.id}?log=call`} size="sm" icon="phone" aria-label={`Log a call with ${f.name}`}>
                      Log a call
                    </LinkButton>
                  ) : null}
                </div>
              </li>
            ))}
          </Rows>
          <MoreLink shown={items.length} total={total} href={HQ_ROUTES.contacts} noun="follow-up" />
        </>
      )}
    </WidgetPanel>
  );
}

// ── opportunities by stage ───────────────────────────────────

async function OpportunitiesByStage({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("opportunities-by-stage", () => loadOpenStageCounts());
  if (!r.ok) return <WidgetFailed id="opportunities-by-stage" title="Active opportunities by stage" />;
  const counts = r.data;
  const total = OPEN_STAGES.reduce((sum, s) => sum + counts[s as OpenStage], 0);
  const biggest = Math.max(1, ...OPEN_STAGES.map((s) => counts[s as OpenStage]));

  return (
    <WidgetPanel id="opportunities-by-stage" title="Active opportunities by stage" meta={total > 0 ? `${total} open` : undefined}>
      {total === 0 ? (
        <EmptyState
          compact
          title="No active opportunities"
          action={
            hasCap(ctx, "growth.write") ? (
              <LinkButton href={HQ_ROUTES.referralNew} size="sm">
                Record a referral
              </LinkButton>
            ) : (
              <LinkButton href={HQ_ROUTES.pipeline} size="sm">
                Open the pipeline
              </LinkButton>
            )
          }
        >
          Record a referral and it appears here as an opportunity, from introduction through to a signed management.
        </EmptyState>
      ) : (
        <>
          <Rows label="Open opportunities by stage">
            {OPEN_STAGES.map((s) => {
              const n = counts[s as OpenStage];
              return (
                <li key={s} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2rem] items-center gap-3 py-1.5 text-[14px]">
                  <span className={n === 0 ? "hq-muted" : undefined}>{STAGE_LABEL[s]}</span>
                  <span aria-hidden="true" className="block h-1.5 bg-line">
                    <span className="block h-full bg-charcoal" style={{ width: `${(n / biggest) * 100}%` }} />
                  </span>
                  <span className={`hq-nums text-right ${n === 0 ? "hq-muted" : "font-semibold"}`}>{n}</span>
                </li>
              );
            })}
          </Rows>
          <p className="mt-3 border-t border-line pt-3 text-[13px]">
            <Link href={HQ_ROUTES.pipeline} className="hq-muted underline underline-offset-2">
              Open the pipeline
            </Link>
          </p>
        </>
      )}
    </WidgetPanel>
  );
}

// ── my tasks ─────────────────────────────────────────────────

const BUCKET_LABEL: Record<TaskBucket, string> = { overdue: "Overdue", today: "Today", upcoming: "Coming up" };

function TaskRow({ task, ctx, returnTo }: { task: DashTask; ctx: DashCtx; returnTo: string }) {
  const canComplete = hasCap(ctx, "tasks.write");
  return (
    <li className={rowClass}>
      <div className="min-w-0">
        <Link href={hrefForSearchHit("tasks", task.id)} className="font-medium underline-offset-2 hover:underline">
          {task.title}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {task.priority === "high" || task.priority === "urgent" ? <PriorityChip priority={task.priority as TaskPriority} /> : null}
        {dueChip(task.dueDate, ctx.today)}
        {canComplete ? (
          <form action={completeTaskAction}>
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="next" value={returnTo} />
            <SubmitButton variant="secondary" size="sm" icon="check" pendingLabel="Completing task" aria-label={`Complete task: ${task.title}`}>
              Complete
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </li>
  );
}

async function MyTasks({ ctx, returnTo }: { ctx: DashCtx; returnTo: string }) {
  const r = await attempt("my-tasks", () => loadMyTasks(ctx));
  if (!r.ok) return <WidgetFailed id="my-tasks" title="My tasks" />;
  const { tasks, counts } = r.data;
  const shown = tasks.slice(0, 8);
  const summary = [
    counts.overdue > 0 ? `${counts.overdue} overdue` : null,
    counts.today > 0 ? `${counts.today} today` : null,
    counts.upcoming > 0 ? `${counts.upcoming} coming up` : null,
  ].filter(Boolean);

  // Group what is shown, in the order a person should act on it.
  const groups = (["overdue", "today", "upcoming"] as const)
    .map((b) => ({ bucket: b, items: shown.filter((t) => bucketFor(t.dueDate, ctx.today) === b) }))
    .filter((g) => g.items.length > 0);

  return (
    <WidgetPanel id="my-tasks" title="My tasks" meta={summary.length > 0 ? summary.join(" · ") : undefined}>
      {tasks.length === 0 ? (
        <EmptyState
          compact
          title="Nothing on your list"
          action={
            hasCap(ctx, "tasks.write") ? (
              <LinkButton href={HQ_ROUTES.taskNew} size="sm">
                New task
              </LinkButton>
            ) : (
              <LinkButton href={HQ_ROUTES.operations} size="sm">
                Open Operations
              </LinkButton>
            )
          }
        >
          Tasks assigned to you appear here, overdue ones first. Logging a call with a follow-up can create one for you.
        </EmptyState>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.bucket} aria-label={BUCKET_LABEL[g.bucket]} className="mb-4 last:mb-0">
              <p className="hq-label mb-2">{BUCKET_LABEL[g.bucket]}</p>
              <Rows label={`${BUCKET_LABEL[g.bucket]} tasks`}>
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} ctx={ctx} returnTo={returnTo} />
                ))}
              </Rows>
            </section>
          ))}
          <MoreLink shown={shown.length} total={tasks.length} href={HQ_ROUTES.operations} noun="task" />
        </>
      )}
    </WidgetPanel>
  );
}

// ── team tasks ───────────────────────────────────────────────

async function TeamTasks({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("team-tasks", () => loadTeamTasks(ctx));
  if (!r.ok) return <WidgetFailed id="team-tasks" title="Team tasks" />;
  const { items, total } = r.data;

  return (
    <WidgetPanel id="team-tasks" title="Team tasks" meta={total > 0 ? "Overdue or due this week" : undefined}>
      {items.length === 0 ? (
        <EmptyState
          compact
          title="Nothing due across the team"
          action={
            <LinkButton href={HQ_ROUTES.operations} size="sm">
              Open Operations
            </LinkButton>
          }
        >
          Other people&rsquo;s tasks that are overdue or due in the next seven days will appear here.
        </EmptyState>
      ) : (
        <>
          <Rows label="Team tasks due">
            {items.map((t) => (
              <li key={t.id} className={rowClass}>
                <div className="min-w-0">
                  <Link href={hrefForSearchHit("tasks", t.id)} className="font-medium underline-offset-2 hover:underline">
                    {t.title}
                  </Link>
                  <p className="hq-muted text-[13px]">{t.assigneeName ?? "Unassigned"}</p>
                </div>
                {dueChip(t.dueDate, ctx.today)}
              </li>
            ))}
          </Rows>
          <MoreLink shown={items.length} total={total} href={HQ_ROUTES.operations} noun="task" />
        </>
      )}
    </WidgetPanel>
  );
}

// ── partner activity: recent interactions ────────────────────

const INTERACTION_ICON: Record<InteractionType, IconName> = {
  phone_call: "phone",
  coffee_meeting: "coffee",
  office_meeting: "calendar",
  email: "mail",
  message: "message",
  note: "note",
};

async function PartnerActivity({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("partner-activity", () => loadRecentInteractions());
  if (!r.ok) return <WidgetFailed id="partner-activity" title="Partner activity" />;

  return (
    <WidgetPanel id="partner-activity" title="Partner activity" meta={r.data.length > 0 ? "Latest" : undefined}>
      {r.data.length === 0 ? (
        <EmptyState compact title="Nothing logged yet">
          Calls, coffees and emails you record against a partner build the relationship timeline here.
        </EmptyState>
      ) : (
        <Timeline label="Latest partner activity">
          {r.data.map((i) => {
            const who = i.contactName ?? i.organisationName ?? "a partner";
            const href = i.contactId ? `${HQ_ROUTES.contacts}/${i.contactId}` : i.organisationId ? `${HQ_ROUTES.organisations}/${i.organisationId}` : null;
            return (
              <TimelineItem
                key={i.id}
                icon={INTERACTION_ICON[i.type]}
                title={
                  <>
                    {INTERACTION_LABEL[i.type]} with{" "}
                    {href ? (
                      <Link href={href} className="underline-offset-2 hover:underline">
                        {who}
                      </Link>
                    ) : (
                      who
                    )}
                  </>
                }
                meta={[formatDateTime(i.occurredAt, ctx.timezone), i.staffName].filter(Boolean).join(" · ")}
              >
                <span className="line-clamp-2">{i.summary}</span>
              </TimelineItem>
            );
          })}
        </Timeline>
      )}
    </WidgetPanel>
  );
}

// ── referral partners ────────────────────────────────────────

async function PartnerReferrals({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("partner-referrals", () => loadTopPartners());
  if (!r.ok) return <WidgetFailed id="partner-referrals" title="Referral partners" />;

  return (
    <WidgetPanel id="partner-referrals" title="Referral partners" meta={r.data.length > 0 ? "Most referrals first" : undefined}>
      {r.data.length === 0 ? (
        <EmptyState
          compact
          title="No referrals recorded yet"
          action={
            hasCap(ctx, "growth.write") ? (
              <LinkButton href={HQ_ROUTES.referralNew} size="sm">
                Record a referral
              </LinkButton>
            ) : (
              <LinkButton href={HQ_ROUTES.referrals} size="sm">
                Open referrals
              </LinkButton>
            )
          }
        >
          When referrals are recorded, the partners sending and receiving them appear here with how many signed.
        </EmptyState>
      ) : (
        <Rows label="Referral partners">
          {r.data.map((p) => (
            <li key={p.id} className={rowClass}>
              <Link href={`${HQ_ROUTES.organisations}/${p.id}`} className="min-w-0 font-medium underline-offset-2 hover:underline">
                {p.name}
              </Link>
              <p className="hq-muted hq-nums text-[13px]">
                {p.received} received · {p.sent} sent · {p.signed} signed
              </p>
            </li>
          ))}
        </Rows>
      )}
      {r.data.length > 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-[13px]">
          <Link href={HQ_ROUTES.referralPartners} className="hq-muted underline underline-offset-2">
            All referral partners
          </Link>
        </p>
      ) : null}
    </WidgetPanel>
  );
}

// ── not contacted in 30 days ─────────────────────────────────

async function StalePartners({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("stale-partners", async () => {
    const [stale, counts] = await Promise.all([loadStaleContacts(), loadContactCounts()]);
    return { ...stale, contactTotal: counts.total };
  });
  if (!r.ok) return <WidgetFailed id="stale-partners" title="Not contacted in 30 days" />;
  const { items, total, contactTotal } = r.data;

  return (
    <WidgetPanel id="stale-partners" title="Not contacted in 30 days" meta={total > 0 ? String(total) : undefined}>
      {items.length === 0 ? (
        contactTotal === 0 ? (
          <EmptyState
            compact
            title="No contacts yet"
            action={
              <LinkButton href={HQ_ROUTES.contacts} size="sm">
                Open contacts
              </LinkButton>
            }
          >
            Add a contact or import your research leads, and anyone you have not spoken to for a month appears here.
          </EmptyState>
        ) : (
          <EmptyState compact title="All caught up">
            Everyone on your list has been contacted in the last 30 days.
          </EmptyState>
        )
      ) : (
        <>
          <Rows label="Contacts not spoken to in 30 days">
            {items.map((c) => {
              const days = c.lastContactAt ? daysSince(c.lastContactAt, ctx.timezone) : null;
              return (
                <li key={c.id} className={rowClass}>
                  <div className="min-w-0">
                    <Link href={`${HQ_ROUTES.contacts}/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                      {c.name}
                    </Link>
                    <p className="hq-muted truncate text-[13px]">
                      {c.organisation ?? "No organisation"} · {days === null ? "Never contacted" : `Last contacted ${plural(days, "day")} ago`}
                    </p>
                  </div>
                  <RelationshipChip status={c.status} />
                </li>
              );
            })}
          </Rows>
          <MoreLink shown={items.length} total={total} href={HQ_ROUTES.contacts} noun="contact" />
          <p className="mt-3 border-t border-line pt-3 text-[13px]">
            <Link href={`${HQ_ROUTES.referralPartners}?quiet=30`} className="hq-muted underline underline-offset-2">
              See which referral partners have gone quiet
            </Link>
          </p>
        </>
      )}
    </WidgetPanel>
  );
}

// ── the registry's components ────────────────────────────────

/** Draws one PANEL widget. Stat widgets are drawn together by StatsBand. */
export function renderPanel(id: WidgetId, ctx: DashCtx, returnTo: string): ReactNode {
  switch (id) {
    case "who-to-call":
      return <WhoToCall ctx={ctx} />;
    case "opportunities-by-stage":
      return <OpportunitiesByStage ctx={ctx} />;
    case "my-tasks":
      return <MyTasks ctx={ctx} returnTo={returnTo} />;
    case "team-tasks":
      return <TeamTasks ctx={ctx} />;
    case "partner-activity":
      return <PartnerActivity ctx={ctx} />;
    case "partner-referrals":
      return <PartnerReferrals ctx={ctx} />;
    case "stale-partners":
      return <StalePartners ctx={ctx} />;
    case "contractors-awaiting-vetting":
      return <AwaitingVettingWidget ctx={ctx} />;
    case "contractors-expiring-documents":
      return <ExpiringDocumentsWidget ctx={ctx} returnTo={returnTo} />;
    case "contractors-preferred-coverage":
      return <PreferredCoverageWidget ctx={ctx} />;
    case "contractors-recent-activity":
      return <RecentContractorActivityWidget ctx={ctx} />;
    default:
      return null;
  }
}

