import { StatusChip } from "../../StatusChip";

/**
 * On a lead's page and its pipeline card: it came in through a form on the website. Its own file with
 * no server imports, because the pipeline board is a Client Component.
 */
export function WebsiteEnquiryChip({ className }: { className?: string }) {
  return (
    <StatusChip plain className={className} title="This lead came in through a form on plantedproperty.com.au">
      Website enquiry
    </StatusChip>
  );
}
