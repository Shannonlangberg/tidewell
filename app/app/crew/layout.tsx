import { RoleShell } from "@/components/app/RoleShell";

/** Shell guard for /app/crew/**: requireRole("crew") runs inside RoleShell before anything renders. */
export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return <RoleShell role="crew">{children}</RoleShell>;
}
