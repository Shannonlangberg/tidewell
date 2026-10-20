import type { ReactNode } from "react";
import { COMMS_TAB_LABEL, COMMS_TAB_LINE, COMMS_TAB_PATH, commsTabs, type CommsTab } from "@/lib/hq/communications";
import { PageHeader } from "../../PageHeader";
import { Tabs } from "../../Tabs";

/*
 * The top of Communications: the title, a tab per part the person may see (Enquiries for growth.read,
 * Emails for email.draft), and one plain line saying what the current tab holds. The Enquiries tab
 * carries the number still New ("3 new"; nothing when there are none). Server-rendered from what the
 * tab's page already loaded; each tab's page has already called requireStaff(capability).
 */
export function CommsHeader({
  current,
  capabilities,
  newEnquiries,
  actions,
}: {
  current: CommsTab;
  capabilities: readonly string[];
  /** New, unhandled website enquiries; null when not loaded or not visible. */
  newEnquiries: number | null;
  actions?: ReactNode;
}) {
  const tabs = commsTabs(capabilities);
  return (
    <>
      <PageHeader title="Communications" description="What comes in from the website, and the emails HQ sends." actions={actions} />
      {tabs.length > 1 ? (
        <Tabs
          label="Communications"
          items={tabs.map((t) => ({
            label: COMMS_TAB_LABEL[t],
            href: COMMS_TAB_PATH[t],
            current: t === current,
            countText: t === "enquiries" && newEnquiries ? `${newEnquiries.toLocaleString("en-AU")} new` : null,
          }))}
        />
      ) : null}
      <p className="hq-muted mt-4 max-w-[70ch] text-[14px]">
        {tabs.length > 1 ? null : <span className="font-medium text-charcoal">{COMMS_TAB_LABEL[current]}. </span>}
        {COMMS_TAB_LINE[current]}
        {tabs.length === 1 && current === "enquiries" && newEnquiries ? ` ${newEnquiries.toLocaleString("en-AU")} new.` : null}
      </p>
    </>
  );
}
