"use client";

import { useActionState } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import { END_REASONS, END_REASON_LABEL } from "@/lib/hq/ceo/rules";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { Select } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { TextInput } from "../../TextInput";

/*
 * The agreement terms behind the CEO Command Centre's contracted fees: the weekly rent on the agreement
 * (with a percentage fee) or the agreed yearly fee (flat fee, other, short-term), excluding GST, and why a
 * management is ending. Ailo keeps the live rent; this is what the agreement said. A blank field is cleared.
 */
export function PropertyTermsForm({
  action,
  propertyId,
  percentFee,
  ending,
  weeklyRent,
  annualFee,
  endReason,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  propertyId: string;
  percentFee: boolean;
  ending: boolean;
  weeklyRent: string;
  annualFee: string;
  endReason: string | null;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  return (
    <form action={formAction} noValidate className="grid max-w-xl gap-4">
      <input type="hidden" name="id" value={propertyId} />
      <FormSummary state={state} labels={{ weekly_rent: "Weekly rent", annual_fee: "Yearly fee", end_reason: "Why it is ending" }} idPrefix="terms" />
      <div className="grid gap-4 sm:grid-cols-2">
        {percentFee ? (
          <TextInput
            name="weekly_rent"
            idPrefix="terms"
            label="Weekly rent on the agreement"
            inputMode="decimal"
            defaultValue={retained?.weekly_rent ?? weeklyRent}
            error={fieldError(state, "weekly_rent")}
            hint="In dollars. With the fee percentage it gives the yearly fee."
          />
        ) : (
          <TextInput
            name="annual_fee"
            idPrefix="terms"
            label="Agreed management fee a year"
            inputMode="decimal"
            defaultValue={retained?.annual_fee ?? annualFee}
            error={fieldError(state, "annual_fee")}
            hint="In dollars, excluding GST. Never income received."
          />
        )}
        {ending ? (
          <Select
            name="end_reason"
            idPrefix="terms"
            label="Why it is ending"
            defaultValue={retained?.end_reason ?? endReason ?? ""}
            error={fieldError(state, "end_reason")}
            options={[{ value: "", label: "Not recorded" }, ...END_REASONS.map((r) => ({ value: r, label: END_REASON_LABEL[r] }))]}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingLabel="Saving">Save terms</SubmitButton>
        {state.ok && state.message ? (
          <p className="text-[14px]" role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
