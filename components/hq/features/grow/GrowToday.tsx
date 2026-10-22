import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/hq/Button";
import { HQ_ROUTES } from "@/components/hq/nav";
import { StatusChip, type StatusTone } from "@/components/hq/StatusChip";
import { cx } from "@/components/hq/cx";
import { requireStaff } from "@/lib/hq/auth";
import { CALL_OUTCOME_LABEL, INTERACTION_LABEL, OPEN_STAGES, RELATIONSHIP_LABEL, STAGE_LABEL, type OpportunityStage, type RelationshipStatus } from "@/lib/hq/constants";
import type { HqClient } from "@/lib/hq/db";
import { CALL_GROUP_LABEL, phoneWords, QUIET_DAYS, shortDate, WARM_IDLE_DAYS, type NextCall } from "@/lib/hq/growth/next-calls";
import { loadNextCalls } from "@/lib/hq/growth/next-calls-queries";
import { loadGrowthPanel, loadLaunchProject, loadMilestones, loadOpenTasks, type Loaded } from "@/lib/hq/leadership/queries";
import { compareMilestone, dayWords, groupByLane, LANE_LABEL, STAGE_HINT, STAGE_LABEL as PARTNER_STAGE_LABEL } from "@/lib/hq/leadership/rules";
import type { LeaderTask } from "@/lib/hq/leadership/types";
import { phoneHref } from "@/lib/hq/today";
import { LogOutcomeButton } from "./LogOutcome";

/*
 * Today in the Grow workspace (docs/hq-workspaces.md): "who should I contact next, and what will move the
 * business forward?" For people with growth.read.
 *
 *   Your next calls       lib/hq/growth/next-calls.ts, each person once, with the reason in words.
 *   Beside it             the first-year goal, open leads by stage, referral partners by stage, and ONE
 *                         line on launch readiness (the launch itself lives in the Business overview).
 *   Your growth tasks     open tasks linked to a contact, organisation, referral or lead. A task linked to
 *                         someone on the call list is shown on their call instead, not twice.
 *
 * Every read runs as the person (row level security). Figures are counts of HQ records only; nothing is
 * estimated or forecast. A failed read says so in one line and the rest of the page still shows.
 */

const FAILED = "could not be loaded just now. Refresh to try again.";
const SHOWN = 6;
const CONTACT = (id: string) => `${HQ_ROUTES.contacts}/${encodeURIComponent(id)}`;
const LEAD = (id: string) => `/hq/growth/opportunities/${encodeURIComponent(id)}`;
const TASK = (id: string) => `${HQ_ROUTES.operations}/tasks/${encodeURIComponent(id)}`;

const LEAD_TONE: Partial<Record<OpportunityStage, StatusTone>> = { appraisal_requested: "warning", appraisal_completed: "warning", proposal_sent: "info", qualified: "info" };
const CONTACT_TONE: Partial<Record<RelationshipStatus, StatusTone>> = { meeting_booked: "info", met: "info", active_relationship: "success", referring_partner: "success" };

function Quiet({ children }: { children: ReactNode }) {
  return <p className="hq-today__quiet hq-cc-quiet">{children}</p>;
}

function Head({ id, eyebrow, title, aside }: { id: string; eyebrow: string; title: string; aside?: ReactNode }) {
  return (
    <header className="hq-cc-head">
      <div className="hq-cc-head__text">
        <p className="hq-cc-eyebrow">{eyebrow}</p>
        <h2 id={id} className="hq-cc-title">
          {title}
        </h2>
      </div>
      {aside ? <div className="hq-cc-head__aside">{aside}</div> : null}
    </header>
  );
}

function StageChip({ call }: { call: NextCall }) {
  if ("lead" in call.stage) return <StatusChip tone={LEAD_TONE[call.stage.lead] ?? "neutral"}>{STAGE_LABEL[call.stage.lead]}</StatusChip>;
  const st = call.stage.contact;
  return <StatusChip tone={st ? (CONTACT_TONE[st] ?? "neutral") : "neutral"}>{st ? RELATIONSHIP_LABEL[st] : "No stage set"}</StatusChip>;
}

function lastContactWords(call: NextCall, today: string): string {
  const lc = call.lastContact;
  if (!lc) return "Never contacted";
  const what = lc.outcome ? CALL_OUTCOME_LABEL[lc.outcome].toLowerCase() : lc.type ? INTERACTION_LABEL[lc.type].toLowerCase() : null;
  return `Last contact ${shortDate(lc.date, today)}${what ? `, ${what}` : ""}`;
}

function CallCard({ call, n, today, canLog, task }: { call: NextCall; n: number; today: string; canLog: boolean; task: LeaderTask | null }) {
  const href = call.kind === "lead" ? LEAD(call.id) : CONTACT(call.id);
  const tel = phoneHref(call.phone, "tel");
  return (
    <li className="hq-grow-call">
      <span className="hq-grow-call__n" aria-hidden="true">
        {n}
      </span>
      <div className="hq-grow-call__body">
        <h3 className="hq-grow-call__who">
          <Link href={href}>{call.name}</Link> <StageChip call={call} />
        </h3>
        <p className="hq-cc-meta">
          {call.business ? <span className="hq-cc-meta__part">{call.business}</span> : null}
          <span className="hq-cc-meta__part">{phoneWords(call.phone)}</span>
          <span className="hq-cc-meta__part">{lastContactWords(call, today)}</span>
        </p>
        <p className="hq-grow-call__why">
          <span className="hq-grow-call__whylabel">Why:</span> {call.why}
        </p>
        <p className="hq-grow-call__next">{call.nextStep ? <>Next step: {call.nextStep}</> : <span className="hq-cc-small">No next step recorded. Set one when you log the call.</span>}</p>
        {task ? (
          <p className="hq-cc-small">
            Task:{" "}
            <Link href={TASK(task.id)} className="hq-cc-textlink">
              {task.title}
            </Link>
            {task.dueDate ? `, due ${dayWords(task.dueDate, today)}` : ""}
          </p>
        ) : null}
      </div>
      <div className="hq-grow-call__acts">
        {tel ? (
          <a className={buttonClass({ variant: "primary", size: "sm" })} href={tel}>
            Call
          </a>
        ) : null}
        {canLog ? <LogOutcomeButton target={{ kind: call.kind, id: call.id, name: call.name, nextStep: call.nextStep }} today={today} primary={!tel} /> : null}
      </div>
    </li>
  );
}

function HowChosen() {
  return (
    <details className="hq-grow-how">
      <summary className="hq-cc-textlink">How this list is chosen</summary>
      <div className="hq-cc-note">
        <p>Only people you own, each once, in this order. Nothing here changes a priority, a stage or a date.</p>
        <ol className="hq-grow-how__list">
          <li>
            <b>{CALL_GROUP_LABEL.callback}</b>: you said you would call back, and that day has come.
          </li>
          <li>
            <b>{CALL_GROUP_LABEL.overdue}</b>: a follow-up date, or a lead&apos;s next action, before today.
          </li>
          <li>
            <b>{CALL_GROUP_LABEL.today}</b>: the same, today. A new website enquiry is due the day it arrives.
          </li>
          <li>
            <b>{CALL_GROUP_LABEL.warm}</b>: qualified, appraisal or proposal stage, with no activity for {WARM_IDLE_DAYS} days, even if the next action is later.
          </li>
          <li>
            <b>{CALL_GROUP_LABEL.introduce}</b>: partner contacts never contacted, high priority first, then the longest waiting.
          </li>
          <li>
            <b>{CALL_GROUP_LABEL.quiet}</b>: met, active or referring partners with no contact for more than {QUIET_DAYS} days.
          </li>
        </ol>
        <p>Apart from warm prospects, a follow-up set for a later day keeps someone off the list until then.</p>
      </div>
    </details>
  );
}

async function loadLeadStages(db: HqClient): Promise<Loaded<Record<string, number>>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).from("opportunity_overview").select("stage").eq("is_open", true).limit(5000);
  if (error) {
    console.error("[hq] grow lead stages failed:", error.code ?? "unknown");
    return { ok: false };
  }
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as { stage: string }[]) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  return { ok: true, data: counts };
}

export async function GrowToday({ today }: { today: string }) {
  const { db, staff, can } = await requireStaff("growth.read");
  const skip = Promise.resolve(null);
  const [calls, panel, stages, tasks, launch] = await Promise.all([
    loadNextCalls(db, { staffId: staff.id, today, timezone: staff.timezone }),
    loadGrowthPanel(db, today, staff.id),
    loadLeadStages(db),
    can("tasks.write") || can("tasks.read_all") ? loadOpenTasks(db, staff.id, "mine") : skip,
    can("projects.read") ? loadLaunchProject(db) : skip,
  ]);
  const launchProject = launch?.ok ? launch.data : null;
  const milestones = launchProject ? await loadMilestones(db, launchProject.id) : null;

  const list = calls.ok ? calls.data.calls : [];
  const growthTasks = (tasks?.ok ? tasks.data : []).filter((t) => t.relationship || t.pipeline);
  // A task linked to someone on the call list is shown on that call.
  const onCall = new Map<string, LeaderTask>();
  for (const c of list) {
    const t = growthTasks.find((x) => (c.kind === "lead" ? x.relatedOpportunityId === c.id : x.relatedContactId === c.id) && !onCall.has(c.key));
    if (t) onCall.set(c.key, t);
  }
  const shownTaskIds = new Set([...onCall.values()].map((t) => t.id));
  const lanes = groupByLane(growthTasks.filter((t) => !shownTaskIds.has(t.id)), today);
  const canLog = can("growth.write");

  const counts = calls.ok ? calls.data.counts : null;
  const glance: { key: string; label: string; value: string; attention?: boolean }[] = [];
  if (counts) {
    glance.push({ key: "calls", label: "Calls", value: list.length === 0 ? "None lined up" : `${list.length} lined up` });
    if (counts.callback) glance.push({ key: "callback", label: "Promised", value: `${counts.callback} ${counts.callback === 1 ? "callback" : "callbacks"}`, attention: true });
    if (counts.overdue) glance.push({ key: "overdue", label: "Overdue", value: `${counts.overdue} ${counts.overdue === 1 ? "follow-up" : "follow-ups"}`, attention: true });
    if (counts.warm) glance.push({ key: "warm", label: "Warm", value: `${counts.warm} ${counts.warm === 1 ? "prospect" : "prospects"}` });
  }

  const g = panel.ok ? panel.data : null;
  const gates = milestones?.ok ? milestones.data.filter((m) => m.launchGate) : [];
  const nextMilestone = milestones?.ok ? [...milestones.data].filter((m) => m.status !== "done").sort(compareMilestone)[0] ?? null : null;

  return (
    <div className="hq-cc hq-grow">
      {glance.length > 0 ? (
        <nav className="hq-cc-glance" aria-label="Today at a glance">
          <ul>
            {glance.map((i) => (
              <li key={i.key}>
                <a href="#grow-calls" className={cx("hq-cc-glance__item", i.attention && "hq-cc-glance__item--attention")}>
                  <span className="hq-cc-glance__label">{i.label}</span>
                  <span className="hq-cc-glance__value">{i.value}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="hq-grow__cols">
        <section className="hq-cc-section" aria-labelledby="grow-calls-h" id="grow-calls">
          <Head id="grow-calls-h" eyebrow="Calls" title="Your next calls" aside={<HowChosen />} />
          {!calls.ok ? (
            <Quiet>Your next calls {FAILED}</Quiet>
          ) : list.length === 0 ? (
            <Quiet>Nobody to call right now. Everyone you own has a follow-up planned for a later day, or nothing is due.</Quiet>
          ) : (
            <>
              <ol className="hq-grow-calls">
                {list.slice(0, SHOWN).map((c, i) => (
                  <CallCard key={c.key} call={c} n={i + 1} today={today} canLog={canLog} task={onCall.get(c.key) ?? null} />
                ))}
              </ol>
              {list.length > SHOWN ? (
                <details className="hq-grow-more">
                  <summary className="hq-cc-textlink">Show all {list.length}</summary>
                  <ol className="hq-grow-calls" start={SHOWN + 1}>
                    {list.slice(SHOWN).map((c, i) => (
                      <CallCard key={c.key} call={c} n={SHOWN + i + 1} today={today} canLog={canLog} task={onCall.get(c.key) ?? null} />
                    ))}
                  </ol>
                </details>
              ) : null}
            </>
          )}
          {calls.ok && calls.data.unowned > 0 ? (
            <p className="hq-cc-foot">
              {calls.data.unowned === 1 ? "1 partner contact has" : `${calls.data.unowned} partner contacts have`} no owner yet, so they are not on anyone&apos;s list.{" "}
              <Link href={`${HQ_ROUTES.contacts}?kind=partner&owner=none`}>Assign them</Link>
            </p>
          ) : null}
        </section>

        <aside className="hq-grow__side" aria-label="Growth at a glance">
          <section className="hq-grow-card" aria-labelledby="grow-goal-h">
            <h2 className="hq-grow-card__label" id="grow-goal-h">
              First-year goal
            </h2>
            {g && g.managed !== null && g.goal !== null ? (
              <>
                <p className="hq-grow-card__figure">
                  <b>{g.managed}</b> of {g.goal} managed properties
                </p>
                <span className="hq-cc-rule hq-cc-rule--lg" role="meter" aria-label="Managed properties against the goal" aria-valuemin={0} aria-valuemax={g.goal} aria-valuenow={g.managed}>
                  <span style={{ width: `${Math.min(100, Math.round((100 * g.managed) / g.goal))}%` }} />
                </span>
                <p className="hq-cc-small">Managed property records in HQ (active or onboarding){g.goalDate ? `, goal date ${g.goalDate}` : ". No goal date set"}.</p>
              </>
            ) : (
              <p className="hq-cc-small">{!panel.ok ? `The goal ${FAILED}` : can("portfolio.read") ? "The goal has not been set. A director can set it in Settings." : "Managed properties are not part of your role."}</p>
            )}
          </section>

          <section className="hq-grow-card" aria-labelledby="grow-leads-h">
            <h2 className="hq-grow-card__label" id="grow-leads-h">
              Open leads by stage
            </h2>
            {stages.ok ? (
              <>
                <ol className="hq-grow-stages">
                  {OPEN_STAGES.map((s) => (
                    <li key={s}>
                      <span className="hq-grow-stages__n">{stages.data[s] ?? 0}</span>
                      <span className="hq-grow-stages__name">{STAGE_LABEL[s]}</span>
                    </li>
                  ))}
                </ol>
                <Link href={HQ_ROUTES.pipeline} className="hq-cc-textlink">
                  Pipeline
                </Link>
              </>
            ) : (
              <p className="hq-cc-small">Open leads {FAILED}</p>
            )}
          </section>

          <section className="hq-grow-card" aria-labelledby="grow-partners-h">
            <h2 className="hq-grow-card__label" id="grow-partners-h">
              Referral partners
            </h2>
            {g ? (
              <ul className="hq-grow-rows">
                {(["connect", "cultivate", "champion"] as const).map((k) => (
                  <li key={k} title={STAGE_HINT[k]}>
                    <span>{PARTNER_STAGE_LABEL[k]}</span>
                    <b>{g.stages[k]}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hq-cc-small">Referral partners {FAILED}</p>
            )}
            <Link href={HQ_ROUTES.referralPartners} className="hq-cc-textlink">
              Referral partners
            </Link>
          </section>

          {launch ? (
            <section className="hq-grow-card" aria-labelledby="grow-launch-h">
              <h2 className="hq-grow-card__label" id="grow-launch-h">
                Launch readiness
              </h2>
              {!launch.ok || (milestones && !milestones.ok) ? (
                <p className="hq-cc-small">Launch readiness {FAILED}</p>
              ) : !launchProject ? (
                <p className="hq-cc-small">No business launch project is tracked yet.</p>
              ) : (
                <>
                  <p>{gates.length === 0 ? "No launch requirements are marked yet." : `${gates.filter((m) => m.status === "done").length} of ${gates.length} launch requirements met`}</p>
                  <p className="hq-cc-small">
                    {nextMilestone ? `Next: ${nextMilestone.name}${nextMilestone.dueDate ? `, ${dayWords(nextMilestone.dueDate, today)}` : ""}. ` : ""}
                    <Link href="/hq?view=overview" className="hq-cc-textlink">
                      Business overview
                    </Link>
                  </p>
                </>
              )}
            </section>
          ) : null}
        </aside>
      </div>

      {tasks ? (
        <section className="hq-cc-section" aria-labelledby="grow-tasks-h">
          <Head
            id="grow-tasks-h"
            eyebrow="Work"
            title="Your growth tasks"
            aside={
              <Link href={HQ_ROUTES.operations} className="hq-cc-textlink">
                All tasks
              </Link>
            }
          />
          {!tasks.ok ? (
            <Quiet>Your tasks {FAILED}</Quiet>
          ) : (
            <>
              <div className="hq-grow-lanes">
                {(["do_now", "in_motion", "waiting"] as const).map((l) => (
                  <div key={l} className={cx("hq-cc-lane", `hq-cc-lane--${l}`)} role="group" aria-labelledby={`grow-lane-${l}`}>
                    <div className="hq-cc-lane__head">
                      <h3 id={`grow-lane-${l}`} className="hq-cc-lane__title">
                        {LANE_LABEL[l]} · {lanes[l].length}
                      </h3>
                    </div>
                    {lanes[l].length === 0 ? (
                      <p className="hq-cc-small hq-cc-lane__empty">Nothing here.</p>
                    ) : (
                      <ul className="hq-cc-cards">
                        {lanes[l].slice(0, 5).map((t) => (
                          <li key={t.id} className="hq-cc-card">
                            <p className="hq-cc-card__title">
                              <Link href={TASK(t.id)}>{t.title}</Link>
                            </p>
                            <p className="hq-cc-small">
                              {l === "waiting" && t.waitingOn ? `Waiting on ${t.waitingOn}` : t.dueDate ? `Due ${dayWords(t.dueDate, today)}` : "No due date"}
                            </p>
                          </li>
                        ))}
                        {lanes[l].length > 5 ? (
                          <li className="hq-cc-small">
                            and {lanes[l].length - 5} more in <Link href={HQ_ROUTES.operations}>Tasks</Link>
                          </li>
                        ) : null}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <p className="hq-cc-foot">
                Tasks linked to a contact, organisation, referral or lead. {lanes.coming_next.length > 0 ? `${lanes.coming_next.length} more are planned for later. ` : ""}A task for someone on your call list shows on their call. Your other tasks are in{" "}
                <Link href="/hq?view=overview">Business overview</Link>.
              </p>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
