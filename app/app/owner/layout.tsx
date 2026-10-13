import { RoleShell } from "@/components/app/RoleShell";

/** Shell guard for /app/owner/**: requireRole("owner") runs inside RoleShell before anything renders. */
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <RoleShell role="owner">{children}</RoleShell>;
}
