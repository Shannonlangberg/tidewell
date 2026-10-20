/*
 * The Communications hub (/hq/communications): website enquiries and branded emails in one place.
 * Routes, who sees which tab, and the old addresses it replaces. Pure and client-safe (constants only),
 * unit tested with `node --test` (communications.test.mts).
 *
 *   Enquiries  growth.read   the website enquiries list (the default tab for anyone who can see it)
 *   Emails     email.draft   drafts waiting for approval, sent, not sent
 *
 * Hiding a tab is a courtesy: each tab's page calls requireStaff(capability) first, and row level
 * security decides what the lists hold. The enquiry and email detail pages keep their addresses
 * (/hq/growth/enquiries/<id>, /hq/email/<id>: notification emails and chat tools link to them); the
 * old list addresses redirect to the hub.
 */
import { HQ_BASE, type Capability } from "./constants";

export const COMMS_BASE = `${HQ_BASE}/communications`;

export const COMMS_TABS = ["enquiries", "emails"] as const;
export type CommsTab = (typeof COMMS_TABS)[number];

export const COMMS_TAB_PATH: Record<CommsTab, string> = {
  enquiries: `${COMMS_BASE}/enquiries`,
  emails: `${COMMS_BASE}/emails`,
};

export const COMMS_TAB_LABEL: Record<CommsTab, string> = { enquiries: "Enquiries", emails: "Emails" };

/** One line under the tabs: what this tab holds. */
export const COMMS_TAB_LINE: Record<CommsTab, string> = {
  enquiries: "Rental appraisal requests and contact forms from the website. Each one is already a lead with an owner and a reply task due the day it arrived.",
  emails: "Branded emails to people HQ holds an address for. Nothing is sent until someone approves it.",
};

export const COMMS_TAB_CAPABILITY: Record<CommsTab, Capability> = { enquiries: "growth.read", emails: "email.draft" };

/** The old list addresses, kept working as redirects; their detail pages stay where they are. */
export const OLD_ENQUIRIES_LIST = `${HQ_BASE}/growth/enquiries`;
export const OLD_EMAIL_LIST = `${HQ_BASE}/email`;

/** The tabs this person may see, in order. */
export function commsTabs(capabilities: readonly string[]): CommsTab[] {
  return COMMS_TABS.filter((t) => capabilities.includes(COMMS_TAB_CAPABILITY[t]));
}

/** Whether the hub (and its nav item) is shown at all: growth.read OR email.draft. */
export function canSeeComms(capabilities: readonly string[]): boolean {
  return commsTabs(capabilities).length > 0;
}

/** Where /hq/communications opens: its first tab for this person, or null when they may see neither. */
export function defaultCommsTab(capabilities: readonly string[]): CommsTab | null {
  return commsTabs(capabilities)[0] ?? null;
}

/** The nav badge text: nothing for zero (or anything that is not a positive whole number), "99+" past 99. */
export function badgeText(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

type Param = string | string[] | undefined;

/** A tab's address with the given query kept (repeated keys too), for redirects from the old lists. */
export function commsHref(tab: CommsTab, searchParams: Record<string, Param> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  const s = q.toString();
  return s ? `${COMMS_TAB_PATH[tab]}?${s}` : COMMS_TAB_PATH[tab];
}
