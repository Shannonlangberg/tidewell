import { formatDateTime } from "@/lib/hq/format";
import { HISTORY_FIELD_LABEL, historyValue, type HistoryAction } from "@/lib/hq/decisions/rules";
import type { HistoryEntry } from "@/lib/hq/decisions/queries";
import type { IconName } from "../../icons";
import { Timeline, TimelineItem } from "../../Timeline";

/*
 * A decision's history, newest first, from hq.decision_history (append-only; written by the
 * database with every change). Each entry: what happened, when and by whom, the note, and for an
 * edit the fields that changed (long text is summarised as "changed", not repeated in full).
 */

const ICON: Record<HistoryAction, IconName> = {
  create: "plus",
  update: "note",
  status_change: "check",
  supersede: "link",
  supersedes: "link",
  reverse: "close",
  link_task: "task",
  unlink_task: "task",
  archive: "inbox",
  restore: "inbox",
};

const LONG = new Set(["description", "rationale"]);
const SHOWN = ["title", "category", "decision_date", "decision_maker_id", "description", "rationale"];

export function DecisionHistory({ entries, timezone, names }: { entries: readonly HistoryEntry[]; timezone: string; names: ReadonlyMap<string, string> }) {
  const nameOf = (id: string) => names.get(id) ?? null;
  return (
    <Timeline label="Decision history">
      {entries.map((e) => {
        const lines =
          e.action === "update" || e.action === "status_change" || e.action === "supersede" || e.action === "reverse"
            ? SHOWN.filter((k) => k in e.changes).map((k) => {
                const c = e.changes[k];
                return LONG.has(k)
                  ? `${HISTORY_FIELD_LABEL[k]} ${c.to === null || c.to === undefined ? "removed" : c.from === null || c.from === undefined ? "added" : "changed"}`
                  : `${HISTORY_FIELD_LABEL[k]}: ${historyValue(k, c.from, nameOf)} → ${historyValue(k, c.to, nameOf)}`;
              })
            : [];
        return (
          <TimelineItem
            key={e.id}
            icon={ICON[e.action] ?? "clock"}
            title={e.summary}
            meta={
              <>
                <time dateTime={e.at}>{formatDateTime(e.at, timezone)}</time>
                {e.byName ? <> &middot; {e.byName}</> : null}
              </>
            }
          >
            {lines.length > 0 || e.note ? (
              <>
                {lines.length > 0 ? (
                  <ul className="m-0 grid list-none gap-0.5 p-0 text-[14px] text-grey-text">
                    {lines.map((l) => (
                      <li key={l} className="break-words">
                        {l}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {e.note ? <p className="mt-1 whitespace-pre-wrap break-words">{e.note}</p> : null}
              </>
            ) : null}
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
