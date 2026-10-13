"use client";

import { createContext, useContext } from "react";
import type { AppRole } from "@/lib/roles";

/**
 * What the server layout knows about the signed-in person, handed to client
 * components (TabBar, Header). The role comes from the session, never the URL.
 */
export type SessionRole = {
  role: AppRole;
  /** Every role this person holds, for the switcher on /app/more. */
  roles: AppRole[];
  firstName: string | null;
  initials: string | null;
};

const RoleContext = createContext<SessionRole | null>(null);

export function RoleProvider({ value, children }: { value: SessionRole; children: React.ReactNode }) {
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole(): SessionRole {
  const value = useContext(RoleContext);
  if (!value) throw new Error("useRole() must be used inside a role layout");
  return value;
}

export function useOptionalRole(): SessionRole | null {
  return useContext(RoleContext);
}
