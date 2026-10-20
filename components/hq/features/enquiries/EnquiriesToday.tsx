import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { plural } from "@/lib/hq/format";
import { countNewEnquiries } from "@/lib/hq/enquiry-queries";

/*
 * Today: one quiet line, "2 new website enquiries", linking to Communications > Enquiries filtered to New. Only for
 * people who can see enquiries (growth.read); nothing is shown when there are none.
 */
export async function EnquiriesToday() {
  const { db, can } = await requireStaff();
  if (!can("growth.read")) return null;
  const loaded = await countNewEnquiries(db);
  if (!loaded.ok) return <p className="hq-today__quiet">New website enquiries: this could not be loaded just now. Reload the page to try again.</p>;
  if (loaded.data === 0) return null;
  return (
    <p id="website-enquiries" className="hq-today__quiet">
      {plural(loaded.data, "new website enquiry", "new website enquiries")}.{" "}
      <Link href="/hq/communications/enquiries?status=new" className="hq-today__inline">
        See {loaded.data === 1 ? "it" : "them"}
      </Link>
    </p>
  );
}
