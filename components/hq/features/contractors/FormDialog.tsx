"use client";

import { useActionState, useId, type ReactNode } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import { Button } from "../../Button";
import { FieldError } from "../../Field";
import { SubmitButton } from "../../SubmitButton";
import { useModalDialog } from "../../useModalDialog";
import { useCloseWhenDone } from "../referrals/useCloseWhenDone";

/*
 * A native <dialog> that holds a real form posting to a Server Action, shared by the contractor
 * status actions, "Record a job" and the Trades editor. ConfirmDialog confirms with hidden fields
 * only; these need inputs inside the form and a confirm button that can stay disabled.
 */

export type FormDialogProps = {
  title: string;
  onClose: () => void;
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** Keeps the confirm button inert (not hidden), with the reason in the body. */
  confirmDisabled?: boolean;
  pending: boolean;
  children: ReactNode;
  action: (formData: FormData) => void;
  wide?: boolean;
};

export function FormDialog({ title, onClose, confirmLabel, tone = "primary", confirmDisabled, pending, children, action, wide }: FormDialogProps) {
  const { ref, handlers } = useModalDialog(true, onClose, { dismissible: !pending });
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className="hq-modal hq-confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      style={{ width: wide ? "min(36rem, calc(100vw - 32px))" : undefined, maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }}
      {...handlers}
    >
      <form action={action} className="hq-confirm__panel" noValidate>
        <h2 id={titleId} className="hq-confirm__title">
          {title}
        </h2>
        <div className="hq-confirm__body grid gap-4">{children}</div>
        <div className="hq-confirm__actions">
          <Button variant="secondary" onClick={onClose} disabled={pending} data-autofocus>
            Cancel
          </Button>
          <SubmitButton variant={tone} disabled={confirmDisabled} pendingLabel={`${confirmLabel} in progress`}>
            {confirmLabel}
          </SubmitButton>
        </div>
      </form>
    </dialog>
  );
}

/** One action's state: a failed attempt keeps the dialog open and says why; a redirect closes it. */
export function useDecision(action: (formData: FormData) => Promise<ActionState>, onClose: () => void) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (_prev, formData) => (await action(formData)) ?? idle, idle);
  useCloseWhenDone(state, pending, onClose);
  return { state, formAction, pending };
}

export function ErrorLine({ state }: { state: ActionState }) {
  if (state.ok || !state.message) return null;
  return (
    <div role="alert">
      <FieldError>{state.message}</FieldError>
    </div>
  );
}
