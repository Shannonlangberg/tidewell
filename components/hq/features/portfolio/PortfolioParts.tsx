import Link from "next/link";
import type { ReactNode } from "react";
import {
  AILO_STATUS_LABEL,
  MANAGED_STATUS_LABEL,
  SERVICE_TYPE_SHORT,
  ailoStatusTone,
  managedStatusTone,
  type AiloStatus,
  type ManagedStatus,
  type ServiceType,
} from "@/lib/hq/portfolio/rules";
import type { PropertyRow } from "@/lib/hq/portfolio/queries";
import { DataTable, ResponsiveTable, type Column } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { StatusChip } from "../../StatusChip";

/*
 * Small pieces of the portfolio: the status (dot plus label, never colour alone), the service chip
 * (long-term or short-term accommodation), the Ailo status, the handover progress "n of 9", and the
 * compact list (a table from 768px, one card per property below). Server-rendered; nothing here is
 * interactive.
 */

export const propertyHref = (id: string) => `/hq/portfolio/${id}`;

export function ManagedStatusChip({ status }: { status: ManagedStatus }) {
  return <StatusChip tone={managedStatusTone(status)}>{MANAGED_STATUS_LABEL[status]}</StatusChip>;
}

/** The service as a plain chip with no dot: it is a kind, not a state. */
export function ServiceChip({ service }: { service: ServiceType }) {
  return (
    <span className="hq-pf-service" data-service={service}>
      {SERVICE_TYPE_SHORT[service]}
    </span>
  );
}

export function AiloChip({ status, prefix = false }: { status: AiloStatus; prefix?: boolean }) {
  return (
    <StatusChip tone={ailoStatusTone(status)} plain={status === "not_started"}>
      {prefix ? `Ailo: ${AILO_STATUS_LABEL[status].toLowerCase()}` : AILO_STATUS_LABEL[status]}
    </StatusChip>
  );
}

export function HandoverProgress({ done, total }: { done: number; total: number }) {
  const complete = total > 0 && done >= total;
  return (
    <span className="hq-nums hq-pf-progress" data-complete={complete ? "true" : undefined} aria-label={`Handover: ${done} of ${total} steps done`}>
      {done} of {total}
    </span>
  );
}

export function PropertiesTable({ rows, caption, empty }: { rows: readonly PropertyRow[]; caption: string; empty: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<PropertyRow>[] = [
    { key: "ref", header: "Ref", nowrap: true, width: "6.5rem", cell: (p) => <span className="tabular-nums text-grey-text">{p.ref}</span> },
    {
      key: "address",
      header: "Property",
      primary: true,
      cell: (p) => (
        <>
          <Link href={propertyHref(p.id)}>{p.propertyAddress}</Link>
          {p.suburb ? <span className="hq-cell-sub">{p.suburb}</span> : null}
        </>
      ),
    },
    { key: "owner", header: "Owner", hideBelow: "lg", cell: (p) => p.ownerDisplayName ?? <span className="hq-cell-nil">Not recorded</span> },
    { key: "service", header: "Service", nowrap: true, cell: (p) => <ServiceChip service={p.serviceType} /> },
    { key: "status", header: "Status", nowrap: true, cell: (p) => <ManagedStatusChip status={p.status} /> },
    { key: "handover", header: "Handover", nowrap: true, cell: (p) => <HandoverProgress done={p.handoverDone} total={p.handoverTotal} /> },
    { key: "ailo", header: "Ailo", nowrap: true, hideBelow: "lg", cell: (p) => <AiloChip status={p.ailoStatus} /> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(p) => p.id} />}
      list={
        <MobileList label="Managed properties">
          {rows.map((p) => (
            <li key={p.id} className="hq-mitem relative">
              <div className="hq-mitem__link">
                <Link href={propertyHref(p.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                  {p.propertyAddress}
                </Link>
                <span className="hq-mitem__sub">
                  {p.ref}
                  {p.suburb ? <> &middot; {p.suburb}</> : null}
                  {p.ownerDisplayName ? <> &middot; {p.ownerDisplayName}</> : null}
                </span>
                <span className="hq-mitem__row">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ManagedStatusChip status={p.status} />
                    <ServiceChip service={p.serviceType} />
                  </span>
                  <span className="hq-mitem__meta shrink-0 whitespace-nowrap">
                    Handover <HandoverProgress done={p.handoverDone} total={p.handoverTotal} />
                  </span>
                </span>
              </div>
            </li>
          ))}
        </MobileList>
      }
    />
  );
}
