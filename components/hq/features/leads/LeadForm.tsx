"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createLead } from "@/app/hq/(app)/growth/opportunities/actions";
import { idle } from "@/lib/hq/forms";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { DIRECT_LEAD_SOURCES, LEAD_FORM_LABELS, LEAD_SOURCE_LABEL } from "@/lib/hq/leads/rules";
import { LinkButton } from "../../Button";
import { Checkbox } from "../../Choice";
import { fieldError, FormActions } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * Add a lead: a landlord or owner who did not come through a referral partner (our own marketing,
 * the website, a direct approach). The person is also added as a landlord contact. A lead always
 * has an owner (you, unless you choose someone), a next action and a follow-up date, so it can
 * never sit in the pipeline with nobody on it.
 *
 * After a failed save it keeps everything typed and shows the error beside the field. When HQ
 * already has someone with the same phone, email, or name and suburb, it says so, links to them,
 * and offers "This is someone else" so a genuine second person can still be added.
 */

export function LeadForm({ staff, staffId, today, tomorrow }: { staff: readonly PickerOption[]; staffId: string; today: string; tomorrow: string }) {
  const [state, formAction] = useActionState(createLead, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const duplicate = (state.data?.duplicate ?? null) as { href: string; kind: string } | null;
  const offerDistinct = !!duplicate || retainedText(values, "confirm_distinct") === "on";

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-7">
      <FormSummary state={state} labels={LEAD_FORM_LABELS} idPrefix="lead" />
      {duplicate ? (
        <InlineNote>
          <Link href={duplicate.href} className="font-medium underline underline-offset-4">
            Open the {duplicate.kind === "opportunity" ? "existing lead" : "existing landlord"}
          </Link>{" "}
          to check it before adding another.
        </InlineNote>
      ) : null}

      <section aria-labelledby="lead-who-h" className="grid gap-5">
        <h2 id="lead-who-h" className="hq-label">
          The landlord
        </h2>
        <InlineNote>Only record details the person has agreed to share.</InlineNote>
        <TextInput
          name="prospect_name"
          idPrefix="lead"
          label="Name"
          required
          maxLength={200}
          autoComplete="off"
          defaultValue={retainedText(values, "prospect_name")}
          error={fieldError(state, "prospect_name")}
          data-autofocus
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="prospect_phone" idPrefix="lead" type="tel" label="Phone" hint="Optional." defaultValue={retainedText(values, "prospect_phone")} error={fieldError(state, "prospect_phone")} />
          <TextInput name="prospect_email" idPrefix="lead" type="email" label="Email" hint="Optional." defaultValue={retainedText(values, "prospect_email")} error={fieldError(state, "prospect_email")} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput name="property_suburb" idPrefix="lead" label="Property suburb" hint="Optional." maxLength={120} defaultValue={retainedText(values, "property_suburb")} error={fieldError(state, "property_suburb")} />
          <TextInput name="property_address" idPrefix="lead" label="Property address" hint="Optional." maxLength={300} defaultValue={retainedText(values, "property_address")} error={fieldError(state, "property_address")} />
        </div>
        <Select
          name="source"
          idPrefix="lead"
          label="Where did the lead come from?"
          required
          placeholder="Choose one"
          options={DIRECT_LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))}
          defaultValue={retainedText(values, "source")}
          error={fieldError(state, "source")}
          hint={
            <>
              Introduced by a referral partner? <Link href="/hq/growth/referrals/new">Record a referral</Link> instead, so the partner is credited.
            </>
          }
        />
      </section>

      <section aria-labelledby="lead-next-h" className="grid gap-5">
        <h2 id="lead-next-h" className="hq-label">
          What happens next
        </h2>
        <NativeSelectPicker
          name="assigned_to"
          idPrefix="lead"
          label="Owner"
          required
          options={staff}
          defaultValue={retainedText(values, "assigned_to", staffId)}
          error={fieldError(state, "assigned_to")}
          hint="Who follows this lead up."
        />
        <TextInput
          name="next_action"
          idPrefix="lead"
          label="Next action"
          required
          maxLength={300}
          placeholder="For example: call to book an appraisal"
          defaultValue={retainedText(values, "next_action")}
          error={fieldError(state, "next_action")}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <DateInput
            name="next_action_due"
            idPrefix="lead"
            label="Follow-up date"
            required
            min={today}
            defaultValue={retainedText(values, "next_action_due", tomorrow)}
            error={fieldError(state, "next_action_due")}
            hint="When the next action is due. It shows in Today."
          />
          <DateInput
            name="expected_close_date"
            idPrefix="lead"
            label="Expected to sign by"
            min={today}
            defaultValue={retainedText(values, "expected_close_date")}
            error={fieldError(state, "expected_close_date")}
            hint="Optional. Your best guess."
          />
        </div>
        <TextInput
          name="estimated_value"
          idPrefix="lead"
          label="Estimated yearly value, in dollars (an estimate)"
          inputMode="decimal"
          placeholder="For example 3200"
          hint="Optional. Your own estimate of a year's management fees for this property. Leave it blank if you don't know."
          defaultValue={retainedText(values, "estimated_value")}
          error={fieldError(state, "estimated_value")}
        />
        <Textarea name="notes" idPrefix="lead" label="Notes" rows={4} maxLength={2000} hint="Optional." defaultValue={retainedText(values, "notes")} error={fieldError(state, "notes")} />
      </section>

      {offerDistinct ? (
        <Checkbox
          name="confirm_distinct"
          idPrefix="lead"
          label="This is someone else"
          hint="Tick only when you have checked the existing record and this is a different person or property."
          defaultChecked={retainedText(values, "confirm_distinct") === "on"}
        />
      ) : null}

      <FormActions>
        <LinkButton href="/hq/growth/pipeline">Cancel</LinkButton>
        <SubmitButton pendingLabel="Adding lead">Add lead</SubmitButton>
      </FormActions>
    </form>
  );
}
