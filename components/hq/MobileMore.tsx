"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "./Avatar";
import { Drawer } from "./Drawer";
import { Icon } from "./icons";
import type { NavEntry } from "./nav";
import type { SignOutAction } from "./types";
import { SubmitButton } from "./SubmitButton";

/*
 * The "More" tab on phones: a button in the tab bar that opens a bottom sheet holding
 * every page that does not have its own tab (Partners, People, Insights, Settings, Profile),
 * the signed-in person, and Sign out. The tab shows the clay marker when the current
 * page lives in this sheet.
 */

export function MobileMore({
  entries,
  person,
  signOutAction,
}: {
  entries: readonly NavEntry[];
  person: { fullName: string; roleLabel: string };
  signOutAction: SignOutAction;
}) {
  const [open, setOpen] = useState(false);
  const containsCurrent = entries.some((e) => e.current);
  return (
    <>
      <button type="button" className="hq-tab" data-active={containsCurrent || undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="more" size={22} />
        <span>More</span>
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="More" placement="bottom" className="hq-more">
        <nav aria-label="More pages">
          <ul className="hq-more__list">
            {entries.map((e) => (
              <li key={e.key}>
                <Link href={e.href} className="hq-more__item" aria-current={e.current ? "page" : undefined} onClick={() => setOpen(false)}>
                  <Icon name={e.icon} size={20} />
                  <span>{e.label}</span>
                  {e.phase ? (
                    <>
                      {" "}
                      <span className="hq-more__tag">{e.phase}</span>
                    </>
                  ) : null}
                  <Icon name="chevron-right" size={16} className="hq-more__chev" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hq-more__person">
          <Avatar name={person.fullName} size="lg" />
          <p>
            <span className="hq-more__name">{person.fullName}</span>
            <span className="hq-more__role">{person.roleLabel}</span>
          </p>
        </div>
        <form action={signOutAction}>
          <SubmitButton variant="secondary" block icon="sign-out" pendingLabel="Signing out">
            Sign out
          </SubmitButton>
        </form>
      </Drawer>
    </>
  );
}
