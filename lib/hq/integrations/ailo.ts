/*
 * Ailo, as HQ sees it: a REFERENCE, typed by a person. NOTHING IN HERE CALLS AILO.
 *
 * Ailo is the system of record for property management: properties, owners, tenancies, rent, trust
 * accounting, owner payments, maintenance and inspections. Planted HQ runs the company around it and
 * does not duplicate any of that.
 *
 * What is known and not known:
 *  - No public Ailo API, webhooks, developer portal or approved third-party integration route is
 *    known. Do not assume endpoints. Do not scrape Ailo. Do not store Ailo staff passwords or any
 *    Ailo credentials in HQ. Build no sync.
 *  - Until Ailo confirms an authorised route in writing, the only link between the two systems is the
 *    managed-property record in HQ (hq.managed_properties, migration 0129): its ailo_reference (the
 *    property's reference as shown in Ailo, typed by a person) and its ailo_status (not_started,
 *    set_up, live), plus the nine-step handover checklist that gets a newly signed property set up
 *    in Ailo by hand.
 *
 * To investigate with Ailo (a business conversation, not code): whether they offer API access,
 * webhooks or an approved integrations programme, and on what contractual terms.
 */

/** Where a value came from. Today everything is "manual": typed into HQ by a person. */
export type RecordSource = "manual";

/** The minimum HQ holds to refer to a property without owning it. Ailo holds the real record. */
export type PropertyRef = {
  /** HQ's own number for the managed property, e.g. "MP-0001". */
  hqReference: string;
  /** The property's reference in Ailo, typed by a person; null until recorded. Never invented, never synced. */
  ailoReference: string | null;
  /** How far the property has been set up in Ailo, as a person recorded it. */
  ailoStatus: "not_started" | "set_up" | "live";
  source: RecordSource;
  /** Display only (the address). */
  label: string;
};

/** Shown wherever a person might expect live Ailo data in HQ. */
export const AILO_REFERENCE_ONLY =
  "Ailo is where rent, trust accounting and maintenance live; HQ only records the reference. HQ is not connected to Ailo.";
