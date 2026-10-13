import { requireAnyRole } from "@/lib/auth";
import { RoleShell } from "@/components/app/RoleShell";

/**
 * /app/more is shared by every role. The role shown is the one chosen on
 * /app/choose (a cookie) or the first the person holds; requireAnyRole()
 * redirects to /app when they hold none.
 */
export default async function MoreLayout({ children }: { children: React.ReactNode }) {
  const { role } = await requireAnyRole();
  return <RoleShell role={role}>{children}</RoleShell>;
}
