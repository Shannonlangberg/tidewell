import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { commsHref } from "@/lib/hq/communications";
import { buildHref } from "@/components/hq";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The old address of the website enquiries list. The list now lives in Communications > Enquiries; this
 * keeps old links and bookmarks working (the filters, page and any notice are kept). An enquiry's own
 * page (/hq/growth/enquiries/<id>) stays where it is: notification emails and chat tools link to it.
 */
export default async function EnquiriesListRedirect({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await requireStaff("growth.read", false, buildHref("/hq/growth/enquiries", sp));
  redirect(commsHref("enquiries", sp));
}
