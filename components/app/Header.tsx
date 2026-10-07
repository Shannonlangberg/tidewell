"use client";

import Link from "next/link";
import { PEOPLE, property } from "@/lib/demo";
import { useAppState } from "./useAppState";

type Props = { back?: { href: string; label: string }; side?: React.ReactNode; title?: string };

export function Header({ back, side, title }: Props) {
  const { state } = useAppState();
  const me = PEOPLE.find((p) => p.id === state.person) ?? PEOPLE[0];
  const heading = title ?? (me.property ? property(me.property).name : me.role === "manager" ? "Tidewell" : me.name);

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
        {side ?? (!back && <Link href="/app/more" className="o-avatar" aria-label="Your account">{me.initials}</Link>)}
      </header>
      <p className="o-demo">Demo · sample homes, people and numbers</p>
    </>
  );
}
