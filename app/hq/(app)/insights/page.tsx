import { redirect } from "next/navigation";
import { HQ_ROUTES } from "@/components/hq/nav";

/*
 * The old address of Reports (it was the "Insights, Phase 4" placeholder). Kept so bookmarks and
 * links still work. The (app) layout has already checked the person is signed-in staff; Reports
 * runs its own requireStaff().
 */
export default function InsightsPage() {
  redirect(HQ_ROUTES.reports);
}
