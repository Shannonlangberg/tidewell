import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { logTag } from "@/lib/hq/contractors/db-errors";
import { first } from "@/lib/hq/contractors/params";
import { toContractor, type Contractor } from "@/lib/hq/contractors/types";
import { todayInZone } from "@/lib/hq/growth/dates";
import { loadTrades } from "@/lib/hq/trades/queries";
import { CONTAINER_SORTS, buildTradeContainers, type ContainerSort } from "@/lib/hq/trades/rules";
import { EmptyState, ErrorState, HQ_ROUTES, LinkButton, PageHeader, Tabs, buildHref } from "@/components/hq";
import { PartnersSections } from "@/components/hq/features/contractors/PartnersSections";
import { TradeContainer } from "@/components/hq/features/trades/TradeContainer";
import { TradesEditor, type EditorTrade } from "@/components/hq/features/trades/TradesEditor";

export const metadata: Metadata = { title: "Trades" };

const PATH = HQ_ROUTES.partnerTrades;

const SORT_LABEL: Record<ContainerSort, string> = { status: "Status", name: "Name", last_used: "Last used" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The Trades view of the Partners module: one container per trade (industry), in the owner's order,
 * each with its contractors, counts, coverage and when it was last used. The list of trades is the
 * owner's (hq.trades): with contractors.write, "Edit trades" opens the editor on this page.
 *
 * URL state: ?sort=status|name|last_used (the order inside every container), ?edit=1 (the editor;
 * ignored without contractors.write). Everything is read as the signed-in person (RLS).
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
      eyebrow="Partners"
      title="Trades"
      description={
        canWrite
          ? "Every trade Planted uses contractors for, with who is in it and whether anyone is approved. The list of trades is yours to change: add, rename, reorder or archive them."
          : "Every trade Planted uses contractors for, with who is in it and whether anyone is approved."
      }
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
  const uncovered = containers.filter((c) => c.trade?.isActive && c.counts.cleared === 0 && c.trade.slug !== "other");
  const inUse = new Map<string, number>();
  for (const c of contractors) for (const s of new Set(c.categories)) inUse.set(s, (inUse.get(s) ?? 0) + 1);
  const editorTrades: EditorTrade[] = trades.data.map((t) => ({ ...t, inUse: inUse.get(t.slug) ?? 0 }));
  const returnTo = buildHref(PATH, { sort: sort === "status" ? undefined : sort });

  return (
    <>
      {header}
      <PartnersSections current="trades" />

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
        <>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <p className="text-[14px] text-grey-text">
              {activeCount === 1 ? "1 trade" : `${activeCount} trades`}
              {uncovered.length > 0 ? (
                <>
                  {" · "}
                  <span className="font-medium text-charcoal">
                    {uncovered.length === 1 ? "1 has" : `${uncovered.length} have`} no approved contractor
                  </span>
                </>
              ) : (
                " · every trade has an approved contractor"
              )}
              {". "}
              Last used dates are recorded by staff: HQ is not connected to Ailo.
            </p>
            <Tabs
              label="Order contractors by"
              className="mt-0"
              items={CONTAINER_SORTS.map((s) => ({ label: SORT_LABEL[s], href: buildHref(PATH, sp, { sort: s === "status" ? null : s }), current: s === sort }))}
            />
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {containers.map((c) => (
              <TradeContainer key={c.trade?.id ?? "unknown"} container={c} today={today} canWrite={canWrite} returnTo={returnTo} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
