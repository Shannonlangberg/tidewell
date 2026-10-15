import Link from "next/link";
import { formatDate, relativeDay } from "@/lib/hq/format";
import { isOverdue, overdueLabel } from "@/lib/hq/tasks/rules";
import { isOpen } from "@/lib/hq/tasks/rules";
import type { TaskStatus } from "@/lib/hq/constants";
import type { RelatedRef, TaskRelated } from "@/lib/hq/tasks/types";
import { Icon, type IconName } from "../../icons";
import { StatusChip } from "../../StatusChip";

/*
 * Small server-rendered pieces shared by the task list, the task page and the form: the due
 * date with its relative wording, and the chips for the records a task is linked to.
 */

/** The due date: the date, then "Tomorrow" / "in 3 days", or an error-tone chip "5 days overdue". Closed tasks show the date only. */
export function DueCell({ due, status, today }: { due: string | null; status: TaskStatus; today: string }) {
  if (!due) return <span className="hq-cell-nil">No due date</span>;
  const overdue = isOverdue(status, due, today);
  return (
    <>
      <time dateTime={due} className="hq-nums">
        {formatDate(due)}
      </time>
      {overdue ? (
        <span className="hq-cell-sub mt-1">
          <StatusChip tone="error">{overdueLabel(due, today)}</StatusChip>
        </span>
      ) : isOpen(status) ? (
        <span className="hq-cell-sub">{relativeDay(due, today)}</span>
      ) : null}
    </>
  );
}

/** One short line for the phone card: "Today", "Tomorrow", "Due 22 Oct 2026". An overdue task has its own chip, so this just gives the date. */
export function dueMeta(due: string | null, status: TaskStatus, today: string): string {
  if (!due) return "No due date";
  if (!isOpen(status) || isOverdue(status, due, today)) return `Due ${formatDate(due)}`;
  const rel = relativeDay(due, today);
  return rel === "Today" || rel === "Tomorrow" ? rel : `Due ${formatDate(due)}`;
}

type Kind = "contact" | "organisation" | "referral" | "opportunity";

const KIND: Record<Kind, { icon: IconName; noun: string; href: ((id: string) => string) | null }> = {
  contact: { icon: "user", noun: "Contact", href: (id) => `/hq/growth/contacts/${id}` },
  organisation: { icon: "building", noun: "Organisation", href: (id) => `/hq/growth/organisations/${id}` },
  referral: { icon: "link", noun: "Referral", href: (id) => `/hq/growth/referrals/${id}` },
  // Opportunities have no page of their own: they live on the pipeline board.
  opportunity: { icon: "growth", noun: "Opportunity", href: null },
};

const ORDER: Kind[] = ["contact", "organisation", "referral", "opportunity"];

function RelatedChip({ kind, rel }: { kind: Kind; rel: RelatedRef }) {
  const k = KIND[kind];
  // No label means the person cannot read that record: say it is linked, name nothing, link nowhere.
  const text = rel.label ?? `Linked ${k.noun.toLowerCase()}`;
  const content = (
    <>
      <Icon name={k.icon} size={13} />
      {rel.label ? <span className="sr-only">{k.noun}: </span> : null}
      <span className="max-w-[16rem] truncate">{text}</span>
    </>
  );
  const href = rel.label && k.href ? k.href(rel.id) : null;
  return href ? (
    <Link href={href} className="hq-chip hq-chip--plain no-underline hover:underline" title={`${k.noun}: ${text}`}>
      {content}
    </Link>
  ) : (
    <span className="hq-chip hq-chip--plain" title={rel.label ? `${k.noun}: ${text}` : "You don't have access to this record"}>
      {content}
    </span>
  );
}

/** Chips for the contact, organisation, referral and opportunity a task is linked to. Renders nothing when it is linked to none. */
export function RelatedChips({ related, className }: { related: TaskRelated; className?: string }) {
  const present = ORDER.filter((k) => related[k] !== null);
  if (present.length === 0) return null;
  return (
    <span className={className ?? "flex flex-wrap gap-1.5"}>
      {present.map((k) => (
        <RelatedChip key={k} kind={k} rel={related[k] as RelatedRef} />
      ))}
    </span>
  );
}

export function hasRelated(related: TaskRelated): boolean {
  return ORDER.some((k) => related[k] !== null);
}
