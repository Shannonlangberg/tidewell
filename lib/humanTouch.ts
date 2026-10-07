// Human Touch Layer.
// The assistant handles repetitive admin. People handle relationships, trust, conflict and important moments.
// Everything here is rules over data — nothing sensitive is ever sent automatically.

export type Level = "green" | "amber" | "red";
export const LEVEL_LABEL: Record<Level, string> = { green: "Routine", amber: "Attention", red: "Human now" };
export const HEALTH_LABEL: Record<Level, string> = { green: "Normal", amber: "Attention recommended", red: "Human contact required" };

export type TeamMember = { id: string; name: string; phone: string; email: string; initials: string };
export const TEAM: TeamMember[] = [
  { id: "court", name: "Court", phone: "0417 604 882", email: "court@tidewell.com.au", initials: "C" },
  { id: "alex", name: "Alex", phone: "0417 604 882", email: "alex@tidewell.com.au", initials: "A" },
];
export const member = (id?: string) => TEAM.find((t) => t.id === id) ?? TEAM[0];

// Only business-relationship signals. No personality, medical or psychological judgements.
export type Signal =
  | "repeated question"
  | "frustration"
  | "confusion"
  | "dissatisfaction"
  | "income concern"
  | "maintenance concern"
  | "fee concern"
  | "slow replies"
  | "asked for a person"
  | "unresolved issue"
  | "mentioned leaving";

export type Method = "Phone call" | "Text" | "Email";
export type Cadence = "Monthly call" | "Every six weeks" | "Quarterly check-in";
export const CADENCE_DAYS: Record<Cadence, number> = { "Monthly call": 30, "Every six weeks": 42, "Quarterly check-in": 90 };

export type OwnerProfile = {
  id: string;
  name: string;
  first: string;
  property: string;
  pm: string;
  method: Method;
  cadence: Cadence;
  prefs: string[];
  callOver: number; // call before approving maintenance over this
  startedDaysAgo: number;
  lastHumanDaysAgo: number;
  notes: string;
  revenueMonth: number;
  revenueChangePct: number;
  occupancy14: number; // nights of 14
  upcomingBookings: number;
  ratingNow: number;
  ratingPrev: number;
  maintenance: { text: string; amount: number; daysAgo: number; major?: boolean; open?: boolean }[];
  feedback: { stars: number; text: string; daysAgo: number }[];
  messages: { daysAgo: number; text: string; signals: Signal[] }[];
  cancellations: { text: string; daysAgo: number }[];
  concerns: string[];
  opportunities: string[];
};

export const OWNER_PROFILES: OwnerProfile[] = [
  {
    id: "jane",
    name: "Jane Pelham",
    first: "Jane",
    property: "bayview",
    pm: "court",
    method: "Text",
    cadence: "Monthly call",
    prefs: ["Text for minor updates", "Call before anything over $150", "Monthly phone call", "Evenings suit best"],
    callOver: 150,
    startedDaysAgo: 410,
    lastHumanDaysAgo: 12,
    notes: "Uses the house at Christmas and Easter. Likes to see photos of every repair. Daughter may take over the place in a few years.",
    revenueMonth: 3972.28,
    revenueChangePct: 9,
    occupancy14: 9,
    upcomingBookings: 5,
    ratingNow: 4.91,
    ratingPrev: 4.9,
    maintenance: [{ text: "Shower screen cracked — $245 quote waiting on Jane", amount: 245, daysAgo: 2, open: true }],
    feedback: [
      { stars: 5, text: "Spotless, and the deck at sunset is something else.", daysAgo: 4 },
      { stars: 4, text: "Lovely stay. Shower pressure is a bit weak.", daysAgo: 11 },
      { stars: 4, text: "Great spot. Shower could be stronger.", daysAgo: 26 },
    ],
    messages: [],
    cancellations: [],
    concerns: ["Asked in June whether winter rates were too low"],
    opportunities: ["Shower pressure has come up in two reviews — a new shower head is under $150", "Outdoor furniture is tired — replace before summer"],
  },
  {
    id: "tait",
    name: "Rob and Alison Tait",
    first: "Rob",
    property: "simms",
    pm: "alex",
    method: "Phone call",
    cadence: "Monthly call",
    prefs: ["Call, don't text", "Call before maintenance over $300", "Quarterly performance review", "Rob handles money, Alison handles the house"],
    callOver: 300,
    startedDaysAgo: 540,
    lastHumanDaysAgo: 47,
    notes: "Long-time owners. Very happy last summer. Sensitive about fees since the cleaning rate went up in August.",
    revenueMonth: 5210.4,
    revenueChangePct: -18,
    occupancy14: 11,
    upcomingBookings: 6,
    ratingNow: 4.82,
    ratingPrev: 4.88,
    maintenance: [{ text: "Hot water system leaking — plumber booked", amount: 1650, daysAgo: 1, major: true, open: true }],
    feedback: [{ stars: 5, text: "Big, easy house for two families.", daysAgo: 8 }],
    messages: [
      { daysAgo: 16, text: "Why was the cleaning charge higher in August?", signals: ["fee concern"] },
      { daysAgo: 3, text: "Second time asking — why is cleaning $40 more? And income's down on last year.", signals: ["repeated question", "fee concern", "income concern", "frustration"] },
    ],
    cancellations: [{ text: "Six-night Christmas booking cancelled — $2,100", daysAgo: 5 }],
    concerns: ["Cleaning fee increase in August", "Income down on last spring"],
    opportunities: ["Christmas gap can be re-let — three enquiries for those dates", "Explain the cleaning change in person, with the numbers"],
  },
  {
    id: "lowe",
    name: "Greg Lowe",
    first: "Greg",
    property: "heritage",
    pm: "court",
    method: "Email",
    cadence: "Quarterly check-in",
    prefs: ["Email only unless urgent", "Quarterly performance review"],
    callOver: 300,
    startedDaysAgo: 220,
    lastHumanDaysAgo: 20,
    notes: "Lives in Adelaide. Happy with the tenant. Wants the least contact possible, but likes a clear quarterly summary.",
    revenueMonth: 1680,
    revenueChangePct: 0,
    occupancy14: 14,
    upcomingBookings: 0,
    ratingNow: 0,
    ratingPrev: 0,
    maintenance: [{ text: "Back gate latch — $85, booked", amount: 85, daysAgo: 3, open: true }],
    feedback: [],
    messages: [],
    cancellations: [],
    concerns: [],
    opportunities: ["Lease renews in six months — a good time to review the rent"],
  },
  {
    id: "castellano",
    name: "Mia Castellano",
    first: "Mia",
    property: "esplanade",
    pm: "court",
    method: "Phone call",
    cadence: "Monthly call",
    prefs: ["Call for anything to do with guests", "Text for minor updates"],
    callOver: 200,
    startedDaysAgo: 6,
    lastHumanDaysAgo: 6,
    notes: "Brand new — bought in August. First time letting a place. Nervous about damage.",
    revenueMonth: 2894.1,
    revenueChangePct: 0,
    occupancy14: 6,
    upcomingBookings: 3,
    ratingNow: 4.6,
    ratingPrev: 4.6,
    maintenance: [{ text: "Split system not cooling — technician tonight", amount: 180, daysAgo: 0, open: true }],
    feedback: [{ stars: 3, text: "Nice spot but the bathroom wasn't as clean as we expected.", daysAgo: 2 }],
    messages: [{ daysAgo: 1, text: "Is it normal to get a 3-star review this early? A bit worried.", signals: ["dissatisfaction"] }],
    cancellations: [],
    concerns: ["Worried about damage from guests", "First review was three stars"],
    opportunities: ["Walk her through the cleaning fix and the photo-per-room check", "Book a 30-day review now"],
  },
];
export const ownerProfile = (id?: string) => OWNER_PROFILES.find((o) => o.id === id);
export const ownerForProperty = (property: string) => OWNER_PROFILES.find((o) => o.property === property);

// ── Human interaction log ───────────────────────────────
export type InteractionType = "Phone call" | "In person" | "Text" | "Email" | "Property inspection" | "Owner review";
export const INTERACTION_TYPES: InteractionType[] = ["Phone call", "In person", "Text", "Email", "Property inspection", "Owner review"];
export type Interaction = { id: string; owner: string; daysAgo: number; by: string; type: InteractionType; notes: string; followUp?: number; proactive?: boolean };

export const SEED_LOG: Interaction[] = [
  { id: "l1", owner: "jane", daysAgo: 12, by: "court", type: "Phone call", notes: "Monthly call. Happy with bookings. Wants photos of the shower screen job.", proactive: true },
  { id: "l2", owner: "lowe", daysAgo: 20, by: "court", type: "Email", notes: "Quarterly summary sent. Replied thanks, no questions.", proactive: true },
  { id: "l3", owner: "castellano", daysAgo: 6, by: "court", type: "In person", notes: "Welcome visit at the house. Walked through the photo-per-room check.", proactive: true },
  { id: "l4", owner: "tait", daysAgo: 47, by: "alex", type: "Phone call", notes: "Winter plan agreed. Rob asked us to keep fees steady.", followUp: 30, proactive: true },
];

// ── Triggers (configurable) ─────────────────────────────
export type TriggerSettings = {
  noContactDays: 30 | 45 | 60;
  revenueDropPct: number;
  lowOccupancyNights: number;
  enabled: Record<TriggerKey, boolean>;
};
export type TriggerKey =
  | "noContact" | "newOwner7" | "newOwner30" | "revenueDrop" | "majorMaintenance" | "overThreshold"
  | "negativeReview" | "ratingDrop" | "repeatedMessages" | "concerned" | "cancellation" | "lowOccupancy";

export const TRIGGER_LABEL: Record<TriggerKey, string> = {
  noContact: "No human contact for a while",
  newOwner7: "New owner reaches 7 days",
  newOwner30: "New owner reaches 30 days",
  revenueDrop: "Revenue falls",
  majorMaintenance: "Major maintenance",
  overThreshold: "Maintenance over the owner's limit",
  negativeReview: "Negative review",
  ratingDrop: "Rating drops",
  repeatedMessages: "Same question more than once",
  concerned: "Owner sounds frustrated or concerned",
  cancellation: "Major cancellation",
  lowOccupancy: "Unusually low occupancy",
};

export const DEFAULT_TRIGGERS: TriggerSettings = {
  noContactDays: 45,
  revenueDropPct: 15,
  lowOccupancyNights: 4,
  enabled: Object.fromEntries(Object.keys(TRIGGER_LABEL).map((k) => [k, true])) as Record<TriggerKey, boolean>,
};

export type Task = {
  id: string;
  owner: OwnerProfile;
  reason: string;
  level: Level;
  points: string[];
  method: Method;
};

export function lastHuman(o: OwnerProfile, logs: Interaction[]) {
  const mine = logs.filter((l) => l.owner === o.id).map((l) => l.daysAgo);
  return Math.min(o.lastHumanDaysAgo, ...mine);
}

const has = (o: OwnerProfile, s: Signal, days = 30) => o.messages.some((m) => m.daysAgo <= days && m.signals.includes(s));

export function relationshipHealth(o: OwnerProfile): { level: Level; signals: Signal[] } {
  const signals = [...new Set(o.messages.filter((m) => m.daysAgo <= 30).flatMap((m) => m.signals))];
  if (signals.includes("asked for a person") || signals.includes("mentioned leaving") || signals.length >= 3) return { level: "red", signals };
  if (signals.length) return { level: "amber", signals };
  return { level: "green", signals };
}

/** Tasks the rules recommend. Logging an interaction with the owner clears them (handled). */
export function ownerTasks(o: OwnerProfile, settings: TriggerSettings, logs: Interaction[], handled: string[]): Task[] {
  const on = settings.enabled;
  const t: Task[] = [];
  const add = (key: string, reason: string, level: Level, points: string[], method: Method = o.method) => {
    const id = `${o.id}:${key}`;
    if (!handled.includes(id)) t.push({ id, owner: o, reason, level, points, method });
  };
  const since = lastHuman(o, logs);
  const big = o.maintenance.filter((m) => m.open && m.major);
  const over = o.maintenance.filter((m) => m.open && m.amount > o.callOver);

  if (on.noContact && since >= settings.noContactDays)
    add("noContact", `No human contact for ${since} days`, "amber", ["Just checking in — how are they feeling about the place?", ...o.concerns.slice(0, 1).map((c) => `Last time: ${c.toLowerCase()}`)]);
  if (on.newOwner7 && o.startedDaysAgo >= 5 && o.startedDaysAgo <= 9)
    add("newOwner7", o.startedDaysAgo < 7 ? `Day-7 check-in due in ${7 - o.startedDaysAgo} day${7 - o.startedDaysAgo === 1 ? "" : "s"}` : "Day-7 check-in due", "amber", ["How has the first week felt?", "Anything confusing in the app?", "Anything they expected that hasn't happened?"], "Phone call");
  if (on.newOwner30 && o.startedDaysAgo >= 28 && o.startedDaysAgo <= 33)
    add("newOwner30", "30-day performance and relationship call", "amber", ["First month in numbers", "What's working, what isn't"], "Phone call");
  if (on.revenueDrop && o.revenueChangePct <= -settings.revenueDropPct)
    add("revenueDrop", `Revenue down ${Math.abs(o.revenueChangePct)}% on the same month last year`, "amber", ["Explain the drop plainly — cancellations, season, pricing", "What we're doing about it"]);
  if (on.majorMaintenance && big.length)
    add("majorMaintenance", `Major maintenance: ${big[0].text}`, "red", ["What happened and when", "What it costs and who's doing it", "Whether guests are affected"], "Phone call");
  if (on.overThreshold && over.length && !big.length)
    add("overThreshold", `Over their $${o.callOver} limit — they asked for a call first`, "amber", [over[0].text], "Phone call");
  if (on.negativeReview && o.feedback.some((f) => f.stars <= 3 && f.daysAgo <= 14))
    add("negativeReview", "Negative review in the last fortnight", "amber", [`"${o.feedback.find((f) => f.stars <= 3)!.text}"`, "What we've changed since"]);
  if (on.ratingDrop && o.ratingPrev && o.ratingNow < o.ratingPrev - 0.05)
    add("ratingDrop", `Rating slipped from ${o.ratingPrev} to ${o.ratingNow}`, "amber", ["What the recent reviews say"]);
  if (on.repeatedMessages && has(o, "repeated question"))
    add("repeatedMessages", "Asked the same thing more than once", "amber", o.messages.filter((m) => m.signals.includes("repeated question")).map((m) => `"${m.text}"`));
  if (on.concerned && (has(o, "frustration") || has(o, "dissatisfaction") || has(o, "income concern")))
    add("concerned", "Sounds concerned in recent messages", relationshipHealth(o).level === "red" ? "red" : "amber", o.concerns.map((c) => `Concern: ${c}`));
  if (on.cancellation && o.cancellations.some((c) => c.daysAgo <= 14))
    add("cancellation", o.cancellations[0].text, "amber", ["What we're doing to re-let the dates"]);
  if (on.lowOccupancy && o.upcomingBookings > 0 && o.occupancy14 < settings.lowOccupancyNights)
    add("lowOccupancy", `Only ${o.occupancy14} of the next 14 nights booked`, "amber", ["Pricing and minimum-stay changes we've made"]);

  // One conversation, not five: merge into a single task per owner at the highest level.
  if (t.length <= 1) return t;
  const level: Level = t.some((x) => x.level === "red") ? "red" : "amber";
  return [{ id: t.map((x) => x.id).join("+"), owner: o, reason: t.map((x) => x.reason).join(" · "), level, points: [...new Set(t.flatMap((x) => x.points))].slice(0, 5), method: level === "red" ? "Phone call" : o.method }];
}

export function nextInteraction(o: OwnerProfile, logs: Interaction[]) {
  if (o.startedDaysAgo < 7) return { inDays: 7 - o.startedDaysAgo, what: "Day-7 check-in" };
  if (o.startedDaysAgo < 30) return { inDays: 30 - o.startedDaysAgo, what: "30-day performance call" };
  if (o.startedDaysAgo < 90) return { inDays: 90 - o.startedDaysAgo, what: "3-month optimisation review" };
  const followUps = logs.filter((l) => l.owner === o.id && l.followUp !== undefined).map((l) => l.followUp! - l.daysAgo);
  const cadence = CADENCE_DAYS[o.cadence] - lastHuman(o, logs);
  const inDays = Math.min(cadence, ...followUps);
  return { inDays, what: followUps.includes(inDays) ? "Follow-up they asked for" : o.cadence };
}

export const NEW_OWNER_PLAN = [
  { day: 1, what: "Welcome call" },
  { day: 7, what: "Check the onboarding experience" },
  { day: 30, what: "Performance and relationship call" },
  { day: 90, what: "Property optimisation review" },
];

// Sample 30-day message numbers for the metrics (flagged as sample in the UI).
export const MESSAGE_STATS_30D = { total: 212, automated: 168, escalated: 21, avgHumanMins: 14, escalationsResolved: 19 };
