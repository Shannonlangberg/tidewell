import type { AppState } from "@/components/app/useAppState";
import { BOARD, INBOX, property, type Thread } from "./demo";
import { OWNER_PROFILES, SEED_LOG, lastHuman, ownerForProperty, ownerTasks, relationshipHealth, type Level, type Task } from "./humanTouch";

export type Item = { id: string; level: Level; kind: "owner" | "guest" | "maintenance"; title: string; reason: string; href: string };

const rank: Record<Level, number> = { red: 0, amber: 1, green: 2 };
export const byLevel = <T extends { level: Level }>(a: T, b: T) => rank[a.level] - rank[b.level];

export function allLogs(state: AppState) {
  return [...state.logs, ...SEED_LOG].sort((a, b) => a.daysAgo - b.daysAgo);
}

export function humanTouch(state: AppState) {
  const logs = allLogs(state);
  // An owner's approval in the app counts as their answer to the over-limit question.
  const handled = [...state.handled, ...(state.approved.includes("shower-screen") ? ["jane:overThreshold"] : [])];

  const tasks: Task[] = OWNER_PROFILES.flatMap((o) => ownerTasks(o, state.triggers, logs, handled)).sort(byLevel);

  const guests: Thread[] = INBOX.filter((t) => t.who !== "owner" && t.escalated && !state.handback.includes(t.id));

  const stageOf = (id: string, s: (typeof BOARD)[number]["stage"]) => state.stages[id] ?? s;
  const maintenance = BOARD.filter((b) => {
    const o = ownerForProperty(b.property);
    const open = stageOf(b.id, b.stage) !== "done" && !(b.id === "shower-screen" && state.approved.includes(b.id));
    return open && o && (b.amount ?? 0) > o.callOver;
  });

  const risk = OWNER_PROFILES.map((o) => ({ owner: o, ...relationshipHealth(o) })).filter((r) => r.level !== "green");
  const noContact = OWNER_PROFILES.map((o) => ({ owner: o, days: lastHuman(o, logs) })).filter((x) => x.days >= state.triggers.noContactDays);

  const items: Item[] = [
    ...guests.map((t) => ({ id: t.id, level: t.level, kind: "guest" as const, title: `${t.from} · ${property(t.property).name}`, reason: t.handover?.issue ?? t.message, href: `/app/manager/inbox#${t.id}` })),
    ...tasks.map((t) => ({ id: t.id, level: t.level, kind: "owner" as const, title: `${t.owner.name} · ${property(t.owner.property).name}`, reason: t.reason, href: `/app/manager/owners/${t.owner.id}` })),
    ...maintenance.map((b) => ({ id: b.id, level: (b.amount ?? 0) >= 1000 ? ("red" as const) : ("amber" as const), kind: "maintenance" as const, title: `${b.title} · ${property(b.property).name}`, reason: `$${b.amount?.toLocaleString("en-AU")} — over ${ownerForProperty(b.property)!.first}'s limit`, href: "/app/manager/jobs" })),
  ].sort(byLevel);

  return { logs, tasks, guests, maintenance, risk, noContact, items };
}

export function counterLines(h: ReturnType<typeof humanTouch>, noContactDays: number) {
  const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  const lines: string[] = [];
  if (h.tasks.length) lines.push(`${n(h.tasks.length, "owner needs", "owners need")} a check-in`);
  if (h.guests.length) lines.push(n(h.guests.length, "guest situation", "guest situations") + " needing a person");
  if (h.maintenance.length) lines.push(n(h.maintenance.length, "important maintenance job", "important maintenance jobs"));
  for (const x of h.noContact) lines.push(`${x.owner.first} hasn't heard from a person in ${x.days} days`);
  void noContactDays;
  return lines;
}
