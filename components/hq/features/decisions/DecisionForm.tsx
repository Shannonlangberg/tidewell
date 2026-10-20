"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import {
  DECISION_CATEGORIES,
  DECISION_CATEGORY_LABEL,
  DECISION_FORM_LABELS,
  DECISION_STATUS_LABEL,
  NOTE_MAX,
  OPEN_DECISION_STATUSES,
  TEXT_MAX,
  TITLE_MAX,
  type DecisionStatus,
} from "@/lib/hq/decisions/rules";
import { LinkButton } from "../../Button";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { RadioGroup } from "../../Choice";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The decision form, for recording and editing. One column: the decision in a sentence first, then
 * the category, the date and who decided, then what was decided and why. A Server Action form
 * (useActionState): after a failed save the server returns what was typed and every field gets it
 * back as its default (React 19 resets an uncontrolled form after an action).
 *
 * Status: proposed, decided or in effect here. Superseding and reversing are separate actions on
 * the decision's page (each needs a note); a superseded or reversed decision shows its status but
 * no status choice.
 */

export type DecisionFormInitial = {
  title: string;
  category: string;
  decisionDate: string;
  status: DecisionStatus;
  decisionMakerId: string;
  description: string;
  rationale: string;
};

export function DecisionForm({
  mode,
  action,
  initial,
  decisionId,
  version,
  staff,
  maxDate,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: DecisionFormInitial;
  decisionId?: string;
  /** updated_at when the form was loaded: the save is refused if someone changed it since. */
  version?: string;
  staff: readonly PickerOption[];
  /** The latest decision date allowed (today + 7). */
  maxDate: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback: string): string => (retained ? (retained[name] ?? "") : fallback);
  const closed = initial.status === "superseded" || initial.status === "reversed";
  const status = v("status", initial.status);

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={DECISION_FORM_LABELS} />
      {decisionId ? <input type="hidden" name="id" value={decisionId} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}

      <TextInput
        name="title"
        label="Decision"
        required
        maxLength={TITLE_MAX}
        autoFocus={mode === "create"}
        error={fieldError(state, "title")}
        defaultValue={v("title", initial.title)}
        hint="The decision in one sentence, for example: We will offer long-term residential management first."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          name="category"
          label="Category"
          required
          placeholder="Choose a category"
          options={DECISION_CATEGORIES.map((c) => ({ value: c, label: DECISION_CATEGORY_LABEL[c] }))}
          error={fieldError(state, "category")}
          defaultValue={v("category", initial.category)}
          key={`category-${v("category", initial.category)}`}
        />
        <DateInput
          name="decision_date"
          label="Decision date"
          required
          max={maxDate}
          error={fieldError(state, "decision_date")}
          defaultValue={v("decision_date", initial.decisionDate)}
          hint="When it was decided. At most a week ahead."
        />
      </div>

      <NativeSelectPicker
        name="decision_maker_id"
        label="Decision maker"
        required
        placeholder="Choose who decided"
        options={staff}
        error={fieldError(state, "decision_maker_id")}
        defaultValue={v("decision_maker_id", initial.decisionMakerId)}
      />

      {closed ? (
        <div className="grid gap-1.5">
          <p className="hq-field__label">Status</p>
          <p className="text-[15px] font-medium">{DECISION_STATUS_LABEL[initial.status]}</p>
          <p className="hq-field__hint">A {DECISION_STATUS_LABEL[initial.status].toLowerCase()} decision keeps its status. You can still correct its wording.</p>
        </div>
      ) : (
        <RadioGroup
          key={`status-${status}`}
          name="status"
          legend="Status"
          segmented
          defaultValue={(OPEN_DECISION_STATUSES as readonly string[]).includes(status) ? status : "decided"}
          error={fieldError(state, "status")}
          options={OPEN_DECISION_STATUSES.map((s) => ({ value: s, label: DECISION_STATUS_LABEL[s] }))}
        />
      )}

      <Textarea
        name="description"
        label="What was decided"
        rows={4}
        maxLength={TEXT_MAX}
        error={fieldError(state, "description")}
        defaultValue={v("description", initial.description)}
        hint="Optional. The detail: what changes, for whom, from when."
      />

      <Textarea
        name="rationale"
        label="Why"
        rows={4}
        maxLength={TEXT_MAX}
        error={fieldError(state, "rationale")}
        defaultValue={v("rationale", initial.rationale)}
        hint="Optional. The reasons, so anyone reading later understands it."
      />

      <TextInput
        name="note"
        label={mode === "create" ? "Note for the history" : "Note about this change"}
        maxLength={NOTE_MAX}
        error={fieldError(state, "note")}
        defaultValue={v("note", "")}
        hint="Optional. Shown in the decision's history, for example where it was agreed."
      />

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={mode === "create" ? "Recording decision" : "Saving decision"}>{mode === "create" ? "Record decision" : "Save changes"}</SubmitButton>
      </FormActions>
    </form>
  );
}
