import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { first } from "@/lib/hq/contractors/params";
import { todayInZone } from "@/lib/hq/growth/dates";
import { staffOptions } from "@/lib/hq/queries/options";
import { loadTrades } from "@/lib/hq/trades/queries";
import { tradeOptions } from "@/lib/hq/trades/rules";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { BLANK_CONTRACTOR, ContractorForm } from "@/components/hq/features/contractors/ContractorForm";

export const metadata: Metadata = { title: "Add contractor" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** ?trade=<slug> (from a container on the Trades page) pre-selects that trade, when it is an active one. */
export default async function NewContractorPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff } = await requireStaff("contractors.write");
  const [staffList, trades] = await Promise.all([staffOptions(db), loadTrades(db)]);
  const crumbs = [{ label: "Partners", href: "/hq/partners" }, { label: "Contractors", href: "/hq/partners" }, { label: "Add contractor" }];

  if (!trades.ok) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Add contractor" />
        <ErrorState title="We could not load the list of trades" action={<LinkButton href="/hq/partners/new" size="sm">Try again</LinkButton>} />
      </>
    );
  }
  const wanted = first(sp.trade);
  const preset = trades.data.find((t) => t.isActive && t.slug === wanted);
  const backHref = preset ? "/hq/partners/trades" : "/hq/partners";

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title="Add contractor"
        description="Record what you know and leave the rest blank. A new contractor starts as a prospect and is not cleared to be sent to a property until a person has vetted and approved them."
      />
      <ContractorForm
        initial={preset ? { ...BLANK_CONTRACTOR, categories: [preset.slug] } : BLANK_CONTRACTOR}
        staff={staffList}
        cancelHref={backHref}
        today={todayInZone(staff.timezone)}
        tradeOptions={tradeOptions(trades.data)}
      />
    </>
  );
}
