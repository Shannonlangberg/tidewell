"use client";

import { useState } from "react";
import { recordContractorJob } from "@/app/hq/(app)/partners/actions";
import { lastUsedText, shortDate } from "@/lib/hq/trades/rules";
import { Button, type ButtonSize } from "../../Button";
import { Checkbox } from "../../Choice";
import { fieldError } from "../../Field";
import { DateInput } from "../../TextInput";
import { ErrorLine, FormDialog, useDecision } from "./FormDialog";

/*
 * "Record a job": sets the contractor's last used date (contractors.last_job_date) through
 * hq.mark_contractor_used. HQ is not connected to Ailo, so this is the only way the date moves
 * (besides job feedback with a later job date): it is recorded by staff and the dialog says so.
 * Default today (the person's timezone, from the server); never in the future; moving the date
 * BACK needs an explicit tick, and the database refuses it without one.
 */

type Props = {
  contractorId: string;
  businessName: string;
  lastJobDate: string | null;
  /** Today in the person's timezone (YYYY-MM-DD), from the server. */
  today: string;
  /** Where to land afterwards: the profile (default) or the Trades page. */
  returnTo?: string;
  size?: ButtonSize;
  variant?: "secondary" | "ghost";
};

export function RecordJobButton({ contractorId, businessName, lastJobDate, today, returnTo, size = "sm", variant = "secondary" }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon="calendar" onClick={() => setOpen(true)} aria-label={`Record a job for ${businessName}`}>
        Record a job
      </Button>
      {open ? <RecordJobDialog contractorId={contractorId} businessName={businessName} lastJobDate={lastJobDate} today={today} returnTo={returnTo} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RecordJobDialog({ contractorId, businessName, lastJobDate, today, returnTo, onClose }: Omit<Props, "size" | "variant"> & { onClose: () => void }) {
  const { state, formAction, pending } = useDecision(recordContractorJob, onClose);
  const [date, setDate] = useState(today);
  const earlier = lastJobDate !== null && date !== "" && date < lastJobDate;
  const [confirmBack, setConfirmBack] = useState(false);

  return (
    <FormDialog title={`Record a job for ${businessName}`} onClose={onClose} confirmLabel="Record job" confirmDisabled={earlier && !confirmBack} pending={pending} action={formAction}>
      <input type="hidden" name="id" value={contractorId} />
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
      <p>
        Sets when Planted last used them. HQ only knows about jobs someone records here.
        <span className="mt-1 block text-[13px] text-grey-text">Now: {lastUsedText(lastJobDate, today)}.</span>
      </p>
      <DateInput
        name="job_date"
        idPrefix={`job-${contractorId}`}
        label="Date of the job"
        required
        max={today}
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setConfirmBack(false);
        }}
        hint="Today unless you choose another day. Not in the future."
        error={fieldError(state, "job_date")}
      />
      {earlier && lastJobDate ? (
        <Checkbox
          name="allow_earlier"
          idPrefix={`job-back-${contractorId}`}
          label={`Yes, move the last used date back from ${shortDate(lastJobDate)} to ${shortDate(date)}`}
          hint="The date already recorded is later. Only tick this if it was recorded by mistake."
          checked={confirmBack}
          onChange={(e) => setConfirmBack(e.target.checked)}
        />
      ) : null}
      <ErrorLine state={state} />
    </FormDialog>
  );
}
