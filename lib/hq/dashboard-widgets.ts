/*
 * The Reports panel registry: WHAT panels exist, which Reports section each belongs to, and
 * the capability a person needs to be shown it. The components that draw each panel are
 * mapped in components/hq/features/dashboard/widgets.tsx (renderPanel); this file is data
 * only, so the selection rules can be unit tested.
 *
 * The database enforces the capabilities again on every query; this only decides what
 * Reports OFFERS: a panel that needs a capability is never shown to a person without it.
 *
 * (The old customisable dashboard, with its figures band and per-person layouts, has gone:
 * Today is laid out by role and these panels appear on Reports only.)
 *
 * Pure: type-only imports, so `node --test` can run it.
 */

import type { Capability } from "./constants";

export const WIDGET_IDS = [
  "opportunities-by-stage",
  "partner-referrals",
  "partner-activity",
  "contractors-preferred-coverage",
  "contractors-awaiting-vetting",
  "contractors-recent-activity",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

/** The Reports section a panel is drawn in. */
export type ReportSection = "growth" | "contractors";

export type WidgetDef = {
  id: WidgetId;
  title: string;
  section: ReportSection;
  /** Omitted: every member of staff may see it (what it shows is still limited by row level security). */
  requires?: Capability;
};

/** In display order within each section. */
export const WIDGETS: readonly WidgetDef[] = [
  { id: "opportunities-by-stage", title: "Pipeline", section: "growth", requires: "growth.read" },
  { id: "partner-referrals", title: "Partners sending referrals", section: "growth", requires: "growth.read" },
  { id: "partner-activity", title: "Latest calls and meetings", section: "growth", requires: "growth.read" },
  { id: "contractors-preferred-coverage", title: "Trades covered", section: "contractors", requires: "contractors.read" },
  { id: "contractors-awaiting-vetting", title: "Being vetted", section: "contractors", requires: "contractors.read" },
  { id: "contractors-recent-activity", title: "Latest contractor changes", section: "contractors", requires: "contractors.read" },
];

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === "string" && (WIDGET_IDS as readonly string[]).includes(value);
}

export function widgetDef(id: WidgetId): WidgetDef {
  const def = WIDGETS.find((w) => w.id === id);
  if (!def) throw new Error(`Unknown dashboard widget: ${id}`);
  return def;
}

/** The panels this person may see, in registry order. */
export function availableWidgets(capabilities: readonly string[]): WidgetDef[] {
  return WIDGETS.filter((w) => !w.requires || capabilities.includes(w.requires));
}

/** The ids of one Reports section's panels that this person may see, in display order. */
export function reportPanels(section: ReportSection, capabilities: readonly string[]): WidgetId[] {
  return availableWidgets(capabilities)
    .filter((w) => w.section === section)
    .map((w) => w.id);
}
