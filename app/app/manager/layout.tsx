import { RoleShell } from "@/components/app/RoleShell";

/**
 * Shell guard for /app/manager/**: requireRole("manager") runs inside RoleShell
 * before anything renders, and it also requires an aal2 session (TOTP verified),
 * so nothing manager-only renders before /app/mfa.
 */
export default function ManagerLayout({ children }: { children: React.ReactNode }) {
  return <RoleShell role="manager">{children}</RoleShell>;
}
