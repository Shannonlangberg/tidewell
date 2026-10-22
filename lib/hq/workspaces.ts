/*
 * Workspaces (docs/hq-workspaces.md): which view Today opens in, and how the navigation is ordered.
 *
 * A workspace is a PREFERENCE, never a permission. It decides what Today shows first, the order of the
 * navigation groups and the phone's three tabs. It never shows a record the person could not already
 * open: the pages and every query still check capabilities, and row level security is the control.
 *
 *   grow      Grow the business (BDM): who to contact next.            Offered with growth.read.
 *   deliver   Deliver the service (property manager).                   Not built yet (Phase 2).
 *   support   Keep things moving (EA / business support).               Not built yet (Phase 3).
 *   overview  Business overview: the leadership command center.         Always offered.
 *
 * Today opens in, first that the person may use: the ?view= they chose, their saved default
 * (staff_profiles.workspace), the role's default, then the overview. Until Deliver and Support are built,
 * Today shows the overview for them, while the navigation already follows them (a property manager's
 * Deliver group comes first, as their operations did before).
 *
 * Pure: type-only imports, so `node --test` can run it.
 */

import type { StaffRole } from "./constants";

export const WORKSPACES = ["grow", "deliver", "support", "overview"] as const;
export type Workspace = (typeof WORKSPACES)[number];

export const WORKSPACE_LABEL: Record<Workspace, string> = {
  grow: "Grow the business",
  deliver: "Deliver the service",
  support: "Keep things moving",
  overview: "Business overview",
};

/** The phone switch has room for one word each. */
export const WORKSPACE_SHORT: Record<Workspace, string> = { grow: "Grow", deliver: "Deliver", support: "Support", overview: "Overview" };

/** The workspaces Today can show in this phase, in switch order. */
const BUILT: readonly Workspace[] = ["grow", "overview"];

export function isWorkspace(v: unknown): v is Workspace {
  return typeof v === "string" && (WORKSPACES as readonly string[]).includes(v);
}

/** The role's own default, used when the person has not chosen one. */
export function roleWorkspace(role: StaffRole): Workspace {
  switch (role) {
    case "business_development_manager":
      return "grow";
    case "senior_property_manager":
    case "property_manager":
    case "junior_property_manager":
      return "deliver";
    case "virtual_assistant":
      return "support";
    default:
      return "overview";
  }
}

/** The workspaces Today may switch between for this person: built ones whose capabilities they hold. */
export function todayWorkspaces(capabilities: readonly string[]): Workspace[] {
  return BUILT.filter((w) => w !== "grow" || capabilities.includes("growth.read"));
}

/** The workspace Today shows: the chosen view, the saved default, the role's default, else the overview. */
export function todayWorkspace(opts: { view?: string | null; saved: Workspace | null; role: StaffRole; capabilities: readonly string[] }): Workspace {
  const offered = todayWorkspaces(opts.capabilities);
  for (const w of [opts.view, opts.saved, roleWorkspace(opts.role)]) {
    if (isWorkspace(w) && offered.includes(w)) return w;
  }
  return "overview";
}

/** The workspace the navigation follows: the saved default, else the role's (built or not). */
export function navWorkspace(saved: Workspace | null, role: StaffRole): Workspace {
  return saved ?? roleWorkspace(role);
}

// ── navigation order ─────────────────────────────────────────

export const NAV_GROUPS = ["grow", "work", "deliver", "company"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];
export const NAV_GROUP_LABEL: Record<NavGroup, string> = { grow: "Grow", work: "Work", deliver: "Deliver", company: "Company" };

/** The selected workspace's group first; the others keep their place below it. */
export function navGroupOrder(w: Workspace): NavGroup[] {
  switch (w) {
    case "grow":
      return ["grow", "work", "deliver", "company"];
    case "deliver":
      return ["deliver", "work", "grow", "company"];
    case "support":
    case "overview":
      return ["work", "grow", "deliver", "company"];
  }
}

/** The phone's three tabs (then More), by nav key. A page the person cannot see is skipped and the next takes its place. */
export function mobileTabKeys(w: Workspace): string[] {
  switch (w) {
    case "grow":
      return ["dashboard", "contacts", "pipeline"];
    case "deliver":
      return ["dashboard", "operations", "partners"];
    case "support":
      return ["dashboard", "enquiries", "operations"];
    case "overview":
      return ["dashboard", "operations", "projects"];
  }
}
