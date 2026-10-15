"use client";

import { useActionState, useState } from "react";
import {
  DOCUMENT_NOTE_MAX,
  DOCUMENT_TYPE_LABEL,
  VERIFICATION_LABEL,
  type DocumentType,
  type Verification,
} from "@/lib/hq/contractors/documents-rules";
import { idle, type ActionState } from "@/lib/hq/forms";
import { Button } from "@/components/hq/Button";
import { Checkbox, RadioGroup } from "@/components/hq/Choice";
import { Drawer } from "@/components/hq/Drawer";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { DateInput, Textarea } from "@/components/hq/TextInput";
import { reviewDocumentAction } from "./actions";

/*
 * "Review": record that a person has checked a document (verified), refused it (rejected, with a
 * reason), or put it back to not yet checked. For a licence or public liability insurance, a
 * verified document can also be recorded on the contractor (its verified date and expiry), as an
 * explicit choice. Verifying a document NEVER approves a contractor or changes its status.
 */

const LABELS = { verification: "Decision", expires_on: "Expiry date", note: "Note", apply_to_contractor: "Record on the contractor" };

export type ReviewTarget = {
  id: string;
  documentType: DocumentType;
  fileName: string;
  verification: Verification;
  expiresOn: string | null;
  note: string | null;
  /** True for a licence or public liability insurance: the only types that can be recorded on the contractor. */
  canApply: boolean;
  /** "licence" or "insurance": what "record on the contractor" refers to. */
  appliesTo: "licence" | "insurance" | null;
};

export function DocumentReview({ doc }: { doc: ReviewTarget }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
        aria-label={`Review ${DOCUMENT_TYPE_LABEL[doc.documentType]} ${doc.fileName}`}
      >
        Review
      </Button>
      <ReviewSession key={session} doc={doc} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ReviewSession({ doc, open, onClose }: { doc: ReviewTarget; open: boolean; onClose: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(reviewDocumentAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;
  const [choice, setChoice] = useState<Verification>((values.verification as Verification | undefined) ?? (doc.verification === "pending" ? "verified" : doc.verification));
  const [lastOk, setLastOk] = useState<ActionState | null>(null);
  if (state.ok && state !== lastOk) {
    setLastOk(state);
    if (open) onClose();
  }
  const idPrefix = `review-${doc.id}`;

  return (
    <form action={formAction} noValidate className="contents">
      <Drawer
        open={open}
        onClose={onClose}
        title="Review document"
        description={`${DOCUMENT_TYPE_LABEL[doc.documentType]}: ${doc.fileName}`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix={idPrefix} />
          <input type="hidden" name="document_id" value={doc.id} />

          <div
            onChange={(e) => {
              const t = e.target as HTMLInputElement;
              if (t.name === "verification") setChoice(t.value as Verification);
            }}
          >
            <RadioGroup
              name="verification"
              idPrefix={idPrefix}
              legend="Decision"
              required
              defaultValue={choice}
              error={fieldError(state, "verification")}
              options={[
                { value: "verified", label: VERIFICATION_LABEL.verified, hint: "You have checked the document and it is genuine and current." },
                { value: "rejected", label: VERIFICATION_LABEL.rejected, hint: "It cannot be accepted. A reason is required." },
                { value: "pending", label: "Not yet checked", hint: "Undo an earlier decision." },
              ]}
            />
          </div>

          <DateInput
            name="expires_on"
            idPrefix={idPrefix}
            label="Expiry date"
            hint="As shown on the document. Leave as it is to keep the current date."
            defaultValue={values.expires_on ?? doc.expiresOn ?? ""}
            error={fieldError(state, "expires_on")}
          />

          <Textarea
            name="note"
            idPrefix={idPrefix}
            label={choice === "rejected" ? "Why is it rejected?" : "Note"}
            required={choice === "rejected"}
            rows={3}
            maxLength={DOCUMENT_NOTE_MAX}
            hint={choice === "rejected" ? "Required, so the reason is on record." : "Optional."}
            defaultValue={values.note ?? doc.note ?? ""}
            error={fieldError(state, "note")}
          />

          {doc.canApply && choice === "verified" ? (
            <Checkbox
              name="apply_to_contractor"
              idPrefix={idPrefix}
              label={`Also record this ${doc.appliesTo} on the contractor`}
              hint={`Sets the contractor's ${doc.appliesTo} verified date to today and its expiry to this document's. It never changes whether the contractor is approved.`}
              defaultChecked={values.apply_to_contractor === "on"}
              error={fieldError(state, "apply_to_contractor")}
            />
          ) : null}

          <p className="hq-muted text-[13px]">Verifying a document does not approve a contractor. Approval is a separate action.</p>
        </div>
      </Drawer>
    </form>
  );
}
