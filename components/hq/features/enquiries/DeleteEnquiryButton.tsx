"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { FieldError } from "../../Field";
import { TextInput } from "../../TextInput";

/*
 * "Delete" for directors: a danger button and a confirmation that asks for the enquiry's number
 * (ENQ-0001) to be typed. Deleting removes the enquiry for good; the lead and contact it made are
 * archived first when nobody has worked on them. The Server Action checks the director role and the
 * database checks the role and the number again; hiding this button is a courtesy only.
 */

export function DeleteEnquiryButton({
  id,
  refLabel,
  name,
  createdLead,
  spam = false,
  action,
  back,
  size = "md",
}: {
  id: string;
  refLabel: string;
  name: string;
  /** True when the enquiry made its own lead (deleting may archive it). */
  createdLead: boolean;
  /** Already marked as spam: its lead and contact were tidied up then. */
  spam?: boolean;
  action: (formData: FormData) => Promise<ActionState>;
  /** Where to land after deleting (the list with its filters). */
  back?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  async function submit(formData: FormData) {
    formData.set("confirm", typed);
    const result = await action(formData);
    if (result && !result.ok) setError(result.fieldErrors?.confirm ?? result.message ?? "Something went wrong. Nothing was deleted.");
  }

  return (
    <>
      <Button
        variant="danger"
        size={size}
        onClick={() => {
          setTyped("");
          setError(null);
          setOpen(true);
        }}
      >
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onClose={close}
        title={`Delete ${refLabel} (${name})?`}
        confirmLabel="Delete enquiry"
        cancelLabel="Keep it"
        tone="danger"
        action={submit}
        fields={back ? { id, back } : { id }}
      >
        <p>This removes the enquiry for good. It cannot be undone.</p>
        <p className="mt-2">
          {spam
            ? "It is already marked as spam, so the lead and contact it created were archived then, unless someone had worked on them."
            : createdLead
              ? "The lead and contact it created are archived too, unless someone has already worked on them. Their copy of the message stays with them."
              : "It joined a lead that already existed, so that lead and its contact are left as they are."}
        </p>
        <div className="mt-4">
          <TextInput name="delete-confirm" idPrefix={`delete-${id}`} label={`Type ${refLabel} to confirm`} autoComplete="off" maxLength={20} value={typed} onChange={(e) => setTyped(e.target.value)} />
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
