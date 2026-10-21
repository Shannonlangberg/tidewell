import { requireStaff } from "@/lib/hq/auth";
import { LANE_LABEL, dayWords, laneOf, laneWhy, waitsOf } from "@/lib/hq/leadership/rules";
import { LEADER_TASK_COLS, loadPlanningItems, loadStaffOptions, toLeaderTask } from "@/lib/hq/leadership/queries";
import { EditButton, ResolveButton, type EditContext } from "./Controls";

/*
 * The task page's "Waiting and plan" panel: the command center's reading of one task (its workboard
 * lane and why), what it waits on with the dates that were recorded (never filled in), and the person's
 * own plan for it. Quick edit and "Wait is over" use the same Server Actions as /hq. Props are plain data
 * (the task id and today); the session comes from requireStaff().
 */
export async function TaskWaitingPanel({ taskId, today }: { taskId: string; today: string }) {
  const { db, can } = await requireStaff();
  const { data } = await db.from("task_overview").select(LEADER_TASK_COLS).eq("id", taskId).is("deleted_at", null).maybeSingle();
  if (!data) return null;
  const t = toLeaderTask(data as Record<string, unknown>);
  const lane = laneOf(t, today);
  if (!lane) return null;
  const canWrite = can("tasks.write");
  const [staff, planning] = canWrite ? await Promise.all([loadStaffOptions(db), can("planning.read") ? loadPlanningItems(db) : Promise.resolve(null)]) : [[], null];
  const ctx: EditContext = { staff, planning: planning?.ok ? planning.data.map((p) => ({ id: p.id, title: p.title, kind: p.kind, status: p.status })) : [], canPlanning: can("planning.read") };
  const waits = waitsOf(t);
  const rows: [string, string][] = [
    ["Workboard", `${LANE_LABEL[lane]}: ${laneWhy(t, today)}`],
    ...(waits.length ? ([["Waiting on", waits.map((w) => w.text.replace(/^Waiting on /, "")).join("; ")]] as [string, string][]) : []),
    ...(lane === "waiting"
      ? ([
          ["Since", t.waitingSince ? dayWords(t.waitingSince, today) : "Not recorded"],
          ["Reply expected", t.expectedResponse ? dayWords(t.expectedResponse, today) : "Not known"],
        ] as [string, string][])
      : []),
    ["Next follow-up", t.nextFollowUp ? dayWords(t.nextFollowUp, today) : "None set"],
    ["Planned for", t.plannedFor ? dayWords(t.plannedFor, today) : "No particular day"],
  ];
  return (
    <section className="hq-panel hq-cc-taskpanel" aria-labelledby="task-waiting">
      <h2 id="task-waiting" className="hq-cc-subhead">
        Waiting and plan
      </h2>
      <dl className="hq-cc-taskpanel__list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {canWrite ? (
        <div className="hq-cc-actions">
          <EditButton task={t} ctx={ctx}>
            Quick edit
          </EditButton>
          {lane === "waiting" && (t.status === "waiting" || t.waitingOn || t.planningItemId || t.blockedReason) ? <ResolveButton task={t} /> : null}
        </div>
      ) : null}
    </section>
  );
}
