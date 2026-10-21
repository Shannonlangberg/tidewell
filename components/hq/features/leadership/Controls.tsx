"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LANE_LABEL, LANES, laneOf } from "@/lib/hq/leadership/rules";
import type { Lane, LeaderActionResult, LeaderTask, PlanningItem } from "@/lib/hq/leadership/types";
import { Button } from "../../Button";
import { Drawer } from "../../Drawer";
import { Icon } from "../../icons";
import { Select } from "../../Select";
import { DateInput, TextInput, Textarea } from "../../TextInput";
import { useToast } from "../../Toast";
import {
  completeLeaderTask,
  moveToLane,
  planTaskFor,
  quickEditTask,
  resolveWaiting,
  savePlanningItem,
  setFollowUp,
  setLaunchGate,
  setLaunchProject,
} from "./actions";

/*
 * The command center's small controls. Each calls a Server Action from ./actions (passed as an import:
 * the actions file is "use server"), shows a toast with what happened (including a refusal by the
 * database), and lets the action's revalidation redraw the page. Native controls throughout, so the
 * keyboard, screen readers and phone pickers work. Nothing here changes a priority or a due date unless
 * the person sets that field in Quick edit.
 */

type Option = { value: string; label: string };
export type EditContext = { staff: Option[]; planning: Pick<PlanningItem, "id" | "title" | "kind" | "status">[]; canPlanning: boolean };

function useRun() {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<LeaderActionResult>, after?: (r: LeaderActionResult) => void) => {
    if (pending) return;
    start(async () => {
      try {
        const r = await fn();
        toast(r.message, { tone: r.ok ? "success" : "error" });
        after?.(r);
        if (r.ok) router.refresh();
      } catch {
        toast("We could not save that. Try again in a moment.", { tone: "error" });
      }
    });
  };
  return { pending, run };
}

// ── Done and Reschedule ──────────────────────────────────────

export function DoneButton({ taskId, title }: { taskId: string; title: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="secondary" icon="check" loading={pending} onClick={() => run(() => completeLeaderTask(taskId))} aria-label={`Mark "${title}" done`}>
      Done
    </Button>
  );
}

/** Plan a task for another day. Changes planned_for only: the due date stays as it is. */
export function RescheduleMenu({ taskId, title, planned }: { taskId: string; title: string; planned: string | null }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(planned ?? "");
  const pick = (when: string) => run(() => planTaskFor(taskId, when), (r) => r.ok && setOpen(false));
  return (
    <>
      <Button size="sm" variant="ghost" icon="calendar" loading={pending} onClick={() => setOpen(true)} aria-label={`Reschedule "${title}"`}>
        Reschedule
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Plan it for another day" description="This moves your own plan for the task. Its due date and priority stay as they are.">
        <div className="hq-cc-choices">
          <Button onClick={() => pick("tomorrow")} disabled={pending}>
            Tomorrow
          </Button>
          <Button onClick={() => pick("next_week")} disabled={pending}>
            Next Monday
          </Button>
          {planned ? (
            <Button variant="ghost" onClick={() => pick("clear")} disabled={pending}>
              No particular day
            </Button>
          ) : null}
        </div>
        <form
          className="hq-cc-inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (date) pick(date);
          }}
        >
          <DateInput name="planned_for" label="Or choose a day" value={date} onChange={(e) => setDate(e.currentTarget.value)} idPrefix={`plan-${taskId}`} />
          <Button type="submit" variant="primary" disabled={!date || pending}>
            Plan for this day
          </Button>
        </form>
      </Drawer>
    </>
  );
}

// ── Quick edit (and "move to Waiting", which is Quick edit focused on what it waits on) ──

const PRIORITY_OPTIONS: Option[] = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
const STATUS_OPTIONS: Option[] = [
  { value: "to_do", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
];

function initialFields(t: LeaderTask): Record<string, string> {
  return {
    status: t.status,
    priority: t.priority,
    due_date: t.dueDate ?? "",
    assignee: t.assignedTo ?? "",
    planned_for: t.plannedFor ?? "",
    waiting_on: t.waitingOn ?? "",
    planning_item: t.planningItemId ?? "",
    expected_response: t.expectedResponse ?? "",
    next_follow_up: t.nextFollowUp ?? "",
    blocked_reason: t.blockedReason ?? "",
  };
}

export function QuickEdit({ task, ctx, open, onClose, mode = "edit" }: { task: LeaderTask; ctx: EditContext; open: boolean; onClose: () => void; mode?: "edit" | "waiting" }) {
  const { pending, run } = useRun();
  const start = initialFields(task);
  const [error, setError] = useState<string | null>(null);
  const livePlanning = ctx.planning.filter((p) => p.kind !== "context" && (p.status === "anticipated" || p.status === "confirmed" || p.id === task.planningItemId));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const changed: Record<string, string> = {};
    for (const k of Object.keys(start)) {
      if (!fd.has(k)) continue;
      const v = String(fd.get(k) ?? "").trim();
      if (v !== start[k]) changed[k] = v;
    }
    if (mode === "waiting") {
      changed.status = "waiting";
      const words = (changed.waiting_on ?? start.waiting_on).trim();
      const item = changed.planning_item ?? start.planning_item;
      if (!words && !item && !task.isBlocked && !task.blockedReason) {
        setError("Say what it is waiting on, or choose the planning item it waits for.");
        return;
      }
    }
    setError(null);
    run(() => quickEditTask(task.id, changed), (r) => r.ok && onClose());
  }

  const waitingFields = (
    <>
      <TextInput name="waiting_on" label="Waiting on" hint="Who or what, in a few words (for example: Ailo to reply after the demo)." defaultValue={start.waiting_on} maxLength={200} idPrefix={`qe-${task.id}`} />
      {ctx.canPlanning && livePlanning.length > 0 ? (
        <Select
          name="planning_item"
          label="Or waiting on a planning item"
          hint="For example the anticipated funding. A planning item is never treated as money held."
          defaultValue={start.planning_item}
          placeholder="None"
          options={livePlanning.map((p) => ({ value: p.id, label: p.title }))}
          idPrefix={`qe-${task.id}`}
        />
      ) : null}
      <div className="hq-cc-pair">
        <DateInput name="expected_response" label="Reply expected" hint="Only if you know it." defaultValue={start.expected_response} idPrefix={`qe-${task.id}`} />
        <DateInput name="next_follow_up" label="Next follow-up" defaultValue={start.next_follow_up} idPrefix={`qe-${task.id}`} />
      </div>
    </>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={mode === "waiting" ? "Move to Waiting" : "Quick edit"}
      description={task.title}
      footer={
        <div className="hq-cc-drawer-actions">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={`qe-form-${task.id}-${mode}`} variant="primary" loading={pending}>
            {mode === "waiting" ? "Move to Waiting" : "Save"}
          </Button>
        </div>
      }
    >
      <form id={`qe-form-${task.id}-${mode}`} className="hq-cc-form" onSubmit={submit} noValidate>
        {error ? (
          <p className="hq-cc-form__error" role="alert">
            {error}
          </p>
        ) : null}
        {mode === "waiting" ? (
          waitingFields
        ) : (
          <>
            <div className="hq-cc-pair">
              <Select name="status" label="Status" defaultValue={start.status} options={STATUS_OPTIONS} idPrefix={`qe-${task.id}`} />
              <Select name="priority" label="Priority" hint="The official priority. Only you change it." defaultValue={start.priority} options={PRIORITY_OPTIONS} idPrefix={`qe-${task.id}`} />
            </div>
            <div className="hq-cc-pair">
              <DateInput name="due_date" label="Due date" hint="A commitment. Leave empty if there is none." defaultValue={start.due_date} idPrefix={`qe-${task.id}`} />
              <DateInput name="planned_for" label="Planned for" hint="Your own plan, not a commitment." defaultValue={start.planned_for} idPrefix={`qe-${task.id}`} />
            </div>
            {ctx.staff.length > 0 ? <Select name="assignee" label="Owner" defaultValue={start.assignee} placeholder="Nobody yet" options={ctx.staff} idPrefix={`qe-${task.id}`} /> : null}
            <fieldset className="hq-cc-fieldset">
              <legend className="hq-label">If it is waiting</legend>
              {waitingFields}
              <TextInput name="blocked_reason" label="Held-up reason" defaultValue={start.blocked_reason} maxLength={500} idPrefix={`qe-${task.id}`} />
            </fieldset>
          </>
        )}
      </form>
    </Drawer>
  );
}

export function EditButton({ task, ctx, children = "Edit" }: { task: LeaderTask; ctx: EditContext; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" icon="note" onClick={() => setOpen(true)} aria-label={`Quick edit "${task.title}"`}>
        {children}
      </Button>
      {open ? <QuickEdit task={task} ctx={ctx} open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// ── Workboard: move a card to another lane ───────────────────

export function LaneMenu({ task, today, ctx }: { task: LeaderTask; today: string; ctx: EditContext }) {
  const { pending, run } = useRun();
  const [waiting, setWaiting] = useState(false);
  const current = laneOf(task, today) ?? "coming_next";
  return (
    <>
      <label className="hq-cc-lanemenu">
        <span className="sr-only">Move &ldquo;{task.title}&rdquo; to</span>
        <select
          value={current}
          disabled={pending}
          onChange={(e) => {
            const to = e.currentTarget.value as Lane;
            if (to === current) return;
            if (to === "waiting") setWaiting(true);
            else run(() => moveToLane(task.id, to));
          }}
        >
          {LANES.map((l) => (
            <option key={l} value={l}>
              {LANE_LABEL[l]}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={14} aria-hidden />
      </label>
      {waiting ? <QuickEdit task={task} ctx={ctx} mode="waiting" open={waiting} onClose={() => setWaiting(false)} /> : null}
    </>
  );
}

// ── Waiting On: the wait is over, and the next follow-up ─────

export function ResolveButton({ task }: { task: LeaderTask }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("in_progress");
  const [note, setNote] = useState("");
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`The wait is over for "${task.title}"`}>
        Wait is over
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="The wait is over"
        description={task.title}
        footer={
          <div className="hq-cc-drawer-actions">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} onClick={() => run(() => resolveWaiting(task.id, next, note), (r) => r.ok && setOpen(false))}>
              Save
            </Button>
          </div>
        }
      >
        <div className="hq-cc-form">
          <Textarea name="note" label="What happened" hint="Goes into the task's comments (for example: Ailo called back, demo on Thursday)." rows={3} value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={4000} idPrefix={`rv-${task.id}`} />
          <Select
            name="next"
            label="Now"
            value={next}
            onChange={(e) => setNext(e.currentTarget.value)}
            options={[
              { value: "in_progress", label: "In motion: I'm working on it" },
              { value: "to_do", label: "To do: ready to start" },
              { value: "completed", label: "Done: nothing more to do" },
            ]}
            idPrefix={`rv-${task.id}`}
          />
        </div>
      </Drawer>
    </>
  );
}

export function FollowUpDate({ task }: { task: LeaderTask }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(task.nextFollowUp ?? "");
  return (
    <label className="hq-cc-followup">
      <span className="sr-only">Next follow-up for &ldquo;{task.title}&rdquo;</span>
      <input
        type="date"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setValue(v);
          run(() => setFollowUp(task.id, v));
        }}
      />
    </label>
  );
}

// ── Planning items ───────────────────────────────────────────

const PLANNING_STATUS: Record<string, Option[]> = {
  funding: [
    { value: "anticipated", label: "Anticipated, not confirmed" },
    { value: "confirmed", label: "Confirmed, not yet received" },
    { value: "received", label: "Received" },
    { value: "closed", label: "Closed (not happening)" },
  ],
  dependency: [
    { value: "anticipated", label: "Awaited" },
    { value: "confirmed", label: "Confirmed" },
    { value: "received", label: "Arrived" },
    { value: "closed", label: "Closed" },
  ],
  context: [
    { value: "current", label: "Current" },
    { value: "closed", label: "No longer current" },
  ],
};

export function PlanningItemButton({ item, kind = "funding", label }: { item?: PlanningItem; kind?: "funding" | "dependency" | "context"; label: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const k = item?.kind ?? kind;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (n: string) => String(fd.get(n) ?? "");
    run(
      () =>
        savePlanningItem({
          id: item?.id,
          kind: get("kind") || k,
          title: get("title"),
          detail: get("detail"),
          amount: get("amount"),
          expectedText: get("expected_text"),
          expectedBy: get("expected_by"),
          status: get("status"),
          version: item?.version,
        }),
      (r) => r.ok && setOpen(false),
    );
  }
  const id = `pl-${item?.id ?? "new"}`;
  return (
    <>
      <Button size="sm" variant={item ? "ghost" : "secondary"} icon={item ? "note" : "plus"} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={item ? "Planning item" : "Add a planning item"}
        description="Planning information, not financial records. An amount here is what you anticipate, never a balance."
        footer={
          <div className="hq-cc-drawer-actions">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={`${id}-form`} variant="primary" loading={pending}>
              Save
            </Button>
          </div>
        }
      >
        <form id={`${id}-form`} className="hq-cc-form" onSubmit={submit} noValidate>
          {!item ? (
            <Select
              name="kind"
              label="Kind"
              defaultValue={k}
              options={[
                { value: "funding", label: "Funding (anticipated)" },
                { value: "dependency", label: "Outside dependency" },
                { value: "context", label: "Context note" },
              ]}
              idPrefix={id}
            />
          ) : null}
          <TextInput name="title" label="Title" required defaultValue={item?.title ?? ""} maxLength={200} idPrefix={id} />
          <Textarea name="detail" label="Detail" rows={3} defaultValue={item?.detail ?? ""} maxLength={2000} idPrefix={id} />
          {k === "funding" ? <TextInput name="amount" label="Anticipated amount (AUD, whole dollars)" hint="A planning figure only." inputMode="numeric" defaultValue={item?.amountAnticipated !== null && item?.amountAnticipated !== undefined ? String(Math.round(item.amountAnticipated)) : ""} idPrefix={id} /> : null}
          {k !== "context" ? (
            <div className="hq-cc-pair">
              <TextInput name="expected_text" label="Expected (in your words)" hint="For example: within a month." defaultValue={item?.expectedText ?? ""} maxLength={200} idPrefix={id} />
              <DateInput name="expected_by" label="Expected by" hint="Only a date you actually know." defaultValue={item?.expectedBy ?? ""} idPrefix={id} />
            </div>
          ) : null}
          <Select name="status" label="Status" defaultValue={item?.status ?? (k === "context" ? "current" : "anticipated")} options={PLANNING_STATUS[k]} idPrefix={id} />
        </form>
      </Drawer>
    </>
  );
}

// ── Business launch ──────────────────────────────────────────

export function LaunchProjectPicker({ options, current }: { options: Option[]; current: string | null }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(current ?? options[0]?.value ?? "");
  if (options.length === 0) return null;
  return (
    <form
      className="hq-cc-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value) run(() => setLaunchProject(value));
      }}
    >
      <Select name="launch_project" label="Track this project as the business launch" value={value} onChange={(e) => setValue(e.currentTarget.value)} options={options} idPrefix="launch" />
      <Button type="submit" variant="secondary" loading={pending}>
        Use this project
      </Button>
    </form>
  );
}

export function GateToggle({ milestoneId, name, gate }: { milestoneId: string; name: string; gate: boolean }) {
  const { pending, run } = useRun();
  return (
    <label className="hq-cc-gate">
      <input type="checkbox" checked={gate} disabled={pending} onChange={(e) => run(() => setLaunchGate(milestoneId, e.currentTarget.checked))} />
      <span>{name}</span>
    </label>
  );
}
