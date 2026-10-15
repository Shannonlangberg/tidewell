"use client";

import { useCallback, useEffect, useRef } from "react";

/*
 * Drives a native <dialog> from React state.
 *
 * Native showModal() gives us the focus trap, an inert page behind, Esc to close and
 * the top layer for free. This hook adds what it does not do reliably:
 *  - the `open` argument is the single source of truth (Esc and the backdrop call onClose),
 *  - focus returns to whatever opened the dialog (including in Safari, which does not
 *    focus a button on click: we remember the last pressed control instead),
 *  - a click on the backdrop closes it, but a text selection that merely ENDS over the
 *    backdrop does not,
 *  - `dismissible: false` blocks Esc and backdrop (a confirm dialog while it is working).
 *
 * Give the dialog one inner wrapper that fills it, so the only clicks that land on the
 * <dialog> element itself are clicks on the backdrop.
 */

// The last control the person pressed, for focus return. Registered once, in the capture phase.
let lastPressed: HTMLElement | null = null;
let tracking = false;
function track() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("button, a[href], [tabindex]");
      if (el) lastPressed = el;
    },
    true,
  );
}

export function useModalDialog(open: boolean, onClose: () => void, options: { dismissible?: boolean } = {}) {
  const { dismissible = true } = options;
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const programmatic = useRef(false);
  const pressedOnBackdrop = useRef(false);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    track();
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : lastPressed;
      dialog.showModal();
      // React's autoFocus does not run when a dialog opens, so honour a marker instead.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      programmatic.current = true;
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (e: Event) => {
      if (!dismissibleRef.current) e.preventDefault();
    };
    const handleClose = () => {
      if (programmatic.current) programmatic.current = false;
      else onCloseRef.current();
      const target = opener.current;
      opener.current = null;
      // Wait a frame: the dialog is still leaving the top layer at this point.
      if (target && target.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDialogElement>) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback((e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget && pressedOnBackdrop.current && dismissibleRef.current) onCloseRef.current();
    pressedOnBackdrop.current = false;
  }, []);

  return { ref, handlers: { onPointerDown, onClick } };
}
