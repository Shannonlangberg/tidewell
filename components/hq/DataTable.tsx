import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/*
 * DataTable: a semantic <table>, server-rendered, with URL-driven sorting.
 *
 * Look (from the approved reference): uppercase letter-spaced column labels in grey,
 * ONE charcoal rule under the header, hairlines between rows, a faint hover tint, DM
 * Sans throughout. No zebra stripes, no boxes.
 *
 * SWITCHING PATTERN, table vs list (the choice, documented):
 *   Below 768px a table cannot be read without sideways scrolling, so HQ renders a
 *   MobileList (one stacked item per row) instead. The switch is CSS ONLY:
 *   <ResponsiveTable table={...} list={...}/> renders BOTH and hides one with
 *   `display: none` at the 768px breakpoint. The hidden one is removed from the
 *   accessibility tree, so nothing is read twice. Why CSS and not JS: it works with no
 *   hydration, never flashes the wrong layout, and needs no window-size state. The cost
 *   is the markup for the page of rows twice, which pagination keeps small (25 rows).
 *   Between 768px and the container width the table scrolls horizontally inside its own
 *   region (tabindex 0, labelled) rather than stretching the page.
 *
 * Sorting: a sortable column renders a link. The page owns the URL; pass `sort` (the
 * current key and direction) and `hrefForSort(sort)` that returns the href for a
 * given sort, normally built with `buildHref` from ./url.
 */

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir };

export type Column<T> = {
  /** Unique within the table. Also the default sort key. */
  key: string;
  header: ReactNode;
  /** Renders the cell. */
  cell: (row: T) => ReactNode;
  /** Makes the header a sort link. Defaults to `key` when `sortable` is true. */
  sortKey?: string;
  sortable?: boolean;
  /** The row's main cell: medium weight, and the one screen readers treat as the row header. */
  primary?: boolean;
  align?: "left" | "right";
  /** Hide this column below a width, so a wide table degrades gracefully. */
  hideBelow?: "lg" | "xl";
  /** A fixed width, e.g. "9rem". */
  width?: string;
  nowrap?: boolean;
};

function nextSortHref(
  col: { sortKey: string },
  sort: SortState | null | undefined,
  hrefForSort: (s: SortState) => string,
  defaultDir: SortDir = "asc",
): string {
  const active = sort?.key === col.sortKey;
  const dir: SortDir = active ? (sort!.dir === "asc" ? "desc" : "asc") : defaultDir;
  return hrefForSort({ key: col.sortKey, dir });
}

/** A sortable <th>. Used by DataTable; exported for hand-built tables. */
export function SortHeader({
  children,
  sortKey,
  sort,
  hrefForSort,
  align,
  className,
  width,
}: {
  children: ReactNode;
  sortKey: string;
  sort?: SortState | null;
  hrefForSort: (s: SortState) => string;
  align?: "left" | "right";
  className?: string;
  width?: string;
}) {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined;
  return (
    <th scope="col" aria-sort={ariaSort} className={cx("hq-th", align === "right" && "hq-th--right", className)} style={{ width }}>
      <Link href={nextSortHref({ sortKey }, sort, hrefForSort)} className="hq-th__sort" data-active={active || undefined}>
        {children}
        <Icon name={active ? (sort!.dir === "asc" ? "arrow-up" : "arrow-down") : "chevron-down"} size={12} className="hq-th__arrow" />
        <span className="sr-only">{active ? `, sorted ${ariaSort}. Activate to reverse.` : ", activate to sort"}</span>
      </Link>
    </th>
  );
}

export type DataTableProps<T> = {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Read by screen readers as the table's name: "Contacts, 27 results, sorted by name". Required. */
  caption: string;
  sort?: SortState | null;
  hrefForSort?: (s: SortState) => string;
  /** Keep the header in view while the table body scrolls (the table region gets a max height). */
  stickyHeader?: boolean;
  /** Shown instead of the table when there are no rows: use an EmptyState. */
  empty?: ReactNode;
  className?: string;
};

export function DataTable<T>({ columns, rows, rowKey, caption, sort, hrefForSort, stickyHeader, empty, className }: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div
      className={cx("hq-tablewrap", stickyHeader && "hq-tablewrap--sticky", className)}
      role="region"
      aria-label={`${caption} (scrollable)`}
      tabIndex={0}
    >
      <table className="hq-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = (c.sortable || c.sortKey) && hrefForSort;
              const hide = c.hideBelow === "lg" ? "hq-hide-lt-lg" : c.hideBelow === "xl" ? "hq-hide-lt-xl" : undefined;
              return sortable ? (
                <SortHeader
                  key={c.key}
                  sortKey={c.sortKey ?? c.key}
                  sort={sort}
                  hrefForSort={hrefForSort}
                  align={c.align}
                  className={hide}
                  width={c.width}
                >
                  {c.header}
                </SortHeader>
              ) : (
                <th key={c.key} scope="col" className={cx("hq-th", c.align === "right" && "hq-th--right", hide)} style={{ width: c.width }}>
                  {c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => {
                const hide = c.hideBelow === "lg" ? "hq-hide-lt-lg" : c.hideBelow === "xl" ? "hq-hide-lt-xl" : undefined;
                const cls = cx("hq-td", c.primary && "hq-td--primary", c.align === "right" && "hq-td--right", c.nowrap && "hq-td--nowrap", hide);
                return c.primary ? (
                  <th key={c.key} scope="row" className={cls}>
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.key} className={cls}>
                    {c.cell(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Table at 768px and up, list below. See the note at the top of this file. */
export function ResponsiveTable({ table, list, className }: { table: ReactNode; list: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="hq-resp-table">{table}</div>
      <div className="hq-resp-list">{list}</div>
    </div>
  );
}
