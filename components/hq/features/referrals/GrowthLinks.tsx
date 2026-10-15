import Link from "next/link";
import { plural } from "@/lib/hq/format";
import { Icon } from "../../icons";

/*
 * The way into the rest of Growth: a flat list divided by hairlines, not a grid of cards.
 * Contacts, organisations and the import belong to other screens; this only links to them.
 */

export type GrowthLink = { href: string; title: string; description: string };

export function GrowthLinks({ links, label }: { links: readonly GrowthLink[]; label: string }) {
  return (
    <ul aria-label={label} className="m-0 grid list-none gap-0 border-t border-line p-0 md:grid-cols-2 md:gap-x-10">
      {links.map((l) => (
        <li key={l.href} className="border-b border-line">
          <Link href={l.href} className="flex min-h-[44px] items-center justify-between gap-4 py-3 no-underline">
            <span>
              <span className="block text-[15px] font-medium">{l.title}</span>
              <span className="hq-muted block text-[13px]">{l.description}</span>
            </span>
            <Icon name="chevron-right" size={16} className="shrink-0 text-grey-text" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** "27 contacts not contacted in 30 days" as a line with a link, for the overview. */
export function QuietPartnersNote({ count, href }: { count: number; href: string }) {
  return (
    <p className="mt-6 text-[14px]">
      <Link href={href} className="font-medium underline underline-offset-4">
        {plural(count, "partner contact")} not contacted in 30 days
      </Link>
      <span className="hq-muted">. This includes anyone you have never contacted.</span>
    </p>
  );
}
