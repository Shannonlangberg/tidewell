"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { FieldError } from "../../Field";
import { TextInput } from "../../TextInput";

/*
 * "Archive": a danger button and a confirmation that asks for an optional reason. The reason is
 * kept in the audit log. Archiving is a soft delete: the record leaves every list but its
 * history is kept, and a director can restore it.
 *
 * The action is a Server Action that returns an error state to show here, or redirects away
 * on success. It checks growth.delete itself; hiding this button is a courtesy only.
 */

export function ArchiveButton({
  id,
  noun,
  name,
  action,
  consequence,
  size = "md",
  fields,
}: {
  id: string;
  /** "contact" or "organisation". */
  noun: string;
  /** Shown in the dialog title. */
  name: string;
  action: (formData: FormData) => Promise<ActionState>;
  /** What archiving means for this record, in a sentence. */
  consequence: string;
  size?: "sm" | "md";
  /** More hidden fields for the action (for example where to go back to). */
  fields?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  // A client wrapper around the Server Action, so the reason typed in the dialog travels with
  // the form post. On success the action redirects and this never returns; on failure it shows why.
  async function submit(formData: FormData) {
    formData.set("reason", reason);
    const result = await action(formData);
    if (result && !result.ok) setError(result.fieldErrors?.reason ?? result.message ?? "Something went wrong. Nothing was archived.");
  }

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        onClick={() => {
          setReason("");
          setError(null);
          setOpen(true);
        }}
      >
        Archive
      </Button>
      <ConfirmDialog open={open} onClose={close} title={`Archive ${name}?`} confirmLabel={`Archive ${noun}`} tone="danger" action={submit} fields={{ ...fields, id }}>
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
        {error ? (
          <div className="mt-3" role="alert">
            <FieldError>{error}</FieldError>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
