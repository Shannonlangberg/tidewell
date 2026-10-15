import type { ReactNode } from "react";
import { AppShell } from "@/components/hq";
import { requireStaff } from "@/lib/hq/auth";
import { searchAction, signOutAction } from "../actions";

/*
 * Everything signed-in in Planted HQ lives under this route group. It is a shell and a
 * first gate, not the only one: Next.js does not re-run a layout on client-side
 * navigation, so EVERY page loader and EVERY Server Action also calls requireStaff()
 * itself (with the capability it needs). That is where authorisation really happens,
 * and row level security is the control behind it.
 *
 * Never rendered for signed-out people: requireStaff() redirects to /hq/sign-in (or to
 * /hq/mfa when a second factor is still owed).
 */

export const dynamic = "force-dynamic";

export default async function HqAppLayout({ children }: { children: ReactNode }) {
  const { staff } = await requireStaff();
  return (
    <AppShell
      staff={{ fullName: staff.fullName, role: staff.role, capabilities: staff.capabilities }}
      signOutAction={signOutAction}
      searchAction={searchAction}
    >
      {children}
    </AppShell>
  );
}
