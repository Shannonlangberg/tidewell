"use client";

import { useActionState, useState } from "react";
import { updateOpportunity, updateReferral } from "@/app/hq/(app)/growth/referrals/actions";
import { SENT_OUTCOME_LABEL, SENT_OUTCOMES } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { Button } from "../../Button";
import { Drawer } from "../../Drawer";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";
import { useCloseWhenDone } from "./useCloseWhenDone";

/*
 * Two small edit forms, as drawers, for a referral's page:
 *
 *  - EditReferralButton: the introduction itself (date, who follows it up, notes; for a SENT
 *    referral also its outcome and the person's details).
 *  - EditProspectButton: the prospect behind a RECEIVED referral (their details, the estimate,
 *    who follows it up, notes). Stage and credit are not here: they move only through the
 *    pipeline actions, so a count can never be changed by editing a field.
 *
 * Each stays open on a failed save and keeps what was typed; it closes once the save has redirected.
 */

const REFERRAL_LABELS: Record<string, string> = {
  referral_date: "Date",
  assigned_to: "Assigned to",
  notes: "Notes",
  sent_outcome: "Outcome",
  prospect_name: "Prospect's name",
  prospect_phone: "Phone",
  prospect_email: "Email",
  property_suburb: "Suburb",
  property_address: "Address",
};

const PROSPECT_LABELS: Record<string, string> = {
  prospect_name: "Prospect's name",
  prospect_phone: "Phone",
  prospect_email: "Email",
  property_suburb: "Suburb",
  property_address: "Address",
  estimated_value: "Estimated annual value",
  assigned_to: "Assigned to",
  notes: "Notes",
};

// ── the referral ─────────────────────────────────────────────

export type EditReferralInitial = {
  referralId: string;
  direction: "received" | "sent";
  referralDate: string;
  assignedTo: string;
  notes: string;
  sentOutcome: string;
  prospectName: string;
  prospectPhone: string;
  prospectEmail: string;
  propertySuburb: string;
  propertyAddress: string;
};

export function EditReferralButton({ initial, staff, today, returnTo }: { initial: EditReferralInitial; staff: readonly PickerOption[]; today: string; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        Edit
      </Button>
      <EditReferralSession key={session} open={open} onClose={() => setOpen(false)} initial={initial} staff={staff} today={today} returnTo={returnTo} />
    </>
  );
}

function EditReferralSession({
  open,
  onClose,
  initial,
  staff,
  today,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  initial: EditReferralInitial;
  staff: readonly PickerOption[];
  today: string;
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState(updateReferral, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  useCloseWhenDone(state, pending, onClose);
  const sent = initial.direction === "sent";

  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title={sent ? "Edit the sent referral" : "Edit the referral"}
        description="Who introduced whom, the stage and the credited source are not edited here: they move through the pipeline."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving referral">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={REFERRAL_LABELS} idPrefix="editref" />
          <input type="hidden" name="referral_id" value={initial.referralId} />
          <input type="hidden" name="return_to" value={returnTo} />

          <DateInput
            name="referral_date"
            idPrefix="editref"
            label="Date of the introduction"
            required
            max={today}
            defaultValue={retainedText(values, "referral_date", initial.referralDate)}
            error={fieldError(state, "referral_date")}
          />

          {sent ? (
            <>
              <Select
                name="sent_outcome"
                idPrefix="editref"
                label="Outcome"
                required
                options={SENT_OUTCOMES.map((o) => ({ value: o, label: SENT_OUTCOME_LABEL[o] }))}
                defaultValue={retainedText(values, "sent_outcome", initial.sentOutcome)}
                error={fieldError(state, "sent_outcome")}
                hint="What happened after you sent them."
              />
              <InlineNote>Only record details the prospect has agreed to share.</InlineNote>
              <TextInput name="prospect_name" idPrefix="editref" label="Prospect's name" maxLength={200} defaultValue={retainedText(values, "prospect_name", initial.prospectName)} error={fieldError(state, "prospect_name")} />
              <div className="grid gap-5 sm:grid-cols-2">
                <TextInput name="prospect_phone" idPrefix="editref" type="tel" label="Phone" defaultValue={retainedText(values, "prospect_phone", initial.prospectPhone)} error={fieldError(state, "prospect_phone")} />
                <TextInput name="prospect_email" idPrefix="editref" type="email" label="Email" defaultValue={retainedText(values, "prospect_email", initial.prospectEmail)} error={fieldError(state, "prospect_email")} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextInput name="property_suburb" idPrefix="editref" label="Property suburb" maxLength={120} defaultValue={retainedText(values, "property_suburb", initial.propertySuburb)} error={fieldError(state, "property_suburb")} />
                <TextInput name="property_address" idPrefix="editref" label="Property address" maxLength={300} defaultValue={retainedText(values, "property_address", initial.propertyAddress)} error={fieldError(state, "property_address")} />
              </div>
            </>
          ) : null}

          <NativeSelectPicker
            name="assigned_to"
            idPrefix="editref"
            label="Assigned to"
            placeholder="Unassigned"
            options={staff}
            defaultValue={retainedText(values, "assigned_to", initial.assignedTo)}
            error={fieldError(state, "assigned_to")}
          />
          <Textarea name="notes" idPrefix="editref" label="Notes" rows={4} maxLength={2000} defaultValue={retainedText(values, "notes", initial.notes)} error={fieldError(state, "notes")} />
        </div>
      </Drawer>
    </form>
  );
}

// ── the prospect ─────────────────────────────────────────────

export type EditProspectInitial = {
  opportunityId: string;
  prospectName: string;
  prospectPhone: string;
  prospectEmail: string;
  propertySuburb: string;
  propertyAddress: string;
  /** Dollars as the person would type them: "6500". */
  estimatedValue: string;
  assignedTo: string;
  notes: string;
};

export function EditProspectButton({ initial, staff, returnTo }: { initial: EditProspectInitial; staff: readonly PickerOption[]; returnTo: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        Edit prospect
      </Button>
      <EditProspectSession key={session} open={open} onClose={() => setOpen(false)} initial={initial} staff={staff} returnTo={returnTo} />
    </>
  );
}

function EditProspectSession({
  open,
  onClose,
  initial,
  staff,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  initial: EditProspectInitial;
  staff: readonly PickerOption[];
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState(updateOpportunity, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  useCloseWhenDone(state, pending, onClose);

  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title="Edit the prospect"
        description="Changes apply to the prospect, whichever partner's referral you are looking at."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving prospect">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={PROSPECT_LABELS} idPrefix="editopp" />
          <input type="hidden" name="opportunity_id" value={initial.opportunityId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <InlineNote>Only record details the prospect has agreed to share.</InlineNote>
          <TextInput
            name="prospect_name"
            idPrefix="editopp"
            label="Prospect's name"
            required
            maxLength={200}
            defaultValue={retainedText(values, "prospect_name", initial.prospectName)}
            error={fieldError(state, "prospect_name")}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput name="prospect_phone" idPrefix="editopp" type="tel" label="Phone" defaultValue={retainedText(values, "prospect_phone", initial.prospectPhone)} error={fieldError(state, "prospect_phone")} />
            <TextInput name="prospect_email" idPrefix="editopp" type="email" label="Email" defaultValue={retainedText(values, "prospect_email", initial.prospectEmail)} error={fieldError(state, "prospect_email")} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput name="property_suburb" idPrefix="editopp" label="Property suburb" maxLength={120} defaultValue={retainedText(values, "property_suburb", initial.propertySuburb)} error={fieldError(state, "property_suburb")} />
            <TextInput name="property_address" idPrefix="editopp" label="Property address" maxLength={300} defaultValue={retainedText(values, "property_address", initial.propertyAddress)} error={fieldError(state, "property_address")} />
          </div>
          <TextInput
            name="estimated_value"
            idPrefix="editopp"
            label="Estimated annual value, in dollars (an estimate)"
            inputMode="decimal"
            hint="Your own estimate of a year's management revenue. Leave it blank if you don't know."
            defaultValue={retainedText(values, "estimated_value", initial.estimatedValue)}
            error={fieldError(state, "estimated_value")}
          />
          <NativeSelectPicker
            name="assigned_to"
            idPrefix="editopp"
            label="Assigned to"
            placeholder="Unassigned"
            options={staff}
            defaultValue={retainedText(values, "assigned_to", initial.assignedTo)}
            error={fieldError(state, "assigned_to")}
          />
          <Textarea name="notes" idPrefix="editopp" label="Notes on the prospect" rows={4} maxLength={2000} defaultValue={retainedText(values, "notes", initial.notes)} error={fieldError(state, "notes")} />
        </div>
      </Drawer>
    </form>
  );
}
