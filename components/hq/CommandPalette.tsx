"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";
import { SEARCH_GROUPS, hrefForSearchHit, type NavEntry, type QuickAction } from "./nav";
import type { SearchAction, SearchResults } from "./types";
import { useModalDialog } from "./useModalDialog";

/*
 * The command palette (Cmd/Ctrl+K, or the search button in the top bar).
 *
 * A native <dialog> holding a combobox: the input owns focus and drives a listbox with
 * aria-activedescendant, so arrow keys move through results while typing continues.
 *  - empty query: quick actions first, then "Go to" pages;
 *  - 2+ characters: a debounced call to `searchAction(query)` (a Server Action running
 *    global_search as the signed-in person), results grouped into Contacts, Organisations,
 *    Referrals and Tasks, each a real link;
 *  - Enter opens the highlighted item, Esc closes and focus goes back to the trigger,
 *    a live region announces the result count, and loading, empty and error states are
 *    all written out.
 */

const MIN_CHARS = 2;
const DEBOUNCE_MS = 220;

type Item = { id: string; href: string; title: string; subtitle?: string | null; icon: IconName; group: string };
type Group = { label: string; items: Item[] };
type Status = "idle" | "loading" | "done" | "error";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  searchAction: SearchAction;
  /** Pages the person can see, for the "Go to" group. */
  nav: readonly NavEntry[];
  quickActions: readonly QuickAction[];
};

export function CommandPalette({ open, onClose, searchAction, nav, quickActions }: CommandPaletteProps) {
  const { ref, handlers } = useModalDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog ref={ref} className="hq-modal hq-palette" aria-labelledby={titleId} {...handlers}>
      <div className="hq-palette__panel">
        <h2 id={titleId} className="sr-only">
          Search Planted HQ
        </h2>
        {/* Mounted only while open, so every opening starts empty. */}
        {open ? <PaletteBody onClose={onClose} searchAction={searchAction} nav={nav} quickActions={quickActions} /> : null}
      </div>
    </dialog>
  );
}

function PaletteBody({ onClose, searchAction, nav, quickActions }: Omit<CommandPaletteProps, "open">) {
  const router = useRouter();
  const uid = useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(0);
  const timer = useRef<number | null>(null);
  const requestId = useRef(0);
  const trimmed = query.trim();

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      requestId.current++; // ignore anything still in flight
    },
    [],
  );

  async function run(q: string) {
    const id = ++requestId.current;
    setStatus("loading");
    try {
      const found = await searchAction(q);
      if (id !== requestId.current) return;
      setResults(found);
      setStatus("done");
      setActive(0);
    } catch {
      if (id !== requestId.current) return;
      setResults(null);
      setStatus("error");
    }
  }

  function onChange(value: string) {
    setQuery(value);
    if (timer.current) window.clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < MIN_CHARS) {
      requestId.current++;
      setResults(null);
      setStatus("idle");
      setActive(0);
      return;
    }
    setStatus("loading");
    timer.current = window.setTimeout(() => void run(q), DEBOUNCE_MS);
  }

  const groups: Group[] = useMemo(() => {
    if (trimmed.length < MIN_CHARS) {
      const out: Group[] = [];
      if (quickActions.length > 0) {
        out.push({
          label: "Quick actions",
          items: quickActions.map((a) => ({ id: `qa-${a.key}`, href: a.href, title: a.label, icon: a.icon, group: "Quick actions" })),
        });
      }
      if (nav.length > 0) {
        out.push({
          label: "Go to",
          items: nav.map((n) => ({ id: `nav-${n.key}`, href: n.href, title: n.label, icon: n.icon, group: "Go to" })),
        });
      }
      return out;
    }
    if (!results) return [];
    const found: Group[] = SEARCH_GROUPS.flatMap((g) => {
      const hits = results[g.kind] ?? [];
      if (hits.length === 0) return [];
      return [
        {
          label: g.label,
          items: hits.map((h) => ({
            id: `${g.kind}-${h.id}`,
            href: hrefForSearchHit(g.kind, h.id),
            title: h.title,
            subtitle: h.subtitle,
            icon: g.icon,
            group: g.label,
          })),
        },
      ];
    });
    // The palette previews a few of each kind; the last item opens the full results page (/hq/search).
    if (found.length > 0) {
      found.push({
        label: "More",
        items: [{ id: "see-all", href: `/hq/search?q=${encodeURIComponent(trimmed)}`, title: `See all results for \u201C${trimmed}\u201D`, icon: "search", group: "More" }],
      });
    }
    return found;
  }, [trimmed, results, quickActions, nav]);

  const items = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const safeActive = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    if (safeActive >= 0) document.getElementById(optionId(safeActive))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from uid, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeActive]);

  function go(item: Item) {
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((safeActive + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((safeActive - 1 + items.length) % items.length);
    } else if (e.key === "Home" && items.length) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && items.length) {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === "Enter" && safeActive >= 0) {
      e.preventDefault();
      go(items[safeActive]);
    }
  }

  const searching = trimmed.length >= MIN_CHARS;
  let announcement = "";
  if (searching) {
    if (status === "loading") announcement = "Searching";
    else if (status === "error") announcement = "Search is not available right now";
    else if (status === "done") {
      // The "see all results" link is not a result.
      const n = items.filter((i) => i.id !== "see-all").length;
      announcement = n === 0 ? "No results" : `${n} ${n === 1 ? "result" : "results"}`;
    }
  } else if (items.length) {
    announcement = `${items.length} suggestions`;
  }

  // Index of each group's first item in the flat list that arrow keys walk.
  const starts = groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.items.length, 0));
  return (
    <>
      <div className="hq-palette__field">
        <Icon name="search" size={18} className="hq-palette__icon" />
        <input
          type="text"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
          aria-label="Search contacts, organisations, referrals and tasks"
          placeholder="Search contacts, organisations, referrals, tasks"
          className="hq-palette__input"
          value={query}
          maxLength={80}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          data-autofocus
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="hq-palette__esc" onClick={onClose}>
          <span className="sr-only">Close search, </span>
          <span className="hq-palette__esc-key">esc</span>
          <span className="hq-palette__esc-text">Close</span>
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="hq-palette__results">
        {searching && status === "error" ? (
          <div className="hq-palette__message" role="alert">
            <Icon name="alert" size={18} />
            <div>
              <p className="hq-palette__message-title">Search is not available right now</p>
              <p className="hq-palette__message-body">Nothing is wrong with your records. Try again in a moment.</p>
              <Button size="sm" onClick={() => void run(trimmed)}>
                Try again
              </Button>
            </div>
          </div>
        ) : null}

        {searching && status === "loading" && items.length === 0 ? (
          <p className="hq-palette__message hq-palette__message--quiet" aria-hidden="true">
            Searching&hellip;
          </p>
        ) : null}

        {searching && status === "done" && items.length === 0 ? (
          <div className="hq-palette__message">
            <div>
              <p className="hq-palette__message-title">No matches for &ldquo;{trimmed}&rdquo;</p>
              <p className="hq-palette__message-body">Check the spelling, or try fewer letters. Search covers contacts, organisations, referrals and tasks.</p>
            </div>
          </div>
        ) : null}

        {trimmed.length > 0 && trimmed.length < MIN_CHARS ? <p className="hq-palette__message hq-palette__message--quiet">Keep typing: search starts at two letters.</p> : null}

        <div id={listId} role="listbox" aria-label={searching ? "Search results" : "Quick actions and pages"} className="hq-palette__list" hidden={items.length === 0}>
          {groups.map((g, gi) => (
            <div key={g.label} role="group" aria-label={g.label} className="hq-palette__group">
              <p className="hq-palette__group-label" aria-hidden="true">
                {g.label}
              </p>
              {g.items.map((item, k) => {
                const i = starts[gi] + k;
                return (
                  <Link
                    key={item.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === safeActive}
                    href={item.href}
                    className={cx("hq-palette__option", i === safeActive && "is-active")}
                    onClick={onClose}
                    onMouseMove={() => i !== safeActive && setActive(i)}
                    tabIndex={-1}
                  >
                    <Icon name={item.icon} size={18} className="hq-palette__option-icon" />
                    <span className="hq-palette__option-text">
                      <span className="hq-palette__option-title">{item.title}</span>
                      {item.subtitle ? <span className="hq-palette__option-sub">{item.subtitle}</span> : null}
                    </span>
                    <Icon name="chevron-right" size={14} className="hq-palette__option-go" />
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="hq-palette__hints" aria-hidden="true">
        <span>
          <kbd className="hq-kbd">&uarr;</kbd> <kbd className="hq-kbd">&darr;</kbd> to move
        </span>
        <span>
          <kbd className="hq-kbd">Enter</kbd> to open
        </span>
        <span>
          <kbd className="hq-kbd">Esc</kbd> to close
        </span>
      </p>
    </>
  );
}
