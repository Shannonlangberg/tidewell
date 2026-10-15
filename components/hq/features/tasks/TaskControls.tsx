"use client";

import { useState, useTransition } from "react";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/hq/constants";
import { allowedTransitions, isOpen, quickToggleTarget } from "@/lib/hq/tasks/rules";
import type { TaskActionResult } from "@/lib/hq/tasks/types";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { Select } from "../../Select";
import { useToast } from "../../Toast";

/*
 * The controls on a single task's page. Every one calls a Server Action passed in as a prop
 * (this file imports no server code), shows the result as a toast, and relies on the action's
 * own revalidation to redraw the page. They are rendered only for people who hold tasks.write;
 * hiding them is a courtesy, the actions refuse everyone else.
 */

type SetStatus = (id: string, to: string) => Promise<TaskActionResult>;

function useStatusChange(id: string, setStatus: SetStatus) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const run = (to: string) => {
    if (pending) return;
    start(async () => {
      try {
        const r = await setStatus(id, to);
        toast(r.message, { tone: r.ok ? "success" : "error" });
      } catch {
        toast("We could not update that task. Try again in a moment.", { tone: "error" });
      }
    });
  };
  return { pending, run };
}

/** "Mark complete" for an open task, "Reopen" for a closed one. */
export function CompleteReopenButton({ id, status, setStatus }: { id: string; status: TaskStatus; setStatus: SetStatus }) {
  const { pending, run } = useStatusChange(id, setStatus);
  const target = quickToggleTarget(status);
  const completing = target === "completed";
  return (
    <Button
      variant={completing ? "primary" : "secondary"}
      icon={completing ? "check" : undefined}
      loading={pending}
      pendingLabel={completing ? "Completing task" : "Reopening task"}
      onClick={() => run(target)}
    >
      {completing ? "Mark complete" : "Reopen"}
    </Button>
  );
}

/** Change to any status the task's current status allows. Complete and Cancel are here too. */
export function StatusSelect({ id, status, setStatus }: { id: string; status: TaskStatus; setStatus: SetStatus }) {
  const { pending, run } = useStatusChange(id, setStatus);
  const options = allowedTransitions(status).map((s) => ({
    value: s,
    // From a closed task the only moves are reopening it, so say so.
    label: isOpen(status) ? TASK_STATUS_LABEL[s] : `Reopen as ${TASK_STATUS_LABEL[s].toLowerCase()}`,
  }));
  const [choice, setChoice] = useState("");
  return (
    <div className="grid gap-3">
      <Select
        // A new status means a new list of choices: start the control fresh.
        key={status}
        name="status_change"
        idPrefix="task-status"
        label="Change status"
        placeholder="Choose a status"
        options={options}
        value={choice}
        onChange={(e) => setChoice(e.currentTarget.value)}
        hint={`Now: ${TASK_STATUS_LABEL[status]}.`}
      />
      <div>
        <Button
          size="sm"
          disabled={!choice}
          loading={pending}
          pendingLabel="Updating status"
          onClick={() => {
            run(choice);
            setChoice("");
          }}
        >
          Update status
        </Button>
      </div>
    </div>
  );
}

/** Cancel (reversible) and archive (removes it from lists) behind confirmations. */
export function ManageTask({
  id,
  title,
  status,
  setStatus,
  archive,
  canArchive,
}: {
  id: string;
  title: string;
  status: TaskStatus;
  setStatus: SetStatus;
  /** A Server Action taking FormData with the task id; redirects when it finishes. */
  archive: (formData: FormData) => void | Promise<void>;
  /** The task's creator or assignee, or someone with growth.delete. (The database decides in the end.) */
  canArchive: boolean;
}) {
  const { toast } = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const open = isOpen(status);

  if (!open && !canArchive) return null;

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {open ? (
          <Button size="sm" onClick={() => setCancelOpen(true)}>
            Cancel task
          </Button>
        ) : null}
        {canArchive ? (
          <Button size="sm" variant="danger" onClick={() => setArchiveOpen(true)}>
            Archive task
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this task?"
        confirmLabel="Cancel task"
        cancelLabel="Keep task"
        onConfirm={async () => {
          try {
            const r = await setStatus(id, "cancelled");
            toast(r.message, { tone: r.ok ? "success" : "error" });
          } catch {
            toast("We could not cancel that task. Try again in a moment.", { tone: "error" });
          }
        }}
      >
        &ldquo;{title}&rdquo; will be marked cancelled and will leave everyone&rsquo;s open lists. It stays on record, and you can reopen it later.
      </ConfirmDialog>

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Archive this task?"
        confirmLabel="Archive task"
        cancelLabel="Keep task"
        tone="danger"
        action={archive}
        fields={{ id }}
      >
        &ldquo;{title}&rdquo; will disappear from every list and from search. Its history is kept, and someone with permission to restore archived records can bring it back.
      </ConfirmDialog>
    </>
  );
}
