import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/site";
import "./globals.css";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

const TITLE = `${SITE.name}: holiday homes, kept well`;
const DESCRIPTION =
  "Tidewell looks after holiday homes on the Copper Coast, South Australia, for owners who live two hours away. Guests, cleaners, pricing and repairs, with published prices.";

export const metadata: Metadata = {
  ...(SITE.url ? { metadataBase: new URL(SITE.url) } : {}),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: "en_AU",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = { themeColor: "#10382F" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body>{children}</body>
    </html>
  );
}
