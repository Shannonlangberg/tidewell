import { redirect } from "next/navigation";
import { chosenRole, currentRoles, readSession } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/roles";
import { SignOutButton } from "@/components/app/SignOutButton";

/**
 * After sign-in: verified claims plus live memberships decide where to go.
 * A manager goes to /app/mfa until the session is aal2; one role lands on
 * /app/{role}; several on /app/choose (or the role already chosen, a cookie);
 * none sees "not set up yet".
 */
export default async function RouteAfterSignIn() {
  const session = await readSession("/app/route");
  const roles = await currentRoles();

  if (roles.includes("manager") && session.claims.aal !== "aal2") redirect("/app/mfa");
  if (roles.length === 1) redirect(ROLE_HOME[roles[0]]);
  if (roles.length > 1) {
    const chosen = await chosenRole();
    redirect(chosen && roles.includes(chosen) ? ROLE_HOME[chosen] : "/app/choose");
  }

  return (
    <>
      <header className="o-header" style={{ justifyContent: "flex-start" }}>
        <div className="o-header-title">
          <span aria-hidden className="o-tag-mark" />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, letterSpacing: "-.055em", lineHeight: 0.9 }}>tidewell</span>
        </div>
      </header>
      <main className="o-main">
        <div>
          <h1 className="o-title">not set up yet</h1>
          <p className="o-status">
            Your login works, but it isn&rsquo;t attached to a home or a job yet. Once it is, sign in again and you&rsquo;ll land in the right place.
          </p>
        </div>
        <section className="o-sep">
          <SignOutButton />
        </section>
      </main>
    </>
  );
}
