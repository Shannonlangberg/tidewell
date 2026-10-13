/**
 * The facts PLANTED. states about itself in public.
 *
 * Anything `null` here is not yet confirmed, and every component that would show
 * it hides itself instead. Nothing on the public site may be invented: no phone
 * number, no email, no address, no ABN, no licence number, no statistics, no
 * testimonials, no awards. Fill these in once they are real (see README).
 */

export const BRAND = {
  name: "PLANTED.",
  /** Used in prose, where the full stop would read as the end of a sentence. */
  nameInText: "PLANTED",
  descriptor: "Property Management",
  /** For future group-level applications. Not used at launch. */
  groupDescriptor: "Property Group",
  tagline: "A better place for your property.",
  region: "Copper Coast, South Australia",
} as const;

/** Unconfirmed business facts. Null until real; never guessed. */
export const CONTACT = {
  /** e.g. "0400 000 000" */
  phone: null as string | null,
  /** e.g. "hello@plantedgroup.com.au" */
  email: null as string | null,
  /** e.g. "https://plantedgroup.com.au" — turns on canonical URLs and JSON-LD `url`. */
  url: null as string | null,
  /** e.g. "Planted Property Group Pty Ltd" */
  legalName: null as string | null,
  /** e.g. "ABN 00 000 000 000" */
  abn: null as string | null,
  /** South Australian land agent registration. Required before any managed service is sold. */
  licenceNumber: null as string | null,
  /** e.g. "Monday to Friday, 9am to 5pm" */
  businessHours: null as string | null,
  /** Postal or office address, once there is one. */
  address: null as string | null,
} as const;

/** Social accounts. Only rendered once an account actually exists. */
export const SOCIAL: { label: string; href: string }[] = [];

export type Area = {
  slug: string;
  name: string;
  /** One sentence of genuine local context. No market statistics. */
  intro: string;
  /** What makes managing here specific. Qualitative only. */
  character: string;
};

/**
 * Service areas. Descriptions are qualitative and verifiable from local knowledge;
 * no rental yields, vacancy rates or median rents appear anywhere (README explains why).
 */
export const AREAS: Area[] = [
  {
    slug: "kadina",
    name: "Kadina",
    intro:
      "The largest of the Copper Triangle towns and the commercial centre of the region, Kadina draws long-term tenants who work locally and want to stay put.",
    character:
      "A mix of character stone cottages, post-war homes and newer builds on the edges of town. Tenant demand here tends to come from people putting down roots rather than passing through.",
  },
  {
    slug: "wallaroo",
    name: "Wallaroo",
    intro:
      "A working port town with a deep-water harbour, a ferry link across Spencer Gulf and a steady residential community alongside the holiday trade.",
    character:
      "Housing runs from heritage cottages near the port to modern homes in the marina and newer estates. Properties close to the water need an owner and a manager who understand salt exposure.",
  },
  {
    slug: "moonta",
    name: "Moonta",
    intro:
      "Known for its Cornish mining heritage and its conservation-listed town centre, Moonta has a settled residential core a few minutes inland from the coast.",
    character:
      "Stone and brick homes on generous blocks, with newer development toward the bay. Maintenance planning matters on older housing stock, and tenants value homes that are genuinely looked after.",
  },
  {
    slug: "moonta-bay",
    name: "Moonta Bay",
    intro:
      "The coastal side of Moonta, with a long jetty, a swimming beach and a residential strip that has grown steadily over the past two decades.",
    character:
      "Family homes a few streets back from the water alongside newer coastal builds. A sought-after address for tenants who want the beach without a holiday-town feel.",
  },
  {
    slug: "north-beach",
    name: "North Beach",
    intro:
      "A quiet residential pocket north of Wallaroo, close to the sand and well regarded by tenants looking for space and calm.",
    character:
      "Predominantly detached homes on larger allotments. Coastal exposure makes proactive inspections and exterior maintenance particularly worthwhile.",
  },
  {
    slug: "port-hughes",
    name: "Port Hughes",
    intro:
      "A small coastal community south of Moonta Bay, known for its jetty, its boat ramp and the golf links on its doorstep.",
    character:
      "A smaller rental pool with a high proportion of newer homes. Owners here are often investors living elsewhere, which puts a premium on clear reporting and reliable local presence.",
  },
];

export const areaBySlug = (slug: string) => AREAS.find((a) => a.slug === slug);

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/** True once there is any published way to make contact. */
export const hasPublicContact = Boolean(CONTACT.phone || CONTACT.email);
