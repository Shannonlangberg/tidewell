"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { INBOX, PEOPLE, REPAIRS, needsHuman, type Role } from "@/lib/demo";
import { useAppState } from "./useAppState";

type Tab = { href: string; label: string; badge?: boolean };

export function roleFromPath(path: string): Role | null {
  const seg = path.split("/")[2];
  return seg === "owner" || seg === "tenant" || seg === "crew" || seg === "manager" ? seg : null;
}

export function TabBar() {
  const path = usePathname();
  const { state } = useAppState();
  const role = roleFromPath(path) ?? PEOPLE.find((p) => p.id === state.person)?.role ?? "owner";

  const ownerWaiting = REPAIRS.some((r) => r.status === "decision" && !state.approved.includes(r.id));
  const unanswered = INBOX.some((m) => needsHuman(m) && !state.sent.includes(m.id) && !state.handback.includes(m.id));

  const TABS: Record<Role, Tab[]> = {
    owner: [
      { href: "/app/owner", label: "Home" },
      { href: "/app/owner/bookings", label: "Bookings" },
      { href: "/app/owner/repairs", label: "Repairs", badge: ownerWaiting },
      { href: "/app/owner/money", label: "Money" },
      { href: "/app/more", label: "More" },
    ],
    tenant: [
      { href: "/app/tenant", label: "Home" },
      { href: "/app/tenant/rent", label: "Rent" },
      { href: "/app/tenant/repairs", label: "Repairs" },
      { href: "/app/tenant/documents", label: "Papers" },
      { href: "/app/more", label: "More" },
    ],
    crew: [
      { href: "/app/crew", label: "Jobs" },
      { href: "/app/crew/pay", label: "Pay" },
      { href: "/app/more", label: "More" },
    ],
    manager: [
      { href: "/app/manager", label: "Today" },
      { href: "/app/manager/inbox", label: "Inbox", badge: unanswered },
      { href: "/app/manager/homes", label: "Homes" },
      { href: "/app/manager/jobs", label: "Jobs" },
      { href: "/app/more", label: "More" },
    ],
  };

  const tabs = TABS[role];
  return (
    <nav className="o-tabs" aria-label="Tidewell">
      {tabs.map((t) => {
        const root = t.href.split("/").length === 3; // /app/<role> — exact match only
        const active = root ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className="o-tab" aria-current={active ? "page" : undefined}>
            <div className="o-tab-icon" aria-hidden />
            {t.badge && <span className="o-tab-badge" aria-label="needs attention" />}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
