import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentRoles, readSession } from "@/lib/auth";
import { ROLE_HOME, ROLE_LABEL } from "@/lib/roles";
import { chooseRole } from "@/app/app/actions";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "Who are you today? · Tidewell" };

const BLURB: Record<string, string> = {
  owner: "Your home: bookings, repairs, money.",
  crew: "Your jobs and your pay.",
  manager: "Every home, every message, every job.",
};

/** For people with more than one role. The choice is a cookie, never a URL privilege. */
export default async function Choose() {
  const session = await readSession("/app/choose");
  const roles = await currentRoles();
  if (roles.includes("manager") && session.claims.aal !== "aal2") redirect("/app/mfa");
  if (roles.length === 0) redirect("/app/route");
  if (roles.length === 1) redirect(ROLE_HOME[roles[0]]);

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
          <h1 className="o-title">which hat?</h1>
          <p className="o-status">You do more than one thing with us. Pick where to start; you can switch under More.</p>
        </div>
        <form action={chooseRole} className="o-list">
          {roles.map((role) => (
            <button
              key={role}
              type="submit"
              name="role"
              value={role}
              style={{ padding: "15px 0", display: "flex", gap: 13, alignItems: "center", border: 0, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit", background: "none" }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600, fontSize: 19 }}>{ROLE_LABEL[role]}</span>
                <span className="o-small" style={{ display: "block" }}>{BLURB[role]}</span>
              </span>
              <span className="o-small">›</span>
            </button>
          ))}
        </form>
        <section className="o-sep">
          <SignOutButton />
        </section>
      </main>
    </>
  );
}
