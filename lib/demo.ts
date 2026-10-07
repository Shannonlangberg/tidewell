// Demo data for the Owner app. Every date is relative to today so the screens always look live.
// Nothing here is real — the app shows a "demo" flag while this module is the data source.

export type Platform = "Airbnb" | "Stayz" | "Booking.com" | "Direct";

export type Stay = {
  id: string;
  guest: string;
  platform: Platform | "Owner";
  startOffset: number; // days from today
  nights: number;
  guests?: number;
  total?: number;
};

export type Repair = {
  id: string;
  title: string;
  status: "decision" | "done";
  summary: string;
  detail?: string;
  reportedDaysAgo: number;
  lines: { label: string; amount: number }[];
  note?: string;
  history: { daysAgo: number; text: string }[];
};

export const OWNER = { first: "jane", initials: "JP", threshold: 150 };
export const PROPERTY = { name: "12 Bayview Road", slug: "bayview", town: "Moonta Bay" };

export const STAYS: Stay[] = [
  { id: "nguyen", guest: "The Nguyens", platform: "Airbnb", startOffset: -1, nights: 4, guests: 5, total: 1410 },
  { id: "hale", guest: "Marcus Hale", platform: "Stayz", startOffset: 5, nights: 2, guests: 2, total: 705 },
  { id: "okafor", guest: "The Okafors", platform: "Booking.com", startOffset: 7, nights: 2, guests: 4, total: 470 },
  { id: "fairweather", guest: "D. Fairweather", platform: "Direct", startOffset: 12, nights: 7, guests: 6, total: 1880 },
  { id: "own", guest: "Your own stay", platform: "Owner", startOffset: 20, nights: 4 },
  { id: "priya", guest: "Priya & Sam", platform: "Airbnb", startOffset: 27, nights: 3, guests: 2, total: 705 },
];

export const OWNER_CLEAN_COST = 90;

export const LISTINGS: { platform: Platform; rating?: string; reviews?: number; price: number; syncedMinsAgo?: number; url: string }[] = [
  { platform: "Airbnb", rating: "4.91", reviews: 68, price: 235, syncedMinsAgo: 8, url: "https://www.airbnb.com.au" },
  { platform: "Stayz", rating: "4.8", reviews: 22, price: 235, syncedMinsAgo: 8, url: "https://www.stayz.com.au" },
  { platform: "Booking.com", rating: "9.2", reviews: 14, price: 235, syncedMinsAgo: 180, url: "https://www.booking.com" },
  { platform: "Direct", price: 235, url: "/" },
];

export const ICAL_URL = "webcal://tidewell.com.au/ical/bayview-3f9c.ics";

export const REPAIRS: Repair[] = [
  {
    id: "shower-screen",
    title: "Shower screen, cracked",
    status: "decision",
    summary: "Guest reported it. Measured and quoted. Glazier can fit Thursday.",
    detail:
      "A guest caught it with the door. It's safe to use — the glass is laminated and hasn't come away — but it needs replacing before the next stay.",
    reportedDaysAgo: 2,
    lines: [
      { label: "Glazier, Kadina", amount: 198 },
      { label: "Call-out", amount: 47 },
    ],
    note: "Recoverable from the guest's bond — we've lodged the claim and we'll credit it back to you if it's paid.",
    history: [
      { daysAgo: 0, text: "Measured and quoted by Kadina Glass" },
      { daysAgo: 2, text: "Reported by guest, photographed by Court" },
    ],
  },
  {
    id: "gutters",
    title: "Gutters and downpipes cleared",
    status: "done",
    summary: "Before the winter rain. Two downpipes were half blocked.",
    reportedDaysAgo: 150,
    lines: [{ label: "Gutter clean, single storey", amount: 120 }],
    history: [{ daysAgo: 150, text: "Done, photos in the house file" }],
  },
  {
    id: "outdoor-tap",
    title: "Outdoor tap washer",
    status: "done",
    summary: "Dripping at the side of the house. Fixed on the rounds.",
    reportedDaysAgo: 34,
    lines: [{ label: "Washer and labour", amount: 38 }],
    history: [{ daysAgo: 34, text: "Spotted on the monthly check, fixed same day" }],
  },
];

export const QUIET_PLAN = [
  { done: true, text: "Off-season rate dropped to $145 a night on all four platforms, Monday." },
  { done: true, text: "Two-night minimum lifted for the quiet months." },
  { done: false, text: "Listing photos reshot in the last light — up Friday." },
];

// This month's statement lines. The total is always computed from these — never typed in.
export const MONTH_LINES = [
  { label: "Bookings, 6", amount: 5640 },
  { label: "Cleaning, paid by guests", amount: 540 },
  { label: "Platform commission", amount: -846 },
  { label: "Tidewell, 18% + GST", amount: -Math.round(5640 * 0.18 * 1.1 * 100) / 100 },
  { label: "Repairs approved", amount: -245 },
];

// Financial year Jul → Jun, paid to owner.
export const YEAR = [1800, 1500, 2600, 3400, 4200, 6800, 7400, 5200, 4800, 4600, 2400, 1900];

// ── helpers ─────────────────────────────────────────────
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
export const words = (n: number) => WORDS[n] ?? String(n);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const money = (n: number, cents = true) =>
  (n < 0 ? "−" : "") +
  "$" +
  Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

export function dayFrom(offset: number, base = new Date()) {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}
export const short = (d: Date) => d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
export const weekday = (d: Date) => d.toLocaleDateString("en-AU", { weekday: "short" });

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export type Night = { offset: number; state: "booked" | "own" | "free" };

export function nextNights(stays: Stay[], count = 14): Night[] {
  return Array.from({ length: count }, (_, offset) => {
    const s = stays.find((x) => offset >= x.startOffset && offset < x.startOffset + x.nights);
    return { offset, state: !s ? "free" : s.platform === "Owner" ? "own" : "booked" };
  });
}

export const repairTotal = (r: Repair) => r.lines.reduce((a, l) => a + l.amount, 0);

// ═══════════════════════════════════════════════════════════
// One app, one login — the tabs change with the role.
// Guests don't log in; they get a signed link (/stay/[token]).
// ═══════════════════════════════════════════════════════════

export type Role = "owner" | "tenant" | "crew" | "manager";

export type Person = {
  id: string;
  name: string;
  first: string;
  initials: string;
  role: Role;
  blurb: string;
  kind?: "cleaner" | "tradie";
  property?: string;
};

export const PEOPLE: Person[] = [
  { id: "jane", name: "Jane Pelham", first: "jane", initials: "JP", role: "owner", property: "bayview", blurb: "Owner · 12 Bayview Road" },
  { id: "tess", name: "Tess Moreno", first: "tess", initials: "TM", role: "tenant", property: "heritage", blurb: "Tenant · 27 Heritage Drive" },
  { id: "kel", name: "Kel Brennan", first: "kel", initials: "KB", role: "crew", kind: "cleaner", blurb: "Cleaner · turnovers and checks" },
  { id: "dean", name: "Dean Ashby", first: "dean", initials: "DA", role: "crew", kind: "tradie", blurb: "Tradie · Kadina Glass" },
  { id: "court", name: "Court", first: "court", initials: "C", role: "manager", blurb: "Manager · all homes" },
];

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", tenant: "Tenant", crew: "Crew", manager: "Manager" };

export type Property = { id: string; name: string; town: string; kind: "short-stay" | "long-term"; ownerName: string; sleeps: number; rooms: string[]; code?: string };

export const PROPERTIES: Property[] = [
  { id: "bayview", name: "12 Bayview Road", town: "Moonta Bay", kind: "short-stay", ownerName: "Jane Pelham", sleeps: 6, rooms: ["Bedroom 1", "Bedroom 2", "Bedroom 3", "Bathroom", "Kitchen", "Living"], code: "4 8 1 9" },
  { id: "simms", name: "4 Simms Cove Road", town: "Port Hughes", kind: "short-stay", ownerName: "Rob and Alison Tait", sleeps: 8, rooms: ["Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4", "Bathroom", "Ensuite", "Kitchen", "Living", "Deck"] },
  { id: "heritage", name: "27 Heritage Drive", town: "Wallaroo", kind: "long-term", ownerName: "Greg Lowe", sleeps: 4, rooms: [] },
  { id: "esplanade", name: "9 Esplanade", town: "North Beach", kind: "short-stay", ownerName: "Mia Castellano", sleeps: 6, rooms: ["Bedroom 1", "Bedroom 2", "Bedroom 3", "Bathroom", "Kitchen", "Living"] },
];
export const property = (id?: string) => PROPERTIES.find((p) => p.id === id) ?? PROPERTIES[0];

// ── Tenant ──────────────────────────────────────────────
export const TENANCY = {
  property: "heritage",
  weeklyRent: 420,
  paidTo: 9, // rent paid up to N days from today
  leaseEndMonths: 6,
  bond: 1680,
  inspectionIn: 12, // days
  bins: "Wednesday night. Red every week, yellow and green alternate — yellow this week.",
  history: [
    { daysAgo: 5, amount: 840 },
    { daysAgo: 19, amount: 840 },
    { daysAgo: 33, amount: 840 },
  ],
};

export const TENANT_REPAIRS = [
  { id: "gate", title: "Back gate latch", status: "Booked in", detail: "Handyman booked for Thursday morning. You don't need to be home.", daysAgo: 3 },
  { id: "tap", title: "Kitchen tap dripping", status: "Fixed", detail: "New cartridge fitted.", daysAgo: 26 },
];

export const DOCUMENTS = [
  { title: "Residential tenancy agreement", meta: "Signed · 12 months" },
  { title: "Entry condition report", meta: "84 photos · signed by you" },
  { title: "Bond lodgement receipt", meta: "Held by Consumer and Business Services" },
  { title: "Smoke alarm check", meta: "All four working · tested this year" },
  { title: "Routine inspection report", meta: "Last one · no issues" },
];

// ── Crew: cleaners and tradies share one app, different job types ──
export type CleanJob = { id: string; type: "clean"; property: string; dayOffset: number; window: string; crew: string; pay: number; guestsOut: string; guestsIn?: string; notes?: string };
export type TradeJob = { id: string; type: "trade"; property: string; dayOffset: number; window: string; crew: string; title: string; brief: string; quote?: number; stage: "quote" | "booked" | "invoice" };
export type Job = CleanJob | TradeJob;

export const JOBS: Job[] = [
  { id: "c-bayview", type: "clean", property: "bayview", dayOffset: 0, window: "10am – 2pm", crew: "kel", pay: 120, guestsOut: "The Nguyens, out 10am", guestsIn: "Marcus Hale, in 3pm", notes: "Spare linen is in the hall cupboard, top shelf." },
  { id: "c-esplanade", type: "clean", property: "esplanade", dayOffset: 0, window: "11am – 3pm", crew: "kel", pay: 120, guestsOut: "Out 10am", guestsIn: "In 4pm" },
  { id: "c-simms", type: "clean", property: "simms", dayOffset: 1, window: "10am – 3pm", crew: "kel", pay: 165, guestsOut: "Out 10am", guestsIn: "In 3pm", notes: "Deck furniture back under cover if it's windy." },
  { id: "t-shower", type: "trade", property: "bayview", dayOffset: 2, window: "Between guests", crew: "dean", title: "Shower screen, cracked", brief: "Laminated glass, cracked from the hinge side. Measured Monday. Owner approval needed before fitting.", quote: 245, stage: "booked" },
  { id: "t-window", type: "trade", property: "simms", dayOffset: 4, window: "Anytime, vacant", crew: "dean", title: "Sliding door glass, scratched", brief: "Deck slider. Guest says it was already scratched — photograph it and quote a replacement.", stage: "quote" },
];

export const PAY_HISTORY = [
  { label: "Last fortnight · 11 cleans", amount: 1395, paidDaysAgo: 3 },
  { label: "Fortnight before · 9 cleans", amount: 1110, paidDaysAgo: 17 },
];

// ── Manager ─────────────────────────────────────────────
export type Handover = {
  issue: string;
  timeline: string[];
  sentiment: string;
  action: string;
  info: string[];
};

export type Thread = {
  id: string;
  from: string;
  who: "guest" | "owner" | "tenant" | "neighbour";
  property: string;
  minsAgo: number;
  message: string;
  level: "green" | "amber" | "red";
  /** Routine questions the Property Assistant answered on its own. */
  assistantReply?: string;
  /** Why it came to a person. Escalated threads pause the assistant. */
  escalated?: string[];
  handover?: Handover;
  draft?: string;
};

export const INBOX: Thread[] = [
  {
    id: "m4",
    from: "Ella Brandt",
    who: "guest",
    property: "esplanade",
    minsAgo: 12,
    level: "red",
    message: "Still not cooling. It's 31 inside and the kids can't sleep. Can someone actually help?",
    escalated: ["Guest is upset", "Maintenance issue the assistant couldn't fix", "Guest asked for a person"],
    handover: {
      issue: "Split system not cooling",
      timeline: [
        "8.47pm — guest reported it's not cooling",
        "8.49pm — assistant asked for a photo of the remote",
        "8.52pm — remote set correctly (cool, 22°)",
        "8.58pm — guest restarted it at the isolator switch",
        "9.10pm — still not cooling; guest asked for a person",
      ],
      sentiment: "Frustrated but polite",
      action: "Call the guest now and get a technician out tonight or first thing",
      info: ["Daikin split system, living room", "Preferred contractor: Copper Coast Air", "Owner's approval limit: $200 — Mia wants a call for anything guest-related", "Two pedestal fans in the laundry cupboard"],
    },
    draft: "Hi Ella, it's Court from Tidewell. I'm so sorry — that's no way to spend a night. I'm ringing you now, and I've got a technician on the way.",
  },
  {
    id: "m5",
    from: "Neighbour at number 6",
    who: "neighbour",
    property: "simms",
    minsAgo: 25,
    level: "red",
    message: "Music's been going since 10 and there's a lot of cars. This is the second weekend.",
    escalated: ["Neighbour complaint", "Possible party", "Repeated issue"],
    handover: {
      issue: "Noise complaint — possible party",
      timeline: ["10.40pm — neighbour texted the house number on the sign", "Booking is 2 adults, 4 guests total", "Second complaint about this address this month"],
      sentiment: "Annoyed, reasonable",
      action: "Call the guest, then drive past if it doesn't stop within 20 minutes",
      info: ["House rules: quiet after 10pm, no parties", "Booking: The Harlows, Airbnb, 3 nights", "Owner (the Taits) asked to hear about anything involving neighbours"],
    },
    draft: "Thanks for letting us know, and sorry it's happened again. I'm calling the guests now and I'll text you when it's sorted. — Court",
  },
  {
    id: "m6",
    from: "Rob Tait",
    who: "owner",
    property: "simms",
    minsAgo: 38,
    level: "amber",
    message: "Second time asking — why is cleaning $40 more? And income's down on last year.",
    escalated: ["Owner asked the same thing twice", "Concern about fees and income"],
    handover: {
      issue: "Cleaning fee increase and lower income",
      timeline: ["16 days ago — asked about the August cleaning charge (no reply logged)", "Today — asked again, mentions income is down"],
      sentiment: "Frustrated",
      action: "Call Rob — his preference is phone, not text. Bring the cleaning numbers.",
      info: ["Cleaning went from $125 to $165 in August (bigger house rate, two extra rooms)", "Revenue down 18% — mostly the cancelled Christmas booking", "Assigned: Alex"],
    },
    draft: "Hi Rob, you're right to chase — sorry we didn't answer properly the first time. Can I ring you this afternoon and walk through the numbers?",
  },
  {
    id: "m2",
    from: "Rob Tait",
    who: "owner",
    property: "simms",
    minsAgo: 18,
    level: "green",
    message: "Are we OK to block the first week of January for family?",
    draft: "Hi Rob — yes. Nothing's booked 1–7 January yet, so I've held it for you. I'll close it on every platform once you confirm the exact nights.",
  },
  {
    id: "m1",
    from: "Marcus Hale",
    who: "guest",
    property: "bayview",
    minsAgo: 42,
    level: "green",
    message: "Hi! Is there anywhere to charge an EV nearby? Arriving about 5.",
    assistantReply: "There's a fast charger at the Moonta Bay foreshore car park, four minutes from the house. The garage also has a normal power point you're welcome to use.",
  },
  {
    id: "m3",
    from: "Tess Moreno",
    who: "tenant",
    property: "heritage",
    minsAgo: 6,
    level: "green",
    message: "Gate latch guy — does he need me there Thursday?",
    assistantReply: "No need — he'll come in the side gate and won't go inside. We'll send you a photo when it's done.",
  },
  {
    id: "m7",
    from: "Priya",
    who: "guest",
    property: "bayview",
    minsAgo: 64,
    level: "green",
    message: "What's the wifi password again?",
    assistantReply: "It's saltandsun — network name Bayview.",
  },
];

/** Needs a person: escalated, or anything not answered by the assistant. */
export const needsHuman = (t: Thread) => !t.assistantReply;

export const PRICING_WEEKS = [
  { week: 0, current: 185, suggest: 185, why: "School term — steady" },
  { week: 1, current: 185, suggest: 199, why: "Long weekend, 3 nearby homes booked" },
  { week: 2, current: 185, suggest: 185, why: "Steady" },
  { week: 3, current: 185, suggest: 175, why: "Quiet week, nothing booked yet" },
  { week: 4, current: 195, suggest: 210, why: "School holidays start" },
  { week: 5, current: 195, suggest: 225, why: "School holidays" },
  { week: 6, current: 195, suggest: 225, why: "School holidays" },
  { week: 7, current: 185, suggest: 185, why: "Term back" },
];

export type Stage = "reported" | "quoted" | "owner" | "booked" | "done";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "reported", label: "Reported" },
  { id: "quoted", label: "Quoted" },
  { id: "owner", label: "Waiting on owner" },
  { id: "booked", label: "Booked" },
  { id: "done", label: "Done" },
];
export const BOARD: { id: string; title: string; property: string; stage: Stage; amount?: number }[] = [
  { id: "hws", title: "Hot water system leaking", property: "simms", stage: "booked", amount: 1650 },
  { id: "t-window", title: "Slider glass scratched", property: "simms", stage: "reported" },
  { id: "k-heater", title: "Heater pilot won't stay lit", property: "esplanade", stage: "quoted", amount: 140 },
  { id: "shower-screen", title: "Shower screen cracked", property: "bayview", stage: "owner", amount: 245 },
  { id: "gate", title: "Back gate latch", property: "heritage", stage: "booked", amount: 85 },
  { id: "tap", title: "Kitchen tap cartridge", property: "heritage", stage: "done", amount: 110 },
];

export const PIPELINE = [
  { name: "Rachel and Tom Ng", place: "Moonta Bay, 3 bed", stage: "Enquiry", note: "Just bought. Wants to know what it could earn.", daysAgo: 1 },
  { name: "Heather Quinn", place: "Port Hughes, 4 bed", stage: "Walk-through booked", note: "Thursday 11am. Currently lets it herself on Airbnb.", daysAgo: 4 },
  { name: "The Dunns", place: "Wallaroo, 2 bed", stage: "Waiting on licence", note: "Long-term. On the list for when the licence is granted.", daysAgo: 20 },
];

export const PAYOUTS = [
  { owner: "Jane Pelham", property: "bayview", amount: 3972.28, matched: true },
  { owner: "Rob and Alison Tait", property: "simms", amount: 5210.4, matched: true },
  { owner: "Mia Castellano", property: "esplanade", amount: 2894.1, matched: false },
];

export const GUEST_STAY = {
  token: "demo",
  guest: "Marcus",
  property: "bayview",
  checkIn: "3pm",
  checkOut: "10am",
  nights: 2,
  wifi: { name: "Bayview", password: "saltandsun" },
  guide: [
    { title: "Getting in", text: "Keypad on the front door. The code turns up on this page from 2pm on the day you arrive." },
    { title: "Parking", text: "Two cars in the driveway. Please don't park on the verge — the council is strict." },
    { title: "Heating and cooling", text: "Split system in the living room, remote on the wall. The fireplace is decorative only." },
    { title: "Bins", text: "Kitchen bin under the sink. Wheelie bins down the side of the house — we take them out." },
    { title: "The beach", text: "Four minutes' walk. Left out the front gate, right at the end of the road." },
  ],
  leaving: ["Dishes in the dishwasher and start it", "Rubbish in the wheelie bins down the side", "Windows closed, split system off", "Keys back where you found them, door pulled shut"],
};
