import Link from "next/link";
import { agoLabel } from "@/lib/hq/growth/dates";
import type { Contact } from "@/lib/hq/growth/types";
import { makePrimaryContact } from "@/app/hq/(app)/growth/contacts/actions";
import { RelationshipChip, StatusChip } from "../../StatusChip";
import { FollowUpCell, NeedsVerifyingChip } from "../contacts/Bits";
import { MakePrimaryButton } from "../contacts/MakePrimary";

/*
 * Everyone at an organisation, the primary contact first, so nobody is called five times.
 * One row per person, laid out to read on a phone as well as a desktop. "Make primary" is
 * offered only to people who may write; the Server Action checks that again.
 */
export function OrganisationContacts({ contacts, timezone, today, canWrite }: { contacts: readonly Contact[]; timezone: string; today: string; canWrite: boolean }) {
  return (
    <ul className="divide-y divide-line border-y border-line" aria-label="Contacts at this organisation">
      {contacts.map((c) => {
        const ago = agoLabel(c.lastContactAt, timezone);
        return (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 py-4">
            <div className="min-w-0 flex-1 basis-56">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Link href={`/hq/growth/contacts/${c.id}`} className="text-[15px] font-medium underline-offset-2 hover:underline">
                  {c.fullName}
                </Link>
                {c.orgContactRole === "primary" ? <StatusChip tone="info">Primary contact</StatusChip> : null}
                {c.needsVerification ? <NeedsVerifyingChip /> : null}
              </p>
              <p className="mt-0.5 text-[13px] text-grey-text">{c.position ?? "Position not recorded"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]">
              <RelationshipChip status={c.status} />
              <span className="text-grey-text">{ago ? `Last contact ${ago.toLowerCase()}` : "Not contacted yet"}</span>
              <span className="flex items-center gap-2">
                <span className="text-grey-text">Follow-up</span>
                <span>
                  <FollowUpCell date={c.nextFollowUpDate} today={today} />
                </span>
              </span>
              {canWrite && c.orgContactRole !== "primary" ? <MakePrimaryButton id={c.id} returnTo="organisation" action={makePrimaryContact} name={c.fullName} /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
