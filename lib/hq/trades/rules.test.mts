import test from "node:test";
import assert from "node:assert/strict";
import {
  agoText,
  allowedTradeSlugs,
  buildTradeContainers,
  cleanTradeLabel,
  countContractors,
  coverageLine,
  daysAgo,
  humaniseSlug,
  lastUsedText,
  listText,
  matchTrade,
  missingDetails,
  shortDate,
  sortContainerContractors,
  sortTrades,
  tradeLabel,
  tradeCountsText,
  tradeLookup,
  tradeOptions,
  tradeSlugBase,
  uniqueTradeSlug,
  usedAgoText,
  type Trade,
} from "./rules.ts";

// The 22 trades migration 0123 seeds (slug, label, order), as the database holds them.
const SEED: Array<[string, string]> = [
  ["plumbing", "Plumbing"], ["electrical", "Electrical"], ["general_maintenance", "General maintenance"], ["handyman", "Handyman"],
  ["carpentry", "Carpentry"], ["cleaning", "Cleaning"], ["carpet_cleaning", "Carpet cleaning"], ["gardening", "Gardening"],
  ["landscaping", "Landscaping"], ["pest_control", "Pest control"], ["locksmith", "Locksmith"], ["painting", "Painting"],
  ["roofing", "Roofing"], ["guttering", "Guttering"], ["air_conditioning", "Air conditioning"], ["appliance_repairs", "Appliance repairs"],
  ["garage_doors", "Garage doors"], ["glazing", "Glazing"], ["tree_services", "Tree services"], ["building", "Building"],
  ["emergency_restoration", "Emergency restoration"], ["other", "Other"],
];
const TRADES: Trade[] = SEED.map(([slug, label], i) => ({ id: `t${i}`, slug, label, description: null, sortOrder: (i + 1) * 10, isActive: true }));
const t = (slug: string) => TRADES.find((x) => x.slug === slug)!;

test("slugs follow the database rule (hq_private.trade_slug_base)", () => {
  assert.equal(tradeSlugBase("Solar & Batteries"), "solar_and_batteries");
  assert.equal(tradeSlugBase("  Air-Con / Heating!! "), "air_con_heating");
  assert.equal(tradeSlugBase("24/7 Call-outs"), "t_24_7_call_outs");
  assert.equal(tradeSlugBase("!!!"), "trade");
  assert.equal(tradeSlugBase("Électricité"), "lectricit");
  const long = tradeSlugBase("Long name ".repeat(20));
  assert.ok(long.length <= 40 && !long.endsWith("_"));
});

test("a taken slug gets a numeric suffix", () => {
  assert.equal(uniqueTradeSlug("Plumbing", ["electrical"]), "plumbing");
  assert.equal(uniqueTradeSlug("Plumbing", ["plumbing"]), "plumbing_2");
  assert.equal(uniqueTradeSlug("Plumbing", ["plumbing", "plumbing_2"]), "plumbing_3");
});

test("labels are tidied like the database does", () => {
  assert.equal(cleanTradeLabel("  Solar   &  Batteries "), "Solar & Batteries");
});

test("trades sort by the owner's order, then label, then slug", () => {
  const mixed: Trade[] = [
    { ...t("electrical"), sortOrder: 10 },
    { ...t("plumbing"), sortOrder: 10 },
    { ...t("other"), sortOrder: 5 },
  ];
  assert.deepEqual(sortTrades(mixed).map((x) => x.slug), ["other", "electrical", "plumbing"]);
  assert.equal(mixed[0].slug, "electrical", "sortTrades does not mutate");
});

test("labels come from the table, with a readable fallback", () => {
  const lookup = tradeLookup([{ ...t("electrical"), label: "Electricians" }]);
  assert.equal(tradeLabel("electrical", lookup), "Electricians");
  assert.equal(tradeLabel("solar_panels", lookup), "Solar panels");
  assert.equal(humaniseSlug("air_conditioning"), "Air conditioning");
});

test("a form offers active trades, plus an archived one the record already has", () => {
  const trades = [t("plumbing"), { ...t("roofing"), isActive: false }, { ...t("glazing"), isActive: false }];
  assert.deepEqual(tradeOptions(trades).map((o) => o.value), ["plumbing"]);
  assert.deepEqual(tradeOptions(trades, ["glazing"]), [
    { value: "plumbing", label: "Plumbing" },
    { value: "glazing", label: "Glazing (archived)" },
  ]);
  assert.deepEqual(allowedTradeSlugs(trades, ["glazing"]).sort(), ["glazing", "plumbing"]);
});

test("loose matching: names people type find the trade", () => {
  const m = (s: string) => {
    const r = matchTrade(s, TRADES);
    return r.kind === "match" ? r.trade.slug : r.kind;
  };
  assert.equal(m("plumbing"), "plumbing");
  assert.equal(m("PLUMBING"), "plumbing");
  assert.equal(m("air_conditioning"), "air_conditioning");
  assert.equal(m("Air conditioning"), "air_conditioning");
  assert.equal(m("electricians"), "electrical");
  assert.equal(m("Electrician"), "electrical");
  assert.equal(m("plumbers"), "plumbing");
  assert.equal(m("painters"), "painting");
  assert.equal(m("gardeners"), "gardening");
  assert.equal(m("locksmiths"), "locksmith");
  assert.equal(m("pest"), "pest_control");
  assert.equal(m("cleaning"), "cleaning", "the trade named exactly wins over Carpet cleaning");
  assert.equal(m("glaziers"), "glazing");
  assert.equal(m("tree"), "tree_services");
  assert.equal(m("wizardry"), "none");
  assert.equal(m(""), "none");
});

test("loose matching never guesses between several, and archived trades match only exactly", () => {
  const r = matchTrade("repairs", [...TRADES, { ...t("roofing"), id: "x", slug: "roof_repairs", label: "Roof repairs" }]);
  assert.equal(r.kind, "ambiguous");
  const archived = TRADES.map((x) => (x.slug === "electrical" ? { ...x, isActive: false } : x));
  assert.equal(matchTrade("electricians", archived).kind, "none");
  const exact = matchTrade("electrical", archived);
  assert.ok(exact.kind === "match" && exact.trade.slug === "electrical");
  const renamed = matchTrade("Electricians", TRADES.map((x) => (x.slug === "electrical" ? { ...x, label: "Electricians" } : x)));
  assert.ok(renamed.kind === "match" && renamed.exact, "a renamed label matches exactly");
});

const C = (id: string, businessName: string, status: string, categories: string[], lastJobDate: string | null = null) => ({ id, businessName, status, categories, lastJobDate });

test("containers: one per active trade, in order; a contractor in several trades is in each", () => {
  const contractors = [
    C("1", "Zed Plumbing", "approved", ["plumbing", "electrical"], "2026-10-01"),
    C("2", "Alpha Plumbing", "prospect", ["plumbing"]),
    C("3", "Sparks", "vetting", ["electrical"], "2026-10-12"),
  ];
  const out = buildTradeContainers(TRADES, contractors);
  assert.equal(out.length, 22);
  assert.deepEqual(out.slice(0, 2).map((c) => c.trade?.slug), ["plumbing", "electrical"]);
  assert.deepEqual(out[0].contractors.map((c) => c.id), ["1", "2"], "status order: approved before prospect");
  assert.deepEqual(out[1].contractors.map((c) => c.id), ["1", "3"]);
  assert.deepEqual(out[0].counts, { cleared: 1, approved: 1, preferred: 0, vetting: 0, prospects: 1, total: 2 });
  assert.equal(out[1].lastUsed, "2026-10-12", "the most recent use across the trade's contractors");
  assert.equal(out[0].lastUsed, "2026-10-01");
  assert.equal(out[2].lastUsed, null);
  assert.equal(out[2].contractors.length, 0);
});

test("containers: an archived trade still carried gets a container at the end; unknown trades are not lost", () => {
  const trades = [t("plumbing"), { ...t("glazing"), isActive: false }, { ...t("roofing"), isActive: false }];
  const out = buildTradeContainers(trades, [C("1", "Glass", "prospect", ["glazing"]), C("2", "Mystery", "prospect", ["wizardry"])]);
  assert.deepEqual(out.map((c) => c.trade?.slug ?? null), ["plumbing", "glazing", null]);
  assert.deepEqual(out[2].contractors.map((c) => c.id), ["2"]);
  assert.equal(buildTradeContainers(trades, []).length, 1, "no empty unknown bucket, no unused archived trade");
});

test("container lists sort by status, name or last used", () => {
  const list = [C("1", "Bravo", "prospect", [], "2026-01-01"), C("2", "alpha", "preferred", [], null), C("3", "Charlie", "approved", [], "2026-09-01")];
  assert.deepEqual(sortContainerContractors(list, "status").map((c) => c.id), ["2", "3", "1"]);
  assert.deepEqual(sortContainerContractors(list, "name").map((c) => c.id), ["2", "1", "3"]);
  assert.deepEqual(sortContainerContractors(list, "last_used").map((c) => c.id), ["3", "1", "2"], "most recent first, never recorded last");
});

test("coverage wording says plainly when nobody is approved", () => {
  assert.deepEqual(coverageLine(countContractors([]), "Roofing"), { tone: "empty", text: "No contractors in Roofing yet." });
  assert.deepEqual(coverageLine(countContractors([{ status: "prospect" }, { status: "vetting" }]), "Plumbing"), {
    tone: "warning",
    text: "No approved contractor for Plumbing. 2 are still a prospect or being vetted.",
  });
  assert.deepEqual(coverageLine(countContractors([{ status: "suspended" }]), "Plumbing"), { tone: "warning", text: "No approved contractor for Plumbing." });
  assert.deepEqual(coverageLine(countContractors([{ status: "vetting" }]), "Plumbing").text, "No approved contractor for Plumbing. 1 is still a prospect or being vetted.");
  assert.deepEqual(coverageLine(countContractors([{ status: "approved" }, { status: "preferred" }, { status: "approved" }]), "Plumbing"), { tone: "ok", text: "Covered: 2 approved, 1 preferred." });
});

test("last used: the date and how long ago, or never recorded", () => {
  assert.equal(lastUsedText("2026-10-12", "2026-10-15"), "Last used 12 Oct 2026 (3 days ago)");
  assert.equal(lastUsedText("2026-10-15", "2026-10-15"), "Last used 15 Oct 2026 (today)");
  assert.equal(lastUsedText("2026-10-14", "2026-10-15"), "Last used 14 Oct 2026 (yesterday)");
  assert.equal(lastUsedText(null, "2026-10-15"), "Never recorded");
  assert.equal(lastUsedText("", "2026-10-15"), "Never recorded");
  assert.equal(shortDate("2026-01-05"), "5 Jan 2026");
  assert.equal(daysAgo("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysAgo("2024-02-28", "2024-03-01"), 2, "leap year");
  assert.equal(agoText(13), "13 days ago");
  assert.equal(agoText(14), "2 weeks ago");
  assert.equal(agoText(59), "8 weeks ago");
  assert.equal(agoText(60), "1 month ago");
  assert.equal(agoText(400), "13 months ago");
  assert.equal(agoText(800), "2 years ago");
  assert.equal(agoText(-2), "today", "a future date (should not happen) is never shown as negative");
});

test("compact trades list: counts in words, used ago, missing details", () => {
  const S = (...st: string[]) => countContractors(st.map((status) => ({ status })));
  assert.equal(tradeCountsText(S()), "No contractors");
  assert.equal(tradeCountsText(S("prospect", "contacted", "prospect")), "3 prospects");
  assert.equal(tradeCountsText(S("prospect")), "1 prospect");
  assert.equal(tradeCountsText(S("approved", "preferred", "vetting", "prospect", "suspended", "inactive")), "1 preferred, 1 approved, 1 being vetted, 1 prospect, 2 not active");
  assert.equal(usedAgoText(null, "2026-10-15"), null);
  assert.equal(usedAgoText("2026-10-12", "2026-10-15"), "Used 3 days ago");
  assert.equal(usedAgoText("2026-10-15", "2026-10-15"), "Used today");
  const base = { phone: null, serviceSuburbs: [], serviceRegions: [], insuranceState: "not_recorded", licenceState: "not_recorded" };
  assert.deepEqual(missingDetails(base), ["phone", "service areas", "insurance", "licence"]);
  assert.deepEqual(missingDetails({ ...base, phone: " 08 8825 0000 ", serviceRegions: ["Copper Coast"], insuranceState: "current", licenceState: "expired" }), []);
  assert.deepEqual(missingDetails({ ...base, phone: "  ", serviceSuburbs: ["Moonta"], insuranceState: "current" }), ["phone", "licence"]);
  assert.equal(listText(["phone"]), "phone");
  assert.equal(listText(["phone", "insurance", "licence"]), "phone, insurance and licence");
  assert.equal(listText(["phone", "licence"], "or"), "phone or licence");
});
