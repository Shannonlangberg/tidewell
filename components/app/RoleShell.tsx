import { currentRoles } from "@/lib/auth";
import { loadProfile } from "@/lib/data";
import type { AppRole } from "@/lib/roles";
import { RoleProvider } from "./RoleContext";
import { TabBar } from "./TabBar";

/**
 * Server shell for one role: `requireRole(role)` runs first (inside loadProfile),
 * then the role, the person's other roles and their name go to the client
 * components by context. This guards the shell only; layouts do not re-render
 * on client-side navigation, so every loader in lib/data and every Server
 * Action calls requireRole() again.
 */
export async function RoleShell({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const { profile } = await loadProfile(role);
  const roles = await currentRoles();
  return (
    <RoleProvider value={{ role, roles, firstName: profile?.first_name ?? null, initials: profile?.initials ?? null }}>
      {children}
      <TabBar />
    </RoleProvider>
  );
}
