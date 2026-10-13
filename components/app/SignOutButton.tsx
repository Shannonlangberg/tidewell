"use client";

import { useTransition } from "react";
import { signOut } from "@/app/app/actions";
import { EMPTY, STORAGE_KEY, useAppState } from "@/components/app/useAppState";

/**
 * Sign out wipes everything of a person from this browser: the demo state in
 * localStorage (only the appearance choice survives), then the session and the
 * role cookie through the Server Action, which lands on /app.
 */
export function SignOutButton({ className = "o-link", style }: { className?: string; style?: React.CSSProperties }) {
  const [pending, start] = useTransition();
  const { update } = useAppState();

  return (
    <button
      type="button"
      className={className}
      style={{ fontSize: 15, ...style }}
      disabled={pending}
      onClick={() => {
        update((s) => ({ ...EMPTY, theme: s.theme }));
        try {
          for (const key of Object.keys(localStorage)) {
            if (key !== STORAGE_KEY) localStorage.removeItem(key);
          }
          sessionStorage.clear();
        } catch {
          /* storage unavailable */
        }
        start(() => signOut());
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
