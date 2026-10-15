import { StatusChip } from "@/components/hq/StatusChip";
import type { EmploymentStatus } from "@/lib/hq/constants";
import { EMPLOYMENT_LABEL } from "@/lib/hq/constants";

/** A person's standing as the database sees it: access needs is_active AND employment_status "active". */
export function staffStanding(s: { is_active: boolean; employment_status: EmploymentStatus }): EmploymentStatus {
  return !s.is_active || s.employment_status === "ended" ? "ended" : s.employment_status;
}

export function EmploymentChip({ standing }: { standing: EmploymentStatus }) {
  const tone = standing === "active" ? "success" : standing === "on_leave" ? "warning" : "neutral";
  return <StatusChip tone={tone}>{EMPLOYMENT_LABEL[standing]}</StatusChip>;
}
