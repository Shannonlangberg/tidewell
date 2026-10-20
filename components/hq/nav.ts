import { HQ_BASE, type Capability, type StaffRole } from "@/lib/hq/constants";
import { isPropertyManagerRole } from "@/lib/hq/today";
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
  /** Referral partners (agencies, brokers, advisers who refer to us). NOT the contractor "Partners" module below. */
  referralPartners: `${HQ_BASE}/growth/partners`,
  contacts: `${HQ_BASE}/growth/contacts`,
  contactNew: `${HQ_BASE}/growth/contacts/new`,
  /** Opens the "log a call" flow on the contacts page (the contacts builder reads `?log=call`). */
  logCall: `${HQ_BASE}/growth/contacts?log=call`,
  organisations: `${HQ_BASE}/growth/organisations`,
  referrals: `${HQ_BASE}/growth/referrals`,
  referralNew: `${HQ_BASE}/growth/referrals/new`,
  pipeline: `${HQ_BASE}/growth/pipeline`,
  partners: `${HQ_BASE}/partners`,
  partnerNew: `${HQ_BASE}/partners/new`,
  partnerImport: `${HQ_BASE}/partners/import`,
  /** One container per trade (industry), with the editable list of trades. */
  partnerTrades: `${HQ_BASE}/partners/trades`,
  operations: `${HQ_BASE}/operations`,
  taskNew: `${HQ_BASE}/operations/tasks/new`,
  people: `${HQ_BASE}/people`,
  /** Figures and trends: referral figures, partner performance, contractor coverage. */
  reports: `${HQ_BASE}/reports`,
  /** The Business Decisions Register: what was decided, why, and whether it still stands. */
  decisions: `${HQ_BASE}/decisions`,
  /** Old address of Reports; redirects there. */
  insights: `${HQ_BASE}/insights`,
  settings: `${HQ_BASE}/settings`,
  profile: `${HQ_BASE}/profile`,
} as const;

// ── global search ────────────────────────────────────────────

/** What `global_search` returns, mapped to the page that shows each kind of record. */
export type SearchKind = "contacts" | "organisations" | "referrals" | "tasks" | "contractors";

const SEARCH_PATHS: Record<SearchKind, (id: string) => string> = {
  contacts: (id) => `${HQ_ROUTES.contacts}/${encodeURIComponent(id)}`,
  organisations: (id) => `${HQ_ROUTES.organisations}/${encodeURIComponent(id)}`,
  referrals: (id) => `${HQ_ROUTES.referrals}/${encodeURIComponent(id)}`,
  tasks: (id) => `${HQ_ROUTES.operations}/tasks/${encodeURIComponent(id)}`,
  contractors: (id) => `${HQ_ROUTES.partners}/${encodeURIComponent(id)}`,
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
  { kind: "contractors", label: "Contractors", icon: "partners" },
];

// ── primary navigation ───────────────────────────────────────

export type NavKey = "dashboard" | "growth" | "partners" | "operations" | "people" | "reports" | "decisions" | "settings" | "profile";

/**
 * One navigation entry. Labels are the words a property manager or BDM would use; the routes
 * behind them have not changed (Tasks is still /hq/operations, Contractors is /hq/partners).
 *
 * - `requires` hides the entry entirely when the signed-in person lacks that
 *   capability. Hiding is a courtesy: the database (RLS) is the actual control.
 * - `mobile` says where it sits below 1024px by default: a bottom tab, or inside the More
 *   sheet. mobileTabs() picks the tabs for the person's role.
 */
export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  requires?: Capability;
  mobile: "tab" | "more";
};

export const PRIMARY_NAV: readonly NavItem[] = [
  { key: "dashboard", label: "Today", href: HQ_ROUTES.dashboard, icon: "dashboard", mobile: "tab" },
  { key: "growth", label: "Growth", href: HQ_ROUTES.growth, icon: "growth", requires: "growth.read", mobile: "tab" },
  { key: "operations", label: "Tasks", href: HQ_ROUTES.operations, icon: "operations", mobile: "tab" },
  { key: "partners", label: "Contractors", href: HQ_ROUTES.partners, icon: "partners", requires: "contractors.read", mobile: "more" },
  { key: "people", label: "People", href: HQ_ROUTES.people, icon: "people", requires: "people.read", mobile: "more" },
  { key: "reports", label: "Reports", href: HQ_ROUTES.reports, icon: "insights", mobile: "more" },
  { key: "decisions", label: "Decisions", href: HQ_ROUTES.decisions, icon: "note", requires: "decisions.read", mobile: "more" },
];

/** Settings (sidebar footer) and Profile (the person block, and the mobile More sheet). */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { key: "settings", label: "Settings", href: HQ_ROUTES.settings, icon: "settings", mobile: "more" },
  { key: "profile", label: "Profile", href: HQ_ROUTES.profile, icon: "user", mobile: "more" },
];

export function visibleNav(items: readonly NavItem[], capabilities: readonly string[]): NavItem[] {
  return items.filter((item) => !item.requires || capabilities.includes(item.requires));
}

/**
 * The bottom tabs on a phone (three, then More): Today, Growth, Tasks for most people; Today,
 * Tasks, Contractors for property managers, whose day is tasks and contractors. A page the person
 * cannot see is skipped and the next visible page takes its place. Sidebar order is kept.
 */
export function mobileTabs(visible: readonly NavItem[], role: StaffRole): NavItem[] {
  const wanted: NavKey[] = isPropertyManagerRole(role) ? ["dashboard", "operations", "partners"] : ["dashboard", "growth", "operations"];
  const picked = new Set(wanted.filter((k) => visible.some((i) => i.key === k)));
  for (const i of visible) {
    if (picked.size >= 3) break;
    picked.add(i.key);
  }
  return visible.filter((i) => picked.has(i.key));
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
  current: boolean;
};

export function toEntries(items: readonly NavItem[], active: NavKey | null): NavEntry[] {
  return items.map((i) => ({ key: i.key, label: i.label, href: i.href, icon: i.icon, current: i.key === active }));
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
  { key: "contractor", label: "Add contractor", href: HQ_ROUTES.partnerNew, icon: "partners", requires: "contractors.write" },
];

export function visibleQuickActions(capabilities: readonly string[]): QuickAction[] {
  return QUICK_ACTIONS.filter((a) => !a.requires || capabilities.includes(a.requires));
}
