"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import {
  DECISIONS_MAX,
  FORM_ACTION_ROWS,
  FORM_CONTACT_ROWS,
  LOCATION_MAX,
  MEETING_FORM_LABELS,
  MEETING_TYPES,
  MEETING_TYPE_LABEL,
  MINUTES_MAX,
  NOTE_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
} from "@/lib/hq/meetings/rules";
import { LinkButton } from "../../Button";
import { Checkbox, CheckboxGroup } from "../../Choice";
import { Field, FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { SectionLabel } from "../../Primitives";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The meeting form, for recording a meeting by hand and for editing one. Most meetings arrive from
 * ChatGPT or Claude (the assistant writes the minutes and saves them through the HQ connector); this
 * form is for typing one in, or correcting what was saved. HQ records no audio.
 *
 * One column: what and when first, then the short summary (what lists and Today show), then the
 * minutes and decisions. Create only: who was there, what it was about (the linked records log one
 * interaction each), and up to four action rows that become real tasks. On edit, attendees, links and
 * actions are managed on the meeting's page.
 *
 * A Server Action form (useActionState): after a failed save the server returns what was typed and
 * every field gets it back as its default (React 19 resets an uncontrolled form after an action).
 */

export type MeetingFormInitial = {
  title: string;
  meetingType: string;
  heldDate: string;
  heldTime: string;
  durationMinutes: string;
  location: string;
  summary: string;
  minutes: string;
  decisionsText: string;
  confidential: boolean;
};

export type MeetingFormOptions = {
  staff: readonly PickerOption[];
  contacts: readonly PickerOption[];
  organisations: readonly PickerOption[];
  leads: readonly PickerOption[];
  contractors: readonly PickerOption[];
};

export function MeetingForm({
  mode,
  action,
  initial,
  meetingId,
  version,
  options,
  meStaffId,
  canTasks,
  canChangeConfidential,
  maxDate,
  cancelHref,
}: {
  mode: "create" | "edit";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: MeetingFormInitial;
  meetingId?: string;
  /** The meeting's version when the form was loaded: the save is refused if someone changed it since. */
  version?: number;
  options: MeetingFormOptions;
  /** Ticked as an attendee to begin with (create). */
  meStaffId: string;
  /** The person may create tasks (the action rows). */
  canTasks: boolean;
  /** Edit: the person recorded it or is a director or administrator. */
  canChangeConfidential: boolean;
  /** Today + 1 (a meeting is recorded after it is held). */
  maxDate: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback: string): string => (retained ? (retained[name] ?? "") : fallback);
  const checked = (name: string, fallback: boolean): boolean => (retained ? retained[name] === "on" : fallback);
  const labels: Record<string, string> = { ...MEETING_FORM_LABELS };
  for (let i = 1; i <= FORM_ACTION_ROWS; i += 1) {
    labels[`action_title_${i}`] = `Action ${i}`;
    labels[`action_assignee_${i}`] = `Action ${i}: who`;
    labels[`action_due_${i}`] = `Action ${i}: due`;
  }

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={labels} />
      {meetingId ? <input type="hidden" name="id" value={meetingId} /> : null}
      {version ? <input type="hidden" name="version" value={String(version)} /> : null}

      <TextInput
        name="title"
        label="Title"
        required
        maxLength={TITLE_MAX}
        autoFocus={mode === "create"}
        error={fieldError(state, "title")}
        defaultValue={v("title", initial.title)}
        hint="Short and specific, for example: Coffee with Tim Hosking, eXp Realty."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          name="meeting_type"
          label="Kind of meeting"
          required
          placeholder="Choose one"
          options={MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABEL[t] }))}
          error={fieldError(state, "meeting_type")}
          defaultValue={v("meeting_type", initial.meetingType)}
          key={`type-${v("meeting_type", initial.meetingType)}`}
        />
        <TextInput
          name="location"
          label="Where"
          maxLength={LOCATION_MAX}
          error={fieldError(state, "location")}
          defaultValue={v("location", initial.location)}
          hint="For example: Coffee at Kadina, Phone, Zoom."
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <DateInput name="held_date" label="Date" required max={maxDate} error={fieldError(state, "held_date")} defaultValue={v("held_date", initial.heldDate)} />
        <Field name="held_time" label="Time" error={fieldError(state, "held_time")} hint="Optional. 9:00 am if left empty.">
          {(a11y) => <input {...a11y} type="time" name="held_time" className="hq-input" defaultValue={v("held_time", initial.heldTime)} />}
        </Field>
        <TextInput
          name="duration_minutes"
          label="Minutes long"
          type="number"
          min={1}
          max={1440}
          error={fieldError(state, "duration_minutes")}
          defaultValue={v("duration_minutes", initial.durationMinutes)}
          hint="Optional."
        />
      </div>

      <Textarea
        name="summary"
        label="Summary"
        required
        rows={3}
        maxLength={SUMMARY_MAX}
        error={fieldError(state, "summary")}
        defaultValue={v("summary", initial.summary)}
        hint="Two or three short lines: what it was about and what came out of it. This is what lists and Today show."
      />

      <Textarea
        name="minutes"
        label="Minutes"
        rows={12}
        maxLength={MINUTES_MAX}
        error={fieldError(state, "minutes")}
        defaultValue={v("minutes", initial.minutes)}
        hint="Optional. Use ## for headings (## Agenda, ## Discussion, ## Next steps), - for bullet points, **bold**. Not a transcript: HQ keeps the minutes only."
      />

      <Textarea
        name="decisions_text"
        label="Decisions"
        rows={4}
        maxLength={DECISIONS_MAX}
        error={fieldError(state, "decisions_text")}
        defaultValue={v("decisions_text", initial.decisionsText)}
        hint="Optional. One per line. A decision can be added to the Decisions register from the meeting's page."
      />

      {mode === "create" || canChangeConfidential ? (
        <>
          {mode === "edit" ? <input type="hidden" name="confidential_shown" value="1" /> : null}
          <Checkbox
            key={`conf-${checked("confidential", initial.confidential)}`}
            name="confidential"
            label="Confidential"
            hint="Only the team members who were there, you, and directors and administrators can see it. Partner timelines show only that a meeting happened."
            defaultChecked={checked("confidential", initial.confidential)}
            error={fieldError(state, "confidential")}
          />
        </>
      ) : null}

      {mode === "create" ? (
        <>
          <section aria-labelledby="mtg-who" className="grid gap-5">
            <SectionLabel as="h2" id="mtg-who" className="border-b border-line pb-3">
              Who was there
            </SectionLabel>
            {options.staff.length > 0 ? (
              <CheckboxGroup
                name="staff_ids"
                legend="From the team"
                inline
                options={options.staff.map((s) => ({ value: s.value, label: s.label }))}
                defaultValue={retained ? [] : [meStaffId]}
              />
            ) : null}
            {options.contacts.length > 0 ? (
              <div className="grid gap-2">
                <p className="hq-field__label m-0">Contacts</p>
                <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: FORM_CONTACT_ROWS }, (_, i) => (
                  <NativeSelectPicker
                    key={i}
                    name="contact_ids"
                    idPrefix={`c${i}`}
                    label={`Contact ${i + 1}`}
                    hideLabel
                    placeholder={i === 0 ? "Choose a contact" : "Another contact (optional)"}
                    options={options.contacts}
                  />
                ))}
              </div>
              </div>
            ) : null}
            <Textarea
              name="external_names"
              label="Other attendees"
              rows={2}
              error={fieldError(state, "external_names")}
              defaultValue={v("external_names", "")}
              hint="People who are not in HQ, one per line. Saved as names only."
            />
          </section>

          {options.organisations.length + options.leads.length + options.contractors.length > 0 ? (
            <section aria-labelledby="mtg-about" className="grid gap-5">
              <SectionLabel as="h2" id="mtg-about" className="border-b border-line pb-3">
                What it was about
              </SectionLabel>
              <p className="hq-field__hint -mt-2">Each linked organisation, lead and contractor gets the meeting logged on its timeline, so &ldquo;last contacted&rdquo; stays right.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {options.organisations.length > 0 ? <NativeSelectPicker name="link_organisation" label="Organisation" placeholder="None" options={options.organisations} defaultValue={v("link_organisation", "")} /> : null}
                {options.leads.length > 0 ? <NativeSelectPicker name="link_opportunity" label="Lead" placeholder="None" options={options.leads} defaultValue={v("link_opportunity", "")} /> : null}
                {options.contractors.length > 0 ? <NativeSelectPicker name="link_contractor" label="Contractor" placeholder="None" options={options.contractors} defaultValue={v("link_contractor", "")} /> : null}
              </div>
              {options.contacts.length > 0 ? (
                <Checkbox name="link_contacts" label="Also log it on the contacts who attended" defaultChecked={checked("link_contacts", true)} />
              ) : null}
            </section>
          ) : null}

          {canTasks ? (
            <section aria-labelledby="mtg-actions" className="grid gap-1">
              <SectionLabel as="h2" id="mtg-actions" className="border-b border-line pb-3">
                Actions
              </SectionLabel>
              <p className="hq-field__hint mt-2">Optional. Each becomes a task with its owner and due date. Leave a row empty to skip it; more can be added on the meeting&rsquo;s page.</p>
              {Array.from({ length: FORM_ACTION_ROWS }, (_, idx) => {
                const i = idx + 1;
                return (
                  <div key={i} className="hq-mtg-action-row">
                    <TextInput name={`action_title_${i}`} label={`Action ${i}`} maxLength={TITLE_MAX} error={fieldError(state, `action_title_${i}`)} defaultValue={v(`action_title_${i}`, "")} />
                    <NativeSelectPicker
                      name={`action_assignee_${i}`}
                      idPrefix={`a${i}`}
                      label="Who"
                      placeholder="Me"
                      options={options.staff}
                      error={fieldError(state, `action_assignee_${i}`)}
                      defaultValue={v(`action_assignee_${i}`, "")}
                    />
                    <DateInput name={`action_due_${i}`} label="Due" error={fieldError(state, `action_due_${i}`)} defaultValue={v(`action_due_${i}`, "")} />
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      ) : (
        <TextInput
          name="change_note"
          label="What you changed"
          maxLength={NOTE_MAX}
          error={fieldError(state, "change_note")}
          defaultValue={v("change_note", "")}
          hint="Optional. Kept in the meeting's history, with the earlier version of the minutes."
        />
      )}

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={mode === "create" ? "Saving meeting" : "Saving changes"}>{mode === "create" ? "Save meeting" : "Save changes"}</SubmitButton>
      </FormActions>
    </form>
  );
}
