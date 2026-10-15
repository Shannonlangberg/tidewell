import { redirect } from "next/navigation";
import { buildHref } from "@/components/hq";

/*
 * /hq/operations/tasks is the same list as /hq/operations (the navigation's "Operations" goes
 * to the latter). Anything that links here, with filters or without, lands on the one list with
 * its query string intact.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksIndexPage({ searchParams }: { searchParams: SearchParams }) {
  redirect(buildHref("/hq/operations", await searchParams));
}
