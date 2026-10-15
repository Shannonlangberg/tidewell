import "server-only";

import { requireStaff } from "../auth";

export const TIMELINE_KINDS = ["status_change", "vetting_step", "document_uploaded", "document_verified", "document_rejected", "review", "contact"] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export type TimelineEvent = {
  key: string;
  kind: TimelineKind | "other";
  occurredAt: string;
  actorName: string | null;
  summary: string;
  detail: string | null;
  interactionType: string | null;
};

const LIMIT = 50;

/** The latest events for one contractor, newest first. Built in SQL from the underlying tables, so the reader's own row level security applies. */
export async function loadTimeline(contractorId: string): Promise<{ events: TimelineEvent[]; total: number }> {
  const { db } = await requireStaff("contractors.read");
  const { data, error, count } = await db
    .from("contractor_timeline")
    .select("event_key, kind, occurred_at, actor_name, summary, detail, interaction_type", { count: "exact" })
    .eq("contractor_id", contractorId)
    .order("occurred_at", { ascending: false })
    .limit(LIMIT);
  if (error) throw new Error(`timeline ${error.code}`);
  const events: TimelineEvent[] = [];
  for (const r of data ?? []) {
    if (!r.event_key || !r.occurred_at || !r.summary) continue;
    events.push({
      key: r.event_key,
      kind: (TIMELINE_KINDS as readonly string[]).includes(r.kind ?? "") ? (r.kind as TimelineKind) : "other",
      occurredAt: r.occurred_at,
      actorName: r.actor_name,
      summary: r.summary,
      detail: r.detail,
      interactionType: r.interaction_type,
    });
  }
  return { events, total: count ?? events.length };
}
