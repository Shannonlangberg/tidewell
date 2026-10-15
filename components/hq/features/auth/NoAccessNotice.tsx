"use client";

import { useEffect, type ReactNode } from "react";
import { endSessionAction } from "@/app/hq/auth-actions";
import { ErrorState } from "@/components/hq/EmptyState";

/*
 * Shown on the sign-in screen when someone is signed in to Supabase but is not (or is no
 * longer) a member of staff. When `endSession` is true it also ends their session on this
 * device, so they are never left holding a login for an app they cannot use. The page only
 * sets it for a visitor who really holds a non-staff session.
 */

export function NoAccessNotice({ title, children, endSession }: { title: string; children: ReactNode; endSession: boolean }) {
  useEffect(() => {
    if (endSession) void endSessionAction();
  }, [endSession]);

  return (
    <ErrorState title={title} className="mb-8">
      {children}
    </ErrorState>
  );
}
