"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveOrganisation } from "@/app/hq/(app)/growth/organisations/actions";
import { CATEGORY_LABEL, PARTNER_CATEGORIES, REGION_SUGGESTIONS, type PartnerCategory } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { retainedList, retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { LinkButton } from "../../Button";
import { CheckboxGroup } from "../../Choice";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { Textarea, TextInput } from "../../TextInput";

/*
 * Add or edit an organisation. At least one category is required. Validation is on the
 * server (saveOrganisation); after a failed save the typed values come back, and a name that
 * already exists links to the existing organisation.
 */

export type OrganisationFormInitial = {
  id?: string;
  version?: string;
  name: string;
  categories: readonly PartnerCategory[];
  website: string;
  phone: string;
  email: string;
  location: string;
  serviceRegion: string;
  ownerId: string;
  notes: string;
};

const LABELS = {
  name: "Name",
  categories: "Categories",
  website: "Website",
  phone: "Phone",
  email: "Email",
  location: "Location",
  service_region: "Service region",
  relationship_owner_id: "Relationship owner",
  notes: "Notes",
};

export function OrganisationForm({ initial, staff, cancelHref }: { initial: OrganisationFormInitial; staff: readonly PickerOption[]; cancelHref: string }) {
  const [state, formAction] = useActionState(saveOrganisation, idle);
  const editing = Boolean(initial.id);
  const failed = Boolean(state.data?.values);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const text = (name: string, fallback: string) => (failed ? retainedText(values, name) : fallback);
  const duplicate = state.data?.duplicate as { id: string; name: string } | undefined;

  return (
    <form action={formAction} noValidate className="grid max-w-3xl gap-8">
      <FormSummary state={state} labels={LABELS} />
      {duplicate ? (
        <InlineNote>
          This looks like an organisation you already have:{" "}
          <Link href={`/hq/growth/organisations/${duplicate.id}`} className="font-medium underline underline-offset-2">
            {duplicate.name}
          </Link>
          . Open it instead of adding a second one.
        </InlineNote>
      ) : null}

      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.version ? <input type="hidden" name="version" value={initial.version} /> : null}

      <section className="grid gap-5">
        <TextInput name="name" label="Name" required maxLength={200} error={fieldError(state, "name")} defaultValue={text("name", initial.name)} data-autofocus />
        <CheckboxGroup
          name="categories"
          legend="Categories"
          required
          inline
          error={fieldError(state, "categories")}
          defaultValue={failed ? retainedList(values, "categories") : initial.categories}
          options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="phone" type="tel" label="Phone" maxLength={40} error={fieldError(state, "phone")} defaultValue={text("phone", initial.phone)} />
          <TextInput name="email" type="email" label="Email" maxLength={254} error={fieldError(state, "email")} defaultValue={text("email", initial.email)} />
        </div>
        <TextInput name="website" type="url" label="Website" maxLength={300} error={fieldError(state, "website")} defaultValue={text("website", initial.website)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="location" label="Location" hint="A suburb or office address." maxLength={300} error={fieldError(state, "location")} defaultValue={text("location", initial.location)} />
          <div>
            <TextInput
              name="service_region"
              label="Service region"
              list="organisation-region-suggestions"
              maxLength={120}
              error={fieldError(state, "service_region")}
              defaultValue={text("service_region", initial.serviceRegion)}
            />
            <datalist id="organisation-region-suggestions">
              {REGION_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
        </div>
        <NativeSelectPicker
          name="relationship_owner_id"
          label="Relationship owner"
          placeholder="No owner"
          options={staff}
          error={fieldError(state, "relationship_owner_id")}
          defaultValue={text("relationship_owner_id", initial.ownerId)}
        />
        <Textarea name="notes" label="Notes" rows={4} maxLength={4000} error={fieldError(state, "notes")} defaultValue={text("notes", initial.notes)} />
      </section>

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={editing ? "Saving organisation" : "Adding organisation"}>{editing ? "Save changes" : "Add organisation"}</SubmitButton>
      </FormActions>
    </form>
  );
}
