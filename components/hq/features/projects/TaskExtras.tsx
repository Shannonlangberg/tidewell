"use client";

import { useActionState, useState, useTransition } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import { CHECKLIST_MAX_ITEMS, CHECKLIST_TEXT_MAX, COMMENT_MAX, moveItem } from "@/lib/hq/projects/rules";
import type { ProjectActionResult } from "@/lib/hq/projects/types";
import { Icon } from "../../icons";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { SubmitButton } from "../../SubmitButton";
import { Textarea } from "../../TextInput";
import { useToast } from "../../Toast";

/*
 * The interactive parts of the extended task page: the checklist (tick, add, edit, reorder,
 * remove; each change saves the whole list through set_task_checklist, so the order on screen is
 * the order kept) and the comment form. Server Actions arrive as props; this file imports no
 * server code. Without JavaScript the checklist is shown read-only by the page.
 */

type Item = { id: string | null; text: string; done: boolean };
type SaveChecklist = (taskId: string, items: unknown) => Promise<ProjectActionResult & { items?: { id: string; text: string; done: boolean }[] }>;

export function ChecklistEditor({ taskId, initial, save }: { taskId: string; initial: { id: string; text: string; done: boolean }[]; save: SaveChecklist }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Item[]>(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  const commit = (next: Item[], quiet = false) => {
    const before = items;
    setItems(next);
    start(async () => {
      try {
        const r = await save(
          taskId,
          next.map((i) => (i.id ? { id: i.id, text: i.text, done: i.done } : { text: i.text, done: i.done })),
        );
        if (!r.ok) {
          setItems(before);
          toast(r.message, { tone: "error" });
          return;
        }
        if (r.items) setItems(r.items);
        if (!quiet) toast(r.message, { tone: "success" });
      } catch {
        setItems(before);
        toast("We could not save the checklist. Try again in a moment.", { tone: "error" });
      }
    });
  };

  const done = items.filter((i) => i.done).length;
  const full = items.length >= CHECKLIST_MAX_ITEMS;

  return (
    <div aria-busy={pending || undefined}>
      {items.length > 0 ? (
        <p className="hq-check__summary mb-2" aria-live="polite">
          {done} of {items.length} done
        </p>
      ) : null}
      <ul className="hq-check">
        {items.map((item, i) => (
          <li key={item.id ?? `new-${i}`} className="hq-check__item" data-done={item.done || undefined}>
            <input
              type="checkbox"
              checked={item.done}
              disabled={pending}
              aria-label={`Done: ${item.text}`}
              onChange={(e) => commit(items.map((x, j) => (j === i ? { ...x, done: e.currentTarget.checked } : x)), true)}
            />
            <input
              className="hq-check__text-input"
              defaultValue={item.text}
              maxLength={CHECKLIST_TEXT_MAX}
              aria-label={`Checklist item ${i + 1}`}
              disabled={pending}
              onBlur={(e) => {
                const text = e.currentTarget.value.replace(/\s+/g, " ").trim();
                if (text === item.text) return;
                if (!text) {
                  e.currentTarget.value = item.text;
                  return;
                }
                commit(items.map((x, j) => (j === i ? { ...x, text } : x)));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="hq-check__move">
              <button type="button" className="hq-btn hq-btn--ghost hq-btn--sm" aria-label={`Move up: ${item.text}`} data-edge={i === 0 || undefined} disabled={pending || i === 0} onClick={() => commit(moveItem(items, i, -1), true)}>
                <Icon name="arrow-up" size={14} />
              </button>
              <button
                type="button"
                className="hq-btn hq-btn--ghost hq-btn--sm"
                aria-label={`Move down: ${item.text}`}
                data-edge={i === items.length - 1 || undefined}
                disabled={pending || i === items.length - 1}
                onClick={() => commit(moveItem(items, i, 1), true)}
              >
                <Icon name="arrow-down" size={14} />
              </button>
              <button type="button" className="hq-btn hq-btn--ghost hq-btn--sm" aria-label={`Remove: ${item.text}`} disabled={pending} onClick={() => commit(items.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {full ? (
        <p className="hq-prj-quiet mt-3">A checklist holds up to {CHECKLIST_MAX_ITEMS} items.</p>
      ) : (
        <form
          className="hq-prj-add mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.replace(/\s+/g, " ").trim();
            if (!text) return;
            setDraft("");
            commit([...items, { id: null, text, done: false }]);
          }}
        >
          <label htmlFor={`check-add-${taskId}`} className="sr-only">
            Add a checklist item
          </label>
          <input
            id={`check-add-${taskId}`}
            className="hq-prj-add__input"
            placeholder="Add an item"
            value={draft}
            maxLength={CHECKLIST_TEXT_MAX}
            disabled={pending}
            onChange={(e) => setDraft(e.currentTarget.value)}
          />
          <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm" disabled={pending || !draft.trim()}>
            <span className="hq-btn__label">Add</span>
          </button>
        </form>
      )}
    </div>
  );
}

export function CommentForm({ taskId, action }: { taskId: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  return (
    <form action={formAction} noValidate className="mt-4 grid gap-3">
      <FormSummary state={state} labels={{ body: "Comment" }} />
      <input type="hidden" name="id" value={taskId} />
      <Textarea name="body" idPrefix="comment" label="Add a comment" rows={3} maxLength={COMMENT_MAX} required error={fieldError(state, "body")} defaultValue={retained?.body ?? ""} />
      <div>
        <SubmitButton size="sm" pendingLabel="Adding comment">
          Add comment
        </SubmitButton>
      </div>
    </form>
  );
}
