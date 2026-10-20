"use client";

import { useState } from "react";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { SubmitButton } from "../../SubmitButton";

/*
 * The buttons on a website enquiry's page (growth.write): set the status (In progress, Archive, back
 * to New) and Mark as spam, which is confirmed in a dialog because it also archives the lead and the
 * contact this enquiry created when nobody has worked on them. Each posts to a Server Action passed
 * in as a prop (this file imports no server code); the actions check the capability again and the
 * database decides in the end. The status buttons are plain forms, so they work without JavaScript.
 */

type Action = (formData: FormData) => void | Promise<void>;

export type EnquiryControlsProps = {
  id: string;
  refLabel: string;
  status: "new" | "in_progress" | "spam" | "archived";
  /** True when the enquiry made its own lead (spam may archive it). */
  createdLead: boolean;
  setStatus: Action;
  markSpam: Action;
};

function StatusButton({ id, to, label, action }: { id: string; to: string; label: string; action: Action }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={to} />
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </form>
  );
}

export function EnquiryControls({ id, refLabel, status, createdLead, setStatus, markSpam }: EnquiryControlsProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "new" ? <StatusButton id={id} to="in_progress" label="Mark in progress" action={setStatus} /> : null}
        {status === "new" || status === "in_progress" ? <StatusButton id={id} to="archived" label="Archive" action={setStatus} /> : null}
        {status === "archived" || status === "spam" ? <StatusButton id={id} to="new" label={status === "spam" ? "Not spam: back to New" : "Back to New"} action={setStatus} /> : null}
        {status !== "spam" ? (
          <Button variant="danger" onClick={() => setOpen(true)}>
            Mark as spam
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Mark ${refLabel} as spam?`}
        confirmLabel="Mark as spam"
        cancelLabel="Keep it"
        tone="danger"
        action={markSpam}
        fields={{ id }}
      >
        <p>The enquiry is kept, marked as spam, with your name on it.</p>
        <p className="mt-2">
          {createdLead
            ? "The lead and the contact it created are archived too, unless someone has already worked on them (a call, a note, a task, a stage change). Nothing is deleted."
            : "It joined a lead that already existed, so that lead and its contact are left as they are."}
        </p>
      </ConfirmDialog>
    </>
  );
}
