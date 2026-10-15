"use client";

import { useEffect, useRef } from "react";

/*
 * A drawer that holds a form posting to a Server Action which REDIRECTS on success (the usual
 * HQ pattern: redirect(withToast(...))). A redirect returns no new state, so the drawer cannot see
 * "it worked" directly. What it can see is a submission that finished without producing a new
 * result: a failure always returns a new state object (the page behind keeps the drawer open and
 * shows the errors), so "was pending, is not, state unchanged" means the action redirected.
 *
 * Pass the `state` and `pending` from useActionState.
 */
export function useCloseWhenDone(state: unknown, pending: boolean, onClose: () => void): void {
  const wasPending = useRef(false);
  const lastState = useRef(state);
  useEffect(() => {
    if (wasPending.current && !pending && lastState.current === state) onClose();
    wasPending.current = pending;
    lastState.current = state;
  });
}
