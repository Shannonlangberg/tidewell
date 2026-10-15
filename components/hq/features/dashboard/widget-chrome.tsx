import Link from "next/link";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/hq/EmptyState";
import { Panel, PanelHeader } from "@/components/hq/Primitives";
import { plural } from "@/lib/hq/format";
import type { WidgetId } from "@/lib/hq/dashboard-widgets";

/*
 * The small pieces every dashboard panel is built from: a failure-containing loader wrapper, the panel
 * and its failed state, a row list, and the "N more" link. Shared by widgets.tsx and the contractor
 * widgets (contractor-widgets.tsx) so neither imports the other.
 */

export type Attempt<T> = { ok: true; data: T } | { ok: false };

/** Runs a loader and turns a failure into a result instead of an exception. Logs a code only. */
export async function attempt<T>(label: string, run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    console.error(`[hq] dashboard widget "${label}" failed:`, e instanceof Error ? e.message : "error");
    return { ok: false };
  }
}

export const LOAD_FAILED = "We could not load this just now. Reload the page to try again.";

export function WidgetPanel({ id, title, meta, action, children }: { id: WidgetId; title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Panel aria-labelledby={`w-${id}`}>
      <PanelHeader id={`w-${id}`} title={title} meta={meta} action={action} />
      {children}
    </Panel>
  );
}

export function WidgetFailed({ id, title }: { id: WidgetId; title: string }) {
  return (
    <WidgetPanel id={id} title={title}>
      <ErrorState>{LOAD_FAILED}</ErrorState>
    </WidgetPanel>
  );
}

export const Rows = ({ children, label }: { children: ReactNode; label: string }) => (
  <ul aria-label={label} className="m-0 list-none p-0">
    {children}
  </ul>
);

export const rowClass = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0";

/** "N more" under a capped list, linking to the full list. */
export function MoreLink({ shown, total, href, noun }: { shown: number; total: number; href: string; noun: string }) {
  if (total <= shown) return null;
  return (
    <p className="mt-3 border-t border-line pt-3 text-[13px]">
      <Link href={href} className="hq-muted underline underline-offset-2">
        {plural(total - shown, `more ${noun}`, `more ${noun}s`)}
      </Link>
    </p>
  );
}
