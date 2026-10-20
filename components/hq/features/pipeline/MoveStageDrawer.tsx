"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { moveStage } from "@/app/hq/(app)/growth/referrals/actions";
import { STAGE_LABEL } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { formatDate } from "@/lib/hq/format";
import { LOST_REASON_LABEL, LOST_REASONS } from "@/lib/hq/leads/rules";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { allowedTargets, classifyMove, moveFieldsFor, moveNeedsConfirmation, isStage, type Stage } from "@/lib/hq/referrals/stages";
import { Button } from "../../Button";
import { useCloseWhenDone } from "../referrals/useCloseWhenDone";
import { ConfirmDialog } from "../../ConfirmDialog";
import { Drawer } from "../../Drawer";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote } from "../../Primitives";
import { Select } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * Move a prospect to another stage. Used by the pipeline board (one drawer for every card) and by
 * a referral's page, with the SAME Server Action (moveStage), so the rules are the same in both.
 *
 * Which stages are offered, and which extra details a stage needs, come from lib/hq/referrals/stages
 * (the database enforces every rule again):
 *   Management signed   the date it was signed (not in the future) and, optionally, the reference
 *                       from the property management system. Signing twice changes nothing.
 *   Lost / did not proceed   a reason from the list and a few words (both required).
 *   Out of "signed"     only a director or administrator, and only after a confirmation that says
 *                       the signed count will change.
 *
 * The drawer stays open on a failed save and keeps everything typed. It closes itself once the
 * action has redirected back (the page behind has already been refreshed).
 */

export type MoveTarget = {
  opportunityId: string;
  prospectName: string;
  stage: Stage;
  signedAt: string | null;
  managementReference: string | null;
};

const LABELS: Record<string, string> = {
  stage: "Move to",
  signed_date: "Date signed",
  management_reference: "Management reference",
  lost_reason_code: "Why it did not proceed",
  lost_reason: "Reason",
  note: "Note",
};

export function MoveStageDrawer({
  open,
  onClose,
  target,
  role,
  today,
  timezone,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  target: MoveTarget | null;
  role: string;
  /** Today in the person's timezone, YYYY-MM-DD. */
  today: string;
  timezone: string;
  /** Where the action sends the person afterwards: the pipeline (with its filters) or the referral's page. */
  returnTo: string;
}) {
  // A fresh form (and a fresh action state) each time the drawer opens. State is adjusted during render,
  // not in an effect, so the new form is the first thing painted.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSession((n) => n + 1);
  }
  return <MoveSession key={session} open={open && target !== null} onClose={onClose} target={target} role={role} today={today} timezone={timezone} returnTo={returnTo} />;
}

function MoveSession({
  open,
  onClose,
  target,
  role,
  today,
  timezone,
  returnTo,
}: {
  open: boolean;
  onClose: () => void;
  target: MoveTarget | null;
  role: string;
  today: string;
  timezone: string;
  returnTo: string;
}) {
  const [state, formAction, pending] = useActionState(moveStage, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);

  const options = target ? allowedTargets(target.stage, role) : [];
  const initial = retainedText(values, "stage");
  const [chosen, setChosen] = useState<string>(initial);
  const [confirming, setConfirming] = useState(false);

  // Close when a submission finishes and produced no new failure: the action redirected, which means it worked.
  useCloseWhenDone(state, pending, onClose);
  useEffect(() => {
    if (!pending) confirmed.current = false;
  });

  if (!target) return null;

  const to: Stage | null = isStage(chosen) ? chosen : null;
  const fields = to ? moveFieldsFor(to) : { signedDate: false, reference: false, lostReason: false };
  const kind = to ? classifyMove(target.stage, to) : null;
  const needsConfirm = to ? moveNeedsConfirmation(target.stage, to) : false;
  const leaving = target.stage === "management_signed";

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      onSubmit={(e) => {
        // Leaving "signed" changes the count, so it is confirmed first. Confirming submits the form again.
        if (needsConfirm && !confirmed.current) {
          e.preventDefault();
          setConfirming(true);
        }
      }}
    >
      <Drawer
        open={open}
        onClose={onClose}
        title="Move to another stage"
        description={`${target.prospectName}, now ${STAGE_LABEL[target.stage]}`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            {options.length > 0 ? (
              <SubmitButton pendingLabel="Moving prospect" variant={needsConfirm ? "danger" : "primary"}>
                {needsConfirm ? "Review move" : "Move"}
              </SubmitButton>
            ) : null}
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix="move" />
          <input type="hidden" name="opportunity_id" value={target.opportunityId} />
          <input type="hidden" name="return_to" value={returnTo} />

          {target.stage === "management_signed" ? (
            <InlineNote>
              Signed{target.signedAt ? ` on ${formatDate(target.signedAt, timezone)}` : ""}
              {target.managementReference ? `, reference ${target.managementReference}` : ""}. This management is counted once.
            </InlineNote>
          ) : null}

          {options.length === 0 ? (
            <p className="text-[14px]">
              A signed management can only be moved out of signed by a director or administrator, because it changes the signed count. Ask one of them if it was signed by mistake.
            </p>
          ) : (
            <>
              <Select
                name="stage"
                idPrefix="move"
                label="Move to"
                required
                placeholder="Choose a stage"
                options={options.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
                defaultValue={initial}
                error={fieldError(state, "stage")}
                onChange={(e) => setChosen(e.target.value)}
                data-autofocus
              />

              {fields.signedDate ? (
                <>
                  <DateInput
                    name="signed_date"
                    idPrefix="move"
                    label="Date signed"
                    required
                    max={today}
                    defaultValue={retainedText(values, "signed_date", today)}
                    error={fieldError(state, "signed_date")}
                    hint="Not in the future."
                  />
                  <TextInput
                    name="management_reference"
                    idPrefix="move"
                    label="Management reference"
                    maxLength={100}
                    defaultValue={retainedText(values, "management_reference")}
                    error={fieldError(state, "management_reference")}
                    hint="Optional. The reference from your property management system, once it exists. It can only be recorded now, as the management is signed, so enter it here if you have it."
                  />
                  <InlineNote>A management is counted once, however many times this is submitted, and credited to the partner who first introduced the prospect.</InlineNote>
                </>
              ) : null}

              {fields.lostReason ? (
                <>
                  <Select
                    name="lost_reason_code"
                    idPrefix="move"
                    label="Why did it not proceed?"
                    required
                    placeholder="Choose a reason"
                    options={LOST_REASONS.map((r) => ({ value: r, label: LOST_REASON_LABEL[r] }))}
                    defaultValue={retainedText(values, "lost_reason_code")}
                    error={fieldError(state, "lost_reason_code")}
                  />
                  <TextInput
                    name="lost_reason"
                    idPrefix="move"
                    label="In a few words"
                    required
                    maxLength={300}
                    defaultValue={retainedText(values, "lost_reason")}
                    error={fieldError(state, "lost_reason")}
                    hint="For example: chose the agency that sold them the house. It is kept with the lead."
                  />
                </>
              ) : null}

              {leaving && to && kind !== "same" ? (
                <InlineNote>
                  Moving this out of Management signed reduces the signed count by one and clears the signed date and reference. Partner performance and the overview change with it.
                </InlineNote>
              ) : null}

              <Textarea
                name="note"
                idPrefix="move"
                label="Note"
                rows={3}
                maxLength={500}
                hint="Optional. Kept in the stage history."
                defaultValue={retainedText(values, "note")}
                error={fieldError(state, "note")}
              />
            </>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Move out of Management signed?"
        confirmLabel="Move out of signed"
        tone="danger"
        onConfirm={() => {
          confirmed.current = true;
          formRef.current?.requestSubmit();
        }}
      >
        <p>
          {target.prospectName} was counted as a signed management. Moving them to {to ? STAGE_LABEL[to] : "another stage"} reduces the signed count by one, and clears the signed date and
          the management reference. This is recorded in the stage history.
        </p>
      </ConfirmDialog>
    </form>
  );
}
