import type { MetadataRoute } from "next";
import { CONTACT } from "@/lib/planted";

/*
 * robots.txt for the public PLANTED. site.
 *
 * The marketing pages are open to crawlers. Everything that is not a public
 * marketing page is closed:
 *   /app               the parked Tidewell product app — behind sign-in
 *   /hq                Planted HQ, the private staff portal — behind sign-in
 *   /stay              guest stay links, which are unguessable tokens
 *   /api/              route handlers, not pages
 *   /enquiry-received  only meaningful immediately after a form submission
 *
 * robots.txt is a crawling hint, not access control. The real protections are
 * sign-in, the X-Robots-Tag headers in next.config.mjs and netlify.toml, and
 * per-page `robots` metadata. This file just keeps those pages out of the index.
 */

/** See the note in app/sitemap.ts. Keep the two in step. */
const PLACEHOLDER_ORIGIN = "https://planted.invalid";

function siteOrigin(): string {
  const configured = CONTACT.url ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  try {
    return new URL(configured).origin;
  } catch {
    return PLACEHOLDER_ORIGIN;
  }
}

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Prefix matches: "/app" also covers "/app/owner" and friends. Any future
        // public route whose path begins with one of these would be caught too,
        // so check this list before naming a page /app… or /stay….
        disallow: ["/app", "/hq", "/stay", "/api/", "/enquiry-received"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
