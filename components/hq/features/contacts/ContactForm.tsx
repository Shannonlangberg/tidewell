"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveContact } from "@/app/hq/(app)/growth/contacts/actions";
import {
  CATEGORY_LABEL,
  PARTNER_CATEGORIES,
  PRIORITIES,
  PRIORITY_LABEL,
  REGION_SUGGESTIONS,
  RELATIONSHIP_LABEL,
  RELATIONSHIP_STATUSES,
  type PartnerCategory,
  type Priority,
  type RelationshipStatus,
} from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { retainedList, retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { Checkbox, CheckboxGroup } from "../../Choice";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { LinkButton } from "../../Button";
import { InlineNote, SectionLabel } from "../../Primitives";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { Textarea, TextInput } from "../../TextInput";

/*
 * Add or edit a contact: one screen, about a minute.
 *
 * Validation happens on the server (saveContact). After a failed save the typed values come
 * back and become each field's default, so nothing is lost. A duplicate (the same name at the
 * same organisation, or the same email) is shown as "this looks like someone you already have"
 * with a link to the existing record.
 */

export type ContactFormInitial = {
  id?: string;
  /** updated_at as loaded: the save refuses if someone else changed the contact meanwhile. */
  version?: string;
  fullName: string;
  organisationId: string;
  position: string;
  categories: readonly PartnerCategory[];
  phone: string;
  email: string;
  website: string;
  location: string;
  serviceRegion: string;
  ownerId: string;
  status: RelationshipStatus;
  priority: Priority;
  notes: string;
  isPrimary: boolean;
};

const LABELS = {
  full_name: "Full name",
  organisation_id: "Organisation",
  new_organisation_name: "New organisation",
  position: "Position",
  categories: "Categories",
  phone: "Phone",
  email: "Email",
  website: "Website",
  location: "Location",
  service_region: "Service region",
  relationship_owner_id: "Relationship owner",
  relationship_status: "Status",
  priority: "Priority",
  notes: "Notes",
  is_primary: "Primary contact",
};

type Duplicate = { kind: "contact" | "organisation"; id: string; name: string; organisation?: string | null };

export function ContactForm({
  initial,
  organisations,
  staff,
  cancelHref,
}: {
  initial: ContactFormInitial;
  organisations: readonly PickerOption[];
  staff: readonly PickerOption[];
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(saveContact, idle);
  const editing = Boolean(initial.id);

  // After a failed save the typed values come back; before one, the form shows `initial`.
  const failed = Boolean(state.data?.values);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const text = (name: string, fallback: string) => (failed ? retainedText(values, name) : fallback);
  const duplicate = state.data?.duplicate as Duplicate | undefined;

  return (
    <form action={formAction} noValidate className="grid max-w-3xl gap-8">
      <FormSummary state={state} labels={LABELS} />

      {duplicate ? (
        <InlineNote>
          {duplicate.kind === "contact" ? "This looks like someone you already have: " : "This looks like an organisation you already have: "}
          <Link href={`/hq/growth/${duplicate.kind === "contact" ? "contacts" : "organisations"}/${duplicate.id}`} className="font-medium underline underline-offset-2">
            {duplicate.name}
          </Link>
          {duplicate.organisation ? `, ${duplicate.organisation}` : ""}. Open their record instead of adding a second one.
        </InlineNote>
      ) : null}

      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.version ? <input type="hidden" name="version" value={initial.version} /> : null}

      <section aria-labelledby="who" className="grid gap-5">
        <SectionLabel as="h2" id="who" className="border-b border-line pb-3">
          Who they are
        </SectionLabel>
        <TextInput name="full_name" label="Full name" required maxLength={200} error={fieldError(state, "full_name")} defaultValue={text("full_name", initial.fullName)} data-autofocus />
        <div className="grid gap-5 sm:grid-cols-2">
          <NativeSelectPicker
            name="organisation_id"
            label="Organisation"
            placeholder="No organisation (independent)"
            options={organisations}
            error={fieldError(state, "organisation_id")}
            defaultValue={text("organisation_id", initial.organisationId)}
          />
          <TextInput
            name="new_organisation_name"
            label="Or add a new organisation"
            hint="Type a name to create it. Leave the list on “No organisation”."
            maxLength={200}
            error={fieldError(state, "new_organisation_name")}
            defaultValue={text("new_organisation_name", "")}
          />
        </div>
        <TextInput name="position" label="Position" maxLength={200} error={fieldError(state, "position")} defaultValue={text("position", initial.position)} />
        <Checkbox
          name="is_primary"
          label="Primary contact for this organisation"
          hint="The first person added at an organisation is its primary contact. Choosing this moves it from whoever holds it now."
          error={fieldError(state, "is_primary")}
          defaultChecked={failed ? retainedText(values, "is_primary") === "on" : initial.isPrimary}
        />
      </section>

      <section aria-labelledby="reach" className="grid gap-5">
        <SectionLabel as="h2" id="reach" className="border-b border-line pb-3">
          How to reach them
        </SectionLabel>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="phone" type="tel" label="Phone" error={fieldError(state, "phone")} defaultValue={text("phone", initial.phone)} maxLength={40} />
          <TextInput name="email" type="email" label="Email" error={fieldError(state, "email")} defaultValue={text("email", initial.email)} maxLength={254} />
        </div>
        <TextInput name="website" type="url" label="Website" error={fieldError(state, "website")} defaultValue={text("website", initial.website)} maxLength={300} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="location" label="Location" hint="A suburb or office address." error={fieldError(state, "location")} defaultValue={text("location", initial.location)} maxLength={300} />
          <div>
            <TextInput
              name="service_region"
              label="Service region"
              list="contact-region-suggestions"
              error={fieldError(state, "service_region")}
              defaultValue={text("service_region", initial.serviceRegion)}
              maxLength={120}
            />
            <datalist id="contact-region-suggestions">
              {REGION_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        </div>
      </section>

      <section aria-labelledby="rel" className="grid gap-5">
        <SectionLabel as="h2" id="rel" className="border-b border-line pb-3">
          The relationship
        </SectionLabel>
        <CheckboxGroup
          name="categories"
          legend="Categories"
          required
          inline
          error={fieldError(state, "categories")}
          defaultValue={failed ? retainedList(values, "categories") : initial.categories}
          options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
        <div className="grid gap-5 sm:grid-cols-3">
          <NativeSelectPicker
            name="relationship_owner_id"
            label="Relationship owner"
            placeholder="No owner"
            options={staff}
            error={fieldError(state, "relationship_owner_id")}
            defaultValue={text("relationship_owner_id", initial.ownerId)}
          />
          <Select
            name="relationship_status"
            label="Status"
            options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABEL[s] }))}
            error={fieldError(state, "relationship_status")}
            defaultValue={text("relationship_status", initial.status)}
          />
          <Select
            name="priority"
            label="Priority"
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            error={fieldError(state, "priority")}
            defaultValue={text("priority", initial.priority)}
          />
        </div>
        <Textarea name="notes" label="Notes" rows={4} maxLength={4000} error={fieldError(state, "notes")} defaultValue={text("notes", initial.notes)} />
      </section>

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={editing ? "Saving contact" : "Adding contact"}>{editing ? "Save changes" : "Add contact"}</SubmitButton>
      </FormActions>
    </form>
  );
}
