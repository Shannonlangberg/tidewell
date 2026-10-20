import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { COMMS_BASE, COMMS_TAB_PATH, defaultCommsTab } from "@/lib/hq/communications";

/*
 * /hq/communications opens on the person's first tab: Enquiries for anyone with growth.read, else
 * Emails (email.draft). Someone with neither is sent back to Today with the usual "not yours" notice.
 */
export default async function CommunicationsPage() {
  const { staff } = await requireStaff(undefined, false, COMMS_BASE);
  const tab = defaultCommsTab(staff.capabilities);
  if (!tab) redirect(`${HQ_BASE}?denied=${encodeURIComponent("growth.read")}`);
  redirect(COMMS_TAB_PATH[tab]);
}
