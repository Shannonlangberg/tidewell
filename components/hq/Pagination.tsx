import Link from "next/link";
import { plural } from "@/lib/hq/format";
import { cx } from "./cx";
import { Icon } from "./icons";
import { buildHref, type SearchParamsInput } from "./url";

/*
 * Link-based pagination. Every other query parameter (filters, sort) is preserved by
 * `buildHref`; only `page` changes. Page 1 drops the param so the canonical URL is clean.
 *
 * "Showing 1 to 25 of 140 contacts" on the left, Previous / page numbers / Next on the right.
 */

function pageWindow(current: number, last: number): Array<number | "gap"> {
  const pages = new Set<number>([1, last, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export type PaginationProps = {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  pathname: string;
  /** The page's resolved searchParams, so filters and sort survive a page change. */
  searchParams?: SearchParamsInput;
  /** What is being counted, singular: "contact", "task". */
  noun?: string;
  /** The query parameter that carries the page number. Default "page". */
  param?: string;
  className?: string;
};

export function Pagination({ page, pageSize, total, pathname, searchParams, noun = "result", param = "page", className }: PaginationProps) {
  if (total <= 0) return null;
  const last = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), last);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const href = (p: number) => buildHref(pathname, searchParams, { [param]: p === 1 ? null : p });

  return (
    <div className={cx("hq-pager", className)}>
      <p className="hq-pager__summary">
        Showing {from.toLocaleString("en-AU")} to {to.toLocaleString("en-AU")} of {plural(total, noun)}
      </p>
      {last > 1 ? (
        <nav aria-label="Pagination" className="hq-pager__nav">
          {current > 1 ? (
            <Link href={href(current - 1)} rel="prev" className="hq-pager__step">
              <Icon name="chevron-left" size={15} />
              Previous
            </Link>
          ) : (
            <span className="hq-pager__step" aria-disabled="true">
              <Icon name="chevron-left" size={15} />
              Previous
            </span>
          )}
          <p className="hq-pager__of">
            Page {current} of {last}
          </p>
          <ol className="hq-pager__pages">
            {pageWindow(current, last).map((p, i) =>
              p === "gap" ? (
                <li key={`gap-${i}`} aria-hidden="true" className="hq-pager__gap">
                  &hellip;
                </li>
              ) : (
                <li key={p}>
                  <Link href={href(p)} className="hq-pager__page" aria-current={p === current ? "page" : undefined} aria-label={`Page ${p}`}>
                    {p}
                  </Link>
                </li>
              ),
            )}
          </ol>
          {current < last ? (
            <Link href={href(current + 1)} rel="next" className="hq-pager__step">
              Next
              <Icon name="chevron-right" size={15} />
            </Link>
          ) : (
            <span className="hq-pager__step" aria-disabled="true">
              Next
              <Icon name="chevron-right" size={15} />
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
