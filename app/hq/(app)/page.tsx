import { PageHeader } from "@/components/hq";
import { requireStaff } from "@/lib/hq/auth";

/*
 * PLACEHOLDER while the dashboard is built. It exists so the signed-in shell has a page
 * to render. The dashboard builder replaces this file.
 */
export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { staff } = await requireStaff();
  return <PageHeader variant="welcome" title={`Good day, ${staff.firstName}.`} description="Dashboard coming next." />;
}
