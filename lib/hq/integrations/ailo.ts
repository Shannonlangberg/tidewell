/*
 * PROPOSED internal interface for a future Ailo integration. NOTHING IN HERE CALLS AILO.
 *
 * Ailo is intended to be the source of truth for property management records: properties,
 * landlords, tenancies, rent, owner payments, maintenance and inspections. Planted HQ runs
 * the company around it and does not duplicate any of that.
 *
 * What is known and not known:
 *  - It has NOT been confirmed that Ailo offers a public API, webhooks or an approved
 *    third-party integration route. Do not assume endpoints. Do not scrape Ailo. Do not
 *    store Ailo staff passwords or any Ailo credentials in HQ.
 *  - The method names below (readProperties, readMaintenanceJobs, ...) are THIS project's
 *    proposed internal contract. They are not Ailo API methods and imply no Ailo endpoint.
 *  - Until an authorised integration is confirmed, HQ runs independently and the only
 *    implementation is the manual workflow at the bottom of this file.
 *
 * To investigate with Ailo (a business conversation, not code): whether they offer API
 * access, webhooks, property and maintenance retrieval, landlord and tenancy data, a
 * growth/CRM route, or an approved integrations programme, and on what contractual terms.
 */

/** Where a record came from, so a manual entry is never mistaken for synced data. */
export type RecordSource = "manual" | "ailo";

/** The minimum HQ needs to refer to a property without owning it. Ailo holds the real record. */
export type PropertyRef = {
  /** Planted's own identifier for the link. */
  hqReference: string;
  /** Ailo's identifier, once an authorised integration exists. Never invented. */
  externalId: string | null;
  source: RecordSource;
  /** Display only. */
  label: string;
};

export type ManagementSummary = {
  property: PropertyRef;
  /** ISO date the management began, if known. */
  managedFrom: string | null;
};

export type MaintenanceJobSummary = {
  property: PropertyRef;
  externalId: string | null;
  source: RecordSource;
  title: string;
  status: string;
};

export type GrowthOpportunityRef = {
  externalId: string | null;
  source: RecordSource;
  prospectLabel: string;
};

/** What an implementation must be able to do. All reads; HQ never writes property records. */
export interface PropertyManagementSystem {
  /** Which implementation this is, shown wherever data from it appears. */
  readonly kind: "manual" | "ailo";
  /** False until the integration is authorised and configured. Callers must check it. */
  readonly connected: boolean;

  readProperties(): Promise<PropertyRef[]>;
  readMaintenanceJobs(): Promise<MaintenanceJobSummary[]>;
  readManagements(): Promise<ManagementSummary[]>;
  readGrowthOpportunities(): Promise<GrowthOpportunityRef[]>;
  /** Record which Ailo id belongs to which HQ record, so the two can be linked. */
  syncPropertyReferences(links: ReadonlyArray<{ hqReference: string; externalId: string }>): Promise<void>;
}

const NOT_CONNECTED =
  "HQ is not connected to a property management system. Enter figures in HQ yourself, or connect Ailo once an authorised integration exists.";

/**
 * The only implementation today. It holds nothing and says so: every read is empty and the
 * UI shows "not connected" rather than a number. Anything staff enter by hand is labelled
 * `source: "manual"`.
 */
export const manualWorkflow: PropertyManagementSystem = {
  kind: "manual",
  connected: false,
  async readProperties() {
    return [];
  },
  async readMaintenanceJobs() {
    return [];
  },
  async readManagements() {
    return [];
  },
  async readGrowthOpportunities() {
    return [];
  },
  async syncPropertyReferences() {
    throw new Error(NOT_CONNECTED);
  },
};

export const notConnectedMessage = NOT_CONNECTED;
