import type { Metadata } from "next";
import { Header } from "@/components/planted/Header";
import { Footer } from "@/components/planted/Footer";
import { Motion } from "@/components/planted/Motion";
import { BRAND, CONTACT } from "@/lib/planted";
import "./planted.css";

/*
 * The public PLANTED. site. Everything in this route group shares the header,
 * the footer and the design system; the parked Tidewell app under /app and
 * /stay sits outside it and is unaffected.
 */

const DESCRIPTION =
  "Residential property management that starts with people. Based on South Australia's Copper Coast, for owners of investment properties in Kadina, Wallaroo, Moonta and the communities around them.";

export const metadata: Metadata = {
  ...(CONTACT.url ? { metadataBase: new URL(CONTACT.url) } : {}),
  title: {
    default: `${BRAND.name} | ${BRAND.descriptor}, Copper Coast`,
    template: `%s | ${BRAND.name}`,
  },
  description: DESCRIPTION,
  applicationName: BRAND.name,
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    locale: "en_AU",
    title: `${BRAND.name} | ${BRAND.descriptor}, Copper Coast`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: BRAND.name, description: DESCRIPTION },
  robots: { index: true, follow: true },
  // No og:image yet: a real one is a pre-launch item in the README.
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Marks the document as scripted before first paint, so reveal states
          (planted.css) only ever hide content when the script that reveals it
          is going to run. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      <a href="#main" className="skip">
        Skip to content
      </a>
      <Header />
      <main id="main">{children}</main>
      <Footer />
      <Motion />
    </>
  );
}
