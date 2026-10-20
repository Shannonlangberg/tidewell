"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import { BODY_MAX, KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABEL, KNOWLEDGE_FORM_LABELS, NOTE_MAX, SUMMARY_MAX, TITLE_MAX } from "@/lib/hq/knowledge/rules";
import { LinkButton } from "../../Button";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The knowledge document form, for writing a new document and for editing one. One column: title,
 * category and summary, owner and review date, then the text with a short guide to the markdown it
 * understands, then (on edit) what changed. A Server Action form (useActionState): after a failed save
 * the server returns what was typed and every field gets it back.
 *
 * On edit the form says which version it starts from; saving makes a NEW draft version, and staff keep
 * reading the approved one until someone approves it.
 */

export type KnowledgeFormInitial = {
  title: string;
  category: string;
  summary: string;
  ownerId: string;
  reviewDue: string;
  body: string;
};

function MarkdownHint() {
  return (
    <span className="hq-kb-hint">
      Start with <code>Purpose:</code> and one line. Then short sections: <code>## Heading</code>, <code>- bullet</code>, <code>1. step</code>, <code>- [ ] checklist item</code>,{" "}
      <code>**bold**</code>, <code>*italic*</code>, <code>[link text](https://...)</code>, and <code>---</code> for a dividing line. Nothing else is formatted.
    </span>
  );
}

export function KnowledgeForm({
  mode,
  action,
  initial,
  documentId,
  baseVersion,
  staff,
  today,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: KnowledgeFormInitial;
  documentId?: string;
  /** The version the edit starts from: the save is refused if someone saved a newer one since. */
  baseVersion?: number;
  staff: readonly PickerOption[];
  today: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback: string): string => (retained ? (retained[name] ?? "") : fallback);

  return (
    <form action={formAction} noValidate className="grid max-w-3xl gap-5">
      <FormSummary state={state} labels={KNOWLEDGE_FORM_LABELS} />
      {documentId ? <input type="hidden" name="id" value={documentId} /> : null}
      {baseVersion ? <input type="hidden" name="base_version" value={String(baseVersion)} /> : null}

      <TextInput
        name="title"
        label="Title"
        required
        maxLength={TITLE_MAX}
        autoFocus={mode === "create"}
        error={fieldError(state, "title")}
        defaultValue={v("title", initial.title)}
        hint="Plain words people would search for, for example: Landlord onboarding checklist."
      />

      <Select
        name="category"
        label="Category"
        required
        placeholder="Choose a category"
        options={KNOWLEDGE_CATEGORIES.map((c) => ({ value: c, label: KNOWLEDGE_CATEGORY_LABEL[c] }))}
        error={fieldError(state, "category")}
        defaultValue={v("category", initial.category)}
        key={`category-${v("category", initial.category)}`}
      />

      <TextInput
        name="summary"
        label="Summary"
        maxLength={SUMMARY_MAX}
        error={fieldError(state, "summary")}
        defaultValue={v("summary", initial.summary)}
        hint="Optional. One sentence on what this is for and who uses it."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <NativeSelectPicker
          name="owner_id"
          label="Owner"
          required
          placeholder="Choose who keeps it up to date"
          options={staff}
          error={fieldError(state, "owner_id")}
          defaultValue={v("owner_id", initial.ownerId)}
        />
        <DateInput
          name="review_due"
          label="Review date"
          min={today}
          error={fieldError(state, "review_due")}
          defaultValue={v("review_due", initial.reviewDue)}
          hint="Optional. When it should next be checked."
        />
      </div>

      <Textarea
        name="body"
        label="Text"
        required
        rows={18}
        maxLength={BODY_MAX}
        className="hq-kb-body-input"
        error={fieldError(state, "body")}
        defaultValue={v("body", initial.body)}
        hint={<MarkdownHint />}
      />

      <TextInput
        name="change_note"
        label={mode === "create" ? "Note for the history" : "What changed"}
        required={mode === "edit"}
        maxLength={NOTE_MAX}
        error={fieldError(state, "change_note")}
        defaultValue={v("change_note", "")}
        hint={mode === "create" ? "Optional. Shown in the version history (default: First draft)." : "Required. A few words for the version history, for example: Added the Ailo invitation step."}
      />

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel="Saving the draft">{mode === "create" ? "Save as draft" : "Save as a new draft"}</SubmitButton>
      </FormActions>
    </form>
  );
}
