import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { propertyForOpportunity } from "@/lib/hq/portfolio/queries";
import { LinkButton } from "../../Button";

/*
 * "Make this a managed property", for a signed opportunity's page (builder A's
 * /hq/growth/opportunities/[id]). A self-contained Server Component: mount it with the opportunity's
 * id and stage, e.g.
 *
 *   <ConvertToManagedButton opportunityId={o.id} stage={o.stage} />
 *
 * What it shows:
 *   - the property already made from this opportunity: a link to it ("Managed property MP-0001");
 *   - a signed opportunity, to someone with portfolio.write: the button, which opens
 *     /hq/portfolio/new?opportunity=<id> (the form; the address, suburb and owner come from the
 *     opportunity, so nothing is typed twice);
 *   - anything else (not signed, no permission, a load error): nothing at all.
 * The button is a courtesy: convert_to_managed_property refuses an unsigned opportunity, a second
 * property for the same opportunity and a caller without portfolio.write.
 */
export async function ConvertToManagedButton({ opportunityId, stage, className }: { opportunityId: string; stage: string; className?: string }) {
  const { db, can } = await requireStaff();
  if (!can("portfolio.read")) return null;
  const existing = await propertyForOpportunity(db, opportunityId);
  if (!existing.ok) return null;
  if (existing.data) {
    return (
      <p className={className ?? "text-[14px]"}>
        <Link href={`/hq/portfolio/${existing.data.id}`} className="underline underline-offset-4">
          Managed property {existing.data.ref}
        </Link>
        {existing.data.archived ? " (archived)" : null}
      </p>
    );
  }
  if (stage !== "management_signed" || !can("portfolio.write")) return null;
  return (
    <LinkButton href={`/hq/portfolio/new?opportunity=${encodeURIComponent(opportunityId)}`} icon="building" className={className}>
      Make this a managed property
    </LinkButton>
  );
}
