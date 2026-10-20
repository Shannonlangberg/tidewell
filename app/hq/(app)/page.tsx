import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { HQ_ROUTES } from "@/components/hq/nav";
import { PageHeader } from "@/components/hq/PageHeader";
import { InlineNote } from "@/components/hq/Primitives";
import { buildHref } from "@/components/hq/url";
import { attempt } from "@/components/hq/features/dashboard/widget-chrome";
import { loadCallToday, loadContractorsToday, loadGoneQuiet, loadNewReferrals, loadTasksToday } from "@/components/hq/features/today/data";
import { loadLeadAttention, loadLeadFollowUps } from "@/lib/hq/leads/queries";
import {
  CallToday,
  FAILED_LINE,
  LeadsAttention,
  GoneQuiet,
  NewReferrals,
  NotUsedLately,
  Paperwork,
  QuietLine,
  TasksToday,
  UncoveredTrades,
} from "@/components/hq/features/today/sections";
import { BusinessGlanceToday } from "@/components/hq/features/portfolio/BusinessGlance";
import { EmailDraftsToday } from "@/components/hq/features/email/EmailDraftsToday";
import { EnquiriesToday } from "@/components/hq/features/enquiries/EnquiriesToday";
import { KnowledgeApprovalsToday } from "@/components/hq/features/knowledge/KnowledgeApprovalsToday";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { longDateIn, welcomeTitle } from "@/lib/hq/greeting";
import { todayFigures, todayPlan, type TodayView } from "@/lib/hq/today";

export const metadata: Metadata = { title: "Today" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/*
 * Today: the home screen. It answers "what should I do now?" for the person signed in.
 *
 *  - Growth (growth.read): follow-ups to call today (contacts, and the person's own leads whose
 *    follow-up date has come), one line about leads needing attention, partners gone quiet, new
 *    referrals.
 *  - Operations (tasks or contractors.read): your tasks overdue and due today, paperwork expiring,
 *    trades with no approved contractor, approved contractors not used lately.
 *
 * Which sections appear comes from capabilities; only their ORDER comes from the role (property
 * managers see operations first). Every loader runs as the person, so row level security decides
 * what comes back. Empty sections collapse to one line. The reporting figures live on Reports.
 *
 * requireStaff() here is the page's own gate: the (app) layout is only the first one.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { staff, db, can } = await requireStaff();
  const sp = await searchParams;
  const plan = todayPlan(staff.role, staff.capabilities);

  const todayResult = await db.rpc("today");
  if (todayResult.error) console.error("[hq] today() failed:", todayResult.error.code);
  // Dates in the business timezone (the same day the database uses for "overdue"); moments in the person's own.
  const today = typeof todayResult.data === "string" ? todayResult.data : todayIn(staff.timezone);

  const skip = Promise.resolve(null);
  const [calls, leads, attention, quiet, referrals, tasks, contractors] = await Promise.all([
    plan.growth ? attempt("today: call", () => loadCallToday(db, today)) : skip,
    plan.growth ? attempt("today: lead follow-ups", () => loadLeadFollowUps(db, { today, staffId: staff.id, mine: true })) : skip,
    plan.growth ? attempt("today: leads needing attention", () => loadLeadAttention(db)) : skip,
    plan.growth ? attempt("today: gone quiet", () => loadGoneQuiet(db)) : skip,
    plan.growth ? attempt("today: new referrals", () => loadNewReferrals(db, today)) : skip,
    plan.tasks ? attempt("today: tasks", () => loadTasksToday(db, { staffId: staff.id, today, team: plan.seesTeamTasks })) : skip,
    plan.contractors ? attempt("today: contractors", () => loadContractorsToday(db, today)) : skip,
  ]);

  const quietParams = { toast: null, toast_tone: null, denied: null } as const;
  const returnTo = buildHref(HQ_BASE, sp, quietParams);
  const denied = Boolean(one(sp.denied));

  const figures = todayFigures({
    call: calls?.ok ? calls.data.total + (leads?.ok ? leads.data.total : 0) : null,
    tasksOverdue: tasks?.ok ? tasks.data.overdue : null,
    tasksToday: tasks?.ok ? tasks.data.dueToday : null,
    expiring: contractors?.ok ? contractors.data.expiringTotal : null,
    referrals: referrals?.ok ? referrals.data.total : null,
  });

  const growth = (
    <>
      {calls ? (
        calls.ok ? (
          <CallToday {...calls.data} leads={leads?.ok ? leads.data : null} today={today} timezone={staff.timezone} canWrite={plan.canLogCalls} returnTo={returnTo} />
        ) : (
          <QuietLine id="call-today">Follow-ups: {FAILED_LINE}</QuietLine>
        )
      ) : null}
      {leads && !leads.ok ? <QuietLine id="lead-follow-ups">Lead follow-ups: {FAILED_LINE}</QuietLine> : null}
      {attention?.ok ? <LeadsAttention data={attention.data} /> : null}
      {referrals?.ok ? <NewReferrals {...referrals.data} /> : null}
      {quiet ? quiet.ok ? <GoneQuiet {...quiet.data} canWrite={plan.canLogCalls} /> : <QuietLine id="gone-quiet">Partners: {FAILED_LINE}</QuietLine> : null}
    </>
  );

  const canRemind = can("contractors.write") && can("tasks.write");
  const operations = (
    <>
      {tasks ? (
        tasks.ok ? (
          <TasksToday {...tasks.data} today={today} canComplete={plan.canCompleteTasks} returnTo={returnTo} />
        ) : (
          <QuietLine id="tasks-today">Tasks: {FAILED_LINE}</QuietLine>
        )
      ) : null}
      {contractors ? (
        contractors.ok ? (
          <>
            <Paperwork data={contractors.data} today={today} canRemind={canRemind} returnTo={returnTo} />
            <UncoveredTrades data={contractors.data} canWrite={can("contractors.write")} />
            <NotUsedLately data={contractors.data} today={today} />
          </>
        ) : (
          <QuietLine id="paperwork">Contractors: {FAILED_LINE}</QuietLine>
        )
      ) : null}
    </>
  );

  const VIEW_LABEL: Record<TodayView, string> = { growth: "Leads and partners", operations: "Tasks and contractors" };
  const both = plan.views.length > 1;
  const first = plan.views[0];
  const primaryAction =
    first === "growth" && can("growth.write") ? (
      <LinkButton href={HQ_ROUTES.referralNew} variant="primary" icon="plus">
        Record a referral
      </LinkButton>
    ) : first === "operations" && can("tasks.write") ? (
      <LinkButton href={HQ_ROUTES.taskNew} variant="primary" icon="plus">
        New task
      </LinkButton>
    ) : null;

  return (
    <>
      <PageHeader variant="welcome" eyebrow={longDateIn(staff.timezone)} title={welcomeTitle(staff.firstName, staff.timezone)} actions={primaryAction} />

      {figures.length > 0 ? (
        <ul className="hq-today__figures" aria-label="Today at a glance">
          {figures.map((f) => (
            <li key={f.key}>
              <Link href={f.href}>{f.text}</Link>
            </li>
          ))}
        </ul>
      ) : null}

      {denied ? (
        <InlineNote className="mt-6">
          Your role does not include that part of Planted HQ. If you think it should, ask a director or an administrator.
        </InlineNote>
      ) : null}

      <BusinessGlanceToday />
      <EmailDraftsToday />
      <EnquiriesToday />
      <KnowledgeApprovalsToday />

      {plan.views.length === 0 ? (
        <QuietLine>Nothing needs you today.</QuietLine>
      ) : (
        <div className="hq-today" data-cols={both ? "2" : "1"}>
          {plan.views.map((v) => (
            <div key={v} className="hq-today__view" aria-label={both ? VIEW_LABEL[v] : undefined} role={both ? "region" : undefined}>
              {both ? <p className="hq-label hq-today__viewlabel">{VIEW_LABEL[v]}</p> : null}
              {v === "growth" ? growth : operations}
            </div>
          ))}
        </div>
      )}

      <p className="hq-today__foot">
        Figures and trends are in{" "}
        <Link href={HQ_ROUTES.reports} className="hq-today__inline">
          Reports
        </Link>
        .
      </p>
    </>
  );
}
