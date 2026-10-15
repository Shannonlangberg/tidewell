"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveContractor } from "@/app/hq/(app)/partners/actions";
import { CONTRACTOR_CATEGORIES, CONTRACTOR_CATEGORY_LABEL, type ContractorCategory } from "@/lib/hq/constants";
import { CONTRACTOR_FORM_LABELS } from "@/lib/hq/contractors/form";
import { idle } from "@/lib/hq/forms";
import { retainedList, retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { CheckboxGroup, RadioGroup } from "../../Choice";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { LinkButton } from "../../Button";
import { InlineNote, SectionLabel } from "../../Primitives";
import { NativeSelectPicker, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * Add or edit a contractor: one screen. Validation happens on the server (saveContractor). After a
 * failed save the typed values come back and become each field's default, so nothing is lost.
 *
 * Unknown stays unknown: a blank rate is "not recorded" (not $0), "Not known" is a real answer for
 * emergency call-outs, and a blank ABN is allowed. Money is typed in dollars and stored as cents.
 * Status is not edited here: a contractor starts as a prospect and moves through its own actions.
 */

export type ContractorFormInitial = {
  id?: string;
  /** updated_at as loaded: the save refuses if someone else changed the contractor meanwhile. */
  version?: string;
  businessName: string;
  primaryContactName: string;
  phone: string;
  email: string;
  website: string;
  abn: string;
  categories: readonly ContractorCategory[];
  serviceSuburbs: string;
  serviceRegions: string;
  /** "yes" | "no" | "unknown" */
  emergency: "yes" | "no" | "unknown";
  businessHours: string;
  hourlyRate: string;
  calloutFee: string;
  afterHoursFee: string;
  minimumCharge: string;
  invoiceTerms: string;
  licenceDetails: string;
  licenceExpiresOn: string;
  insuranceDetails: string;
  insuranceExpiresOn: string;
  ownerId: string;
  lastJobDate: string;
  internalNotes: string;
};

export const BLANK_CONTRACTOR: ContractorFormInitial = {
  businessName: "",
  primaryContactName: "",
  phone: "",
  email: "",
  website: "",
  abn: "",
  categories: [],
  serviceSuburbs: "",
  serviceRegions: "",
  emergency: "unknown",
  businessHours: "",
  hourlyRate: "",
  calloutFee: "",
  afterHoursFee: "",
  minimumCharge: "",
  invoiceTerms: "",
  licenceDetails: "",
  licenceExpiresOn: "",
  insuranceDetails: "",
  insuranceExpiresOn: "",
  ownerId: "",
  lastJobDate: "",
  internalNotes: "",
};

export function ContractorForm({
  initial,
  staff,
  cancelHref,
  today,
}: {
  initial: ContractorFormInitial;
  staff: readonly PickerOption[];
  cancelHref: string;
  /** Today in the person's time zone: a job cannot have happened after it. */
  today: string;
}) {
  const [state, formAction] = useActionState(saveContractor, idle);
  const editing = Boolean(initial.id);

  const failed = Boolean(state.data?.values);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const text = (name: string, fallback: string) => (failed ? retainedText(values, name) : fallback);
  const duplicate = state.data?.duplicate as { id: string; name: string } | undefined;

  return (
    <form action={formAction} noValidate className="grid max-w-3xl gap-8">
      <FormSummary state={state} labels={CONTRACTOR_FORM_LABELS} />

      {duplicate ? (
        <InlineNote>
          This looks like a contractor you already have:{" "}
          <Link href={`/hq/partners/${duplicate.id}`} className="font-medium underline underline-offset-2">
            {duplicate.name}
          </Link>
          . Open their record instead of adding a second one.
        </InlineNote>
      ) : null}

      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.version ? <input type="hidden" name="version" value={initial.version} /> : null}

      <section aria-labelledby="who" className="grid gap-5">
        <SectionLabel as="h2" id="who" className="border-b border-line pb-3">
          The business
        </SectionLabel>
        <TextInput name="business_name" label="Business name" required maxLength={200} error={fieldError(state, "business_name")} defaultValue={text("business_name", initial.businessName)} data-autofocus />
        <TextInput name="primary_contact_name" label="Contact person" maxLength={200} error={fieldError(state, "primary_contact_name")} defaultValue={text("primary_contact_name", initial.primaryContactName)} />
        <CheckboxGroup
          name="categories"
          legend="Trades"
          required
          inline
          error={fieldError(state, "categories")}
          defaultValue={failed ? retainedList(values, "categories") : initial.categories}
          options={CONTRACTOR_CATEGORIES.map((c) => ({ value: c, label: CONTRACTOR_CATEGORY_LABEL[c] }))}
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
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="website" type="url" label="Website" error={fieldError(state, "website")} defaultValue={text("website", initial.website)} maxLength={300} />
          <TextInput
            name="abn"
            label="ABN"
            inputMode="numeric"
            hint="11 digits. HQ checks it for typing mistakes only; it does not look the business up."
            error={fieldError(state, "abn")}
            defaultValue={text("abn", initial.abn)}
            maxLength={20}
          />
        </div>
        <TextInput name="business_hours" label="Business hours" hint="For example: Mon to Fri, 7am to 4pm." error={fieldError(state, "business_hours")} defaultValue={text("business_hours", initial.businessHours)} maxLength={300} />
      </section>

      <section aria-labelledby="where" className="grid gap-5">
        <SectionLabel as="h2" id="where" className="border-b border-line pb-3">
          Where they work
        </SectionLabel>
        <div className="grid gap-5 sm:grid-cols-2">
          <Textarea
            name="service_suburbs"
            label="Suburbs serviced"
            rows={4}
            hint="One per line, or separated by commas. Leave blank if you don't know yet."
            error={fieldError(state, "service_suburbs")}
            defaultValue={text("service_suburbs", initial.serviceSuburbs)}
          />
          <Textarea
            name="service_regions"
            label="Regions serviced"
            rows={4}
            hint="For example Copper Coast or Yorke Peninsula. Optional."
            error={fieldError(state, "service_regions")}
            defaultValue={text("service_regions", initial.serviceRegions)}
          />
        </div>
        <RadioGroup
          name="emergency_available"
          legend="Emergency call-outs"
          segmented
          defaultValue={text("emergency_available", initial.emergency)}
          error={fieldError(state, "emergency_available")}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
            { value: "unknown", label: "Not known" },
          ]}
        />
      </section>

      <section aria-labelledby="rates" className="grid gap-5">
        <SectionLabel as="h2" id="rates" className="border-b border-line pb-3">
          Rates and terms
        </SectionLabel>
        <p className="text-[13px] text-grey-text">Type amounts in dollars. Leave a box blank if you don&rsquo;t know it: blank is recorded as not known, never as $0. Type 0 only if the contractor really charges nothing.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="hourly_rate" label="Hourly rate ($)" inputMode="decimal" error={fieldError(state, "hourly_rate")} defaultValue={text("hourly_rate", initial.hourlyRate)} maxLength={14} />
          <TextInput name="callout_fee" label="Call-out fee ($)" inputMode="decimal" error={fieldError(state, "callout_fee")} defaultValue={text("callout_fee", initial.calloutFee)} maxLength={14} />
          <TextInput name="after_hours_fee" label="After-hours fee ($)" inputMode="decimal" error={fieldError(state, "after_hours_fee")} defaultValue={text("after_hours_fee", initial.afterHoursFee)} maxLength={14} />
          <TextInput name="minimum_charge" label="Minimum charge ($)" inputMode="decimal" error={fieldError(state, "minimum_charge")} defaultValue={text("minimum_charge", initial.minimumCharge)} maxLength={14} />
        </div>
        <TextInput name="invoice_terms" label="Invoice terms" hint="For example: 14 days, or paid on completion." error={fieldError(state, "invoice_terms")} defaultValue={text("invoice_terms", initial.invoiceTerms)} maxLength={500} />
      </section>

      <section aria-labelledby="paper" className="grid gap-5">
        <SectionLabel as="h2" id="paper" className="border-b border-line pb-3">
          Licence and insurance
        </SectionLabel>
        <p className="text-[13px] text-grey-text">
          What the contractor has told you. These are not verified until someone checks the document. Changing an expiry date clears its verified date, so it has to be checked again. Documents are uploaded on the contractor&rsquo;s page once they are added.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Textarea name="licence_details" label="Licence details" rows={3} error={fieldError(state, "licence_details")} defaultValue={text("licence_details", initial.licenceDetails)} />
          <Textarea name="insurance_details" label="Insurance details" rows={3} error={fieldError(state, "insurance_details")} defaultValue={text("insurance_details", initial.insuranceDetails)} />
          <DateInput name="licence_expires_on" label="Licence expires" error={fieldError(state, "licence_expires_on")} defaultValue={text("licence_expires_on", initial.licenceExpiresOn)} />
          <DateInput name="insurance_expires_on" label="Insurance expires" error={fieldError(state, "insurance_expires_on")} defaultValue={text("insurance_expires_on", initial.insuranceExpiresOn)} />
        </div>
      </section>

      <section aria-labelledby="rel" className="grid gap-5">
        <SectionLabel as="h2" id="rel" className="border-b border-line pb-3">
          The relationship
        </SectionLabel>
        <div className="grid gap-5 sm:grid-cols-2">
          <NativeSelectPicker
            name="relationship_owner_id"
            label="Relationship owner"
            placeholder="No owner"
            options={staff}
            error={fieldError(state, "relationship_owner_id")}
            defaultValue={text("relationship_owner_id", initial.ownerId)}
          />
          <DateInput name="last_job_date" label="Last job" max={today} hint="Optional." error={fieldError(state, "last_job_date")} defaultValue={text("last_job_date", initial.lastJobDate)} />
        </div>
        <Textarea name="internal_notes" label="Internal notes" rows={4} maxLength={4000} error={fieldError(state, "internal_notes")} defaultValue={text("internal_notes", initial.internalNotes)} />
      </section>

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={editing ? "Saving contractor" : "Adding contractor"}>{editing ? "Save changes" : "Add contractor"}</SubmitButton>
      </FormActions>
    </form>
  );
}
