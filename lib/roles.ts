/**
 * Role names shared by server and client code. Tenant is out of v1.
 * Nothing here is an authorisation decision: the database re-checks
 * `memberships` on every query, and `lib/auth.ts` on every request.
 */
export const ROLES = ["owner", "crew", "manager"] as const;
export type AppRole = (typeof ROLES)[number];

export const ROLE_LABEL: Record<AppRole, string> = { owner: "Owner", crew: "Crew", manager: "Manager" };

/** Where each role lands after sign-in. */
export const ROLE_HOME: Record<AppRole, string> = { owner: "/app/owner", crew: "/app/crew", manager: "/app/manager" };

/** The chosen role for people who hold several. A preference cookie, never a privilege. */
export const ROLE_COOKIE = "tw-role";

/** The address waiting for a sign-in code, between /app and /app/verify. Never in the URL. */
export const OTP_EMAIL_COOKIE = "tw-otp-email";

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
