import type { ReactNode } from "react";
import { AppShell } from "@/components/hq";
import { requireStaff } from "@/lib/hq/auth";
import { countNewEnquiries } from "@/lib/hq/enquiry-queries";
import { loadSavedWorkspace } from "@/lib/hq/workspace-queries";
import { navWorkspace } from "@/lib/hq/workspaces";
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
 *
 * The Enquiries badge: for people who can see website enquiries (growth.read), ONE
 * head-only count of enquiries still New and unhandled, as the person (RLS), on each full
 * render of the shell. Nothing is cached and no enquiry data reaches the page: only the number.
 *
 * The navigation follows the person's saved workspace, else their role's (lib/hq/workspaces.ts): it
 * orders the groups and picks the phone's tabs. It never hides anything the capabilities allow.
 */

export const dynamic = "force-dynamic";

export default async function HqAppLayout({ children }: { children: ReactNode }) {
  const { staff, db, can } = await requireStaff();
  const [fresh, saved] = await Promise.all([can("growth.read") ? countNewEnquiries(db) : null, loadSavedWorkspace(db, staff.id)]);
  return (
    <AppShell
      staff={{ fullName: staff.fullName, role: staff.role, capabilities: staff.capabilities }}
      signOutAction={signOutAction}
      searchAction={searchAction}
      badges={fresh?.ok ? { enquiries: fresh.data } : {}}
      workspace={navWorkspace(saved, staff.role)}
    >
      {children}
    </AppShell>
  );
}
