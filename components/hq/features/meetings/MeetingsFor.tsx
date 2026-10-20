import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { meetingsFor } from "@/lib/hq/meetings/queries";
import { SectionLabel } from "../../Primitives";
import { MeetingMiniList } from "./MeetingParts";

/*
 * A small "Meetings" list on a contact, organisation, lead or contractor page: the latest meetings
 * linked to that record that the viewer may see (a confidential meeting they were not at is left
 * out), newest first. Nothing is shown when there are none, or when the person cannot read meetings.
 */
export async function MeetingsFor({ kind, id, max = 5 }: { kind: "contact" | "organisation" | "opportunity" | "contractor"; id: string; max?: number }) {
  const { db, staff, can } = await requireStaff();
  if (!can("meetings.read")) return null;
  const loaded = await meetingsFor(db, kind, id, max);
  if (!loaded.ok) {
    return (
      <section aria-labelledby={`meetings-${kind}-h`}>
        <SectionLabel as="h2" id={`meetings-${kind}-h`} className="mb-3.5">
          Meetings
        </SectionLabel>
        <p className="hq-muted text-[14px]">The meetings could not be loaded just now.</p>
      </section>
    );
  }
  const { rows, total } = loaded.data;
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={`meetings-${kind}-h`}>
      <SectionLabel as="h2" id={`meetings-${kind}-h`} className="mb-3.5">
        Meetings
      </SectionLabel>
      <MeetingMiniList rows={rows} timezone={staff.timezone} />
      {total > rows.length ? (
        <p className="mt-2 text-[13px]">
          <Link href="/hq/meetings" className="underline underline-offset-2">
            All {total} meetings
          </Link>
        </p>
      ) : null}
    </section>
  );
}
