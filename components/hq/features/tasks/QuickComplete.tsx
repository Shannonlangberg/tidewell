"use client";

import { useTransition } from "react";
import type { TaskStatus } from "@/lib/hq/constants";
import { quickToggleTarget } from "@/lib/hq/tasks/rules";
import type { TaskActionResult } from "@/lib/hq/tasks/types";
import { Spinner } from "../../Button";
import { Icon } from "../../icons";
import { useToast } from "../../Toast";

/*
 * The checkbox-style button at the start of a task row: tick it to complete an open task, tick
 * a completed or cancelled one to reopen it. It calls the Server Action directly (passed in as
 * a prop, so this file imports no server code), shows a toast with the result, and the action's
 * own revalidation redraws the list, so there is no page flow.
 *
 * It is a real <button> with a name that includes the task title ("Mark complete: Call the
 * broker"), 44px square on a phone and 32px beside a table row, and it ignores a second tap
 * while the first is still being saved. People who may not write tasks never get one: the
 * list leaves this column out entirely (the server refuses a forged request regardless).
 */

export function QuickComplete({
  id,
  title,
  status,
  setStatus,
}: {
  id: string;
  title: string;
  status: TaskStatus;
  setStatus: (id: string, to: string) => Promise<TaskActionResult>;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const target = quickToggleTarget(status);
  const completing = target === "completed";

  function run() {
    if (pending) return;
    start(async () => {
      try {
        const result = await setStatus(id, target);
        toast(result.message, { tone: result.ok ? "success" : "error" });
      } catch {
        toast("We could not update that task. Try again in a moment.", { tone: "error" });
      }
    });
  }

  const label = completing ? `Mark complete: ${title}` : `Reopen: ${title}`;
  const closedWith = status === "cancelled" ? "close" : "check";

  return (
    <button
      type="button"
      onClick={run}
      aria-label={label}
      title={completing ? "Mark complete" : "Reopen"}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      className="group inline-flex min-h-11 min-w-11 items-center justify-center rounded-control bg-transparent p-0 md:min-h-8 md:min-w-7"
    >
      <span
        aria-hidden="true"
        className={
          completing
            ? "grid size-6 place-items-center rounded-control border border-grey bg-white text-charcoal transition-colors group-hover:border-charcoal group-hover:bg-ivory"
            : "grid size-6 place-items-center rounded-control border border-charcoal bg-charcoal text-ivory transition-colors group-hover:bg-charcoal-hover"
        }
      >
        {pending ? (
          <Spinner className="size-3.5" />
        ) : completing ? (
          <Icon name="check" size={16} className="opacity-0 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50" />
        ) : (
          <Icon name={closedWith} size={16} />
        )}
      </span>
      <span className="sr-only" role="status">
        {pending ? "Saving" : ""}
      </span>
    </button>
  );
}
