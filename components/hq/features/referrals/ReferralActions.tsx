"use client";

import { useState } from "react";
import { archiveReferral, setCreditedSource } from "@/app/hq/(app)/growth/referrals/actions";
import { allowedTargets } from "@/lib/hq/referrals/stages";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { TextInput } from "../../TextInput";
import { MoveStageDrawer, type MoveTarget } from "../pipeline/MoveStageDrawer";

/*
 * The buttons on a referral's page that change something. Each one only OPENS a drawer or a
 * confirmation: the work, and the permission check behind it, is in the Server Action. Hiding a
 * button a person cannot use is a courtesy; the database is what stops them.
 */

// ── move stage ───────────────────────────────────────────────

export function MoveStageButton({
  target,
  role,
  today,
  timezone,
  returnTo,
}: {
  target: MoveTarget;
  role: string;
  today: string;
  timezone: string;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  // A signed management can only be moved by a director or administrator: nobody else is offered the button.
  if (allowedTargets(target.stage, role).length === 0) return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {target.stage === "management_signed" ? "Change stage" : "Move stage"}
      </Button>
      <MoveStageDrawer open={open} onClose={() => setOpen(false)} target={target} role={role} today={today} timezone={timezone} returnTo={returnTo} />
    </>
  );
}

// ── who is credited ──────────────────────────────────────────

export function MakeCreditedButton({
  opportunityId,
  referralId,
  refLabel,
  partnerName,
  currentName,
  signed,
  returnTo,
}: {
  opportunityId: string;
  referralId: string;
  refLabel: string;
  partnerName: string;
  /** The partner who is credited now. */
  currentName: string;
  /** The prospect has already signed, so the credit for a signed management is what moves. */
  signed: boolean;
  returnTo: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`Make ${refLabel} the credited source`}>
        Make this the credited source
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Credit ${partnerName}?`}
        confirmLabel="Make credited source"
        action={setCreditedSource}
        fields={{ opportunity_id: opportunityId, referral_id: referralId, return_to: returnTo }}
      >
        <p>
          {refLabel} from {partnerName} will become the credited source for this prospect, instead of {currentName}.{" "}
          {signed
            ? `The management is already signed, so its credit moves from ${currentName} to ${partnerName}.`
            : `If the prospect signs, the management is credited to ${partnerName}.`}
        </p>
        <p className="mt-3">The prospect is still one prospect and a signed management is still counted once. The change is recorded in the audit log.</p>
      </ConfirmDialog>
    </>
  );
}

// ── archive ──────────────────────────────────────────────────

export function ArchiveReferralButton({
  id,
  refLabel,
  consequence,
  blockedNoteId,
}: {
  id: string;
  refLabel: string;
  /** What archiving means for this referral, in a sentence or two. */
  consequence: string;
  /**
   * Set when the database would refuse (the credited source while other partners claim the prospect):
   * the button is shown but not available, and points at the visible explanation with this id.
   */
  blockedNoteId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // A client wrapper around the Server Action, so the reason typed in the dialog travels with the post.
  async function submit(formData: FormData) {
    formData.set("reason", reason);
    await archiveReferral(formData);
  }

  if (blockedNoteId) {
    return (
      <Button disabled aria-describedby={blockedNoteId}>
        Archive
      </Button>
    );
  }

  return (
    <>
      <Button
        onClick={() => {
          setReason("");
          setOpen(true);
        }}
      >
        Archive
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={`Archive ${refLabel}?`} confirmLabel="Archive referral" tone="danger" action={submit} fields={{ id }}>
        <p>{consequence}</p>
        <div className="mt-4">
          <TextInput
            name="archive-reason"
            idPrefix={`archive-${id}`}
            label="Reason (optional)"
            hint="Kept in the audit log."
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
