import Link from "next/link";
import { formatDateTime } from "@/lib/hq/format";
import type { VersionRow } from "@/lib/hq/knowledge/queries";
import { Timeline, TimelineItem } from "../../Timeline";
import { VersionStatusChip } from "./KnowledgeParts";

/*
 * A document's version history, newest first: who saved each version and when, through HQ or a chat
 * app, the change note, its status, and who approved it. Each links to the version page (text and
 * what changed). Readers without knowledge.write are given only approved and previously approved
 * versions by the database.
 */
export function KnowledgeHistory({ docId, versions, timezone }: { docId: string; versions: readonly VersionRow[]; timezone: string }) {
  return (
    <Timeline label="Version history">
      {versions.map((v) => (
        <TimelineItem
          key={v.id}
          icon={v.status === "approved" ? "check" : v.status === "discarded" ? "close" : "note"}
          title={
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/hq/knowledge/${docId}/versions/${v.version}`}>Version {v.version}</Link>
              <VersionStatusChip status={v.status} wasApproved={v.approvedAt !== null} />
            </span>
          }
          meta={
            <>
              Saved <time dateTime={v.editedAt}>{formatDateTime(v.editedAt, timezone)}</time>
              {v.editedByName ? <> by {v.editedByName}</> : null}
              {v.via === "mcp" ? <> &middot; through a chat app</> : <> &middot; in HQ</>}
            </>
          }
        >
          {v.changeNote || v.approvedAt ? (
            <>
              {v.changeNote ? <p className="whitespace-pre-wrap break-words">{v.changeNote}</p> : null}
              {v.approvedAt ? (
                <p className="mt-1 text-[14px] text-grey-text">
                  Approved <time dateTime={v.approvedAt}>{formatDateTime(v.approvedAt, timezone)}</time>
                  {v.approvedByName ? ` by ${v.approvedByName}` : ""}
                  {v.approvedVia === "mcp" ? " from a chat app" : ""}
                </p>
              ) : null}
            </>
          ) : null}
        </TimelineItem>
      ))}
    </Timeline>
  );
}
