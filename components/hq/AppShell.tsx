import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LABEL } from "@/lib/hq/constants";
import { ActiveLink } from "./ActiveLink";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { MobileMore } from "./MobileMore";
import {
  ACCOUNT_NAV,
  PRIMARY_NAV,
  phaseLabel,
  toEntries,
  visibleNav,
  visibleQuickActions,
  type NavItem,
  type NavKey,
} from "./nav";
import { QuickAdd } from "./QuickAdd";
import { AskPlantedButton, MobileSearchButton, SearchTrigger } from "./ShellButtons";
import { ShellProvider } from "./ShellProvider";
import type { SearchAction, ShellStaff, SignOutAction } from "./types";
import { Wordmark } from "./Wordmark";

/*
 * The signed-in chrome. A Server Component: the page passes through as `children`.
 *
 *  - 1024px and up: a fixed charcoal sidebar (wordmark block, navigation, Settings, the
 *    signed-in person) and a slim soft-white top bar (breadcrumb slot, search, Quick add,
 *    Ask Planted).
 *  - below 1024px: a purpose-built mobile layout, NOT the desktop shrunk: a charcoal header
 *    (wordmark, search, Ask Planted), a bottom tab bar (Dashboard, Growth, Operations,
 *    More) with a clay marker on the current page, a More sheet for everything else, and
 *    a floating Quick add button.
 *
 * Contract:
 *  - `staff` is the verified signed-in person (from requireStaff()). Navigation entries and
 *    quick actions the person lacks the capability for are not rendered. That is a courtesy;
 *    RLS is the control.
 *  - `active` is OPTIONAL. Left out, every link works out whether it is current from the URL
 *    (ActiveLink), which is what a shared layout needs because it cannot see the path. Pass a
 *    NavKey to force a section, or null to light nothing.
 *  - `signOutAction` is a Server Action (FormData in) that ends the session and redirects.
 *    The shell posts a <form> to it; it never touches auth itself.
 *  - `searchAction` is a Server Action `(query: string) => Promise<SearchResults>` that
 *    runs global_search as the signed-in person.
 *  - `breadcrumb` fills the top bar's left slot on desktop (optional; PageHeader has its own).
 */

export type AppShellProps = {
  staff: ShellStaff;
  active?: NavKey | null;
  children: ReactNode;
  signOutAction: SignOutAction;
  searchAction: SearchAction;
  breadcrumb?: ReactNode;
};

function SidebarLink({ item, active }: { item: NavItem; active?: NavKey | null }) {
  const phase = phaseLabel(item);
  return (
    <ActiveLink href={item.href} className="hq-nav__item" navKey={item.key} override={active}>
      <Icon name={item.icon} size={18} className="hq-nav__icon" />
      <span>{item.label}</span>
      {phase ? (
        <>
          {" "}
          <span className="hq-nav__tag">{phase}</span>
        </>
      ) : null}
    </ActiveLink>
  );
}

export function AppShell({ staff, active, children, signOutAction, searchAction, breadcrumb }: AppShellProps) {
  const caps = staff.capabilities;
  const primary = visibleNav(PRIMARY_NAV, caps);
  const account = visibleNav(ACCOUNT_NAV, caps);
  const settings = account.find((i) => i.key === "settings");
  const profile = account.find((i) => i.key === "profile");
  const quickActions = visibleQuickActions(caps);
  const roleLabel = ROLE_LABEL[staff.role];

  const tabs = primary.filter((i) => i.mobile === "tab");
  const more = [...primary.filter((i) => i.mobile === "more"), ...account];

  return (
    <ShellProvider searchAction={searchAction} nav={toEntries(primary, active ?? null)} quickActions={quickActions}>
      <a className="hq-skip" href="#hq-main">
        Skip to content
      </a>

      <div className="hq-shell">
        {/* ── desktop sidebar ── */}
        <aside className="hq-sidebar hq-on-dark" aria-label="Planted HQ">
          <Wordmark />
          <nav aria-label="Primary">
            <ul className="hq-nav">
              {primary.map((item) => (
                <li key={item.key}>
                  <SidebarLink item={item} active={active} />
                </li>
              ))}
            </ul>
            {settings ? (
              <>
                <hr className="hq-nav__rule" />
                <ul className="hq-nav">
                  <li>
                    <SidebarLink item={settings} active={active} />
                  </li>
                </ul>
              </>
            ) : null}
          </nav>

          <div className="hq-person">
            <Avatar name={staff.fullName} onDark />
            {profile ? (
              <ActiveLink href={profile.href} className="hq-person__link" navKey="profile" override={active}>
                <span className="hq-person__name">{staff.fullName}</span> <span className="hq-person__role">{roleLabel}</span>
                <span className="sr-only">, your profile</span>
              </ActiveLink>
            ) : (
              <span className="hq-person__link">
                <span className="hq-person__name">{staff.fullName}</span>
                <span className="hq-person__role">{roleLabel}</span>
              </span>
            )}
            <form action={signOutAction} className="hq-person__out">
              <button type="submit" className="hq-signout-btn" aria-label="Sign out" title="Sign out">
                <Icon name="sign-out" size={18} />
              </button>
            </form>
          </div>
        </aside>

        <div className="hq-shell__main">
          {/* ── desktop top bar ── */}
          <header className="hq-topbar">
            {breadcrumb ? <div className="hq-topbar__crumbs">{breadcrumb}</div> : null}
            <SearchTrigger />
            <span className="hq-topbar__spacer" />
            <QuickAdd actions={quickActions} />
            <AskPlantedButton />
          </header>

          {/* ── mobile header ── */}
          <header className="hq-mheader hq-on-dark">
            <Link href="/hq" className="hq-mheader__brand">
              PLANTED.
              <span className="sr-only"> HQ, dashboard</span>
            </Link>
            <div className="hq-mheader__actions">
              <MobileSearchButton />
              <AskPlantedButton onDark size="sm" />
            </div>
          </header>

          <main id="hq-main" tabIndex={-1} className="hq-main">
            <div className="hq-content">{children}</div>
          </main>
        </div>
      </div>

      {/* ── mobile: bottom tab bar and floating quick add ── */}
      <nav className="hq-tabbar" aria-label="Primary, mobile">
        {tabs.map((item) => (
          <ActiveLink key={item.key} href={item.href} className="hq-tab" navKey={item.key} override={active}>
            <Icon name={item.icon} size={22} />
            <span>{item.label}</span>
          </ActiveLink>
        ))}
        <MobileMore
          entries={toEntries(more, active ?? null)}
          active={active}
          person={{ fullName: staff.fullName, roleLabel }}
          signOutAction={signOutAction}
        />
      </nav>
      <div className="hq-fab-wrap">
        <QuickAdd actions={quickActions} variant="fab" />
      </div>
    </ShellProvider>
  );
}

