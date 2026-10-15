/*
 * The dashboard widget registry: WHAT exists, who may see it, and who gets it by default.
 * The components that draw each widget are mapped in components/hq/features/dashboard;
 * this file is data only, so the selection rules can be unit tested.
 *
 * Rules (the database enforces the capabilities again on every query; this only decides
 * what the dashboard OFFERS):
 *  - a widget that needs a capability is never offered to, or shown to, a person without it;
 *  - `staff_profiles.dashboard_widgets` null means "my role's default";
 *  - a saved choice keeps only widgets that still exist and are still allowed, in registry order;
 *  - if nothing survives (a capability was withdrawn), the role default is used instead.
 *
 * Pure: type-only imports, so `node --test` can run it.
 */

import type { Capability, StaffRole } from "./constants";

export const WIDGET_IDS = [
  "contacts-identified",
  "referrals-summary",
  "managed-properties",
  "who-to-call",
  "opportunities-by-stage",
  "my-tasks",
  "team-tasks",
  "partner-activity",
  "partner-referrals",
  "stale-partners",
  "contractors-awaiting-vetting",
  "contractors-expiring-documents",
  "contractors-preferred-coverage",
  "contractors-recent-activity",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

/** `stat` widgets are cells in the figures band at the top; `panel` widgets are boxes below it. */
export type WidgetKind = "stat" | "panel";

export type WidgetDef = {
  id: WidgetId;
  title: string;
  /** One line in the Customise drawer. */
  description: string;
  kind: WidgetKind;
  /** Omitted: every member of staff may see it (what it shows is still limited by row level security). */
  requires?: Capability;
  /** Roles that get it when the person has not chosen their own layout. */
  defaultFor: readonly StaffRole[];
};

/** In display order: the figures band first, then the panels, top to bottom. */
export const WIDGETS: readonly WidgetDef[] = [
  {
    id: "contacts-identified",
    title: "Contacts identified",
    description: "How many contacts are in HQ and how many still need checking.",
    kind: "stat",
    requires: "growth.read",
    defaultFor: ["director", "administrator", "business_development_manager", "virtual_assistant", "read_only"],
  },
  {
    id: "referrals-summary",
    title: "Referrals and managements",
    description: "Referrals received and sent, managements signed, and conversion.",
    kind: "stat",
    requires: "growth.read",
    defaultFor: ["director", "administrator", "business_development_manager", "read_only"],
  },
  {
    id: "managed-properties",
    title: "Managed properties",
    description: "Appears once HQ is connected to Ailo. Nothing is entered here by hand.",
    kind: "stat",
    defaultFor: [
      "director",
      "administrator",
      "business_development_manager",
      "senior_property_manager",
      "property_manager",
      "junior_property_manager",
      "read_only",
    ],
  },
  {
    id: "who-to-call",
    title: "Who to call this week",
    description: "Overdue and upcoming follow-ups, oldest first.",
    kind: "panel",
    requires: "growth.read",
    defaultFor: ["director", "administrator", "business_development_manager", "senior_property_manager", "property_manager", "virtual_assistant"],
  },
  {
    id: "opportunities-by-stage",
    title: "Active opportunities by stage",
    description: "Open referrals and where each one is in the pipeline.",
    kind: "panel",
    requires: "growth.read",
    defaultFor: ["director", "business_development_manager", "read_only"],
  },
  {
    id: "my-tasks",
    title: "My tasks",
    description: "Tasks assigned to you: overdue, due today and coming up.",
    kind: "panel",
    defaultFor: [
      "director",
      "administrator",
      "business_development_manager",
      "senior_property_manager",
      "property_manager",
      "junior_property_manager",
      "virtual_assistant",
    ],
  },
  {
    id: "team-tasks",
    title: "Team tasks",
    description: "What is overdue or due this week across the team.",
    kind: "panel",
    requires: "tasks.read_all",
    defaultFor: ["administrator", "senior_property_manager", "read_only"],
  },
  {
    id: "partner-activity",
    title: "Partner activity",
    description: "The latest calls, meetings and emails logged with partners.",
    kind: "panel",
    requires: "growth.read",
    defaultFor: ["director", "business_development_manager", "virtual_assistant", "read_only"],
  },
  {
    id: "partner-referrals",
    title: "Referral partners",
    description: "Which partners are sending and receiving referrals, and how many signed.",
    kind: "panel",
    requires: "growth.read",
    defaultFor: ["business_development_manager"],
  },
  {
    id: "stale-partners",
    title: "Not contacted in 30 days",
    description: "Contacts who have not been spoken to for a month, or ever.",
    kind: "panel",
    requires: "growth.read",
    defaultFor: ["director", "business_development_manager", "virtual_assistant"],
  },
  {
    id: "contractors-awaiting-vetting",
    title: "Contractors awaiting vetting",
    description: "Contractors being vetted, and how far through the checklist each one is.",
    kind: "panel",
    requires: "contractors.read",
    defaultFor: ["director", "administrator", "senior_property_manager", "property_manager", "virtual_assistant"],
  },
  {
    id: "contractors-expiring-documents",
    title: "Expiring contractor documents",
    description: "Licences, insurance and documents that have expired or expire soon, with a button to create reminder tasks.",
    kind: "panel",
    requires: "contractors.read",
    defaultFor: ["director", "administrator", "senior_property_manager", "property_manager"],
  },
  {
    id: "contractors-preferred-coverage",
    title: "Preferred contractor coverage",
    description: "Which trades have an approved contractor, and which have none.",
    kind: "panel",
    requires: "contractors.read",
    defaultFor: ["director", "administrator", "senior_property_manager"],
  },
  {
    id: "contractors-recent-activity",
    title: "Recent contractor activity",
    description: "The latest status changes, checklist steps, documents, feedback and contacts across contractors.",
    kind: "panel",
    requires: "contractors.read",
    defaultFor: ["director", "administrator"],
  },
];

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && (WIDGET_IDS as readonly string[]).includes(value);
}

export function widgetDef(id: WidgetId): WidgetDef {
  const def = WIDGETS.find((w) => w.id === id);
  if (!def) throw new Error(`Unknown dashboard widget: ${id}`);
  return def;
}

/** The widgets this person may see, in registry order. */
export function availableWidgets(capabilities: readonly string[]): WidgetDef[] {
  return WIDGETS.filter((w) => !w.requires || capabilities.includes(w.requires));
}

/** The role's default set, limited to what the person may see. */
export function defaultWidgetsFor(role: StaffRole, capabilities: readonly string[]): WidgetId[] {
  const picked = availableWidgets(capabilities)
    .filter((w) => w.defaultFor.includes(role))
    .map((w) => w.id);
  if (picked.length > 0) return picked;
  // A role with no default and nothing else allowed still gets something useful.
  return availableWidgets(capabilities)
    .filter((w) => w.id === "my-tasks" || w.id === "managed-properties")
    .map((w) => w.id);
}

/**
 * Keeps only real, allowed widgets, once each, in registry order. Used to clean what a
 * form posted before it is saved, and what was saved before it is shown.
 */
export function sanitiseSelection(selection: readonly unknown[], capabilities: readonly string[]): WidgetId[] {
  const wanted = new Set(selection.filter(isWidgetId));
  return availableWidgets(capabilities)
    .filter((w) => wanted.has(w.id))
    .map((w) => w.id);
}

/**
 * The widgets to draw. `saved` is staff_profiles.dashboard_widgets: null (or undefined)
 * is the role default; an array is the person's own choice.
 */
export function resolveWidgets(opts: {
  role: StaffRole;
  capabilities: readonly string[];
  saved: readonly string[] | null | undefined;
}): WidgetId[] {
  if (Array.isArray(opts.saved)) {
    const own = sanitiseSelection(opts.saved, opts.capabilities);
    if (own.length > 0) return own;
  }
  return defaultWidgetsFor(opts.role, opts.capabilities);
}

/** True when the person has chosen their own layout rather than using the role default. */
export function hasCustomLayout(saved: readonly string[] | null | undefined): boolean {
  return Array.isArray(saved);
}
