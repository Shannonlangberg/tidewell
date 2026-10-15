import Link from "next/link";
import { formatDate } from "@/lib/hq/format";
import type { SearchResults } from "../../types";
import { Icon } from "../../icons";
import { SEARCH_GROUPS, hrefForSearchHit, type SearchKind } from "../../nav";
import { SectionLabel } from "../../Primitives";
import { StatusChip } from "../../StatusChip";

/*
 * The results on /hq/search: one group per kind of record, each row a type chip, a title, a
 * quiet subtitle and a link. Only groups that HAVE results are drawn. A person without
 * growth.read gets no contacts, organisations or referrals back from the database, and this
 * page must not hint that those groups exist, so an empty group is never shown as "none".
 *
 * Server-rendered, so every result is a plain link.
 */

/** The database writes a task's subtitle as "to do - due 2026-10-14"; show it the way the rest of HQ writes dates. */
function subtitleFor(kind: SearchKind, subtitle: string | null | undefined): string | null {
  if (!subtitle) return null;
  if (kind !== "tasks") return subtitle;
  const text = subtitle.replace(/due (\d{4}-\d{2}-\d{2})/, (_m, d: string) => `due ${formatDate(d)}`);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NOUN: Record<SearchKind, string> = { contacts: "Contact", organisations: "Organisation", referrals: "Referral", tasks: "Task", contractors: "Contractor" };

export function SearchResultsView({ results, perGroupLimit }: { results: SearchResults; perGroupLimit: number }) {
  const groups = SEARCH_GROUPS.filter((g) => results[g.kind].length > 0);
  return (
    <div className="grid max-w-3xl gap-10">
      {groups.map((g) => {
        const hits = results[g.kind];
        const headingId = `search-group-${g.kind}`;
        return (
          <section key={g.kind} aria-labelledby={headingId}>
            <SectionLabel as="h2" id={headingId} className="flex items-center gap-2 pb-3">
              <Icon name={g.icon} size={14} />
              {g.label}
              <span className="font-normal normal-case tracking-normal">({hits.length}{hits.length >= perGroupLimit ? "+" : ""})</span>
            </SectionLabel>
            <ul className="hq-mlist m-0" aria-labelledby={headingId}>
              {hits.map((h) => (
                <li key={h.id} className="hq-mitem">
                  <Link href={hrefForSearchHit(g.kind, h.id)} className="hq-mitem__link flex items-center justify-between gap-4 no-underline">
                    <span className="min-w-0">
                      <span className="hq-mitem__title">{h.title}</span>
                      {h.subtitle ? <span className="hq-mitem__sub">{subtitleFor(g.kind, h.subtitle)}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <StatusChip plain>{NOUN[g.kind]}</StatusChip>
                      <Icon name="chevron-right" size={16} className="text-grey-text" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {hits.length >= perGroupLimit ? (
              <p className="hq-muted mt-3 text-[13px]">Showing the first {perGroupLimit}. Add more of the name to narrow it down.</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
