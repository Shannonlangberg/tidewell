import {
  PARTNER_CATEGORIES,
  PRIORITIES,
  RELATIONSHIP_STATUSES,
  type PartnerCategory,
  type Priority,
  type RelationshipStatus,
} from "../constants";
import { FormReader } from "../forms";

/*
 * Reads and validates the add / edit contact form. Every field is validated here, on the
 * server, whatever the browser did: lengths, uuids, enums, and the combinations that make no
 * sense (an existing organisation AND a new one).
 *
 * The caller checks `reader.ok`; `reader.errors` are field-level messages for the form.
 */

export type ContactFormValues = {
  id: string | null;
  /** The updated_at the person was looking at when they opened the edit form. */
  version: string | null;
  fullName: string;
  organisationId: string | null;
  newOrganisationName: string | null;
  position: string | null;
  categories: PartnerCategory[];
  phone: string | null;
  email: string | null;
  website: string | null;
  location: string | null;
  serviceRegion: string | null;
  ownerId: string | null;
  status: RelationshipStatus;
  priority: Priority;
  notes: string | null;
  wantsPrimary: boolean;
};

export function readContactForm(formData: FormData): { reader: FormReader; values: ContactFormValues } {
  const f = new FormReader(formData);

  const id = f.uuid("id");
  const version = f.text("version", { max: 64 });
  const fullName = f.requiredText("full_name", { label: "Full name", max: 200 });
  const organisationId = f.uuid("organisation_id");
  const newOrganisationName = f.text("new_organisation_name", { label: "Organisation name", max: 200 });
  const position = f.text("position", { label: "Position", max: 200 });
  const categories = f.manyOf("categories", PARTNER_CATEGORIES);
  if (categories.length === 0 && !f.errors.categories) f.errors.categories = "Choose at least one category.";
  const phone = f.phone("phone");
  const email = f.email("email");
  const website = f.url("website");
  const location = f.text("location", { label: "Location", max: 300 });
  const serviceRegion = f.text("service_region", { label: "Service region", max: 120 });
  const ownerId = f.uuid("relationship_owner_id");
  const status = f.oneOf("relationship_status", RELATIONSHIP_STATUSES, { fallback: "identified" }) ?? "identified";
  const priority = f.oneOf("priority", PRIORITIES, { fallback: "medium" }) ?? "medium";
  const notes = f.text("notes", { label: "Notes", max: 4000 });
  const wantsPrimary = f.bool("is_primary");

  if (organisationId && newOrganisationName) {
    f.errors.new_organisation_name = "Choose an existing organisation or enter a new one, not both.";
  }
  if (wantsPrimary && !organisationId && !newOrganisationName) {
    f.errors.is_primary = "Choose an organisation to make them its primary contact.";
  }

  return {
    reader: f,
    values: {
      id,
      version,
      fullName,
      organisationId,
      newOrganisationName,
      position,
      categories,
      phone,
      email,
      website,
      location,
      serviceRegion,
      ownerId,
      status,
      priority,
      notes,
      wantsPrimary,
    },
  };
}
