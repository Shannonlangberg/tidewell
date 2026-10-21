import Link from "next/link";
import type { ReactNode } from "react";
import { requireStaff } from "@/lib/hq/auth";
import type { HqClient } from "@/lib/hq/db";
import {
  FOCUS_MAX,
  LANES,
  LANE_HINT,
  LANE_LABEL,
  POINTS,
  STAGE_HINT,
  STAGE_LABEL,
  alsoDueToday,
  dayWords,
  daysFrom,
  groupByLane,
  laneOf,
  laneWhy,
  launchReadiness,
  milestoneState,
  pickFocus,
  planningAmount,
  planningIsLive,
  planningStatusLabel,
  upcomingCommitments,
  waitsOf,
  compareMilestone,
  type FocusPick,
} from "@/lib/hq/leadership/rules";
import {
  NEW_LEAD_DAYS,
  loadDecisionsForMe,
  loadGrowthPanel,
  loadLaunchProject,
  loadMilestones,
  loadOpenTasks,
  loadPlanningItems,
  loadProjectTasks,
  loadStaffOptions,
  type GrowthPanel,
  type LaunchProject,
  type PendingDecision,
} from "@/lib/hq/leadership/queries";
import type { Lane, LaunchMilestone, LeaderTask, PlanningItem } from "@/lib/hq/leadership/types";
import { HEALTH_LABEL, healthTone } from "@/lib/hq/projects/rules";
import type { ProjectHealth } from "@/lib/hq/projects/types";
import { cx } from "../../cx";
import { Dot } from "../projects/ProjectParts";
import { DoneButton, EditButton, FollowUpDate, GateToggle, LaneMenu, LaunchProjectPicker, PlanningItemButton, RescheduleMenu, ResolveButton, type EditContext } from "./Controls";

/*
 * The leadership command center: the top of /hq for anyone who holds tasks. It answers, in order and in
 * five seconds: my three most important actions today; what is moving; what is waiting and on whom;
 * what decisions need me; are we closer to launch and to the goal.
 *
 *   A  Today: my focus      at most three tasks, from the deterministic score (lib/hq/leadership/rules.ts),
 *                           each with its reasons; the rest of today folded away
 *   B  Business launch      requirements met (launch-gate milestones) APART from tasks done, the
 *                           milestones as a timeline, the next milestone and action, blockers, commitments
 *   C  The workboard        Do now, In motion, Waiting, Coming next: worked out from each task's status,
 *                           dependencies and waiting fields (a view, never a status)
 *   D  Waiting on           planning items such as the anticipated funding (never a balance) with the
 *                           tasks that wait on them, then each outside wait with its dates and follow-up
 *   E  Growth               counts from HQ records only: leads, appraisals, follow-ups, partners, the
 *                           Connect / Cultivate / Champion stages, managed properties against the goal
 *
 * Every loader runs as the person (RLS). A section the person's role does not include is not drawn; a
 * failed load is one quiet line. Nothing is invented: no figure appears that HQ does not hold.
 */

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TASK = (id: string) => `/hq/operations/tasks/${id}`;
const PROJECT = (id: string) => `/hq/projects/${id}`;
const FAILED = "This could not be loaded just now. Reload the page to try again.";

/**
 * Props are PLAIN DATA on purpose (a database client or a function in a Server Component's props cannot be
 * serialised for React's debug stream); the session comes from requireStaff(), cached per request.
 */
export async function CommandCenter({ today, searchParams }: { today: string; searchParams: SP }) {
  const { db, staff: me, can } = await requireStaff();
  const meId = me.id;
  if (!can("tasks.write")) return null;
  const everyone = can("tasks.read_all") && one(searchParams.board) === "everyone";
  const skip = Promise.resolve(null);

  const [mine, all, launch, planning, growth, decisions, staff] = await Promise.all([
    loadOpenTasks(db, meId, "mine"),
    everyone || can("planning.read") ? loadOpenTasks(db, meId, can("tasks.read_all") ? "all" : "mine") : skip,
    can("projects.read") ? loadLaunchProject(db) : skip,
    can("planning.read") ? loadPlanningItems(db) : skip,
    can("growth.read") ? loadGrowthPanel(db, today, meId) : skip,
    can("decisions.read") ? loadDecisionsForMe(db, meId) : skip,
    loadStaffOptions(db),
  ]);

  const launchProject = launch?.ok ? launch.data : null;
  const [milestones, projectTasks, projectOptions] = await Promise.all([
    launchProject ? loadMilestones(db, launchProject.id) : skip,
    launchProject ? loadProjectTasks(db, launchProject.id) : skip,
    can("settings.admin") && launch?.ok && (!launchProject || launchProject.how === "name") ? loadProjectChoices(db) : skip,
  ]);

  const myTasks = mine.ok ? mine.data : [];
  const boardTasks = everyone && all?.ok ? all.data : myTasks;
  const visible = all?.ok ? all.data : myTasks;
  const plan = planning?.ok ? planning.data : [];
  const ctx: EditContext = { staff, planning: plan.map((p) => ({ id: p.id, title: p.title, kind: p.kind, status: p.status })), canPlanning: can("planning.read") };

  const focus = pickFocus(myTasks, today, meId);
  const lanes = groupByLane(boardTasks, today);

  return (
    <div className="hq-cc">
      <Glance
        focus={mine.ok ? focus.length : null}
        moving={mine.ok ? lanes.in_motion.length : null}
        waiting={mine.ok ? lanes.waiting.length : null}
        decisions={decisions?.ok ? decisions.data : null}
        launch={launchProject && milestones?.ok && projectTasks?.ok ? launchReadiness(milestones.data, projectTasks.data, { done: launchProject.progressDone, total: launchProject.progressTotal }, today) : null}
        growth={growth?.ok ? growth.data : null}
      />

      {mine.ok ? <FocusSection picks={focus} also={alsoDueToday(myTasks, today, meId, new Set(focus.map((f) => f.task.id)))} today={today} ctx={ctx} /> : <Quiet id="focus">My focus: {FAILED}</Quiet>}

      {launch ? (
        launch.ok ? (
          <LaunchSection
            project={launchProject}
            milestones={milestones?.ok ? milestones.data : null}
            tasks={projectTasks?.ok ? projectTasks.data : null}
            today={today}
            canGates={can("projects.write")}
            choices={projectOptions}
          />
        ) : (
          <Quiet id="launch">Business launch: {FAILED}</Quiet>
        )
      ) : null}

      {mine.ok ? <Workboard lanes={lanes} today={today} ctx={ctx} meId={meId} everyone={everyone} canEveryone={can("tasks.read_all")} /> : null}

      {mine.ok ? <WaitingSection tasks={visible} mine={myTasks} planning={planning ? (planning.ok ? plan : null) : undefined} today={today} meId={meId} canPlanningWrite={can("planning.write")} /> : null}

      {growth ? growth.ok ? <GrowthSection g={growth.data} canPortfolio={can("portfolio.read")} /> : <Quiet id="growth">Growth: {FAILED}</Quiet> : null}
    </div>
  );
}

async function loadProjectChoices(db: HqClient): Promise<{ value: string; label: string }[]> {
  const { data, error } = await db.from("projects").select("id, name").is("deleted_at", null).in("status", ["planning", "active", "on_hold"]).order("name").limit(100);
  if (error) return [];
  return (data ?? []).map((p) => ({ value: p.id, label: p.name }));
}

// ── pieces ───────────────────────────────────────────────────

function Quiet({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="hq-today__quiet hq-cc-quiet">
      {children}
    </p>
  );
}

function Head({ id, eyebrow, title, aside, lead }: { id: string; eyebrow: string; title: ReactNode; aside?: ReactNode; lead?: ReactNode }) {
  return (
    <header className="hq-cc-head">
      <div className="hq-cc-head__text">
        <p className="hq-cc-eyebrow">{eyebrow}</p>
        <h2 id={id} className="hq-cc-title">
          {title}
        </h2>
        {lead ? <p className="hq-cc-lead">{lead}</p> : null}
      </div>
      {aside ? <div className="hq-cc-head__aside">{aside}</div> : null}
    </header>
  );
}

const PRIORITY_WORD: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

function Meta({ t, today, owner }: { t: LeaderTask; today: string; owner?: boolean }) {
  const due = daysFrom(today, t.dueDate);
  const parts: ReactNode[] = [];
  if (t.projectName && t.projectId)
    parts.push(
      <Link key="p" href={PROJECT(t.projectId)} className="hq-cc-meta__link">
        {t.projectName}
      </Link>,
    );
  if (t.milestoneName) parts.push(<span key="m">{t.milestoneName}</span>);
  if (t.dueDate)
    parts.push(
      <span key="d" className={cx(due !== null && due < 0 && "hq-cc-late")}>
        {due !== null && due < 0 ? `Was due ${dayWords(t.dueDate, today)}` : `Due ${dayWords(t.dueDate, today)}`}
      </span>,
    );
  if (t.priority === "urgent" || t.priority === "high") parts.push(<span key="pr">{PRIORITY_WORD[t.priority]} priority</span>);
  if (owner) parts.push(<span key="o">{t.assignedToName ?? "Nobody yet"}</span>);
  return (
    <p className="hq-cc-meta">
      {parts.map((p, i) => (
        <span key={i} className="hq-cc-meta__part">
          {p}
        </span>
      ))}
    </p>
  );
}

// ── the five-second line ─────────────────────────────────────

function Glance({
  focus,
  moving,
  waiting,
  decisions,
  launch,
  growth,
}: {
  focus: number | null;
  moving: number | null;
  waiting: number | null;
  decisions: PendingDecision[] | null;
  launch: ReturnType<typeof launchReadiness> | null;
  growth: GrowthPanel | null;
}) {
  const items: { key: string; href: string; label: string; value: string; tone?: "quiet" | "attention" }[] = [];
  if (focus !== null) items.push({ key: "focus", href: "#cc-focus", label: "Focus today", value: focus === 0 ? "Clear" : `${focus} ${focus === 1 ? "task" : "tasks"}` });
  if (moving !== null) items.push({ key: "moving", href: "#cc-board", label: "Moving", value: `${moving} in motion`, tone: moving === 0 ? "quiet" : undefined });
  if (waiting !== null) items.push({ key: "waiting", href: "#cc-waiting", label: "Waiting", value: `${waiting} held up`, tone: waiting === 0 ? "quiet" : undefined });
  if (decisions !== null) items.push({ key: "decisions", href: "/hq/decisions?status=proposed", label: "Decisions", value: decisions.length === 0 ? "None need you" : `${decisions.length} need you`, tone: decisions.length ? "attention" : "quiet" });
  if (launch)
    items.push({
      key: "launch",
      href: "#cc-launch",
      label: "Ready to open",
      value: launch.gatesTotal > 0 ? `${launch.gatesDone} of ${launch.gatesTotal} requirements` : "Requirements not marked",
      tone: launch.gatesTotal === 0 ? "quiet" : undefined,
    });
  if (growth && growth.managed !== null && growth.goal !== null) items.push({ key: "goal", href: "#cc-growth", label: "Goal", value: `${growth.managed} of ${growth.goal} managed` });
  if (items.length === 0) return null;
  return (
    <nav className="hq-cc-glance" aria-label="Today at a glance">
      <ul>
        {items.map((i) => (
          <li key={i.key}>
            <a href={i.href} className={cx("hq-cc-glance__item", i.tone && `hq-cc-glance__item--${i.tone}`)}>
              <span className="hq-cc-glance__label">{i.label}</span>
              <span className="hq-cc-glance__value">{i.value}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── A. Today: my focus ───────────────────────────────────────

function FocusSection({ picks, also, today, ctx }: { picks: FocusPick[]; also: LeaderTask[]; today: string; ctx: EditContext }) {
  return (
    <section className="hq-cc-section" aria-labelledby="cc-focus-h" id="cc-focus">
      <Head
        id="cc-focus-h"
        eyebrow="Today"
        title="My focus"
        lead={picks.length ? `The ${picks.length === 1 ? "one thing" : `${picks.length === 2 ? "two" : "three"} things`} that matter most today, and why. Priorities are never changed for you.` : null}
        aside={
          <Link href="/hq/operations/tasks/new" className="hq-cc-textlink">
            New task
          </Link>
        }
      />
      {picks.length === 0 ? (
        <Quiet>Nothing needs you right now: your open tasks are done, waiting on something, or not yours.</Quiet>
      ) : (
        <ol className="hq-cc-focus">
          {picks.map((p, i) => (
            <li key={p.task.id} className="hq-cc-focus__item">
              <span className="hq-cc-focus__n" aria-hidden>
                {i + 1}
              </span>
              <p className={cx("hq-cc-focus__weight", p.scored.pressing && "hq-cc-focus__weight--now")}>{p.weight}</p>
              <h3 className="hq-cc-focus__title">
                <Link href={TASK(p.task.id)}>{p.task.title}</Link>
              </h3>
              <Meta t={p.task} today={today} />
              <p className="hq-cc-why">
                <span className="sr-only">Why: </span>
                {p.why}
              </p>
              <div className="hq-cc-actions">
                <DoneButton taskId={p.task.id} title={p.task.title} />
                <RescheduleMenu taskId={p.task.id} title={p.task.title} planned={p.task.plannedFor} />
                <EditButton task={p.task} ctx={ctx} />
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="hq-cc-folds">
        {also.length > 0 ? (
          <details className="hq-cc-fold">
            <summary>
              Also due today or overdue <span className="hq-today__count">{also.length}</span>
            </summary>
            <ul className="hq-cc-rows">
              {also.map((t) => (
                <li key={t.id} className="hq-cc-row">
                  <div className="hq-cc-row__main">
                    <p className="hq-cc-row__title">
                      <Link href={TASK(t.id)}>{t.title}</Link>
                    </p>
                    <Meta t={t} today={today} />
                  </div>
                  <div className="hq-cc-actions">
                    <DoneButton taskId={t.id} title={t.title} />
                    <RescheduleMenu taskId={t.id} title={t.title} planned={t.plannedFor} />
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details className="hq-cc-fold hq-cc-fold--quiet">
          <summary>How the focus is chosen</summary>
          <div className="hq-cc-explain">
            <p>
              From your own open tasks that can move now (not waiting, not a parent whose subtasks are the work), HQ adds up points and shows the top {FOCUS_MAX}. The same rules answer
              &ldquo;What&rsquo;s my focus today?&rdquo; in chat.
            </p>
            <ul>
              <li>
                Time: overdue {POINTS.overdueBase} plus {POINTS.overduePerDay} a day; due today {POINTS.dueToday}, tomorrow {POINTS.dueTomorrow}, within 3 days {POINTS.dueIn3}, within a week {POINTS.dueIn7}; planned by
                you for today {POINTS.plannedToday}.
              </li>
              <li>
                Official priority: urgent {POINTS.priority.urgent}, high {POINTS.priority.high}, normal {POINTS.priority.normal}. A high or urgent project adds a little.
              </li>
              <li>
                Milestones: required to open +{POINTS.launchGate}; its milestone overdue +{POINTS.milestoneOverdue} or due within two weeks +{POINTS.milestoneSoon}.
              </li>
              <li>
                Unblocks others +{POINTS.unblocksEach} each (up to {POINTS.unblocksCap}); a relationship follow-up +{POINTS.relationship}; business development +{POINTS.pipeline}; already in progress +{POINTS.inMotion}.
              </li>
            </ul>
            <p>&ldquo;Important, not pressing&rdquo; means it matters but nothing about time makes it today&rsquo;s. Rescheduling changes only your plan, never the due date.</p>
          </div>
        </details>
      </div>
    </section>
  );
}

// ── B. Business launch ───────────────────────────────────────

function LaunchSection({
  project,
  milestones,
  tasks,
  today,
  canGates,
  choices,
}: {
  project: LaunchProject | null;
  milestones: LaunchMilestone[] | null;
  tasks: LeaderTask[] | null;
  today: string;
  canGates: boolean;
  choices: { value: string; label: string }[] | null;
}) {
  if (!project) {
    return (
      <section className="hq-cc-section" aria-labelledby="cc-launch-h" id="cc-launch">
        <Head id="cc-launch-h" eyebrow="Launch" title="Business launch" />
        <Quiet>No project is set as the business launch yet{choices && choices.length ? "." : ". A director can choose one here once the project exists."}</Quiet>
        {choices && choices.length ? <LaunchProjectPicker options={choices} current={null} /> : null}
      </section>
    );
  }
  if (!milestones || !tasks) return <Quiet id="cc-launch">Business launch: {FAILED}</Quiet>;
  const r = launchReadiness(milestones, tasks, { done: project.progressDone, total: project.progressTotal }, today);
  const ordered = [...milestones].sort(compareMilestone);
  const blockers = tasks.filter((t) => laneOf(t, today) === "waiting" && t.parentId === null);
  const commitments = upcomingCommitments(milestones, tasks, today).slice(0, 6);
  const gatePct = r.gatesTotal ? Math.round((100 * r.gatesDone) / r.gatesTotal) : 0;
  const taskPct = r.tasksTotal ? Math.floor((100 * r.tasksDone) / r.tasksTotal) : 0;
  const health = project.health as ProjectHealth;

  return (
    <section className="hq-cc-section" aria-labelledby="cc-launch-h" id="cc-launch">
      <Head
        id="cc-launch-h"
        eyebrow="Launch"
        title={
          <Link href={PROJECT(project.id)} className="hq-cc-title__link">
            {project.name}
          </Link>
        }
        aside={<Dot tone={healthTone(health)}>{HEALTH_LABEL[health] ?? project.health}</Dot>}
      />
      {project.how === "name" && choices ? (
        <div className="hq-cc-note">
          <p>Found by its name. Confirm it so the command center keeps tracking it if it is renamed.</p>
          <LaunchProjectPicker options={choices} current={project.id} />
        </div>
      ) : null}

      <div className="hq-cc-launch">
        <div className="hq-cc-meters">
          <div className="hq-cc-meter">
            <p className="hq-cc-meter__label">Ready to open</p>
            {r.gatesTotal > 0 ? (
              <>
                <p className="hq-cc-meter__figure">
                  <b>{r.gatesDone}</b> of {r.gatesTotal} launch requirements met
                </p>
                <ol className="hq-cc-gates" role="meter" aria-label="Launch requirements met" aria-valuemin={0} aria-valuemax={r.gatesTotal} aria-valuenow={r.gatesDone} aria-valuetext={`${r.gatesDone} of ${r.gatesTotal} launch requirements met`}>
                  {ordered
                    .filter((m) => m.launchGate)
                    .map((m) => (
                      <li key={m.id} className={cx("hq-cc-gates__seg", m.status === "done" && "is-done")} title={`${m.name}: ${m.status === "done" ? "done" : "open"}`} />
                    ))}
                </ol>
                <p className="hq-cc-meter__hint">Counts only the milestones that must be done before opening{r.openGates.length ? `. Still to meet: ${r.openGates.map((m) => m.name).join(", ")}` : ""}.</p>
              </>
            ) : (
              <p className="hq-cc-meter__hint">No milestone is marked as required to open yet, so no readiness figure is shown. Task completion alone is not launch readiness.</p>
            )}
          </div>
          <div className="hq-cc-meter hq-cc-meter--quiet">
            <p className="hq-cc-meter__label">Tasks done</p>
            <p className="hq-cc-meter__figure">
              <b>{r.tasksDone}</b> of {r.tasksTotal}
              {r.tasksTotal ? <span className="hq-cc-meter__pct"> · {taskPct}%</span> : null}
            </p>
            <span className="hq-cc-rule" role="meter" aria-label="Tasks done" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskPct}>
              <span style={{ width: `${taskPct}%` }} />
            </span>
            <p className="hq-cc-meter__hint">Every task counts the same here, from paperwork to licensing.</p>
          </div>
          {canGates && ordered.length > 0 ? (
            <details className="hq-cc-fold hq-cc-fold--quiet">
              <summary>Choose the launch requirements</summary>
              <div className="hq-cc-gate-list">
                {ordered.map((m) => (
                  <GateToggle key={m.id} milestoneId={m.id} name={m.name} gate={m.launchGate} />
                ))}
              </div>
            </details>
          ) : null}
          {gatePct === 100 && r.gatesTotal > 0 ? <p className="hq-cc-meter__hint">Every launch requirement is met.</p> : null}
        </div>

        {ordered.length > 0 ? (
          <ol className="hq-cc-timeline" aria-label="Milestones">
            {ordered.map((m) => {
              const st = milestoneState(m, today);
              const isNext = r.nextMilestone?.id === m.id;
              return (
                <li key={m.id} className={cx("hq-cc-timeline__item", `is-${st}`, isNext && "is-next")}>
                  <span className="hq-cc-timeline__node" aria-hidden />
                  <span className="hq-cc-timeline__name">{m.name}</span>
                  <span className="hq-cc-timeline__date">
                    {st === "done" ? "Done" : m.dueDate ? (st === "overdue" ? `Was due ${dayWords(m.dueDate, today)}` : dayWords(m.dueDate, today)) : "No date"}
                    {isNext ? " · next" : ""}
                  </span>
                  {m.launchGate ? <span className="hq-cc-timeline__gate">Required to open</span> : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <Quiet>This project has no milestones yet. Add them on the project page to see the timeline.</Quiet>
        )}
      </div>

      <div className="hq-cc-launch__cols">
        <div>
          <h3 className="hq-cc-subhead">Next</h3>
          {r.nextMilestone ? <p className="hq-cc-next__ms">{r.nextMilestone.name}{r.nextMilestone.dueDate ? `, ${dayWords(r.nextMilestone.dueDate, today)}` : ""}</p> : <p className="hq-cc-small">No open milestone.</p>}
          {r.nextAction ? (
            <p className="hq-cc-next__task">
              <Link href={TASK(r.nextAction.id)}>{r.nextAction.title}</Link>
              <span className="hq-cc-small"> · {laneWhy(r.nextAction, today)}</span>
            </p>
          ) : (
            <p className="hq-cc-small">Nothing in it can move right now.</p>
          )}
        </div>
        <div>
          <h3 className="hq-cc-subhead">
            Blocking the launch <span className="hq-today__count">{blockers.length}</span>
          </h3>
          {blockers.length === 0 ? (
            <p className="hq-cc-small">Nothing is held up.</p>
          ) : (
            <ul className="hq-cc-mini">
              {blockers.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <Link href={TASK(t.id)}>{t.title}</Link>
                  <span className="hq-cc-small">{waitsOf(t)[0]?.text}</span>
                </li>
              ))}
              {blockers.length > 5 ? <li className="hq-cc-small">and {blockers.length - 5} more on the workboard</li> : null}
            </ul>
          )}
        </div>
        <div>
          <h3 className="hq-cc-subhead">Coming up (three weeks)</h3>
          {commitments.length === 0 ? (
            <p className="hq-cc-small">Nothing dated in the next three weeks.</p>
          ) : (
            <ul className="hq-cc-mini">
              {commitments.map((c) => (
                <li key={`${c.kind}-${c.id}`}>
                  {c.kind === "task" ? <Link href={TASK(c.id)}>{c.title}</Link> : <span className="hq-cc-mini__ms">{c.title}</span>}
                  <span className={cx("hq-cc-small", c.overdue && "hq-cc-late")}>
                    {c.overdue ? `Was due ${dayWords(c.date, today)}` : dayWords(c.date, today)}
                    {c.kind === "milestone" ? " · milestone" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ── C. The workboard ─────────────────────────────────────────

const LANE_SHOWN = 6;

function Workboard({ lanes, today, ctx, meId, everyone, canEveryone }: { lanes: Record<Lane, LeaderTask[]>; today: string; ctx: EditContext; meId: string; everyone: boolean; canEveryone: boolean }) {
  return (
    <section className="hq-cc-section" aria-labelledby="cc-board-h" id="cc-board">
      <Head
        id="cc-board-h"
        eyebrow="Work"
        title="The workboard"
        lead="Worked out from each task's status, what it waits on and its dates. Moving a card changes its status or your plan, never its priority or due date."
        aside={
          canEveryone ? (
            <div className="hq-cc-scope" role="group" aria-label="Whose tasks">
              <Link href="/hq#cc-board" aria-current={!everyone ? "true" : undefined} scroll={false}>
                Mine
              </Link>
              <Link href="/hq?board=everyone#cc-board" aria-current={everyone ? "true" : undefined} scroll={false}>
                Everyone
              </Link>
            </div>
          ) : null
        }
      />
      <div className="hq-cc-board">
        {LANES.map((l) => {
          const list = lanes[l];
          return (
            <section key={l} className={cx("hq-cc-lane", `hq-cc-lane--${l}`)} aria-labelledby={`cc-lane-${l}`}>
              <header className="hq-cc-lane__head">
                <h3 id={`cc-lane-${l}`} className="hq-cc-lane__title">
                  {LANE_LABEL[l]} <span className="hq-today__count">{list.length}</span>
                </h3>
                <p className="hq-cc-lane__hint">{LANE_HINT[l]}</p>
              </header>
              {list.length === 0 ? (
                <p className="hq-cc-small hq-cc-lane__empty">{l === "waiting" ? "Nothing is held up." : l === "do_now" ? "Nothing is pressing." : "Empty."}</p>
              ) : (
                <>
                  <ul className="hq-cc-cards">
                    {list.slice(0, LANE_SHOWN).map((t) => (
                      <Card key={t.id} t={t} today={today} ctx={ctx} owner={everyone || t.assignedTo !== meId} />
                    ))}
                  </ul>
                  {list.length > LANE_SHOWN ? (
                    <details className="hq-cc-fold hq-cc-fold--quiet">
                      <summary>{list.length - LANE_SHOWN} more</summary>
                      <ul className="hq-cc-cards">
                        {list.slice(LANE_SHOWN).map((t) => (
                          <Card key={t.id} t={t} today={today} ctx={ctx} owner={everyone || t.assignedTo !== meId} />
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </>
              )}
            </section>
          );
        })}
      </div>
      <p className="hq-cc-foot">
        Lists and filters: <Link href="/hq/operations?view=today">Due today</Link> · <Link href="/hq/operations?view=week">This week</Link> · <Link href="/hq/operations?view=waiting">Waiting</Link> ·{" "}
        <Link href="/hq/operations">My tasks</Link> · <Link href="/hq/projects">Projects</Link> · <Link href="/hq/operations?view=completed">Completed</Link>
      </p>
    </section>
  );
}

function Card({ t, today, ctx, owner }: { t: LeaderTask; today: string; ctx: EditContext; owner: boolean }) {
  const why = laneWhy(t, today);
  const late = /^Overdue/.test(why);
  return (
    <li className="hq-cc-card">
      <p className="hq-cc-card__title">
        <Link href={TASK(t.id)}>{t.title}</Link>
      </p>
      <p className={cx("hq-cc-card__why", late && "hq-cc-late")}>{why}</p>
      <Meta t={{ ...t, dueDate: late || /^Due /.test(why) ? null : t.dueDate }} today={today} owner={owner} />
      {t.checklistTotal > 0 ? (
        <p className="hq-cc-small">
          Checklist {t.checklistDone} of {t.checklistTotal}
        </p>
      ) : null}
      <div className="hq-cc-card__controls">
        <LaneMenu task={t} today={today} ctx={ctx} />
        <EditButton task={t} ctx={ctx} />
      </div>
    </li>
  );
}

// ── D. Waiting on ────────────────────────────────────────────

function WaitingSection({ tasks, mine, planning, today, meId, canPlanningWrite }: { tasks: LeaderTask[]; mine: LeaderTask[]; planning: PlanningItem[] | null | undefined; today: string; meId: string; canPlanningWrite: boolean }) {
  const waiting = tasks.filter((t) => laneOf(t, today) === "waiting");
  const live = (planning ?? []).filter(planningIsLive);
  const context = (planning ?? []).filter((p) => p.kind === "context" && p.status === "current");
  const onItem = new Map<string, LeaderTask[]>();
  for (const t of waiting) if (t.planningItemId) onItem.set(t.planningItemId, [...(onItem.get(t.planningItemId) ?? []), t]);
  // The table lists the person's OWN outside waits (someone or something outside the task list). A task that
  // only waits for another task is a dependency chain: it stays on the workboard, not here.
  const others = mine.filter((t) => laneOf(t, today) === "waiting" && !(t.planningItemId && live.some((p) => p.id === t.planningItemId)) && waitsOf(t).some((w) => w.kind !== "dependency"));
  const chained = mine.filter((t) => laneOf(t, today) === "waiting" && waitsOf(t).every((w) => w.kind === "dependency")).length;
  const canMoveNow = mine.filter((t) => t.assignedTo === meId && laneOf(t, today) !== "waiting" && laneOf(t, today) !== null).length;

  return (
    <section className="hq-cc-section" aria-labelledby="cc-waiting-h" id="cc-waiting">
      <Head
        id="cc-waiting-h"
        eyebrow="Held up"
        title="Waiting on"
        aside={canPlanningWrite ? <PlanningItemButton label="Add a planning item" /> : null}
      />

      {live.length > 0 ? (
        <ul className="hq-cc-plans">
          {live.map((p) => {
            const list = onItem.get(p.id) ?? [];
            const amount = p.kind === "funding" ? planningAmount(p.amountAnticipated) : null;
            return (
              <li key={p.id} className="hq-cc-plan">
                <div className="hq-cc-plan__head">
                  <div>
                    <p className="hq-cc-plan__kind">{p.kind === "funding" ? "Funding · planning figure" : "Outside dependency"}</p>
                    <h3 className="hq-cc-plan__title">{p.title}</h3>
                  </div>
                  {canPlanningWrite ? <PlanningItemButton item={p} label="Edit" /> : null}
                </div>
                <dl className="hq-cc-plan__facts">
                  {amount ? (
                    <div>
                      <dt>Amount</dt>
                      <dd>{amount}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <Dot tone={p.status === "confirmed" ? "info" : "warning"}>{planningStatusLabel(p.kind, p.status)}</Dot>
                    </dd>
                  </div>
                  <div>
                    <dt>Expected</dt>
                    <dd>{p.expectedBy ? dayWords(p.expectedBy, today) : p.expectedText ? `${p.expectedText}` : "Not known"}</dd>
                  </div>
                  <div>
                    <dt>Recorded</dt>
                    <dd>
                      {p.createdAt.slice(0, 10) ? dayWords(p.createdAt.slice(0, 10), today) : ""}
                      {p.createdByName ? ` by ${p.createdByName}` : ""}
                    </dd>
                  </div>
                </dl>
                {p.kind === "funding" ? <p className="hq-cc-small">Not a balance: nothing is counted as money held until it is marked received.</p> : null}
                {list.length > 0 ? (
                  <>
                    <p className="hq-cc-plan__waits">Waiting on it ({list.length})</p>
                    <ul className="hq-cc-mini">
                      {list.map((t) => (
                        <li key={t.id}>
                          <Link href={TASK(t.id)}>{t.title}</Link>
                          {t.projectName ? <span className="hq-cc-small">{t.projectName}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="hq-cc-small">No task is waiting on it.</p>
                )}
              </li>
            );
          })}
          {canMoveNow > 0 ? (
            <li className="hq-cc-plan hq-cc-plan--meanwhile">
              <p className="hq-cc-plan__kind">Meanwhile</p>
              <p className="hq-cc-plan__title">
                {canMoveNow} of your tasks can move now, without waiting on anything.
              </p>
              <a href="#cc-board" className="hq-cc-textlink">
                See them on the workboard
              </a>
            </li>
          ) : null}
        </ul>
      ) : null}

      {others.length === 0 && live.length === 0 ? <Quiet>Nothing of yours is waiting on anyone outside.</Quiet> : null}
      {others.length > 0 ? (
        <div className="hq-cc-waits" role="table" aria-label="Tasks waiting on someone or something">
          <div className="hq-cc-waits__row hq-cc-waits__row--head" role="row">
            <span role="columnheader">Task</span>
            <span role="columnheader">Waiting on</span>
            <span role="columnheader">Since</span>
            <span role="columnheader">Reply expected</span>
            <span role="columnheader">Next follow-up</span>
            <span role="columnheader">
              <span className="sr-only">Actions</span>
            </span>
          </div>
          {others.map((t) => {
            const w = waitsOf(t);
            const fu = daysFrom(today, t.nextFollowUp);
            return (
              <div key={t.id} className="hq-cc-waits__row" role="row">
                <span role="cell" className="hq-cc-waits__task">
                  <Link href={TASK(t.id)}>{t.title}</Link>
                  {t.projectName ? <span className="hq-cc-small">{t.projectName}</span> : null}
                </span>
                <span role="cell" className="hq-cc-waits__on">
                  <span className="hq-cc-waits__label">Waiting on</span>
                  {w.map((x) => x.text.replace(/^Waiting on /, "")).join("; ")}
                </span>
                <span role="cell">
                  <span className="hq-cc-waits__label">Since</span>
                  {t.waitingSince ? dayWords(t.waitingSince, today) : <span className="hq-cc-small">Not recorded</span>}
                </span>
                <span role="cell">
                  <span className="hq-cc-waits__label">Reply expected</span>
                  {t.expectedResponse ? dayWords(t.expectedResponse, today) : <span className="hq-cc-small">Not known</span>}
                </span>
                <span role="cell" className={cx(fu !== null && fu <= 0 && "hq-cc-late")}>
                  <span className="hq-cc-waits__label">Next follow-up</span>
                  <FollowUpDate task={t} />
                  {fu !== null && fu < 0 ? <span className="hq-cc-small hq-cc-late">Overdue</span> : fu === 0 ? <span className="hq-cc-small">Today</span> : null}
                </span>
                <span role="cell" className="hq-cc-waits__act">
                  {t.isBlocked && !t.waitingOn && !t.blockedReason && t.status !== "waiting" ? (
                    <Link href={TASK(t.id)} className="hq-cc-textlink">
                      See what it waits for
                    </Link>
                  ) : (
                    <ResolveButton task={t} />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {chained > 0 ? (
        <p className="hq-cc-foot">
          {chained === 1 ? "1 more of your tasks waits" : `${chained} more of your tasks wait`} for another task to finish: see the Waiting lane on the <a href="#cc-board">workboard</a>.
        </p>
      ) : null}

      {context.length > 0 ? (
        <div className="hq-cc-context">
          <h3 className="hq-cc-subhead">Current context</h3>
          <ul className="hq-cc-mini">
            {context.map((p) => (
              <li key={p.id}>
                <span>{p.title}</span>
                <span className="hq-cc-small">
                  {p.createdByName ? `${p.createdByName}, ` : ""}
                  {dayWords(p.createdAt.slice(0, 10), today)}
                </span>
                {canPlanningWrite ? <PlanningItemButton item={p} label="Edit" /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ── E. Growth and relationships ──────────────────────────────

function GrowthSection({ g, canPortfolio }: { g: GrowthPanel; canPortfolio: boolean }) {
  const stats = [
    { key: "new", label: `New leads, last ${NEW_LEAD_DAYS} days`, value: g.newLeads, href: "/hq/growth/pipeline" },
    { key: "appraisals", label: "Appraisals requested", value: g.appraisalsRequested, href: "/hq/growth/pipeline", hint: g.appraisalsCompleted ? `${g.appraisalsCompleted} completed, awaiting a proposal` : null },
    { key: "followups", label: "Follow-ups due", value: g.followUpsDue + g.leadFollowUpsDue, href: "/hq/growth/contacts", hint: g.leadFollowUpsDue ? `${g.leadFollowUpsDue} of them on your leads` : null },
    { key: "partners", label: "Partners to contact", value: g.partnersQuiet + g.partnersNever, href: "/hq/growth/partners", hint: g.partners ? `${g.partnersNever} never contacted, ${g.partnersQuiet} quiet over 30 days` : "No partners recorded yet" },
  ];
  const total = g.stages.connect + g.stages.cultivate + g.stages.champion;
  const managedPct = g.managed !== null && g.goal ? Math.min(100, Math.round((100 * g.managed) / g.goal)) : 0;
  return (
    <section className="hq-cc-section" aria-labelledby="cc-growth-h" id="cc-growth">
      <Head id="cc-growth-h" eyebrow="Growth" title="Growth and relationships" lead="Counts from HQ records only. No rates or forecasts." />
      <ul className="hq-cc-stats">
        {stats.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="hq-cc-stat">
              <span className="hq-cc-stat__value">{s.value}</span>
              <span className="hq-cc-stat__label">{s.label}</span>
              {s.hint ? <span className="hq-cc-small">{s.hint}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="hq-cc-growth__cols">
        <div>
          <h3 className="hq-cc-subhead">Referral partners</h3>
          <ol className="hq-cc-stages" aria-label="Referral partners by stage">
            {(["connect", "cultivate", "champion"] as const).map((k) => (
              <li key={k} className="hq-cc-stage">
                <span className="hq-cc-stage__n">{g.stages[k]}</span>
                <span className="hq-cc-stage__name">{STAGE_LABEL[k]}</span>
                <span className="hq-cc-small">{STAGE_HINT[k]}</span>
              </li>
            ))}
          </ol>
          <p className="hq-cc-small">{total === 0 ? "No partner has a relationship stage yet." : `${total} partners with a stage; inactive ones are not counted.`}</p>
        </div>
        <div>
          <h3 className="hq-cc-subhead">First-year goal</h3>
          {g.managed !== null && g.goal !== null ? (
            <>
              <p className="hq-cc-meter__figure">
                <b>{g.managed}</b> of {g.goal} managed properties
              </p>
              <span className="hq-cc-rule hq-cc-rule--lg" role="meter" aria-label="Managed properties against the goal" aria-valuemin={0} aria-valuemax={g.goal} aria-valuenow={g.managed}>
                <span style={{ width: `${managedPct}%` }} />
              </span>
              <p className="hq-cc-small">
                Actual: managed property records in HQ (active or onboarding){g.goalDate ? `, goal date ${g.goalDate}` : ""}.{" "}
                <Link href="/hq/portfolio" className="hq-cc-textlink">
                  Portfolio
                </Link>
              </p>
            </>
          ) : (
            <p className="hq-cc-small">{canPortfolio ? "The goal has not been set. A director can set it in Settings." : "Managed properties are not part of your role."}</p>
          )}
        </div>
      </div>
    </section>
  );
}
