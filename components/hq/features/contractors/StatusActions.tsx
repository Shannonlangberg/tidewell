"use client";

import { useState } from "react";
import {
  approveContractor,
  changeContractorStatus,
  reinstateContractor,
  suspendContractor,
} from "@/app/hq/(app)/partners/actions";
import { CONTRACTOR_STATUS_LABEL, VETTING_STEP_LABEL, type ContractorStatus, type VettingStep } from "@/lib/hq/constants";
import type { ApprovalPreview, StatusActionSet } from "@/lib/hq/contractors/status";
import { blockedText } from "@/lib/hq/contractors/status";
import { formatDate } from "@/lib/hq/format";
import { Button } from "../../Button";
import { ErrorLine, FormDialog, useDecision } from "./FormDialog";
import { Checkbox } from "../../Choice";
import { fieldError } from "../../Field";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker } from "../../Select";
import { Textarea } from "../../TextInput";

/*
 * The status actions on a contractor's page: Approve (and make or remove Preferred), Suspend,
 * Reinstate, and the other moves. Each opens a small dialog that says plainly what will happen
 * and asks for a note where one is required.
 *
 * What is offered here is a courtesy (the page decides from the person's capabilities). The
 * Server Actions check the capability again, and the database refuses a move the person may not
 * make, so hiding or showing a button never decides anything.
 *
 * Approval is the one that matters most. The dialog shows the vetting checklist state and the
 * warnings the database reports (read from preview_contractor_approval, which writes nothing),
 * requires a note, and states that the person is approving. Preferred is a separate, explicit tick.
 */

type Props = {
  contractorId: string;
  businessName: string;
  status: ContractorStatus;
  actions: StatusActionSet;
  /** Present when approval or Preferred is offered. null when it could not be loaded. */
  preview: ApprovalPreview | null;
};

export function StatusActions({ contractorId, businessName, status, actions, preview }: Props) {
  const [open, setOpen] = useState<null | "approve" | "prefer" | "unprefer" | "suspend" | "reinstate" | "move">(null);
  const close = () => setOpen(null);

  const any = actions.approve || actions.prefer || actions.removePreferred || actions.suspend || actions.reinstate || actions.moves.length > 0;
  if (!any) return null;

  return (
    <>
      {actions.approve ? (
        <Button size="sm" variant="primary" icon="check" onClick={() => setOpen("approve")}>
          Approve
        </Button>
      ) : null}
      {actions.prefer ? (
        <Button size="sm" onClick={() => setOpen("prefer")}>
          Make preferred
        </Button>
      ) : null}
      {actions.removePreferred ? (
        <Button size="sm" onClick={() => setOpen("unprefer")}>
          Remove preferred
        </Button>
      ) : null}
      {actions.reinstate ? (
        <Button size="sm" variant="primary" onClick={() => setOpen("reinstate")}>
          Reinstate
        </Button>
      ) : null}
      {actions.moves.length > 0 ? (
        <Button size="sm" onClick={() => setOpen("move")}>
          Change status
        </Button>
      ) : null}
      {actions.suspend ? (
        <Button size="sm" variant="danger" onClick={() => setOpen("suspend")}>
          Suspend
        </Button>
      ) : null}

      {open === "approve" || open === "prefer" || open === "unprefer" ? (
        <ApproveDialog key={open} mode={open} contractorId={contractorId} businessName={businessName} preview={preview} onClose={close} />
      ) : null}
      {open === "suspend" ? <SuspendDialog contractorId={contractorId} businessName={businessName} onClose={close} /> : null}
      {open === "reinstate" ? <ReinstateDialog contractorId={contractorId} businessName={businessName} onClose={close} /> : null}
      {open === "move" ? <MoveDialog contractorId={contractorId} businessName={businessName} status={status} targets={actions.moves} onClose={close} /> : null}
    </>
  );
}

// ── approve / prefer / remove preferred ──────────────────────

function ApproveDialog({
  mode,
  contractorId,
  businessName,
  preview,
  onClose,
}: {
  mode: "approve" | "prefer" | "unprefer";
  contractorId: string;
  businessName: string;
  preview: ApprovalPreview | null;
  onClose: () => void;
}) {
  const { state, formAction, pending } = useDecision(approveContractor, onClose);
  const [preferred, setPreferred] = useState(mode === "prefer");
  const blocked = preview === null ? "We couldn't check this contractor's checklist, so approval isn't available right now. Reload the page and try again." : blockedText(preview.blockedBy);
  const missing = preview?.missingSteps ?? [];
  const warnings = preview?.warnings ?? [];

  const title = mode === "approve" ? `Approve ${businessName}?` : mode === "prefer" ? `Make ${businessName} a preferred contractor?` : `Remove ${businessName} as a preferred contractor?`;
  const makePreferred = mode === "unprefer" ? false : preferred;
  const confirmLabel = mode === "unprefer" ? "Remove preferred" : makePreferred ? "Approve as preferred" : mode === "prefer" ? "Make preferred" : "Approve contractor";

  return (
    <FormDialog title={title} onClose={onClose} confirmLabel={confirmLabel} confirmDisabled={Boolean(blocked)} pending={pending} action={formAction} wide>
      <input type="hidden" name="id" value={contractorId} />
      {makePreferred ? <input type="hidden" name="make_preferred" value="on" /> : null}

      <p>
        {mode === "unprefer"
          ? "They stay approved and can still be sent to a property. They will no longer be listed as preferred."
          : mode === "prefer"
            ? "They are already approved. Preferred contractors are the first ones to call. This is recorded against your name."
            : "You are approving this contractor. Once approved they can be sent to Planted's properties. This is recorded against your name, with your note, and it is a decision a person makes: nothing about their documents or checklist approves them on its own."}
      </p>

      {mode === "approve" ? (
        <div>
          <p className="font-semibold text-charcoal">Vetting checklist</p>
          {preview === null ? (
            <p className="mt-1">The checklist could not be loaded.</p>
          ) : missing.length === 0 ? (
            <p className="mt-1">Steps 1 to 8 are complete (done, or marked not applicable with a reason).</p>
          ) : (
            <>
              <p className="mt-1">
                {missing.length === 1 ? "1 step is" : `${missing.length} steps are`} not complete yet, so approval is not possible:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {missing.map((s) => (
                  <li key={s}>{VETTING_STEP_LABEL[s as VettingStep] ?? s}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}

      {mode !== "unprefer" && warnings.length > 0 ? (
        <div>
          <p className="font-semibold text-charcoal">{warnings.length === 1 ? "One thing to check first" : `${warnings.length} things to check first`}</p>
          <ul className="mt-1 grid gap-1.5">
            {warnings.map((w) => (
              <li key={w.code} className="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>
                  {w.message}
                  {w.expiresOn ? ` (${w.daysRemaining !== null && w.daysRemaining < 0 ? "expired" : "expires"} ${formatDate(w.expiresOn)})` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-grey-text">These do not stop you approving. They are shown so you decide with them in front of you.</p>
        </div>
      ) : null}

      {blocked ? <InlineNote>{blocked}</InlineNote> : null}

      {mode === "approve" ? (
        <Checkbox
          name="ticked_preferred"
          idPrefix={`pref-${contractorId}`}
          label="Also make them a preferred contractor"
          hint="A separate choice. Leave it unticked to approve them without making them a first call."
          checked={preferred}
          onChange={(e) => setPreferred(e.target.checked)}
        />
      ) : null}

      <Textarea
        name="note"
        idPrefix={`approve-${contractorId}`}
        label={mode === "unprefer" ? "Note (required)" : "Note for the record (required)"}
        required
        rows={3}
        maxLength={1000}
        hint={mode === "approve" ? `Say what you checked and why you are approving them, for example “Spoke to two property managers who use them; licence and insurance sighted.”` : "Why you are making this change."}
        error={fieldError(state, "note")}
      />
      <ErrorLine state={state} />
    </FormDialog>
  );
}

// ── suspend ──────────────────────────────────────────────────

function SuspendDialog({ contractorId, businessName, onClose }: { contractorId: string; businessName: string; onClose: () => void }) {
  const { state, formAction, pending } = useDecision(suspendContractor, onClose);
  return (
    <FormDialog title={`Suspend ${businessName}?`} onClose={onClose} confirmLabel="Suspend contractor" tone="danger" pending={pending} action={formAction}>
      <input type="hidden" name="id" value={contractorId} />
      <p>They will be marked suspended straight away, so nobody sends them to a property. Their records and documents are kept. Only a director or administrator can reinstate them, and they return to vetting.</p>
      <Textarea
        name="note"
        idPrefix={`suspend-${contractorId}`}
        label="Reason (required)"
        required
        rows={3}
        maxLength={1000}
        hint="What happened. It is kept with their record."
        error={fieldError(state, "note")}
      />
      <ErrorLine state={state} />
    </FormDialog>
  );
}

// ── reinstate ────────────────────────────────────────────────

function ReinstateDialog({ contractorId, businessName, onClose }: { contractorId: string; businessName: string; onClose: () => void }) {
  const { state, formAction, pending } = useDecision(reinstateContractor, onClose);
  return (
    <FormDialog title={`Reinstate ${businessName}?`} onClose={onClose} confirmLabel="Reinstate contractor" pending={pending} action={formAction}>
      <input type="hidden" name="id" value={contractorId} />
      <p>They return to vetting, not to approved. To send them to a property again, approve them once the checklist is complete.</p>
      <Textarea name="note" idPrefix={`reinstate-${contractorId}`} label="Note (optional)" rows={3} maxLength={1000} hint="Why they are being reinstated." error={fieldError(state, "note")} />
      <ErrorLine state={state} />
    </FormDialog>
  );
}

// ── other moves ──────────────────────────────────────────────

function MoveDialog({
  contractorId,
  businessName,
  status,
  targets,
  onClose,
}: {
  contractorId: string;
  businessName: string;
  status: ContractorStatus;
  targets: readonly ContractorStatus[];
  onClose: () => void;
}) {
  const { state, formAction, pending } = useDecision(changeContractorStatus, onClose);
  const leavingCleared = status === "approved" || status === "preferred";
  return (
    <FormDialog title={`Change status of ${businessName}`} onClose={onClose} confirmLabel="Change status" pending={pending} action={formAction}>
      <input type="hidden" name="id" value={contractorId} />
      <p>
        Now: <b className="font-semibold text-charcoal">{CONTRACTOR_STATUS_LABEL[status]}</b>.{" "}
        {leavingCleared ? "Moving them out of approved means they are no longer cleared to be sent to a property, and their approval step is reset." : "This does not approve anyone: approval is its own action."}
      </p>
      <NativeSelectPicker
        name="status"
        idPrefix={`move-${contractorId}`}
        label="New status"
        required
        placeholder="Choose a status"
        options={targets.map((s) => ({ value: s, label: CONTRACTOR_STATUS_LABEL[s] }))}
        error={fieldError(state, "status")}
        data-autofocus
      />
      <Textarea name="note" idPrefix={`move-note-${contractorId}`} label="Note (optional)" rows={3} maxLength={1000} error={fieldError(state, "note")} />
      <ErrorLine state={state} />
    </FormDialog>
  );
}
