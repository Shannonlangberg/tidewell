import { HQ_BASE, type Capability } from "@/lib/hq/constants";
import type { IconName } from "./icons";

/*
 * Navigation and route constants for the HQ shell. Everything that names a URL the
 * shell links to lives here, so a route can be renamed in one place.
 *
 * Server-safe and client-safe: no imports beyond constants and a type.
 */

// ── routes the shell, quick add and search point at ──────────

export const HQ_ROUTES = {
  dashboard: HQ_BASE,
  growth: `${HQ_BASE}/growth`,
  contacts: `${HQ_BASE}/growth/contacts`,
  contactNew: `${HQ_BASE}/growth/contacts/new`,
  /** Opens the "log a call" flow on the contacts page (the contacts builder reads `?log=call`). */
  logCall: `${HQ_BASE}/growth/contacts?log=call`,
  organisations: `${HQ_BASE}/growth/organisations`,
  referrals: `${HQ_BASE}/growth/referrals`,
  referralNew: `${HQ_BASE}/growth/referrals/new`,
  pipeline: `${HQ_BASE}/growth/pipeline`,
  partners: `${HQ_BASE}/partners`,
  operations: `${HQ_BASE}/operations`,
  taskNew: `${HQ_BASE}/operations/tasks/new`,
  people: `${HQ_BASE}/people`,
  insights: `${HQ_BASE}/insights`,
  settings: `${HQ_BASE}/settings`,
  profile: `${HQ_BASE}/profile`,
} as const;

// ── global search ────────────────────────────────────────────

/** What `global_search` returns, mapped to the page that shows each kind of record. */
export type SearchKind = "contacts" | "organisations" | "referrals" | "tasks";

const SEARCH_PATHS: Record<SearchKind, (id: string) => string> = {
  contacts: (id) => `${HQ_ROUTES.contacts}/${encodeURIComponent(id)}`,
  organisations: (id) => `${HQ_ROUTES.organisations}/${encodeURIComponent(id)}`,
  referrals: (id) => `${HQ_ROUTES.referrals}/${encodeURIComponent(id)}`,
  tasks: (id) => `${HQ_ROUTES.operations}/tasks/${encodeURIComponent(id)}`,
};

export function hrefForSearchHit(kind: SearchKind, id: string): string {
  return SEARCH_PATHS[kind](id);
}

/** Result groups in the order the palette shows them. */
export const SEARCH_GROUPS: ReadonlyArray<{ kind: SearchKind; label: string; icon: IconName }> = [
  { kind: "contacts", label: "Contacts", icon: "user" },
  { kind: "organisations", label: "Organisations", icon: "building" },
  { kind: "referrals", label: "Referrals", icon: "link" },
  { kind: "tasks", label: "Tasks", icon: "task" },
];

// ── primary navigation ───────────────────────────────────────

export type NavKey = "dashboard" | "growth" | "partners" | "operations" | "people" | "insights" | "settings" | "profile";

/**
 * One navigation entry.
 *
 * - `status: "built"` is live in this phase. `"planned"` still shows, quietly tagged
 *   ("Phase 2"), so the shape of HQ is visible and the page it links to can say so.
 * - `requires` hides the entry entirely when the signed-in person lacks that
 *   capability. Hiding is a courtesy: the database (RLS) is the actual control.
 * - `mobile` says where it sits below 1024px: a bottom tab, or inside the More sheet.
 */
export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  status: "built" | "planned";
  /** The phase a planned module arrives in, shown as a quiet tag. */
  phase?: 2 | 3 | 4 | 5;
  requires?: Capability;
  mobile: "tab" | "more";
};

export const PRIMARY_NAV: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: HQ_ROUTES.dashboard, icon: "dashboard", status: "built", mobile: "tab" },
  { key: "growth", label: "Growth", href: HQ_ROUTES.growth, icon: "growth", status: "built", requires: "growth.read", mobile: "tab" },
  { key: "partners", label: "Partners", href: HQ_ROUTES.partners, icon: "partners", status: "planned", phase: 2, mobile: "more" },
  { key: "operations", label: "Operations", href: HQ_ROUTES.operations, icon: "operations", status: "built", mobile: "tab" },
  { key: "people", label: "People", href: HQ_ROUTES.people, icon: "people", status: "built", requires: "people.read", mobile: "more" },
  { key: "insights", label: "Insights", href: HQ_ROUTES.insights, icon: "insights", status: "planned", phase: 4, mobile: "more" },
];

/** Settings (sidebar footer) and Profile (the person block, and the mobile More sheet). */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { key: "settings", label: "Settings", href: HQ_ROUTES.settings, icon: "settings", status: "built", mobile: "more" },
  { key: "profile", label: "Profile", href: HQ_ROUTES.profile, icon: "user", status: "built", mobile: "more" },
];

export function visibleNav(items: readonly NavItem[], capabilities: readonly string[]): NavItem[] {
  return items.filter((item) => !item.requires || capabilities.includes(item.requires));
}

/** "Phase 2" for a planned module, otherwise null. */
export function phaseLabel(item: Pick<NavItem, "status" | "phase">): string | null {
  return item.status === "planned" && item.phase ? `Phase ${item.phase}` : null;
}

/**
 * Which nav key owns a pathname. The longest matching href wins, and the dashboard
 * (`/hq`) matches only itself so it does not stay lit on every page. Pages may use
 * this to compute `active` for AppShell from `usePathname()`.
 */
export function navKeyForPath(pathname: string): NavKey | null {
  const all = [...PRIMARY_NAV, ...ACCOUNT_NAV];
  let best: NavItem | null = null;
  for (const item of all) {
    const exact = pathname === item.href;
    const nested = item.href !== HQ_ROUTES.dashboard && pathname.startsWith(`${item.href}/`);
    if ((exact || nested) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** The plain-data form of a nav entry, safe to pass from a Server Component to a Client Component. */
export type NavEntry = {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  phase: string | null;
  current: boolean;
};

export function toEntries(items: readonly NavItem[], active: NavKey | null): NavEntry[] {
  return items.map((i) => ({ key: i.key, label: i.label, href: i.href, icon: i.icon, phase: phaseLabel(i), current: i.key === active }));
}

// ── quick add ────────────────────────────────────────────────

export type QuickAction = {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  /** Hidden when the person lacks it. */
  requires?: Capability;
};

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: "contact", label: "Add contact", href: HQ_ROUTES.contactNew, icon: "user", requires: "growth.write" },
  { key: "call", label: "Log a call", href: HQ_ROUTES.logCall, icon: "phone", requires: "growth.write" },
  { key: "task", label: "New task", href: HQ_ROUTES.taskNew, icon: "task", requires: "tasks.write" },
  { key: "referral", label: "Record a referral", href: HQ_ROUTES.referralNew, icon: "link", requires: "growth.write" },
];

export function visibleQuickActions(capabilities: readonly string[]): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => !a.requires || capabilities.includes(a.requires));
}
