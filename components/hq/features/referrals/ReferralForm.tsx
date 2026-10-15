"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordReferral } from "@/app/hq/(app)/growth/referrals/actions";
import { idle } from "@/lib/hq/forms";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { LinkButton } from "../../Button";
import { RadioGroup } from "../../Choice";
import { fieldError, FormActions } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * Record a referral. One form, two directions:
 *
 *  - Received: a partner introduced a prospect. It is a NEW prospect (credited to this partner),
 *    or a further introduction for a prospect already in the pipeline (a claim, not credited).
 *  - Sent: you introduced someone to a partner. No prospect enters the pipeline.
 *
 * It stays on the page after a failed save and keeps everything that was typed (the Server Action
 * hands the values back and they become each field's defaultValue), with the error beside the
 * field. Nothing is posted for a section that is not shown.
 */

const LABELS: Record<string, string> = {
  direction: "Direction",
  partner_organisation: "Partner organisation",
  partner_contact: "Partner contact",
  referral_date: "Date",
  prospect_mode: "Prospect",
  existing_opportunity: "Prospect already in the pipeline",
  prospect_name: "Prospect's name",
  prospect_phone: "Phone",
  prospect_email: "Email",
  property_suburb: "Suburb",
  property_address: "Address",
  estimated_value: "Estimated annual value",
  assigned_to: "Assigned to",
  notes: "Notes",
};

export type ReferralFormInitial = {
  direction: "received" | "sent";
  partnerContact: string;
  partnerOrganisation: string;
  existingOpportunity: string;
};

export function ReferralForm({
  organisations,
  contacts,
  staff,
  opportunities,
  today,
  staffId,
  initial,
}: {
  organisations: readonly PickerOption[];
  contacts: readonly PickerOption[];
  staff: readonly PickerOption[];
  opportunities: readonly PickerOption[];
  /** Today in the person's timezone, YYYY-MM-DD: the default date and the latest allowed. */
  today: string;
  staffId: string;
  initial: ReferralFormInitial;
}) {
  const [state, formAction] = useActionState(recordReferral, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;

  const [direction, setDirection] = useState<"received" | "sent">(
    retainedText(values, "direction", initial.direction) === "sent" ? "sent" : "received",
  );
  const [mode, setMode] = useState<"new" | "existing">(
    retainedText(values, "prospect_mode", initial.existingOpportunity ? "existing" : "new") === "existing" ? "existing" : "new",
  );

  const received = direction === "received";
  const attaching = received && mode === "existing";

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-7">
      <FormSummary state={state} labels={LABELS} idPrefix="ref" />

      <div
        onChange={(e) => {
          const t = e.target as HTMLInputElement;
          if (t.name === "direction") setDirection(t.value === "sent" ? "sent" : "received");
        }}
      >
        <RadioGroup
          name="direction"
          idPrefix="ref"
          legend="Direction"
          segmented
          required
          defaultValue={direction}
          error={fieldError(state, "direction")}
          hint="Received: a partner introduced a prospect to you. Sent: you introduced someone to a partner."
          options={[
            { value: "received", label: "Received" },
            { value: "sent", label: "Sent" },
          ]}
        />
      </div>

      <section aria-labelledby="ref-partner-h" className="grid gap-5">
        <h2 id="ref-partner-h" className="hq-label">
          {received ? "Who introduced them" : "Who you sent them to"}
        </h2>
        <NativeSelectPicker
          name="partner_organisation"
          idPrefix="ref"
          label="Partner organisation"
          placeholder="Choose an organisation"
          options={organisations}
          defaultValue={retainedText(values, "partner_organisation", initial.partnerOrganisation)}
          error={fieldError(state, "partner_organisation")}
          hint="Choose an organisation, a contact, or both. If you choose only a contact, their organisation is used."
        />
        <NativeSelectPicker
          name="partner_contact"
          idPrefix="ref"
          label="Partner contact"
          placeholder="No particular person"
          options={contacts}
          defaultValue={retainedText(values, "partner_contact", initial.partnerContact)}
          error={fieldError(state, "partner_contact")}
          hint={
            <>
              Not in the list? <Link href="/hq/growth/contacts/new">Add a contact</Link> first.
            </>
          }
        />
      </section>

      <DateInput
        name="referral_date"
        idPrefix="ref"
        label="Date of the introduction"
        required
        max={today}
        defaultValue={retainedText(values, "referral_date", today)}
        error={fieldError(state, "referral_date")}
        hint="It can be back-dated, but not in the future."
      />

      {received ? (
        <section aria-labelledby="ref-prospect-mode-h" className="grid gap-4">
          <h2 id="ref-prospect-mode-h" className="hq-label">
            The prospect
          </h2>
          <div
            onChange={(e) => {
              const t = e.target as HTMLInputElement;
              if (t.name === "prospect_mode") setMode(t.value === "existing" ? "existing" : "new");
            }}
          >
            <RadioGroup
              name="prospect_mode"
              idPrefix="ref"
              legend="Is this prospect already in the pipeline?"
              defaultValue={mode}
              error={fieldError(state, "prospect_mode")}
              options={[
                { value: "new", label: "No, this is a new prospect", hint: "A prospect is created at Introduction received, credited to this partner." },
                { value: "existing", label: "Yes, another partner already introduced them", hint: "This referral is added to that prospect as a further claim." },
              ]}
            />
          </div>
          <InlineNote>The first partner to introduce a prospect is credited. You can change the credited source later.</InlineNote>
          {attaching ? (
            <NativeSelectPicker
              name="existing_opportunity"
              idPrefix="ref"
              label="Prospect already in the pipeline"
              required
              placeholder="Choose a prospect"
              options={opportunities}
              defaultValue={retainedText(values, "existing_opportunity", initial.existingOpportunity)}
              error={fieldError(state, "existing_opportunity")}
              hint="This referral will not be credited, and no second prospect is created. If the prospect signs, the management is still counted once."
            />
          ) : null}
        </section>
      ) : null}

      {!attaching ? (
        <section aria-labelledby="ref-details-h" className="grid gap-5">
          <h2 id="ref-details-h" className="hq-label">
            {received ? "About the prospect" : "About the person you sent (optional)"}
          </h2>
          <InlineNote>Only record details the prospect has agreed to share.</InlineNote>
          <TextInput
            name="prospect_name"
            idPrefix="ref"
            label="Prospect's name"
            required={received}
            maxLength={200}
            defaultValue={retainedText(values, "prospect_name")}
            error={fieldError(state, "prospect_name")}
            autoComplete="off"
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput
              name="prospect_phone"
              idPrefix="ref"
              type="tel"
              label="Phone"
              hint="Optional."
              defaultValue={retainedText(values, "prospect_phone")}
              error={fieldError(state, "prospect_phone")}
            />
            <TextInput
              name="prospect_email"
              idPrefix="ref"
              type="email"
              label="Email"
              hint="Optional."
              defaultValue={retainedText(values, "prospect_email")}
              error={fieldError(state, "prospect_email")}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput
              name="property_suburb"
              idPrefix="ref"
              label="Property suburb"
              hint="Optional."
              maxLength={120}
              defaultValue={retainedText(values, "property_suburb")}
              error={fieldError(state, "property_suburb")}
            />
            <TextInput
              name="property_address"
              idPrefix="ref"
              label="Property address"
              hint="Optional."
              maxLength={300}
              defaultValue={retainedText(values, "property_address")}
              error={fieldError(state, "property_address")}
            />
          </div>
          {received ? (
            <TextInput
              name="estimated_value"
              idPrefix="ref"
              label="Estimated annual value, in dollars (an estimate)"
              inputMode="decimal"
              placeholder="For example 6500"
              hint="Optional. Your own estimate of what managing this property would earn Planted in a year. Leave it blank if you don't know. HQ does not record referral payments."
              defaultValue={retainedText(values, "estimated_value")}
              error={fieldError(state, "estimated_value")}
            />
          ) : null}
        </section>
      ) : null}

      <NativeSelectPicker
        name="assigned_to"
        idPrefix="ref"
        label="Assigned to"
        placeholder="Unassigned"
        options={staff}
        defaultValue={retainedText(values, "assigned_to", staffId)}
        error={fieldError(state, "assigned_to")}
        hint="Who follows this up."
      />

      <Textarea
        name="notes"
        idPrefix="ref"
        label="Notes"
        rows={4}
        maxLength={2000}
        hint="Optional. What the partner said, or what happens next."
        defaultValue={retainedText(values, "notes")}
        error={fieldError(state, "notes")}
      />

      <FormActions>
        <LinkButton href="/hq/growth/referrals">Cancel</LinkButton>
        <SubmitButton pendingLabel="Recording referral">Record referral</SubmitButton>
      </FormActions>
    </form>
  );
}

