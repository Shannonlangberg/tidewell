"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { SubmitButton } from "./SubmitButton";
import { useModalDialog } from "./useModalDialog";

/*
 * ConfirmDialog: a small centred native <dialog> for a decision that is hard to undo
 * ("Archive contact"). The confirm button names the action; never "OK" or "Yes".
 * Cancel is focused first, so Enter does not destroy anything by accident.
 *
 * Two ways to confirm:
 *  - `action`: a Server Action (FormData in). The confirm button is a SubmitButton in a
 *    <form>, so it shows pending and the dialog stays open until the page navigates or
 *    you close it. `fields` become hidden inputs (e.g. the record id).
 *  - `onConfirm`: a client callback, sync or async. The dialog shows pending until it settles.
 */

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** The verb phrase on the button: "Archive contact", "Remove from pod". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  action?: (formData: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  onConfirm?: () => void | Promise<void>;
  className?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  action,
  fields,
  onConfirm,
  className,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const { ref, handlers } = useModalDialog(open, onClose, { dismissible: !busy });
  const titleId = useId();
  const descId = useId();
  const variant = tone === "danger" ? "danger" : "primary";

  async function run() {
    if (!onConfirm || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className={cx("hq-modal hq-confirm", className)}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={children ? descId : undefined}
      {...handlers}
    >
      <div className="hq-confirm__panel">
        <h2 id={titleId} className="hq-confirm__title">
          {title}
        </h2>
        {children ? (
          <div id={descId} className="hq-confirm__body">
            {children}
          </div>
        ) : null}
        {action ? (
          <form action={action} className="hq-confirm__actions">
            {Object.entries(fields ?? {}).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button variant="secondary" onClick={onClose} data-autofocus>
              {cancelLabel}
            </Button>
            <SubmitButton variant={variant} pendingLabel={`${confirmLabel} in progress`}>
              {confirmLabel}
            </SubmitButton>
          </form>
        ) : (
          <div className="hq-confirm__actions">
            <Button variant="secondary" onClick={onClose} disabled={busy} data-autofocus>
              {cancelLabel}
            </Button>
            <Button variant={variant} onClick={run} loading={busy} pendingLabel={`${confirmLabel} in progress`}>
              {confirmLabel}
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
}
