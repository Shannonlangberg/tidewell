"use client";

import Link from "next/link";
import { PEOPLE, property } from "@/lib/demo";
import { useOptionalRole } from "./RoleContext";

type Props = { back?: { href: string; label: string }; side?: React.ReactNode; title?: string };

/**
 * The role comes from the session (RoleContext). Until the screens are rewired
 * the demo persona for that role supplies the property name; the initials are
 * the signed-in person's own when their profile row exists.
 */
export function Header({ back, side, title }: Props) {
  const session = useOptionalRole();
  const me = PEOPLE.find((p) => p.role === (session?.role ?? "owner")) ?? PEOPLE[0];
  const heading = title ?? (me.property ? property(me.property).name : me.role === "manager" ? "Tidewell" : (session?.firstName ?? me.name));
  const initials = session?.initials ?? me.initials;

  return (
    <>
      <header className="o-header">
        {back ? (
          <div className="o-header-title">
            <Link href={back.href} className="o-back" aria-label="Back">‹</Link>
            {back.label}
          </div>
        ) : (
          <div className="o-header-title">
            <span aria-hidden className="o-tag-mark" />
            {heading}
          </div>
        )}
        {side ?? (!back && <Link href="/app/more" className="o-avatar" aria-label="Your account">{initials}</Link>)}
      </header>
      <p className="o-demo">Demo · sample homes, people and numbers</p>
    </>
  );
}
