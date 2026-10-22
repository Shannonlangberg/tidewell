import { HQ_BASE, type Capability } from "@/lib/hq/constants";
import { COMMS_BASE, COMMS_TAB_PATH, OLD_EMAIL_LIST, OLD_ENQUIRIES_LIST, badgeText } from "@/lib/hq/communications";
import { mobileTabKeys, navGroupOrder, NAV_GROUP_LABEL, type NavGroup, type Workspace } from "@/lib/hq/workspaces";
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
  /** The website enquiries tab of Communications (its own entry under Grow, with the new-enquiry badge). */
  enquiries: COMMS_TAB_PATH.enquiries,
  /** The emails tab of Communications (under Work). */
  emails: COMMS_TAB_PATH.emails,
  partners: `${HQ_BASE}/partners`,
  partnerNew: `${HQ_BASE}/partners/new`,
  partnerImport: `${HQ_BASE}/partners/import`,
  /** One container per trade (industry), with the editable list of trades. */
  partnerTrades: `${HQ_BASE}/partners/trades`,
  operations: `${HQ_BASE}/operations`,
  /** Projects: milestones, tasks, board and timeline for the larger pieces of work. */
  projects: `${HQ_BASE}/projects`,
  taskNew: `${HQ_BASE}/operations/tasks/new`,
  people: `${HQ_BASE}/people`,
  /** Figures and trends: referral figures, partner performance, contractor coverage. */
  reports: `${HQ_BASE}/reports`,
  /** Managed properties (the light HQ record and Ailo handover checklist; Ailo holds the rest). */
  portfolio: `${HQ_BASE}/portfolio`,
  /** The Business Decisions Register: what was decided, why, and whether it still stands. */
  decisions: `${HQ_BASE}/decisions`,
  /** The Knowledge base: procedures, policies, checklists and how PLANTED. speaks (approved versions for staff). */
  knowledge: `${HQ_BASE}/knowledge`,
  /** Resources: PLANTED.'s brand library (guide, logos, photos, colours and type, tokens, UI kit). Everyone reads and downloads it. */
  resources: `${HQ_BASE}/resources`,
  /** Meetings: minutes, summaries and action items, mostly saved from ChatGPT or Claude through the HQ connector. */
  meetings: `${HQ_BASE}/meetings`,
  meetingNew: `${HQ_BASE}/meetings/new`,
  /** Website enquiries and branded emails, one tab each (the old /hq/email and /hq/growth/enquiries lists redirect here). */
  communications: COMMS_BASE,
  /** Old address of the email list; redirects to Communications > Emails. Email pages (/hq/email/<id>, /new) stay. */
  email: OLD_EMAIL_LIST,
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

export type NavKey =
  | "dashboard"
  | "contacts"
  | "referralPartners"
  | "pipeline"
  | "enquiries"
  | "emails"
  | "portfolio"
  | "partners"
  | "operations"
  | "projects"
  | "people"
  | "reports"
  | "meetings"
  | "decisions"
  | "knowledge"
  | "resources"
  | "settings"
  | "profile";

/**
 * One navigation entry. Labels are the words a property manager or BDM would use; the routes
 * behind them have not changed (Tasks is still /hq/operations, Contractors is /hq/partners).
 *
 * - `requires` hides the entry entirely when the signed-in person lacks that
 *   capability; `requiresAny` when they hold none of those. Hiding is a courtesy: the
 *   database (RLS) is the actual control.
 * - `also` lists other path prefixes that belong to the entry (pages kept at an older
 *   address), so it lights there too and wins over a shorter match.
 * - `group` is the labelled group (Grow, Work, Deliver, Company). The person's workspace decides the
 *   order of the groups and the phone's three tabs (lib/hq/workspaces.ts); it never hides anything.
 */
export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  requires?: Capability;
  requiresAny?: readonly Capability[];
  also?: readonly string[];
  /** The labelled group it sits in (docs/hq-workspaces.md); Today and the account entries have none. */
  group?: NavGroup;
};

export const PRIMARY_NAV: readonly NavItem[] = [
  { key: "dashboard", label: "Today", href: HQ_ROUTES.dashboard, icon: "dashboard" },
  // Grow. Contacts also owns organisations, referrals and the import (their pages sit under /hq/growth);
  // the Growth overview's referral figures are reached from Reports, so /hq/growth itself lights Reports.
  {
    key: "contacts",
    label: "Contacts",
    href: HQ_ROUTES.contacts,
    icon: "user",
    requires: "growth.read",
    also: [HQ_ROUTES.organisations, HQ_ROUTES.referrals, `${HQ_BASE}/growth/import`],
    group: "grow",
  },
  { key: "referralPartners", label: "Referral partners", href: HQ_ROUTES.referralPartners, icon: "link", requires: "growth.read", group: "grow" },
  { key: "pipeline", label: "Pipeline", href: HQ_ROUTES.pipeline, icon: "growth", requires: "growth.read", also: [`${HQ_BASE}/growth/opportunities`], group: "grow" },
  // Enquiries also lights the Communications hub itself (it opens on this tab for anyone with growth.read).
  { key: "enquiries", label: "Enquiries", href: HQ_ROUTES.enquiries, icon: "mail", requires: "growth.read", also: [OLD_ENQUIRIES_LIST, COMMS_BASE], group: "grow" },
  // Work
  { key: "operations", label: "Tasks", href: HQ_ROUTES.operations, icon: "operations", group: "work" },
  { key: "projects", label: "Projects", href: HQ_ROUTES.projects, icon: "projects", requires: "projects.read", group: "work" },
  { key: "meetings", label: "Meetings", href: HQ_ROUTES.meetings, icon: "calendar", requires: "meetings.read", group: "work" },
  { key: "emails", label: "Emails", href: HQ_ROUTES.emails, icon: "note", requires: "email.draft", also: [OLD_EMAIL_LIST], group: "work" },
  // Deliver
  { key: "portfolio", label: "Properties", href: HQ_ROUTES.portfolio, icon: "building", requires: "portfolio.read", group: "deliver" },
  { key: "partners", label: "Contractors", href: HQ_ROUTES.partners, icon: "partners", requires: "contractors.read", group: "deliver" },
  // Company
  { key: "decisions", label: "Decisions", href: HQ_ROUTES.decisions, icon: "note", requires: "decisions.read", group: "company" },
  { key: "knowledge", label: "Knowledge", href: HQ_ROUTES.knowledge, icon: "book", requires: "knowledge.read", group: "company" },
  { key: "resources", label: "Resources", href: HQ_ROUTES.resources, icon: "resources", requires: "resources.read", group: "company" },
  { key: "people", label: "People", href: HQ_ROUTES.people, icon: "people", requires: "people.read", group: "company" },
  { key: "reports", label: "Reports", href: HQ_ROUTES.reports, icon: "insights", also: [HQ_ROUTES.growth], group: "company" },
];

/** Settings (sidebar footer) and Profile (the person block, and the mobile More sheet). */
export const ACCOUNT_NAV: readonly NavItem[] = [
  { key: "settings", label: "Settings", href: HQ_ROUTES.settings, icon: "settings" },
  { key: "profile", label: "Profile", href: HQ_ROUTES.profile, icon: "user" },
];

export function visibleNav(items: readonly NavItem[], capabilities: readonly string[]): NavItem[] {
  return items.filter(
    (item) => (!item.requires || capabilities.includes(item.requires)) && (!item.requiresAny || item.requiresAny.some((c) => capabilities.includes(c))),
  );
}

/** The visible entries in labelled groups, the person's workspace's group first (Today is not in a group). */
export function navGroups(visible: readonly NavItem[], workspace: Workspace): { key: NavGroup; label: string; items: NavItem[] }[] {
  return navGroupOrder(workspace)
    .map((g) => ({ key: g, label: NAV_GROUP_LABEL[g], items: visible.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);
}

/**
 * The bottom tabs on a phone (three, then More), chosen by the workspace: Grow: Today, Contacts, Pipeline;
 * Deliver: Today, Tasks, Contractors; Support: Today, Enquiries, Tasks; Overview: Today, Tasks, Projects. A page
 * the person cannot see is skipped and the next visible page (in the workspace's group order) takes its place.
 */
export function mobileTabs(visible: readonly NavItem[], workspace: Workspace): NavItem[] {
  const ordered = [...visible.filter((i) => !i.group), ...navGroups(visible, workspace).flatMap((g) => g.items)];
  const picked: NavItem[] = [];
  for (const key of mobileTabKeys(workspace)) {
    const item = ordered.find((i) => i.key === key);
    if (item) picked.push(item);
  }
  for (const i of ordered) {
    if (picked.length >= 3) break;
    if (!picked.includes(i)) picked.push(i);
  }
  return picked;
}

/**
 * Which nav key owns a pathname. The longest matching href wins, and the dashboard
 * (`/hq`) matches only itself so it does not stay lit on every page. Pages may use
 * this to compute `active` for AppShell from `usePathname()`.
 */
export function navKeyForPath(pathname: string): NavKey | null {
  const all = [...PRIMARY_NAV, ...ACCOUNT_NAV];
  let best: { key: NavKey; length: number } | null = null;
  for (const item of all) {
    for (const href of [item.href, ...(item.also ?? [])]) {
      const exact = pathname === href;
      const nested = href !== HQ_ROUTES.dashboard && pathname.startsWith(`${href}/`);
      if ((exact || nested) && (!best || href.length > best.length)) best = { key: item.key, length: href.length };
    }
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
  /** A small count after the label (for example new website enquiries on Communications); absent for zero. */
  badge?: string;
};

/** Counts shown on nav entries, by key. A count is a plain number the layout read for this person. */
export type NavBadges = Partial<Record<NavKey, number>>;

export function toEntries(items: readonly NavItem[], active: NavKey | null, badges: NavBadges = {}): NavEntry[] {
  return items.map((i) => {
    const badge = badgeText(badges[i.key]);
    return { key: i.key, label: i.label, href: i.href, icon: i.icon, current: i.key === active, ...(badge ? { badge } : {}) };
  });
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
