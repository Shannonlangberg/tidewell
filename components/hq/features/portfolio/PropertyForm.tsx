"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import {
  ADDRESS_MAX,
  AILO_REFERENCE_MAX,
  AILO_STATUSES,
  AILO_STATUS_LABEL,
  FEE_BASES,
  FEE_BASIS_LABEL,
  FEE_NOTES_MAX,
  MANAGED_STATUSES,
  MANAGED_STATUS_LABEL,
  NOTES_MAX,
  NOTE_MAX,
  OWNER_NAME_MAX,
  PROPERTY_FORM_LABELS,
  SERVICE_TYPES,
  SERVICE_TYPE_LABEL,
  START_STATUSES,
  SUBURB_MAX,
} from "@/lib/hq/portfolio/rules";
import { LinkButton } from "../../Button";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { RadioGroup } from "../../Choice";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The managed-property form, three ways:
 *   convert  from a signed opportunity: the address, suburb and owner come from the opportunity
 *            unless typed here (typed once, never twice);
 *   manual   a property signed before HQ: the address, the owner and a note saying where it came
 *            from are required;
 *   edit     every field as it should be after the save (a blank clears it).
 * A Server Action form (useActionState): after a failed save the server returns what was typed and
 * every field gets it back. Ailo is where rent, trust accounting and maintenance live; HQ only
 * records the reference, typed by a person.
 */

export type PropertyFormInitial = {
  propertyAddress: string;
  suburb: string;
  ownerContactId: string;
  ownerName: string;
  serviceType: string;
  feeBasis: string;
  feePercent: string;
  feeNotes: string;
  agreementSignedOn: string;
  managedFrom: string;
  status: string;
  endedOn: string;
  ailoReference: string;
  ailoStatus: string;
  notes: string;
};

export const EMPTY_PROPERTY: PropertyFormInitial = {
  propertyAddress: "",
  suburb: "",
  ownerContactId: "",
  ownerName: "",
  serviceType: "",
  feeBasis: "",
  feePercent: "",
  feeNotes: "",
  agreementSignedOn: "",
  managedFrom: "",
  status: "onboarding",
  endedOn: "",
  ailoReference: "",
  ailoStatus: "not_started",
  notes: "",
};

export function PropertyForm({
  mode,
  action,
  initial,
  propertyId,
  opportunityId,
  fromOpportunity,
  version,
  owners,
  today,
  cancelHref,
}: {
  mode: "convert" | "manual" | "edit";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: PropertyFormInitial;
  propertyId?: string;
  opportunityId?: string;
  /** What the opportunity already holds, shown as the defaults (convert only). */
  fromOpportunity?: { address: string | null; suburb: string | null; owner: string | null };
  version?: string;
  owners: readonly PickerOption[];
  today: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback: string): string => (retained ? (retained[name] ?? "") : fallback);
  const statuses = mode === "edit" ? MANAGED_STATUSES : START_STATUSES;
  const convert = mode === "convert";

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={PROPERTY_FORM_LABELS} />
      {propertyId ? <input type="hidden" name="id" value={propertyId} /> : null}
      {opportunityId ? <input type="hidden" name="opportunity_id" value={opportunityId} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}

      {mode === "manual" ? (
        <Textarea
          name="manual_origin_note"
          label="Where this property came from"
          required
          rows={2}
          maxLength={NOTE_MAX}
          autoFocus
          error={fieldError(state, "manual_origin_note")}
          defaultValue={v("manual_origin_note", "")}
          hint="Required for a property signed before HQ, for example: Signed in March 2026 on a paper agreement."
        />
      ) : null}

      <RadioGroup
        key={`service-${v("service_type", initial.serviceType)}`}
        name="service_type"
        legend="Service"
        segmented
        defaultValue={v("service_type", initial.serviceType) || undefined}
        error={fieldError(state, "service_type")}
        options={SERVICE_TYPES.map((s) => ({ value: s, label: SERVICE_TYPE_LABEL[s] }))}
      />

      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextInput
          name="property_address"
          label="Property address"
          required={!convert}
          maxLength={ADDRESS_MAX}
          error={fieldError(state, "property_address")}
          defaultValue={v("property_address", initial.propertyAddress)}
          hint={convert ? (fromOpportunity?.address ? `Leave blank to use the lead's: ${fromOpportunity.address}.` : "The lead has no address recorded, so enter it here.") : undefined}
        />
        <TextInput
          name="suburb"
          label="Suburb"
          maxLength={SUBURB_MAX}
          error={fieldError(state, "suburb")}
          defaultValue={v("suburb", initial.suburb)}
          hint={convert && fromOpportunity?.suburb ? `Blank uses ${fromOpportunity.suburb}.` : undefined}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <NativeSelectPicker
          name="owner_contact_id"
          label="Owner (a contact)"
          placeholder={owners.length ? "Choose a contact" : "No landlord contacts yet"}
          options={owners}
          error={fieldError(state, "owner_contact_id")}
          defaultValue={v("owner_contact_id", initial.ownerContactId)}
        />
        <TextInput
          name="owner_name"
          label="Or the owner's name"
          maxLength={OWNER_NAME_MAX}
          error={fieldError(state, "owner_name")}
          defaultValue={v("owner_name", initial.ownerName)}
          hint={convert && fromOpportunity?.owner ? `Blank uses ${fromOpportunity.owner}.` : "Used when the owner is not a contact in HQ."}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          name="status"
          label="Status"
          required
          options={statuses.map((s) => ({ value: s, label: MANAGED_STATUS_LABEL[s] }))}
          error={fieldError(state, "status")}
          defaultValue={v("status", initial.status)}
          key={`status-${v("status", initial.status)}`}
          hint={mode === "edit" ? "Reopening an ended property needs a director or administrator." : "Onboarding until management starts."}
        />
        <DateInput
          name="managed_from"
          label="Managed from"
          error={fieldError(state, "managed_from")}
          defaultValue={v("managed_from", initial.managedFrom)}
          hint="Needed to mark it active (today or earlier)."
        />
        <DateInput
          name="agreement_signed_on"
          label="Agreement signed"
          max={today}
          error={fieldError(state, "agreement_signed_on")}
          defaultValue={v("agreement_signed_on", initial.agreementSignedOn)}
          hint={convert ? "Blank uses the date the lead was signed." : "Optional."}
        />
        {mode === "edit" ? (
          <DateInput
            name="ended_on"
            label="Ended on"
            max={today}
            error={fieldError(state, "ended_on")}
            defaultValue={v("ended_on", initial.endedOn)}
            hint="Only when the status is Ended."
          />
        ) : null}
      </div>

      <fieldset className="grid gap-5 border-0 p-0">
        <legend className="hq-field__label mb-2">Fee</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Select
            name="fee_basis"
            label="Fee basis"
            placeholder="Not recorded"
            options={FEE_BASES.map((b) => ({ value: b, label: FEE_BASIS_LABEL[b] }))}
            error={fieldError(state, "fee_basis")}
            defaultValue={v("fee_basis", initial.feeBasis)}
            key={`fee-${v("fee_basis", initial.feeBasis)}`}
          />
          <TextInput
            name="fee_percent"
            label="Percentage of rent"
            inputMode="decimal"
            maxLength={8}
            error={fieldError(state, "fee_percent")}
            defaultValue={v("fee_percent", initial.feePercent)}
            hint="For example 8.8. Only for a percentage-of-rent fee."
          />
        </div>
        <TextInput name="fee_notes" label="Fee notes" maxLength={FEE_NOTES_MAX} error={fieldError(state, "fee_notes")} defaultValue={v("fee_notes", initial.feeNotes)} hint="Optional, for example a flat fee amount or what is included." />
      </fieldset>

      <fieldset className="grid gap-4 border-0 p-0">
        <legend className="hq-field__label mb-2">Ailo</legend>
        <InlineNote>Ailo is where rent, trust accounting and maintenance live; HQ only records the reference.</InlineNote>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            name="ailo_reference"
            label="Ailo reference"
            maxLength={AILO_REFERENCE_MAX}
            error={fieldError(state, "ailo_reference")}
            defaultValue={v("ailo_reference", initial.ailoReference)}
            hint="As shown in Ailo, typed by you. Never synced."
          />
          {convert ? null : (
            <Select
              name="ailo_status"
              label="Ailo status"
              options={AILO_STATUSES.map((s) => ({ value: s, label: AILO_STATUS_LABEL[s] }))}
              error={fieldError(state, "ailo_status")}
              defaultValue={v("ailo_status", initial.ailoStatus)}
              key={`ailo-${v("ailo_status", initial.ailoStatus)}`}
              hint="Live needs the reference."
            />
          )}
        </div>
      </fieldset>

      <Textarea name="notes" label="Notes" rows={3} maxLength={NOTES_MAX} error={fieldError(state, "notes")} defaultValue={v("notes", initial.notes)} hint="Optional. Business notes only: tenancy, rent and maintenance stay in Ailo." />

      {mode === "edit" ? (
        <TextInput name="note" label="Note about this change" maxLength={NOTE_MAX} error={fieldError(state, "note")} defaultValue={v("note", "")} hint="Optional. Kept in the audit log." />
      ) : null}

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={mode === "edit" ? "Saving property" : "Recording property"}>
          {mode === "edit" ? "Save changes" : convert ? "Make it a managed property" : "Record property"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}
