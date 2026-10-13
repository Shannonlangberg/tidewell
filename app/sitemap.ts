import type { MetadataRoute } from "next";
import { AREAS, CONTACT } from "@/lib/planted";

/*
 * The sitemap for the public PLANTED. site.
 *
 * It lists only pages a visitor is meant to find in search. Deliberately absent:
 *   /app, /stay            the parked Tidewell product app — behind sign-in, not indexed
 *   /enquiry-received      a thank-you page that only makes sense after a submission
 *   /api                   route handlers, not pages
 * app/robots.ts disallows the same set.
 */

/**
 * Last time the published route list was reviewed. A constant rather than
 * `new Date()`, so a rebuild does not silently claim every page changed today.
 * Update it when routes are added or removed.
 */
const LAST_REVIEWED = "2026-10-14";

/**
 * Stand-in origin, used only when no real one has been configured. It is a
 * reserved, unresolvable TLD (RFC 2606) so it is obviously wrong if it ever
 * reaches production, rather than quietly pointing at somebody else's domain.
 * Setting NEXT_PUBLIC_SITE_URL (or CONTACT.url) is a pre-launch item in README.md.
 */
const PLACEHOLDER_ORIGIN = "https://planted.invalid";

/**
 * The absolute origin every sitemap entry is built from. Sitemaps may only
 * contain absolute URLs, so an unset or malformed value must not be allowed
 * through: `new URL()` throws on both and we fall back to the placeholder.
 *
 * app/robots.ts keeps its own copy of this — Next.js metadata route files should
 * export only the conventional names, so the two are not shared. Change both.
 */
function siteOrigin(): string {
  const configured = CONTACT.url ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  try {
    return new URL(configured).origin;
  } catch {
    return PLACEHOLDER_ORIGIN;
  }
}

type Entry = {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
};

const PAGES: Entry[] = [
  { path: "/", changeFrequency: "monthly", priority: 1 },
  { path: "/property-management", changeFrequency: "monthly", priority: 0.9 },
  { path: "/rental-appraisal", changeFrequency: "monthly", priority: 0.9 },
  { path: "/why-planted", changeFrequency: "monthly", priority: 0.8 },
  { path: "/our-approach", changeFrequency: "monthly", priority: 0.8 },
  { path: "/areas-we-serve", changeFrequency: "monthly", priority: 0.8 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.7 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

/** Suburb pages come straight from AREAS, so adding one there publishes it here. */
const AREA_PAGES: Entry[] = AREAS.map((area) => ({
  path: `/areas-we-serve/${area.slug}`,
  changeFrequency: "monthly",
  priority: 0.7,
}));

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();

  return [...PAGES, ...AREA_PAGES].map(({ path, changeFrequency, priority }) => ({
    url: `${origin}${path}`,
    lastModified: LAST_REVIEWED,
    changeFrequency,
    priority,
  }));
}
