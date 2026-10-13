import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/planted";

/*
 * The web app manifest for the public PLANTED. site.
 *
 * `display: "browser"` is deliberate: this is a marketing website, not an
 * installable application, and claiming "standalone" would offer an install
 * prompt for something that has no offline or app-like behaviour. The manifest
 * earns its keep by naming the site and carrying the brand colours.
 *
 * The parked Tidewell app under /app keeps its own icon at app/pwa-icon, which
 * this manifest no longer points at — it draws the Tidewell tag mark, which is
 * the wrong brand for this site. That route is untouched and still served; if
 * the parked app ever needs its own install story it gets its own manifest.
 */

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: `${BRAND.tagline} Residential property management on the ${BRAND.region}.`,
    lang: "en-AU",
    start_url: "/",
    scope: "/",
    display: "browser",
    // Ivory page, charcoal chrome — the two anchors of the design system.
    background_color: "#F5F1EA",
    theme_color: "#252525",
    icons: [
      { src: "/icon", sizes: "64x64", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
