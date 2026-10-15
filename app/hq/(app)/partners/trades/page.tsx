import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { logTag } from "@/lib/hq/contractors/db-errors";
import { first } from "@/lib/hq/contractors/params";
import { toContractor, type Contractor } from "@/lib/hq/contractors/types";
import { todayInZone } from "@/lib/hq/growth/dates";
import { loadTrades } from "@/lib/hq/trades/queries";
import { CONTAINER_SORTS, buildTradeContainers, listText, missingDetails, type ContainerSort } from "@/lib/hq/trades/rules";
import { EmptyState, ErrorState, HQ_ROUTES, LinkButton, PageHeader, buildHref } from "@/components/hq";
import { PartnersSections } from "@/components/hq/features/contractors/PartnersSections";
import { OpenFromHash } from "@/components/hq/features/trades/OpenFromHash";
import { EmptyTrades, TradeRow } from "@/components/hq/features/trades/TradeList";
import { TradesEditor, type EditorTrade } from "@/components/hq/features/trades/TradesEditor";

export const metadata: Metadata = { title: "Trades" };

const PATH = HQ_ROUTES.partnerTrades;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The Trades view of the Partners module, as a compact list (docs/hq-simple-layouts.md, change 4):
 * one row per trade that has contractors, in the owner's order, opening to its contractors; the
 * trades nobody is in yet fold into one "No contractors yet (n)" row. The list of trades is the
 * owner's (hq.trades): with contractors.write, "Edit trades" opens the editor on this page.
 *
 * URL state: ?edit=1 (the editor; ignored without contractors.write); ?sort=status|name|last_used
 * (the order inside each trade, status by default); #trade-<slug> opens that trade. Everything is
 * read as the signed-in person (RLS).
 */
export default async function TradesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("contractors.read", false, buildHref(PATH, sp));
  const canWrite = can("contractors.write");
  const canApprove = can("contractors.approve");
  const editing = canWrite && first(sp.edit) === "1";
  const sortRaw = first(sp.sort);
  const sort: ContainerSort = (CONTAINER_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as ContainerSort) : "status";
  const today = todayInZone(staff.timezone);

  const [trades, list] = await Promise.all([
    loadTrades(db),
    db.from("contractor_directory").select("*").order("business_name").limit(2000),
  ]);
  if (list.error) console.error("[hq] trades page contractors failed:", logTag(list.error));

  const header = (
    <PageHeader
      eyebrow="Contractors"
      title="Trades"
      description="Who to call for each trade."
      actions={
        canWrite ? (
          <>
            {editing ? (
              <LinkButton href={buildHref(PATH, sp, { edit: null })} variant="primary" icon="check">
                Done editing
              </LinkButton>
            ) : (
              <LinkButton href={buildHref(PATH, sp, { edit: "1" })}>Edit trades</LinkButton>
            )}
            <LinkButton href={HQ_ROUTES.partnerNew} variant={editing ? "secondary" : "primary"} icon="plus">
              Add contractor
            </LinkButton>
          </>
        ) : undefined
      }
    />
  );

  if (!trades.ok || list.error) {
    return (
      <>
        {header}
        <PartnersSections current="trades" />
        <ErrorState title="We could not load the trades" action={<LinkButton href={buildHref(PATH, sp)} size="sm">Try again</LinkButton>} />
      </>
    );
  }

  const contractors = (list.data ?? []).map(toContractor).filter((c): c is Contractor => c !== null);
  const containers = buildTradeContainers(trades.data, contractors, sort);
  const activeCount = trades.data.filter((t) => t.isActive).length;
  const filled = containers.filter((c) => c.counts.total > 0);
  const empty = containers.filter((c) => c.counts.total === 0 && c.trade).map((c) => c.trade!);
  const activeFilled = filled.filter((c) => c.trade?.isActive);
  const covered = activeFilled.filter((c) => c.counts.cleared > 0).length;
  // Principle 2: a gap every trade shares is said once (the sentence), not as a marker on each row.
  const markUncovered = covered > 0;
  // Details nobody has recorded are said once above the list; rows only flag what else is missing.
  const sharedMissing = new Set<string>(contractors.length > 0 ? missingDetails(contractors[0]) : []);
  for (const c of contractors.slice(1)) {
    const m = new Set(missingDetails(c));
    for (const x of sharedMissing) if (!m.has(x)) sharedMissing.delete(x);
  }
  const inUse = new Map<string, number>();
  for (const c of contractors) for (const s of new Set(c.categories)) inUse.set(s, (inUse.get(s) ?? 0) + 1);
  const editorTrades: EditorTrade[] = trades.data.map((t) => ({ ...t, inUse: inUse.get(t.slug) ?? 0 }));
  const returnTo = buildHref(PATH, { sort: sort === "status" ? undefined : sort });

  const coverSentence =
    activeFilled.length === 0
      ? "No trade has a contractor yet."
      : `${activeFilled.length} of ${activeCount} ${activeCount === 1 ? "trade has" : "trades have"} contractors. ${
          covered === 0
            ? "None has an approved contractor yet."
            : covered === activeFilled.length
              ? "Every one has an approved contractor."
              : `${covered} ${covered === 1 ? "has" : "have"} an approved contractor.`
        }`;
  const missingSentence =
    sharedMissing.size > 0 && contractors.length > 1 ? `No contractor has ${listText([...sharedMissing].map((m) => (m === "phone" ? "a phone number" : m)), "or")} recorded yet.` : null;

  return (
    <>
      {header}
      <PartnersSections current="trades" />
      <OpenFromHash />

      {editing ? <TradesEditor trades={editorTrades} canApprove={canApprove} /> : null}

      {activeCount === 0 && contractors.length === 0 ? (
        <EmptyState
          title="No trades yet"
          action={
            canWrite && !editing ? (
              <LinkButton href={buildHref(PATH, sp, { edit: "1" })} variant="primary">
                Add a trade
              </LinkButton>
            ) : undefined
          }
        >
          {canWrite ? "Add the trades Planted uses contractors for, such as Plumbers or Electricians." : "Nobody has added a trade yet. Someone who manages contractors can add them."}
        </EmptyState>
      ) : (
        <section aria-label="Trades" className="hq-trades">
          <p className="hq-trades__lede">
            {coverSentence}
            {missingSentence ? <span className="hq-trades__lede-sub">{missingSentence}</span> : null}
          </p>
          <div className="hq-trades__list">
            {filled.map((c) => (
              <TradeRow key={c.trade?.id ?? "unknown"} container={c} markUncovered={markUncovered} sharedMissing={sharedMissing} today={today} canWrite={canWrite} returnTo={returnTo} />
            ))}
            <EmptyTrades trades={empty} canWrite={canWrite} />
          </div>
        </section>
      )}
    </>
  );
}
