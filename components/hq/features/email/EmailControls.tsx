"use client";

import { useState } from "react";
import { Button, LinkButton } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { cx } from "../../cx";

/*
 * The buttons on an email (its page, and the Today card): Approve and send, Send now (an approved
 * email held back, for example by the daily limit), Edit and Discard. Each posts to a Server Action
 * passed in as a prop (this file imports no server code); the actions check the capability again and
 * the database decides in the end. Sending is always confirmed in a dialog that names the exact
 * recipient and address, because it cannot be undone.
 */

type Action = (formData: FormData) => void | Promise<void>;

export type EmailControlsProps = {
  id: string;
  refLabel: string;
  toName: string;
  toEmail: string;
  fromLabel: string;
  replyTo: string;
  /** What the person may do, decided on the server from their capabilities and the email's status. */
  can: { approveAndSend: boolean; sendNow: boolean; edit: boolean; discard: boolean };
  approveAndSend: Action;
  sendNow: Action;
  discard: Action;
  /** Where to come back to after the action (an HQ path). */
  returnTo?: string;
  compact?: boolean;
};

export function EmailControls({ id, refLabel, toName, toEmail, fromLabel, replyTo, can, approveAndSend, sendNow, discard, returnTo, compact }: EmailControlsProps) {
  const [open, setOpen] = useState<null | "send" | "discard">(null);
  const close = () => setOpen(null);
  const fields: Record<string, string> = returnTo ? { id, return_to: returnTo } : { id };
  const size = compact ? "sm" : "md";
  const btn = compact ? "hq-today__btn" : undefined;
  const sendLabel = can.approveAndSend ? "Approve and send" : "Send now";

  if (!can.approveAndSend && !can.sendNow && !can.edit && !can.discard) return null;

  return (
    <>
      <div className={cx("flex flex-wrap gap-2", compact && "hq-today__actions")}>
        {can.approveAndSend || can.sendNow ? (
          <Button variant="primary" size={size} icon="mail" className={btn} onClick={() => setOpen("send")} aria-label={compact ? `${sendLabel}: ${refLabel} to ${toName}` : undefined}>
            {sendLabel}
          </Button>
        ) : null}
        {can.edit ? (
          <LinkButton href={`/hq/email/${id}/edit`} size={size} icon="note" className={btn} aria-label={compact ? `Edit ${refLabel}` : undefined}>
            Edit
          </LinkButton>
        ) : null}
        {can.discard ? (
          <Button variant={compact ? "secondary" : "danger"} size={size} className={btn} onClick={() => setOpen("discard")} aria-label={compact ? `Discard ${refLabel}` : undefined}>
            Discard
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={open === "send"}
        onClose={close}
        title={can.approveAndSend ? `Approve and send ${refLabel}?` : `Send ${refLabel} now?`}
        confirmLabel={sendLabel}
        cancelLabel="Not yet"
        action={can.approveAndSend ? approveAndSend : sendNow}
        fields={fields}
      >
        <p>
          It goes to <strong>{toName}</strong> at <strong className="break-all">{toEmail}</strong>, the address on their HQ record.
        </p>
        <p className="mt-2">
          From {fromLabel}. Replies go to <span className="break-all">{replyTo}</span>.
        </p>
        <p className="mt-2">{can.approveAndSend ? "You are approving it. An email cannot be recalled once it is sent." : "An email cannot be recalled once it is sent."}</p>
      </ConfirmDialog>

      <ConfirmDialog open={open === "discard"} onClose={close} title={`Discard ${refLabel}?`} confirmLabel="Discard email" cancelLabel="Keep it" tone="danger" action={discard} fields={fields}>
        It will never be sent. HQ keeps a record that it was discarded. To email {toName}, draft a new one.
      </ConfirmDialog>
    </>
  );
}
