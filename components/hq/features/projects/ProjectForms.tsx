"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import {
  DOC_TITLE_MAX,
  DOC_URL_MAX,
  MILESTONE_DESCRIPTION_MAX,
  NAME_MAX,
  NOTES_MAX,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_FORM_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  TASK_PRIORITY_WORD,
} from "@/lib/hq/projects/rules";
import type { ProjectStatus } from "@/lib/hq/projects/types";
import type { TaskPriority } from "@/lib/hq/constants";
import { LinkButton } from "../../Button";
import { RadioGroup } from "../../Choice";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The project form (create and edit), the milestone form and the document-link form. Server Action
 * forms (useActionState): after a failed save the server returns what was typed and every field is
 * given it back (React 19 resets an uncontrolled form after an action). The server validates
 * everything again; the database has the last word.
 */

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export type ProjectFormInitial = {
  name: string;
  description: string;
  ownerId: string;
  status: ProjectStatus;
  priority: TaskPriority;
  startDate: string;
  targetDate: string;
  notes: string;
};

const PRIORITY_ORDER: readonly TaskPriority[] = ["low", "normal", "high", "urgent"];

export function ProjectForm({
  mode,
  action,
  initial,
  projectId,
  version,
  staff,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: Action;
  initial: ProjectFormInitial;
  projectId?: string;
  version?: number;
  staff: readonly PickerOption[];
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback: string): string => (retained ? (retained[name] ?? "") : fallback);
  const status = v("status", initial.status);
  const priority = v("priority", initial.priority);

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={PROJECT_FORM_LABELS} />
      {projectId ? <input type="hidden" name="id" value={projectId} /> : null}
      {version ? <input type="hidden" name="version" value={String(version)} /> : null}

      <TextInput
        name="name"
        label="Name"
        required
        maxLength={NAME_MAX}
        autoFocus={mode === "create"}
        error={fieldError(state, "name")}
        defaultValue={v("name", initial.name)}
        hint="A short name people will recognise, for example: Open the Moonta office."
      />

      <Textarea
        name="description"
        label="What it is for"
        rows={3}
        maxLength={PROJECT_DESCRIPTION_MAX}
        error={fieldError(state, "description")}
        defaultValue={v("description", initial.description)}
        hint="Optional. One or two sentences on the outcome you want."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <NativeSelectPicker
          name="owner_id"
          label="Owner"
          placeholder="No owner"
          options={staff}
          error={fieldError(state, "owner_id")}
          defaultValue={v("owner_id", initial.ownerId)}
          hint="The person who keeps it moving."
        />
        <Select
          name="status"
          label="Status"
          options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABEL[s] }))}
          error={fieldError(state, "status")}
          defaultValue={(PROJECT_STATUSES as readonly string[]).includes(status) ? status : "planning"}
        />
      </div>

      <RadioGroup
        key={`priority-${priority}`}
        name="priority"
        legend="Priority"
        segmented
        defaultValue={(PRIORITY_ORDER as readonly string[]).includes(priority) ? priority : "normal"}
        error={fieldError(state, "priority")}
        options={PRIORITY_ORDER.map((p) => ({ value: p, label: TASK_PRIORITY_WORD[p] }))}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <DateInput name="start_date" label="Start date" error={fieldError(state, "start_date")} defaultValue={v("start_date", initial.startDate)} hint="Optional." />
        <DateInput name="target_date" label="Target date" error={fieldError(state, "target_date")} defaultValue={v("target_date", initial.targetDate)} hint="Optional. When it should be finished." />
      </div>

      <Textarea
        name="notes"
        label="Notes"
        rows={8}
        maxLength={NOTES_MAX}
        error={fieldError(state, "notes")}
        defaultValue={v("notes", initial.notes)}
        hint="Optional. Background, decisions and anything useful. Simple formatting works: **bold**, *italic*, lists starting with -, and [links](https://...)."
      />

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={mode === "create" ? "Creating project" : "Saving project"}>{mode === "create" ? "Create project" : "Save changes"}</SubmitButton>
      </FormActions>
    </form>
  );
}

export function MilestoneForm({ projectId, action, returnView }: { projectId: string; action: Action; returnView?: string }) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  return (
    <form action={formAction} noValidate className="grid max-w-xl gap-4 pt-3">
      <FormSummary state={state} labels={{ name: "Milestone name", description: "Description", due_date: "Due date" }} />
      <input type="hidden" name="project_id" value={projectId} />
      {returnView ? <input type="hidden" name="return_view" value={returnView} /> : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <TextInput name="name" idPrefix="ms" label="Milestone name" required maxLength={NAME_MAX} error={fieldError(state, "name")} defaultValue={retained?.name ?? ""} hint="A stage of the work, for example: Licensing." />
        <DateInput name="due_date" idPrefix="ms" label="Due date" error={fieldError(state, "due_date")} defaultValue={retained?.due_date ?? ""} hint="Optional." />
      </div>
      <TextInput name="description" idPrefix="ms" label="Description" maxLength={MILESTONE_DESCRIPTION_MAX} error={fieldError(state, "description")} defaultValue={retained?.description ?? ""} hint="Optional." />
      <div>
        <SubmitButton size="sm" pendingLabel="Adding milestone">
          Add milestone
        </SubmitButton>
      </div>
    </form>
  );
}

export function DocumentForm({ projectId, action }: { projectId: string; action: Action }) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  return (
    <details className="mt-3" open={state.ok === false && !!state.message ? true : undefined}>
      <summary className="hq-prj-section__link inline-flex min-h-11 cursor-pointer items-center">Add a document link</summary>
      <form action={formAction} noValidate className="hq-prj-inline-form">
        <FormSummary state={state} labels={{ title: "Title", url: "Link" }} />
        <input type="hidden" name="id" value={projectId} />
        <TextInput name="title" idPrefix="doc" label="Title" required maxLength={DOC_TITLE_MAX} error={fieldError(state, "title")} defaultValue={retained?.title ?? ""} />
        <TextInput name="url" idPrefix="doc" label="Link" type="url" inputMode="url" required maxLength={DOC_URL_MAX} error={fieldError(state, "url")} defaultValue={retained?.url ?? ""} hint="A full https:// address." />
        <div>
          <SubmitButton size="sm" pendingLabel="Adding link">
            Add link
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
