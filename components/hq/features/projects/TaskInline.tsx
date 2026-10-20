"use client";

import { useState, useTransition } from "react";
import type { TaskPriority, TaskStatus } from "@/lib/hq/constants";
import { TASK_PRIORITY_WORD, TASK_STATUS_WORD, isTaskOverdue, moveTargets } from "@/lib/hq/projects/rules";
import type { ProjectActionResult } from "@/lib/hq/projects/types";
import { Icon } from "../../icons";
import { useToast } from "../../Toast";

/*
 * The small inline controls on a task row in the List view: status, assignee, priority and due
 * date. Each is a native control (keyboard and phone pickers work), quiet until hovered or
 * focused, and calls a Server Action passed in as a prop (this file imports no server code). The
 * action's revalidation redraws the page; the toast says what happened, including a refusal by the
 * database (for example reassigning a task you did not create).
 */

type Result = ProjectActionResult;
export type SetStatus = (id: string, to: string) => Promise<Result>;
export type SetField = (id: string, field: string, value: string) => Promise<Result>;

function useRun() {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, onFail?: () => void) => {
    if (pending) return;
    start(async () => {
      try {
        const r = await fn();
        toast(r.message, { tone: r.ok ? "success" : "error" });
        if (!r.ok) onFail?.();
      } catch {
        toast("We could not update that task. Try again in a moment.", { tone: "error" });
        onFail?.();
      }
    });
  };
  return { pending, run };
}

function Chev() {
  return <Icon name="chevron-down" size={13} className="hq-prj-mini__chev" />;
}

export function StatusMini({ id, title, status, setStatus }: { id: string; title: string; status: TaskStatus; setStatus: SetStatus }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState<TaskStatus>(status);
  const targets = moveTargets(status);
  return (
    <span className="hq-prj-mini">
      <select
        aria-label={`Status: ${title}`}
        value={pending ? value : status}
        disabled={pending}
        onChange={(e) => {
          const to = e.currentTarget.value as TaskStatus;
          setValue(to);
          run(() => setStatus(id, to), () => setValue(status));
        }}
      >
        <option value={status}>{TASK_STATUS_WORD[status]}</option>
        {targets.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_WORD[s]}
          </option>
        ))}
      </select>
      <Chev />
    </span>
  );
}

export function AssigneeMini({
  id,
  title,
  assignedTo,
  assignedName,
  staff,
  setField,
}: {
  id: string;
  title: string;
  assignedTo: string | null;
  assignedName: string | null;
  staff: readonly { value: string; label: string }[];
  setField: SetField;
}) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(assignedTo ?? "");
  // Someone no longer in the active list stays selectable, so the control shows the truth.
  const options = assignedTo && !staff.some((s) => s.value === assignedTo) ? [{ value: assignedTo, label: assignedName ?? "A colleague" }, ...staff] : staff;
  return (
    <span className="hq-prj-mini" data-tone={assignedTo ? undefined : "none"}>
      <select
        aria-label={`Assigned to: ${title}`}
        value={pending ? value : (assignedTo ?? "")}
        disabled={pending}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setValue(v);
          run(() => setField(id, "assignee", v), () => setValue(assignedTo ?? ""));
        }}
      >
        <option value="">Unassigned</option>
        {options.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Chev />
    </span>
  );
}

const PRIORITY_ORDER: readonly TaskPriority[] = ["urgent", "high", "normal", "low"];

export function PriorityMini({ id, title, priority, setField }: { id: string; title: string; priority: TaskPriority; setField: SetField }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(priority);
  return (
    <span className="hq-prj-mini" data-tone={priority === "urgent" || priority === "high" ? priority : priority === "low" ? "none" : undefined}>
      <select
        aria-label={`Priority: ${title}`}
        value={pending ? value : priority}
        disabled={pending}
        onChange={(e) => {
          const v = e.currentTarget.value as TaskPriority;
          setValue(v);
          run(() => setField(id, "priority", v), () => setValue(priority));
        }}
      >
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>
            {TASK_PRIORITY_WORD[p]}
          </option>
        ))}
      </select>
      <Chev />
    </span>
  );
}

export function DueMini({ id, title, due, status, today, setField }: { id: string; title: string; due: string | null; status: TaskStatus; today: string; setField: SetField }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(due ?? "");
  const late = isTaskOverdue(status, due, today);
  return (
    <span className="hq-prj-mini" data-late={late || undefined} data-empty={!due || undefined}>
      <input
        type="date"
        aria-label={`Due date: ${title}${late ? " (overdue)" : ""}`}
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => {
          if (value === (due ?? "")) return;
          run(() => setField(id, "due_date", value), () => setValue(due ?? ""));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(due ?? "");
          }
        }}
      />
    </span>
  );
}

export function MilestoneMini({
  id,
  title,
  milestoneId,
  milestones,
  setField,
}: {
  id: string;
  title: string;
  milestoneId: string | null;
  milestones: readonly { value: string; label: string }[];
  setField: SetField;
}) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(milestoneId ?? "");
  return (
    <span className="hq-prj-mini" data-tone={milestoneId ? undefined : "none"}>
      <select
        aria-label={`Milestone: ${title}`}
        value={pending ? value : (milestoneId ?? "")}
        disabled={pending}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setValue(v);
          run(() => setField(id, "milestone", v), () => setValue(milestoneId ?? ""));
        }}
      >
        <option value="">No milestone</option>
        {milestones.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <Chev />
    </span>
  );
}
