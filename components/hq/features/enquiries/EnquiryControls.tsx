"use client";

import { useState } from "react";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { SubmitButton } from "../../SubmitButton";
import type { ActionState } from "@/lib/hq/forms";
import { ArchiveButton } from "../contacts/ArchiveButton";
import { DeleteEnquiryButton } from "./DeleteEnquiryButton";

/*
 * The buttons on a website enquiry's page (growth.write): Mark in progress, Archive (confirmed, with an
 * optional reason; reversible), Restore (back to the status it had), Not spam: back to New, and Mark as
 * spam, which is confirmed in a dialog because it also archives the lead and the contact this enquiry
 * created when nobody has worked on them. Directors also get Delete (the ENQ number typed to confirm). Each posts to a Server Action passed
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
  archive: (formData: FormData) => Promise<ActionState>;
  /** What archiving means, for the confirmation (ENQUIRY_ARCHIVE_CONSEQUENCE; passed in so this file imports no server code). */
  archiveConsequence: string;
  restore: Action;
  /** Directors only: deletes the enquiry for good. */
  deleteEnquiry?: (formData: FormData) => Promise<ActionState>;
  /** The enquiry's name, for the delete confirmation. */
  name: string;
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

export function EnquiryControls({ id, refLabel, status, createdLead, setStatus, markSpam, archive, archiveConsequence, restore, deleteEnquiry, name }: EnquiryControlsProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "new" ? <StatusButton id={id} to="in_progress" label="Mark in progress" action={setStatus} /> : null}
        {status === "new" || status === "in_progress" ? <ArchiveButton id={id} noun="enquiry" name={refLabel} action={archive} consequence={archiveConsequence} /> : null}
        {status === "archived" ? (
          <form action={restore}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton variant="secondary">Restore</SubmitButton>
          </form>
        ) : null}
        {status === "spam" ? <StatusButton id={id} to="new" label="Not spam: back to New" action={setStatus} /> : null}
        {status !== "spam" ? (
          <Button variant="danger" onClick={() => setOpen(true)}>
            Mark as spam
          </Button>
        ) : null}
        {deleteEnquiry ? <DeleteEnquiryButton id={id} refLabel={refLabel} name={name} createdLead={createdLead} spam={status === "spam"} action={deleteEnquiry} /> : null}
      </div>

      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={`Mark ${refLabel} as spam?`} confirmLabel="Mark as spam" cancelLabel="Keep it" tone="danger" action={markSpam} fields={{ id }}>
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
